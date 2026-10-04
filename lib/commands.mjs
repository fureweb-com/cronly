import { accessSync, constants, existsSync, mkdirSync, statSync } from 'fs'
import { execFile } from 'child_process'
import { homedir } from 'os'
import { delimiter, dirname, isAbsolute, join, resolve } from 'path'
import { readCrontab, writeCrontab } from './crontab.mjs'
import { buildBlock, inferRuntime, inspectCommand, makeId, normalizePath, parseBlocks } from './entry.mjs'
import { t } from './i18n.mjs'

export function isSupportedNodeVersion(nodeVer = process.version) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(nodeVer)
  if (!match) return false

  const major = Number(match[1])
  const minor = Number(match[2])

  if (major > 14) return true
  if (major < 14) return false
  return minor >= 8
}

export function removeBlockFromCrontab(raw, target) {
  const next = raw.replace(target.raw, '')
  return next.trim() ? next : ''
}

/**
 * Directory for job logs: $CRONLY_HOME/logs, defaulting to ~/.cronly/logs.
 */
export function getLogDir(env = process.env) {
  return join(resolve(env.CRONLY_HOME || join(homedir(), '.cronly')), 'logs')
}

/**
 * PATH for cron jobs: cron's default plus the directory of the running node,
 * so scripts can call node, npm and npx.
 */
export function getCronPath() {
  return [...new Set([dirname(process.execPath), '/usr/bin', '/bin'])].join(':')
}

/**
 * Whether two paths point to the same file on disk. On macOS Report.mjs and
 * report.mjs are one file, and a symlink gives one file several paths.
 */
export function isSameFile(a, b) {
  try {
    const sa = statSync(a, { bigint: true })
    const sb = statSync(b, { bigint: true })
    return sa.dev === sb.dev && sa.ino === sb.ino
  } catch {
    return false
  }
}

/**
 * Managed entries for a script: the one registered under this exact path plus
 * any registered under another path to the same file.
 */
function findEntriesForFile(blocks, absolutePath) {
  const id = makeId(absolutePath)
  return blocks.filter((b) => b.id === id || isSameFile(b.path, absolutePath))
}

function isExecutableFile(filePath) {
  try {
    accessSync(filePath, constants.X_OK)
    return statSync(filePath).isFile()
  } catch {
    return false
  }
}

/**
 * Resolve the binary that runs the script, so a missing runtime fails here
 * instead of silently at cron time. Returns '' for exec (the script runs itself).
 */
export function resolveRuntimePath(runtime, scriptPath, env = process.env) {
  if (typeof runtime !== 'string' || /\s/.test(runtime)) {
    throw new Error(t('commands.add.invalid_runtime', { runtime }))
  }
  if (runtime === 'node') return process.execPath
  if (runtime === 'sh') return '/bin/sh'
  if (runtime === 'exec') {
    if (!isExecutableFile(scriptPath)) {
      throw new Error(t('commands.add.not_executable', { path: scriptPath }))
    }
    return ''
  }

  const candidates = runtime.includes('/')
    ? [resolve(runtime)]
    : (env.PATH || '').split(delimiter).filter(isAbsolute).map((dir) => join(dir, runtime))
  const found = candidates.find(isExecutableFile)
  if (!found) throw new Error(t('commands.add.runtime_not_found', { runtime }))
  return found
}

// ── add ─────────────────────────────────────────────────────────────────────

export async function add(file, { schedule, runtime }) {
  if (!file) throw new Error(t('commands.add.no_file'))
  if (!schedule) throw new Error(t('commands.add.no_schedule'))

  const absolutePath = normalizePath(file)

  if (!existsSync(absolutePath)) {
    throw new Error(t('commands.add.file_not_found', { path: absolutePath }))
  }
  if (!statSync(absolutePath).isFile()) {
    throw new Error(t('commands.add.not_a_file', { path: absolutePath }))
  }

  if (!runtime) {
    runtime = inferRuntime(absolutePath)
    if (!runtime) {
      throw new Error(t('commands.add.no_runtime'))
    }
  }
  const runtimePath = resolveRuntimePath(runtime, absolutePath)

  const id = makeId(absolutePath)
  const logPath = join(getLogDir(), `${id}.log`)
  const newBlock = buildBlock({ schedule, absolutePath, runtime, runtimePath, logPath, pathEnv: getCronPath() })

  const raw = await readCrontab()
  const blocks = parseBlocks(raw)
  // Entries for the same file under another path (letter case, symlink) are
  // replaced too, but cron keeps running the path given here, so a symlinked
  // deploy such as current -> releases/v2 keeps following the link.
  const existing = findEntriesForFile(blocks, absolutePath)

  let newCrontab
  if (existing.length > 0) {
    // A replacement string would expand $&, $` and $' found in the path
    newCrontab = raw.replace(existing[0].raw, () => newBlock)
    for (const duplicate of existing.slice(1)) {
      newCrontab = newCrontab.replace(duplicate.raw, '')
    }
  } else {
    const trimmed = raw.replace(/\n+$/, '')
    newCrontab = trimmed ? `${trimmed}\n\n${newBlock}\n` : `${newBlock}\n`
  }

  mkdirSync(dirname(logPath), { recursive: true })
  await writeCrontab(newCrontab)
  console.log(
    existing.length > 0
      ? t('commands.add.updated', { path: absolutePath, id })
      : t('commands.add.created', { path: absolutePath, id })
  )
  for (const entry of existing) {
    if (entry.path !== absolutePath) {
      console.log(t('commands.add.replaced', { path: entry.path, id: entry.id }))
    }
  }
  console.log(t('commands.add.log_hint', { path: logPath }))
}

