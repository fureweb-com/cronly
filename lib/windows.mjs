import { existsSync, mkdirSync, readFileSync, statSync } from 'fs'
import { basename, delimiter, dirname, extname, isAbsolute, join, resolve } from 'path'
import { makeId } from './entry.mjs'
import { formatJobId, findRegistrationsForAdd, selectJobs, findEntryIssues, getLogDir, isSupportedNodeVersion } from './job.mjs'
import { withCrontabLock } from './lock.mjs'
import { atomicWrite, nativeScriptPath, runScheduler } from './native-scheduler.mjs'
import { launcherPath, scriptHostPath, windowsLauncher, windowsTaskXml } from './windows-task.mjs'
import { t } from './i18n.mjs'

function powershell() {
  return join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
}

async function request(data, track, replyToLine) {
  const script = readFileSync(new URL('./windows-tasks.ps1', import.meta.url), 'utf8')
  const result = await runScheduler(powershell(), ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script], track, JSON.stringify(data), replyToLine)
  if (!result.ok) throw new Error(t('windows.failed', { message: result.detail }))
  return result.output
}

function readTask(entry, sid, definitions) {
  try {
    const job = JSON.parse(entry.metadata)
    if (entry.source !== 'Cronly/v1' || job.backend !== 'windows' || job.id !== entry.id
      || (job.name !== undefined && makeId(job.path, job.name) !== job.id)
      || ![job.path, job.runtimePath, job.logPath, job.nodePath].every(isAbsolute)
      || typeof job.runtime !== 'string' || typeof job.schedule !== 'string') throw new Error()
    definitions[entry.id] = windowsTaskXml(job, sid)
    return { ...job, entry }
  } catch {
    return { id: entry.id, invalid: true, entry }
  }
}

async function snapshot(track, checkScriptHost = false) {
  let sid, jobs, blockedBy
  const result = await request({ op: 'list', checkScriptHost }, track, line => {
    const listing = JSON.parse(line)
    sid = listing.sid
    blockedBy = listing.blockedBy
    const definitions = {}
    jobs = listing.entries.map(entry => readTask(entry, sid, definitions))
    return JSON.stringify(definitions)
  })
  const changed = new Set(JSON.parse(result))
  for (const job of jobs) {
    if (changed.has(job.id)) job.invalid = true
    if (job.invalid) job.nativeName = `Cronly-${sid}-${job.id}`
  }
  return { sid, jobs, blockedBy }
}

export function windowsRuntime(file, requested) {
  const ext = extname(file).toLowerCase()
  const runtimes = { '.js': 'node', '.mjs': 'node', '.cjs': 'node', '.ps1': 'powershell', '.exe': 'exec' }
  const runtime = requested || runtimes[ext]
  if (!runtime) throw new Error(t('windows.runtime'))
  let runtimePath
  if (runtime === 'node') runtimePath = process.execPath
  else if (runtime === 'exec') {
    if (ext !== '.exe') throw new Error(t('windows.runtime'))
    runtimePath = file
  } else if (runtime === 'powershell') runtimePath = powershell()
  else {
    const name = /\.exe$/i.test(runtime) ? runtime : runtime + '.exe'
    const paths = /[\\/]/.test(name) ? [resolve(name)] : (process.env.PATH || '').split(delimiter).filter(isAbsolute).map(dir => join(dir, name))
    runtimePath = paths.find(path => existsSync(path) && statSync(path).isFile())
    if (!runtimePath) throw new Error(t('commands.add.runtime_not_found', { runtime }))
  }
  const args = runtime === 'exec' ? [] : [file]
  if (/^(powershell|pwsh)\.exe$/i.test(basename(runtimePath))) args.unshift('-NoProfile', '-NonInteractive', '-File')
  return { runtime, runtimePath, args }
}

function launcherReady(job) {
  if (job.launcher !== 'wscript-v1') return true
  const path = launcherPath()
  return existsSync(path) && readFileSync(path, 'utf8') === windowsLauncher
}

function requireScriptHost(blockedBy) {
  if (blockedBy) throw new Error(t('windows.wsh_blocked', { key: blockedBy }))
}

function checkManaged(job) {
  if (job.invalid) throw new Error(t('windows.invalid', job))
}

