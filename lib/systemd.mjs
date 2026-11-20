import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync, unlinkSync } from 'fs'
import { homedir } from 'os'
import { dirname, isAbsolute, join, resolve } from 'path'
import { parseCalendar } from './calendar.mjs'
import { readCrontab } from './crontab.mjs'
import { makeId, parseBlocks } from './entry.mjs'
import { formatJobId, findRegistrationsForAdd, selectJobs, findEntriesForFile, findEntryIssues, findExecutable, isSupportedNodeVersion } from './job.mjs'
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

export function buildSystemdUnits(job, version = 2) {
  const metadata = Buffer.from(JSON.stringify(job)).toString('base64')
  const header = `# cronly-v${version} ${metadata}`
  // v1 disabled expansion with ':' (systemd 242+). Earlier managers support
  // literal dollars as '$$' in ExecStart. Environment= does not expand them.
  const execWord = value => version === 1 ? value : value.replace(/\$/g, () => '$$')
  const args = [job.logPath, dirname(job.path), job.runtimePath, job.path].filter(Boolean).map(value => unitWord(execWord(value)))
  const script = execWord('exec >>"$1" 2>&1; cd "$2" && shift 2 && exec "$@"')
  const shell = version === 1 ? ':/bin/sh' : '/bin/sh'
  const service = [
    header, '[Service]', 'Type=oneshot',
    `Environment=${unitWord('PATH=' + job.pathEnv)}`,
    `ExecStart=${shell} -c '${script}' cronly ${args.join(' ')}`,
  ].join('\n') + '\n'
  const timerHeader = version === 1 ? `# cronly-v1 ${job.id}` : header
  const timer = `${timerHeader}\n[Timer]\n${timerDirectives(job.schedule)}\nAccuracySec=1s\n\n[Install]\nWantedBy=timers.target\n`
  return { service, timer }
}

const kinds = ['service', 'timer']
function unitName(id, kind) { return `cronly-${id}.${kind}` }
function unitPath(id, kind) { return join(unitDir(), unitName(id, kind)) }

function readUnit(id, kind) {
  const path = unitPath(id, kind)
  try {
    if (!lstatSync(path).isFile()) throw new Error(invalidMessage(id))
    return readFileSync(path)
  } catch (err) {
    if (err.code === 'ENOENT') return null
    throw err
  }
}

function readDefinition(raw, id) {
  const match = /^# cronly-v([12]) ([A-Za-z0-9+/=]+)\n/.exec(raw)
  if (!match) throw new Error(invalidMessage(id))
  const job = JSON.parse(Buffer.from(match[2], 'base64').toString())
  if (job.backend !== 'systemd' || job.id !== id || !isAbsolute(job.path) || makeId(job.path, job.name) !== id) throw new Error(invalidMessage(id))
  return { job, version: Number(match[1]) }
}

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
      const service = readUnit(id, 'service')
      const timer = readUnit(id, 'timer')
      const raw = { service, timer }
      // Parse each surviving header independently before treating a pair as ours.
      const serviceDef = service && readDefinition(service, id)
      const legacyTimer = timer && timer.toString().startsWith(`# cronly-v1 ${id}\n`)
      const timerDef = timer && !legacyTimer && readDefinition(timer, id)
      if (timerDef && timerDef.version !== 2) throw new Error()
      if (serviceDef && timerDef && (serviceDef.job.path !== timerDef.job.path || serviceDef.job.name !== timerDef.job.name)) throw new Error()
      if (!service && legacyTimer) return { id, invalid: true, raw }
      const { job, version } = serviceDef || timerDef
      const expected = buildSystemdUnits(job, version)
      const serviceMatches = service && service.equals(Buffer.from(expected.service))
      const timerMatches = timer && timer.equals(Buffer.from(expected.timer))
      if (!serviceMatches || !timerMatches) {
        const readableLog = Boolean((!service && timerMatches) || (!timer && serviceMatches))
        return { ...job, invalid: true, raw, readableLog, recoveryTimer: expected.timer }
      }
      return { ...job, raw }
    } catch {
      return { id, invalid: true }
    }
  })
}

async function systemctl(args, track) {
  const result = await runScheduler('systemctl', ['--user', ...args], track)
  if (!result.ok) {
    const detail = `systemctl --user ${args.join(' ')}: ${result.detail}`
    if (args.includes('--property=Version') || !(await runScheduler('systemctl', ['--user', 'show', '--property=Version'], track)).ok) {
      throw new Error(t('systemd.unavailable', { detail }))
    }
    throw new Error(detail)
  }
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
  const unparsed = !properties.FragmentPath && ['not-found', 'bad-setting', 'error'].includes(properties.LoadState)
  if (overridden || (!unparsed && properties.FragmentPath !== unitPath(id, kind))) {
    throw new Error(t('systemd.foreign', { name }))
  }
  return properties
}

async function legacyJobs(track) {
  return findExecutable('crontab') ? parseBlocks(await readCrontab({ trackProcess: track })) : []
}

function invalidMessage(id) {
  return t('systemd.invalid', { id, path: unitPath(id, 'service'), timer: unitPath(id, 'timer') })
}

function hasInstallLink(id) {
  const name = unitName(id, 'timer')
  const dir = join(unitDir(), 'timers.target.wants')
  try {
    if (resolve(dir, readlinkSync(join(dir, name))) === unitPath(id, 'timer')) return true
  } catch (err) {
    if (err.code === 'ENOENT') return false
    if (err.code !== 'EINVAL') throw err
  }
  throw new Error(t('systemd.foreign', { name }))
}

