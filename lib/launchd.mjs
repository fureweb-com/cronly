import { execFile } from 'child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync } from 'fs'
import { homedir, userInfo } from 'os'
import { dirname, isAbsolute, join, resolve } from 'path'
import { randomBytes } from 'crypto'
import { makeId, normalizePath, parseBlocks } from './entry.mjs'
import { findEntriesForFile, findEntryIssues, findIgnoredShebang, getCronPath, getLogDir, isSupportedNodeVersion, resolveJobRuntime } from './job.mjs'
import { readCrontab } from './crontab.mjs'
import { withCrontabLock } from './lock.mjs'
import { compileLaunchdSchedule } from './launchd-schedule.mjs'
import { t } from './i18n.mjs'

export const LABEL_PREFIX = 'com.fureweb.cronly.'
export function getLaunchdDir(env = process.env) {
  return resolve(env.CRONLY_LAUNCHD_DIR || join(homedir(), 'Library', 'LaunchAgents'))
}
export function getLaunchdDomain() { return `gui/${userInfo().uid}` }

function xml(value) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')
}
function plist(value) {
  if (typeof value === 'string') return `<string>${xml(value)}</string>`
  if (typeof value === 'number') return `<integer>${value}</integer>`
  if (typeof value === 'boolean') return value ? '<true/>' : '<false/>'
  if (Array.isArray(value)) return `<array>${value.map(plist).join('')}</array>`
  return `<dict>${Object.entries(value).map(([key, entry]) => `<key>${xml(key)}</key>${plist(entry)}`).join('')}</dict>`
}
function metadata(job) {
  const { id, path, runtime, runtimePath, schedule, pathEnv, logPath } = job
  return { backend: 'launchd', id, path, runtime, runtimePath, schedule, pathEnv, logPath }
}
export function launchdConfig(job) {
  const trigger = compileLaunchdSchedule(job.schedule)
  return {
    Label: `${LABEL_PREFIX}${job.id}`,
    ProgramArguments: job.runtimePath ? [job.runtimePath, job.path] : [job.path],
    WorkingDirectory: dirname(job.path), EnvironmentVariables: { PATH: job.pathEnv },
    StandardOutPath: job.logPath, StandardErrorPath: job.logPath,
    RunAtLoad: !!trigger.runAtLoad,
    ...(trigger.calendar ? { StartCalendarInterval: trigger.calendar } : {}),
  }
}
export function buildLaunchdPlist(job) {
  const data = metadata(job)
  const encoded = Buffer.from(JSON.stringify(data)).toString('base64')
  return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<!-- cronly:${encoded} -->\n<plist version="1.0">${plist(launchdConfig(data))}</plist>\n`
}
/**
 * Every Cronly LaunchAgent file, valid or not. A job is trusted only when its
 * file is exactly what buildLaunchdPlist writes for the metadata it carries,
 * so that `list` cannot show one thing while launchd runs another. A file that
 * fails this (edited by hand, damaged, unreadable) is returned with `invalid`
 * set, and `newer` when it declares a layout this version does not know,
 * instead of failing the command: one bad file must not block every other job.
 *
 * The layout written by buildLaunchdPlist is therefore frozen. To change it,
 * add a numeric `format` to the metadata and keep the old builder for the
 * files that are already installed.
 */
export function readLaunchdEntries() {
  const dir = getLaunchdDir()
  if (!existsSync(dir)) return []
  return readdirSync(dir).filter((name) => name.startsWith(LABEL_PREFIX) && name.endsWith('.plist')).map((name) => {
    const label = name.slice(0, -'.plist'.length)
    const entry = { invalid: true, newer: false, id: label.slice(LABEL_PREFIX.length), label, plistPath: join(dir, name) }
    try {
      // The bytes are what a failed replacement puts back: a file Cronly did
      // not write, such as a binary plist, need not be valid UTF-8.
      entry.bytes = readFileSync(entry.plistPath)
      entry.raw = entry.bytes.toString('utf8')
      const match = /<!-- cronly:([A-Za-z0-9+/=]+) -->/.exec(entry.raw)
      const job = JSON.parse(Buffer.from(match[1], 'base64').toString('utf8'))
      // Lets `remove <file>` and a repeated `add` find the job by its script.
      if (typeof job.path === 'string') entry.path = job.path
      if (typeof job.format === 'number') {
        entry.newer = true
        throw new Error('unknown format')
      }
      for (const key of ['id', 'path', 'runtime', 'runtimePath', 'schedule', 'pathEnv', 'logPath']) {
        if (typeof job[key] !== 'string') throw new Error('invalid metadata')
      }
      if (job.backend !== 'launchd' || !isAbsolute(job.path) || job.id !== makeId(job.path)
        || name !== `${LABEL_PREFIX}${job.id}.plist` || !entry.bytes.equals(Buffer.from(buildLaunchdPlist(job)))) throw new Error('invalid job')
      return { ...job, label, plistPath: entry.plistPath, raw: entry.raw, bytes: entry.bytes }
    } catch {
      return entry
    }
  })
}
export function readLaunchdJobs() {
  return readLaunchdEntries().filter((entry) => !entry.invalid)
}
/**
 * Say which files were skipped and how to repair them. Returns their count.
 * `remove --id` is suggested only for an id Cronly could have produced: one
 * taken from a name such as "... copy.plist" would be split by the shell.
 */
function reportInvalid(entries) {
  const invalid = entries.filter((entry) => entry.invalid)
  for (const entry of invalid) {
    let key = 'launchd.invalid_entry'
    if (entry.newer) key = 'launchd.newer_entry'
    else if (entry.raw === undefined) key = 'launchd.unreadable_entry'
    else if (!/^[0-9a-f]{8}$/.test(entry.id)) key = 'launchd.stray_entry'
    console.log(t(key, { id: entry.id, path: entry.plistPath }))
  }
  return invalid.length
}
/** A file that could not be read cannot be put back if replacing it fails. */
function assertRestorable(entries) {
  for (const entry of entries) {
    if (entry.bytes === undefined) throw new Error(t('launchd.invalid_plist', { path: entry.plistPath }))
  }
}

export function runLaunchctl(args, trackProcess) {
  return new Promise((resolve) => {
    let untrack = () => {}
    const proc = execFile('launchctl', args, (err, stdout, stderr) => {
      untrack()
      resolve({ ok: !err, output: stdout, detail: stderr.trim() || (err ? err.message : '') })
    })
    try {
      if (trackProcess && proc.pid) untrack = trackProcess(proc.pid)
    } catch {
      // The command is already running and ends within moments. Its result
      // must still be reported: a bootout that happened but looked like a
      // failure would not be undone when a later step fails.
    }
  })
}
async function required(args, trackProcess) {
  const result = await runLaunchctl(args, trackProcess)
  if (!result.ok) throw new Error(t('launchd.command_failed', { command: args[0], message: result.detail }))
  return result.output
}
async function state(label, trackProcess) {
  const result = await runLaunchctl(['print', `${getLaunchdDomain()}/${label}`], trackProcess)
  if (!result.ok && !/Could not find service|No such process/i.test(result.detail)) {
    throw new Error(t('launchd.command_failed', { command: 'print', message: result.detail }))
  }
  return { loaded: result.ok, output: result.output }
}
function atomicWrite(path, raw) {
  const temporary = `${path}.${randomBytes(6).toString('hex')}.tmp`
  try {
    writeFileSync(temporary, raw, { mode: 0o600, flag: 'wx' })
    renameSync(temporary, path)
  } finally {
    if (existsSync(temporary)) unlinkSync(temporary)
  }
}

/** Restore both files and loaded jobs when registration or removal fails. */
async function replaceJobs(previous, next, trackProcess) {
  if (next && !previous.some((job) => job.label === next.label) && (await state(next.label, trackProcess)).loaded) {
    throw new Error(t('launchd.orphan_loaded', { id: next.id }))
  }
  const stopped = []
  let installed = false
  try {
    for (const job of previous) {
      if ((await state(job.label, trackProcess)).loaded) {
        await required(['bootout', `${getLaunchdDomain()}/${job.label}`], trackProcess)
        stopped.push(job)
      }
    }
    if (next) {
      atomicWrite(next.plistPath, next.raw)
      installed = true
      await required(['bootstrap', getLaunchdDomain(), next.plistPath], trackProcess)
    }
    for (const job of previous) if (!next || job.plistPath !== next.plistPath) unlinkSync(job.plistPath)
  } catch (error) {
    try {
      if (installed) {
        if ((await state(next.label, trackProcess)).loaded) await required(['bootout', `${getLaunchdDomain()}/${next.label}`], trackProcess)
        unlinkSync(next.plistPath)
      }
      for (const job of previous) atomicWrite(job.plistPath, job.bytes)
      for (const job of stopped) await required(['bootstrap', getLaunchdDomain(), job.plistPath], trackProcess)
    } catch (rollback) {
      throw new Error(t('launchd.rollback_failed', { message: error.message, rollback: rollback.message }))
    }
    throw error
  }
}
async function legacyJobs(trackProcess) {
  return parseBlocks(await readCrontab({ trackProcess }))
}
function legacyHint(jobs) {
  if (jobs.length) console.log(t('launchd.legacy_hint', { count: jobs.length }))
}

export async function add(file, { schedule, runtime }) {
  if (!file) throw new Error(t('commands.add.no_file'))
  if (!schedule) throw new Error(t('commands.add.no_schedule'))
  const path = normalizePath(file)
  if (!existsSync(path)) throw new Error(t('commands.add.file_not_found', { path }))
  if (!statSync(path).isFile()) throw new Error(t('commands.add.not_a_file', { path }))
  const { runtime: jobRuntime, runtimePath } = resolveJobRuntime(path, runtime)
  const id = makeId(path)
  const logPath = join(getLogDir(), `${id}.log`)
  const job = { backend: 'launchd', id, path, runtime: jobRuntime, runtimePath, schedule, pathEnv: getCronPath(), logPath }
  if ([path, runtimePath, job.pathEnv, logPath].some((value) => /[\r\n]/.test(value))) throw new Error(t('entry.newline_path'))
  job.label = `${LABEL_PREFIX}${id}`
  job.plistPath = join(getLaunchdDir(), `${job.label}.plist`)
  job.raw = buildLaunchdPlist(job)
  const existing = await withCrontabLock(async (trackProcess) => {
    const legacy = findEntriesForFile(await legacyJobs(trackProcess), path)
    if (legacy.length) throw new Error(t('launchd.legacy_conflict', { path }))
    // An invalid file for this script is replaced too: adding again repairs it.
    const previous = findEntriesForFile(readLaunchdEntries(), path)
    assertRestorable(previous)
    mkdirSync(getLaunchdDir(), { recursive: true })
    mkdirSync(dirname(logPath), { recursive: true })
    await replaceJobs(previous, job, trackProcess)
    return previous
  })
  console.log(t(existing.length ? 'commands.add.updated' : 'commands.add.created', { path, id }))
  for (const old of existing) if (!old.invalid && old.path !== path) console.log(t('commands.add.replaced', { path: old.path, id: old.id }))
  console.log(t('commands.add.log_hint', { path: logPath }))
}
export async function list() {
  const entries = readLaunchdEntries()
  const jobs = entries.filter((entry) => !entry.invalid)
  if (!jobs.length) console.log(t('launchd.empty'))
  for (const job of jobs) console.log(`  ${job.id}  ${job.schedule.padEnd(15)}  ${job.path}  (${job.runtime}, launchd)`)
  reportInvalid(entries)
  legacyHint(await legacyJobs())
}
export async function print() {
  const entries = readLaunchdEntries()
  const jobs = entries.filter((entry) => !entry.invalid)
  if (!jobs.length) console.log(t('launchd.empty'))
  for (const job of jobs) console.log(job.raw)
  reportInvalid(entries)
  legacyHint(await legacyJobs())
}
export async function remove(file, { id }) {
  if (!file && !id) throw new Error(t('commands.remove.no_target'))
  const targets = await withCrontabLock(async (trackProcess) => {
    // Invalid files can be removed as well, by id or by the script they name.
    const entries = readLaunchdEntries()
    const matches = id ? entries.filter((job) => job.id === id) : findEntriesForFile(entries, normalizePath(file))
    if (!matches.length) throw new Error(t(id ? 'commands.remove.id_not_found' : 'commands.remove.file_not_found', { id, path: normalizePath(file || '.') }))
    assertRestorable(matches)
    await replaceJobs(matches, null, trackProcess)
    return matches
  })
  for (const job of targets) console.log(t('commands.remove.done', { path: job.path || job.plistPath, id: job.id }))
}
export async function doctor() {
  let ok = true
  console.log(`  Node.js: ${process.version}`)
  if (!isSupportedNodeVersion()) { console.log(t('doctor.node_warning')); ok = false }
  try {
    await required(['print', getLaunchdDomain()])
    console.log(t('launchd.session_ok'))
    const entries = readLaunchdEntries()
    const jobs = entries.filter((entry) => !entry.invalid)
    console.log(t('doctor.entries', { count: jobs.length }))
    if (reportInvalid(entries)) ok = false
    for (let i = 0; i < jobs.length; i++) {
      const job = jobs[i]
      for (const issue of findEntryIssues(job, jobs.slice(0, i))) {
        console.log(t(`doctor.${issue.code}`, { id: job.id, ...issue })); ok = false
      }
      const shebang = findIgnoredShebang(job)
      if (shebang) console.log(t('doctor.shebang_ignored', { id: job.id, shebang }))
      const current = await state(job.label)
      if (!current.loaded) { console.log(t('launchd.not_loaded', { id: job.id })); ok = false }
      const failed = /last exit code = ([1-9]\d*)/.exec(current.output)
      if (failed) { console.log(t('launchd.last_failed', { id: job.id, code: failed[1] })); ok = false }
    }
    const legacy = await legacyJobs()
    legacyHint(legacy)
    if (legacy.length) ok = false
  } catch (error) {
    console.log(t('launchd.check_failed', { message: error.message })); ok = false
  }
  console.log(ok ? t('doctor.summary_ok') : t('doctor.summary_fail'))
  return ok
}