// ── list ────────────────────────────────────────────────────────────────────

export async function list() {
  const raw = await readCrontab()
  const blocks = parseBlocks(raw)

  if (blocks.length === 0) {
    console.log(t('commands.list.empty'))
    return
  }

  const maxPathLen = Math.max(...blocks.map((b) => b.path.length))

  for (const b of blocks) {
    console.log(
      `  ${b.id}  ${b.schedule.padEnd(15)}  ${b.path.padEnd(maxPathLen)}  (${b.runtime})`
    )
  }
}

// ── remove ──────────────────────────────────────────────────────────────────

export async function remove(file, { id }) {
  if (!file && !id) {
    throw new Error(t('commands.remove.no_target'))
  }

  const raw = await readCrontab()
  const blocks = parseBlocks(raw)

  let targets
  if (id) {
    targets = blocks.filter((b) => b.id === id)
    if (targets.length === 0) throw new Error(t('commands.remove.id_not_found', { id }))
  } else {
    // Every entry for this file, including ones registered under another path
    const absolutePath = normalizePath(file)
    targets = findEntriesForFile(blocks, absolutePath)
    if (targets.length === 0) throw new Error(t('commands.remove.file_not_found', { path: absolutePath }))
  }

  let newCrontab = raw
  for (const target of targets) {
    newCrontab = removeBlockFromCrontab(newCrontab, target)
  }

  await writeCrontab(newCrontab)
  for (const target of targets) {
    console.log(t('commands.remove.done', { path: target.path, id: target.id }))
  }
}

// ── print ───────────────────────────────────────────────────────────────────

export async function print() {
  const raw = await readCrontab()
  const blocks = parseBlocks(raw)

  if (blocks.length === 0) {
    console.log(t('commands.print.empty'))
    return
  }

  for (const b of blocks) {
    console.log(b.raw)
    console.log()
  }
}

// ── doctor ──────────────────────────────────────────────────────────────────

/**
 * Report what would make a managed entry fail at cron time: a moved script,
 * a removed runtime (e.g. an uninstalled nvm version) or a deleted log directory.
 * An entry for the same file as an earlier entry is reported too, since both run.
 */
export function findEntryIssues(block, earlierBlocks = []) {
  const issues = []
  const original = earlierBlocks.find((b) => b.id === block.id || isSameFile(b.path, block.path))
  if (original) {
    issues.push({ code: 'duplicate', path: block.path, other: original.id })
  }
  if (!existsSync(block.path)) {
    issues.push({ code: 'script_missing', path: block.path })
  }
  const { runtimeBin, logPath } = inspectCommand(block.command, block.path)
  if (runtimeBin && isAbsolute(runtimeBin) && !existsSync(runtimeBin)) {
    issues.push({ code: 'runtime_missing', path: runtimeBin })
  }
  if (logPath && !existsSync(dirname(logPath))) {
    issues.push({ code: 'log_dir_missing', path: dirname(logPath) })
  }
  return issues
}

export async function doctor() {
  let ok = true

  // Node.js version
  const nodeVer = process.version
  console.log(`  Node.js: ${nodeVer}`)
  if (!isSupportedNodeVersion(nodeVer)) {
    console.log(t('doctor.node_warning'))
    ok = false
  }

  // crontab command
  const crontabExists = await new Promise((resolve) => {
    execFile('which', ['crontab'], (err) => resolve(!err))
  })
  console.log(crontabExists ? t('doctor.crontab_found') : t('doctor.crontab_missing'))
  if (!crontabExists) ok = false

  // crontab readable
  let raw = null
  try {
    raw = await readCrontab()
    console.log(t('doctor.read_ok'))
  } catch (e) {
    console.log(t('doctor.read_fail', { message: e.message }))
    ok = false
  }

  // managed entries
  if (raw !== null) {
    const blocks = parseBlocks(raw)
    console.log(t('doctor.entries', { count: blocks.length }))
    let broken = false
    blocks.forEach((block, i) => {
      for (const issue of findEntryIssues(block, blocks.slice(0, i))) {
        console.log(t(`doctor.${issue.code}`, { id: block.id, ...issue }))
        broken = true
      }
    })
    if (broken) {
      console.log(t('doctor.entries_hint'))
      ok = false
    }
  }

  console.log()
  console.log(ok ? t('doctor.summary_ok') : t('doctor.summary_fail'))
  return ok
}
