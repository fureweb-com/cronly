import { lstatSync, mkdirSync, readFileSync, readdirSync, unlinkSync } from 'fs'
import { homedir } from 'os'
import { dirname, isAbsolute, join } from 'path'
import { parseCalendar } from './calendar.mjs'
import { readCrontab } from './crontab.mjs'
import { makeId, normalizePath, parseBlocks } from './entry.mjs'
import { findEntriesForFile, findEntryIssues, findExecutable, isSupportedNodeVersion } from './job.mjs'
import { withCrontabLock } from './lock.mjs'
import { atomicWrite, prepareNativeJob, runScheduler } from './native-scheduler.mjs'
import { t } from './i18n.mjs'

function unitDir() {
  const config = process.env.XDG_CONFIG_HOME
  return join(config && isAbsolute(config) ? config : join(homedir(), '.config'), 'systemd', 'user')
}

const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export function timerDirectives(schedule) {
  const parsed = parseCalendar(schedule)
  if (!parsed) return 'OnStartupSec=0'
  const [minute, hour, day, month, weekday] = parsed.values
  const field = (values) => values ? values.join(',') : '*'
  function calendar(dates, days) {
    const prefix = days ? days.map((d) => weekdays[d]).join(',') + ' ' : ''
    return `OnCalendar=${prefix}*-${field(month)}-${field(dates)} ${field(hour)}:${field(minute)}:00`
  }
  // OnCalendar combines date and weekday with AND. Two directives express OR.
  if (parsed.cronUsesAnd) return calendar(day, weekday)
  if (!day || !weekday) return calendar(null, null)
  return calendar(day, null) + '\n' + calendar(null, weekday)
}

