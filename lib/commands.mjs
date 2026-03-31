import { existsSync } from 'fs'
import { execFile } from 'child_process'
import { readCrontab, writeCrontab } from './crontab.mjs'
import { buildBlock, inferRuntime, makeId, normalizePath, parseBlocks } from './entry.mjs'
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

// ── add ─────────────────────────────────────────────────────────────────────

export async function add(file, { schedule, runtime }) {
  if (!file) throw new Error(t('commands.add.no_file'))
  if (!schedule) throw new Error(t('commands.add.no_schedule'))

  const absolutePath = normalizePath(file)

  if (!existsSync(absolutePath)) {
    throw new Error(t('commands.add.file_not_found', { path: absolutePath }))
  }

  if (!runtime) {
    runtime = inferRuntime(absolutePath)
    if (!runtime) {
      throw new Error(t('commands.add.no_runtime'))
    }
  }

  const raw = await readCrontab()
  const blocks = parseBlocks(raw)
  const id = makeId(absolutePath)
  const existing = blocks.find((b) => b.id === id)

  const newBlock = buildBlock({ schedule, absolutePath, runtime })

  let newCrontab
  let isUpdate = false
  if (existing) {
    newCrontab = raw.replace(existing.raw, newBlock)
    isUpdate = true
  } else {
    const trimmed = raw.replace(/\n+$/, '')
    newCrontab = trimmed ? `${trimmed}\n\n${newBlock}\n` : `${newBlock}\n`
  }

  await writeCrontab(newCrontab)
  console.log(
    isUpdate
      ? t('commands.add.updated', { path: absolutePath, id })
      : t('commands.add.created', { path: absolutePath, id })
  )
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

  let target
  if (id) {
    target = blocks.find((b) => b.id === id)
    if (!target) throw new Error(t('commands.remove.id_not_found', { id }))
  } else {
    const absolutePath = normalizePath(file)
    const targetId = makeId(absolutePath)
    target = blocks.find((b) => b.id === targetId)
    if (!target) throw new Error(t('commands.remove.file_not_found', { path: absolutePath }))
  }

  const newCrontab = removeBlockFromCrontab(raw, target)

  await writeCrontab(newCrontab)
  console.log(t('commands.remove.done', { path: target.path, id: target.id }))
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
  try {
    await readCrontab()
    console.log(t('doctor.read_ok'))
  } catch (e) {
    console.log(t('doctor.read_fail', { message: e.message }))
    ok = false
  }

  // managed entries count
  try {
    const raw = await readCrontab()
    const blocks = parseBlocks(raw)
    console.log(t('doctor.entries', { count: blocks.length }))
  } catch {
    // already reported
  }

  console.log()
  console.log(ok ? t('doctor.summary_ok') : t('doctor.summary_fail'))
}
