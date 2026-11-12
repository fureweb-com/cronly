import { getBackend } from './backend.mjs'
import * as launchd from './launchd.mjs'
import { findEntriesForFile, findEntryIssues, findExecutable, findIgnoredShebang, getCronPath, getLogDir, isCronDaemonRunning, isSupportedNodeVersion, resolveJobRuntime } from './job.mjs'
export { findEntryIssues, getCronPath, getLogDir, isSameFile, isSupportedNodeVersion, resolveRuntimePath } from './job.mjs'
import { existsSync, mkdirSync, statSync } from 'fs'
import { dirname, join } from 'path'
import { withCrontabLock } from './lock.mjs'
import { readCrontab, writeCrontab } from './crontab.mjs'
import { buildBlock, makeId, normalizePath, parseBlocks } from './entry.mjs'
import { t } from './i18n.mjs'

/**
 * Remove a managed block together with the empty line `add` puts in front of
 * it, so that remove undoes add and repeated changes do not pile up empty
 * lines. Nothing else is touched: the spacing of manual entries stays as it is.
 */
export function removeBlockFromCrontab(raw, target) {
  const lines = raw.split('\n')
  const block = target.raw.split('\n')
  const start = lines.findIndex((_, i) => block.every((line, k) => lines[i + k] === line))
  if (start === -1) return raw

  if (start > 0 && lines[start - 1] === '') {
    lines.splice(start - 1, block.length + 1)
  } else {
    lines.splice(start, block.length)
    // First entry of the file: the separator belongs to the entry below it.
    if (start === 0 && lines[0] === '') lines.shift()
  }
  const next = lines.join('\n')
  return next.trim() ? next : ''
}

// ── add ─────────────────────────────────────────────────────────────────────

export async function add(file, { schedule, runtime }) {
  if (getBackend() === 'launchd') return launchd.add(file, { schedule, runtime })
  if (!file) throw new Error(t('commands.add.no_file'))
  if (!schedule) throw new Error(t('commands.add.no_schedule'))

  const absolutePath = normalizePath(file)

  if (!existsSync(absolutePath)) {
    throw new Error(t('commands.add.file_not_found', { path: absolutePath }))
  }
  if (!statSync(absolutePath).isFile()) {
    throw new Error(t('commands.add.not_a_file', { path: absolutePath }))
  }

  const job = resolveJobRuntime(absolutePath, runtime)

  const id = makeId(absolutePath)
  const logPath = join(getLogDir(), `${id}.log`)
  const newBlock = buildBlock({ schedule, absolutePath, ...job, logPath, pathEnv: getCronPath() })

  const existing = await withCrontabLock(async (trackProcess) => {
    if (findEntriesForFile(launchd.readLaunchdEntries(), absolutePath).length) {
      throw new Error(t('backend.launchd_conflict', { path: absolutePath }))
    }
    const raw = await readCrontab({ trackProcess })
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
        newCrontab = removeBlockFromCrontab(newCrontab, duplicate)
      }
    } else {
      const trimmed = raw.replace(/\n+$/, '')
      newCrontab = trimmed ? `${trimmed}\n\n${newBlock}\n` : `${newBlock}\n`
    }

    mkdirSync(dirname(logPath), { recursive: true })
    await writeCrontab(newCrontab, { trackProcess })
    return existing
  })
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
  if (getBackend() === 'launchd') return launchd.list()
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
  // With both, the id used to win silently: a pasted "--id abc def" removed
  // job abc while the user meant something else.
  if (file && id) throw new Error(t('commands.remove.both_targets'))
  if (getBackend() === 'launchd') return launchd.remove(file, { id })
  if (!file && !id) {
    throw new Error(t('commands.remove.no_target'))
  }

  const targets = await withCrontabLock(async (trackProcess) => {
    const raw = await readCrontab({ trackProcess })
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

    await writeCrontab(newCrontab, { trackProcess })
    return targets
  })
  for (const target of targets) {
    console.log(t('commands.remove.done', { path: target.path, id: target.id }))
  }
}

// ── print ───────────────────────────────────────────────────────────────────

export async function print() {
  if (getBackend() === 'launchd') return launchd.print()
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

export async function doctor() {
  if (getBackend() === 'launchd') return launchd.doctor()
  let ok = true

  // Node.js version
  const nodeVer = process.version
  console.log(`  Node.js: ${nodeVer}`)
  if (!isSupportedNodeVersion(nodeVer)) {
    console.log(t('doctor.node_warning'))
    ok = false
  }

  // crontab command
  const crontabExists = findExecutable('crontab') !== null
  console.log(crontabExists ? t('doctor.crontab_found') : t('doctor.crontab_missing'))
  if (!crontabExists) ok = false

  // cron daemon: without one nothing in the crontab ever runs. Skipped where
  // the process list cannot tell (see isCronDaemonRunning).
  const daemonRunning = isCronDaemonRunning()
  if (daemonRunning !== null) {
    console.log(daemonRunning ? t('doctor.daemon_running') : t('doctor.daemon_missing'))
    if (!daemonRunning) ok = false
  }

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
      // A note, not a failure: the job may well work under /bin/sh.
      const shebang = findIgnoredShebang(block)
      if (shebang) console.log(t('doctor.shebang_ignored', { id: block.id, shebang }))
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