function unitWord(value) {
  return '"' + value.replace(/[%\\"]/g, c => c === '%' ? '%%' : '\\' + c)
    .replace(/[\x00-\x1f\x7f]/g, c => '\\x' + c.charCodeAt(0).toString(16).padStart(2, '0')) + '"'
}

function units(job) {
  const metadata = Buffer.from(JSON.stringify(job)).toString('base64')
  const args = [job.logPath, dirname(job.path), job.runtimePath, job.path].filter(Boolean).map(unitWord)
  // The ':' prefix disables systemd's $ expansion. Only this fixed shell
  // program is interpreted. Every user-controlled value is a separate argv.
  const service = [
    `# cronly-v1 ${metadata}`, '[Service]', 'Type=oneshot',
    `Environment=${unitWord('PATH=' + job.pathEnv)}`,
    `ExecStart=:/bin/sh -c 'exec >>"$1" 2>&1; cd "$2" && shift 2 && exec "$@"' cronly ${args.join(' ')}`,
  ].join('\n') + '\n'
  const timer = `# cronly-v1 ${job.id}\n[Timer]\n${timerDirectives(job.schedule)}\nAccuracySec=1s\n\n[Install]\nWantedBy=timers.target\n`
  return { service, timer }
}

const kinds = ['service', 'timer']
function unitName(id, kind) { return `cronly-${id}.${kind}` }
function unitPath(id, kind) { return join(unitDir(), unitName(id, kind)) }

export function readSystemdEntries() {
  let names
  try { names = readdirSync(unitDir()) } catch (err) {
    if (err.code === 'ENOENT') return []
    throw err
  }
  const ids = new Set()
  for (const name of names) {
    const match = /^cronly-([a-f0-9]{8})\.(service|timer)$/.exec(name)
    if (match) ids.add(match[1])
  }
  return [...ids].sort().map(id => {
    try {
      const raw = {}
      for (const kind of kinds) {
        const path = unitPath(id, kind)
        if (!lstatSync(path).isFile()) throw new Error()
        raw[kind] = readFileSync(path, 'utf8')
      }
      const header = /^# cronly-v1 ([A-Za-z0-9+/=]+)\n/.exec(raw.service)
      const job = JSON.parse(Buffer.from(header[1], 'base64').toString())
      if (job.backend !== 'systemd' || job.id !== id || !isAbsolute(job.path) || makeId(job.path) !== id) throw new Error()
      const expected = units(job)
      if (expected.service !== raw.service || expected.timer !== raw.timer) throw new Error()
      return { ...job, raw }
    } catch {
      return { id, invalid: true }
    }
  })
}

async function systemctl(args, track) {
  const result = await runScheduler('systemctl', ['--user', ...args], track)
  if (!result.ok) throw new Error(`systemctl --user ${args.join(' ')}: ${result.detail}`)
  return result.output
}

async function state(id, kind, track) {
  const name = unitName(id, kind)
  const output = await systemctl(['show', '--property=LoadState,FragmentPath,DropInPaths,ActiveState,UnitFileState,Result', name], track)
  const properties = Object.fromEntries(output.trimEnd().split('\n').map(line => {
    const split = line.indexOf('=')
    return [line.slice(0, split), line.slice(split + 1)]
  }))
  // Distribution-wide service.d defaults also apply to user services.
  // Protect overrides for this particular unit while honoring those defaults.
  const overridden = properties.DropInPaths.includes('/' + name + '.d/')
  if (properties.LoadState !== 'not-found' && (properties.FragmentPath !== unitPath(id, kind) || overridden)) {
    throw new Error(t('systemd.foreign', { name }))
  }
  return properties
}

async function legacyJobs(track) {
  return findExecutable('crontab') ? parseBlocks(await readCrontab({ trackProcess: track })) : []
}

function invalidMessage(id) {
  return t('systemd.invalid', { path: unitPath(id, 'service'), timer: unitPath(id, 'timer') })
}

// Snapshot enabled/active separately: a reboot timer is deliberately enabled
// without starting it in the registration session.
async function replace(previous, next, track) {
  const ids = new Set(previous.map(entry => entry.id))
  if (next) ids.add(next.id)
  const states = new Map()
  for (const id of ids) {
    await state(id, 'service', track)
    states.set(id, await state(id, 'timer', track))
  }
  const changed = []
  const previousFiles = new Map()
  const ctl = (...args) => systemctl(args, track)
  let enabling = false
  try {
    for (const entry of previous) {
      const timer = unitName(entry.id, 'timer')
      const old = states.get(entry.id)
      changed.push({ timer, old, schedule: entry.schedule })
      if (old.ActiveState === 'active') await ctl('stop', timer)
      if (old.UnitFileState === 'enabled') await ctl('--no-reload', 'disable', timer)
    }
    for (const id of ids) {
      const old = previous.find(entry => entry.id === id)
      for (const kind of kinds) {
        const path = unitPath(id, kind)
        if (next && next.id === id) atomicWrite(path, next.raw[kind])
        else unlinkSync(path)
        previousFiles.set(path, old && old.raw[kind])
      }
    }
    await ctl('daemon-reload')
    if (next) {
      const timer = unitName(next.id, 'timer')
      enabling = true
      await ctl('--no-reload', 'enable', timer)
      if (next.schedule !== '@reboot') await ctl('start', timer)
    }
  } catch (error) {
    const failures = []
    async function restore(action) {
      try { await action() } catch (err) { failures.push(err.message) }
    }
    // A manager failure must not prevent restoration of the unit files.
    if (enabling) await restore(() => ctl('--no-reload', 'disable', '--now', unitName(next.id, 'timer')))
    for (const [path, raw] of previousFiles) {
      await restore(() => raw ? atomicWrite(path, raw) : unlinkSync(path))
    }
    if (previousFiles.size) await restore(() => ctl('daemon-reload'))
    for (const { timer, old, schedule } of changed) {
      if (old.UnitFileState === 'enabled') await restore(() => ctl('--no-reload', 'enable', timer))
      // Restarting an elapsed startup timer would run the job a second time.
      if (old.ActiveState === 'active' && schedule !== '@reboot') await restore(() => ctl('start', timer))
    }
    if (failures.length) throw new Error(t('systemd.rollback', { message: error.message, rollback: failures.join(' / ') }))
    throw error
  }
}

export async function add(file, { schedule, runtime }) {
  const job = prepareNativeJob('systemd', file, schedule, runtime)
  job.raw = units(job)
  const previous = await withCrontabLock(async track => {
    if (findEntriesForFile(await legacyJobs(track), job.path).length) throw new Error(t('systemd.legacy_conflict', { path: job.path }))
    const previous = findEntriesForFile(readSystemdEntries(), job.path)
    for (const entry of previous) if (entry.invalid) throw new Error(invalidMessage(entry.id))
    mkdirSync(unitDir(), { recursive: true })
    mkdirSync(dirname(job.logPath), { recursive: true })
    await replace(previous, job, track)
    return previous
  })
  console.log(t(previous.length ? 'commands.add.updated' : 'commands.add.created', job))
  for (const old of previous) if (old.path !== job.path) console.log(t('commands.add.replaced', old))
  console.log(t('commands.add.log_hint', { path: job.logPath }))
}

export async function remove(file, { id }) {
  if (!file && !id) throw new Error(t('commands.remove.no_target'))
  const targets = await withCrontabLock(async track => {
    const entries = readSystemdEntries()
    const matches = id ? entries.filter(job => job.id === id) : findEntriesForFile(entries, normalizePath(file))
    if (!matches.length) throw new Error(t(id ? 'commands.remove.id_not_found' : 'commands.remove.file_not_found', { id, path: file && normalizePath(file) }))
    for (const entry of matches) if (entry.invalid) throw new Error(invalidMessage(entry.id))
    await replace(matches, null, track)
    return matches
  })
  for (const entry of targets) console.log(t('commands.remove.done', entry))
}

async function display(raw) {
  const entries = readSystemdEntries()
  if (!entries.length) console.log(t('systemd.empty'))
  for (const job of entries) {
    if (job.invalid) console.log(invalidMessage(job.id))
    else if (raw) console.log(job.raw.service + '\n' + job.raw.timer)
    else console.log(`  ${job.id}  ${job.schedule.padEnd(15)}  ${job.path}  (${job.runtime}, systemd)`)
  }
  const legacy = await legacyJobs()
  if (legacy.length) console.log(t('launchd.legacy_hint', { count: legacy.length }))
}
export function list() { return display(false) }
export function print() { return display(true) }

export async function doctor() {
  let ok = isSupportedNodeVersion()
  console.log(`  Node.js: ${process.version}`)
  if (!ok) console.log(t('doctor.node_warning'))
  try {
    await systemctl(['show', '--property=Version'])
    const entries = readSystemdEntries()
    console.log(t('doctor.entries', { count: entries.length }))
    for (const [i, job] of entries.entries()) {
      if (job.invalid) {
        console.log(invalidMessage(job.id))
        ok = false
        continue
      }
      const timer = await state(job.id, 'timer')
      const service = await state(job.id, 'service')
      if (timer.UnitFileState !== 'enabled' || (timer.ActiveState !== 'active' && !(job.schedule === '@reboot' && timer.ActiveState === 'inactive'))
        || service.LoadState !== 'loaded' || service.Result !== 'success') {
        console.log(t('systemd.unhealthy', { id: job.id, timer: timer.ActiveState, enabled: timer.UnitFileState, result: service.Result }))
        ok = false
      }
      for (const issue of findEntryIssues(job, entries.slice(0, i))) {
        console.log(t(`doctor.${issue.code}`, { id: job.id, ...issue }))
        ok = false
      }
    }
    const legacy = await legacyJobs()
    if (legacy.length) {
      console.log(t('launchd.legacy_hint', { count: legacy.length }))
      ok = false
    }
  } catch (err) {
    console.log(err.message)
    ok = false
  }
  console.log(ok ? t('doctor.summary_ok') : t('doctor.summary_fail'))
  return ok
}