// Snapshot enabled/active separately: a reboot timer is deliberately enabled
// without starting it in the registration session.
async function replace(previous, next, track) {
  for (const entry of previous) if (!entry.raw) throw new Error(invalidMessage(entry.id))
  const ids = new Set(previous.map(entry => entry.id))
  if (next) ids.add(next.id)
  const states = new Map()
  for (const id of ids) {
    await state(id, 'service', track)
    states.set(id, await state(id, 'timer', track))
  }
  const changed = []
  const previousFiles = new Map()
  const missingTimers = new Map()
  const ctl = (...args) => systemctl(args, track)
  let enabling = false
  try {
    for (const entry of previous) {
      const timer = unitName(entry.id, 'timer')
      const old = states.get(entry.id)
      if (!entry.raw.timer && hasInstallLink(entry.id)) old.UnitFileState = 'enabled'
      const startup = entry.schedule === '@reboot' || (!entry.schedule && entry.raw.timer.includes('OnStartupSec='))
      changed.push({ timer, old, startup })
      if (old.ActiveState === 'active') await ctl('stop', timer)
      // systemctl disable needs an install section to clean up even a dangling
      // timers.target.wants link after somebody deleted the timer file.
      if (!entry.raw.timer) {
        const path = unitPath(entry.id, 'timer')
        const original = entry.recoveryTimer
        atomicWrite(path, original)
        if (old.ActiveState === 'active' || old.UnitFileState === 'enabled') missingTimers.set(path, original)
        previousFiles.set(path, null)
      }
      if (old.UnitFileState === 'enabled' || !entry.raw.timer) await ctl('--no-reload', 'disable', timer)
    }
    for (const id of ids) {
      const old = previous.find(entry => entry.id === id)
      for (const kind of kinds) {
        const path = unitPath(id, kind)
        if (next && next.id === id) atomicWrite(path, next.raw[kind])
        else if (old.raw[kind] || previousFiles.has(path)) unlinkSync(path)
        else continue
        previousFiles.set(path, old && old.raw[kind])
      }
    }
    await ctl('daemon-reload')
    if (next) {
      for (const kind of kinds) {
        const { LoadState } = await state(next.id, kind, track)
        if (LoadState !== 'loaded') throw new Error(t('systemd.load_failed', { name: unitName(next.id, kind), state: LoadState }))
      }
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
      await restore(() => {
        const contents = raw || missingTimers.get(path)
        if (contents) atomicWrite(path, contents)
        else if (existsSync(path)) unlinkSync(path)
      })
    }
    if (previousFiles.size) await restore(() => ctl('daemon-reload'))
    for (const { timer, old, startup } of changed) {
      if (old.UnitFileState === 'enabled') await restore(() => ctl('--no-reload', 'enable', timer))
      // Restarting an elapsed startup timer would run the job a second time.
      if (old.ActiveState === 'active' && !startup) await restore(() => ctl('start', timer))
    }
    // The cached timer and its install link can predate a deleted file. Restore
    // those first, then put the disk back without reloading the manager again.
    for (const path of missingTimers.keys()) await restore(() => unlinkSync(path))
    if (failures.length) throw new Error(t('systemd.rollback', { message: error.message, rollback: failures.join(' / ') }))
    throw error
  }
}

export async function add(file, { schedule, runtime, name }) {
  const job = prepareNativeJob('systemd', file, schedule, runtime, name)
  job.raw = buildSystemdUnits(job)
  const previous = await withCrontabLock(async track => {
    if (findEntriesForFile(await legacyJobs(track), job.path).length) throw new Error(t('systemd.legacy_conflict', { path: job.path }))
    const previous = findRegistrationsForAdd(readSystemdEntries(), job.path, name)
    mkdirSync(unitDir(), { recursive: true })
    mkdirSync(dirname(job.logPath), { recursive: true })
    await replace(previous, job, track)
    return previous
  })
  console.log(t(previous.length ? 'commands.add.updated' : 'commands.add.created', job))
  for (const old of previous) if (old.path && old.path !== job.path) console.log(t('commands.add.replaced', old))
  console.log(t('commands.add.log_hint', { path: job.logPath }))
}

export async function remove(file, target) {
  const targets = await withCrontabLock(async track => {
    const entries = readSystemdEntries()
    const matches = selectJobs(entries, file, target, true)
    await replace(matches, null, track)
    return matches
  })
  for (const entry of targets) console.log(t('commands.remove.done', { id: entry.id, path: entry.path || unitPath(entry.id, 'timer') }))
}

export { readSystemdEntries as readEntries }

export async function run(job, track) {
  const service = await state(job.id, 'service', track)
  if (service.LoadState !== 'loaded') throw new Error(t('run.not_loaded', job))
  await systemctl(['--no-block', 'start', unitName(job.id, 'service')], track)
}

async function display(raw) {
  const entries = readSystemdEntries()
  if (!entries.length) console.log(t('systemd.empty'))
  for (const job of entries) {
    if (job.invalid) console.log(invalidMessage(job.id))
    else if (raw) console.log(job.raw.service + '\n' + job.raw.timer)
    else console.log(`  ${formatJobId(job)}  ${job.schedule.padEnd(15)}  ${job.path}  (${job.runtime}, systemd)`)
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
    const linger = await runScheduler('loginctl', ['show-user', String(process.getuid()), '--property=Linger'])
    if (linger.ok && linger.output.trim() === 'Linger=no') console.log(t('systemd.linger'))
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
    if (legacy.length) console.log(t('launchd.legacy_hint', { count: legacy.length }))
  } catch (err) {
    console.log(err.message)
    ok = false
  }
  console.log(ok ? t('doctor.summary_ok') : t('doctor.summary_fail'))
  return ok
}