export async function add(file, { schedule, runtime, name }) {
  const path = nativeScriptPath(file, schedule)
  const resolved = windowsRuntime(path, runtime)
  const { job, updated } = await withCrontabLock(async track => {
    const { sid, jobs, blockedBy } = await snapshot(track, true)
    requireScriptHost(blockedBy)
    const previous = findRegistrationsForAdd(jobs, path, name)
    if (previous.length > 1) throw new Error(t('windows.duplicates'))
    const old = previous[0]
    if (old) checkManaged(old)
    // Update the same native task even when the new path is a symlink. The
    // service performs one create/update; a rejected definition retains the old one.
    const id = old ? old.id : makeId(path, name)
    const logPath = join(getLogDir(), id + '.log')
    const job = { backend: 'windows', id, path, name, schedule, ...resolved, nodePath: process.execPath, logPath, launcher: 'wscript-v1' }
    const host = scriptHostPath()
    if (!existsSync(host)) throw new Error(t('commands.add.runtime_not_found', { runtime: host }))
    const xml = windowsTaskXml(job, sid)
    mkdirSync(dirname(logPath), { recursive: true })
    const launcher = launcherPath()
    mkdirSync(dirname(launcher), { recursive: true })
    if (!existsSync(launcher)) atomicWrite(launcher, windowsLauncher)
    else if (!launcherReady(job)) throw new Error(t('windows.launcher', { path: launcher }))
    await request({ op: old ? 'update' : 'create', id, xml, previousXml: old && old.entry.xml }, track)
    return { job, updated: Boolean(old) }
  })
  console.log(t(updated ? 'commands.add.updated' : 'commands.add.created', job))
  console.log(t('commands.add.log_hint', { path: job.logPath }))
}

export async function readEntries(track) {
  return (await snapshot(track)).jobs
}

export async function run(job, track) {
  if (!launcherReady(job)) throw new Error(t('windows.launcher', { path: launcherPath() }))
  const blockedBy = await request({ op: 'run', id: job.id, previousXml: job.entry.xml, checkScriptHost: job.launcher === 'wscript-v1' }, track)
  requireScriptHost(blockedBy)
}

async function display(raw) {
  const { jobs } = await snapshot()
  if (!jobs.length) console.log(t('windows.empty'))
  for (const job of jobs) {
    if (job.invalid) console.log(t('windows.invalid', job))
    else if (raw) console.log(job.entry.xml)
    else console.log(`  ${formatJobId(job)}  ${job.schedule.padEnd(15)}  ${job.path}  (${job.runtime}, windows)`)
  }
}
export function list() { return display(false) }
export function print() { return display(true) }

export async function remove(file, target) {
  await withCrontabLock(async track => {
    const { jobs } = await snapshot(track)
    const matches = selectJobs(jobs, file, target, true)
    for (const job of matches) {
      if (!target.id || job.entry.source !== 'Cronly/v1') checkManaged(job)
    }
    for (const job of matches) {
      await request({ op: 'remove', id: job.id, previousXml: job.entry.xml }, track)
      console.log(t('commands.remove.done', { id: job.id, path: job.path || job.nativeName }))
    }
  })
}

export async function doctor() {
  let ok = isSupportedNodeVersion()
  console.log(`  Node.js: ${process.version}`)
  if (!ok) console.log(t('doctor.node_warning'))
  try {
    const { jobs, blockedBy } = await snapshot(undefined, true)
    if (blockedBy) {
      console.log(t('windows.wsh_blocked', { key: blockedBy }))
      ok = false
    } else if (!existsSync(scriptHostPath())) {
      console.log(t('commands.add.runtime_not_found', { runtime: scriptHostPath() }))
      ok = false
    }
    console.log(t('doctor.entries', { count: jobs.length }))
    for (const [i, job] of jobs.entries()) {
      if (job.invalid) {
        console.log(t('windows.invalid', job))
        ok = false
        continue
      }
      for (const issue of findEntryIssues(job, jobs.slice(0, i))) {
        console.log(t(`doctor.${issue.code}`, { id: job.id, ...issue }))
        ok = false
      }
      if (!launcherReady(job)) {
        console.log(t('windows.launcher', { path: launcherPath() }))
        ok = false
      }
      if (!existsSync(job.nodePath)) {
        console.log(t('doctor.runtime_missing', { id: job.id, path: job.nodePath }))
        ok = false
      }
      // SCHED_S_TASK_RUNNING and SCHED_S_TASK_HAS_NOT_RUN are normal states.
      if (!job.entry.enabled || ![0, 0x41301, 0x41303].includes(job.entry.result)) {
        console.log(t('windows.unhealthy', { id: job.id, result: job.entry.result }))
        ok = false
      }
    }
  } catch (err) {
    console.log(err.message)
    ok = false
  }
  console.log(ok ? t('doctor.summary_ok') : t('doctor.summary_fail'))
  return ok
}
