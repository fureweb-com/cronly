import { existsSync } from 'fs'
import { execFile } from 'child_process'
import { readCrontab, writeCrontab } from './crontab.mjs'
import { buildBlock, inferRuntime, makeId, normalizePath, parseBlocks } from './entry.mjs'

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
  if (!file) throw new Error('파일 경로를 지정해 주세요.')
  if (!schedule) throw new Error('--schedule 옵션이 필요해요. 예: --schedule "*/5 * * * *"')

  const absolutePath = normalizePath(file)

  if (!existsSync(absolutePath)) {
    throw new Error(`파일이 없어요: ${absolutePath}`)
  }

  if (!runtime) {
    runtime = inferRuntime(absolutePath)
    if (!runtime) {
      throw new Error(
        `런타임을 추론할 수 없어요. --runtime 옵션을 써 주세요. (node|sh|exec)`
      )
    }
  }

  const raw = await readCrontab()
  const blocks = parseBlocks(raw)
  const id = makeId(absolutePath)
  const existing = blocks.find((b) => b.id === id)

  const newBlock = buildBlock({ schedule, absolutePath, runtime })

  let newCrontab
  if (existing) {
    // update: replace old block with new
    newCrontab = raw.replace(existing.raw, newBlock)
    console.log(`업데이트했어요: ${absolutePath} (id=${id})`)
  } else {
    // append
    const trimmed = raw.replace(/\n+$/, '')
    newCrontab = trimmed ? `${trimmed}\n\n${newBlock}\n` : `${newBlock}\n`
    console.log(`등록했어요: ${absolutePath} (id=${id})`)
  }

  await writeCrontab(newCrontab)
}

// ── list ────────────────────────────────────────────────────────────────────

export async function list() {
  const raw = await readCrontab()
  const blocks = parseBlocks(raw)

  if (blocks.length === 0) {
    console.log('관리 중인 crontab 엔트리가 없어요.')
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
    throw new Error('삭제할 파일 경로 또는 --id를 지정해 주세요.')
  }

  const raw = await readCrontab()
  const blocks = parseBlocks(raw)

  let target
  if (id) {
    target = blocks.find((b) => b.id === id)
    if (!target) throw new Error(`해당 id의 엔트리를 찾을 수 없어요: ${id}`)
  } else {
    const absolutePath = normalizePath(file)
    const targetId = makeId(absolutePath)
    target = blocks.find((b) => b.id === targetId)
    if (!target) throw new Error(`해당 파일의 엔트리를 찾을 수 없어요: ${absolutePath}`)
  }

  const newCrontab = removeBlockFromCrontab(raw, target)

  await writeCrontab(newCrontab)
  console.log(`삭제했어요: ${target.path} (id=${target.id})`)
}

// ── print ───────────────────────────────────────────────────────────────────

export async function print() {
  const raw = await readCrontab()
  const blocks = parseBlocks(raw)

  if (blocks.length === 0) {
    console.log('관리 중인 crontab 엔트리가 없어요.')
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
    console.log('  ⚠ Node.js 14.8.0 이상이 필요해요.')
    ok = false
  }

  // crontab command
  const crontabExists = await new Promise((resolve) => {
    execFile('which', ['crontab'], (err) => resolve(!err))
  })
  console.log(`  crontab 명령: ${crontabExists ? '있어요' : '없어요'}`)
  if (!crontabExists) ok = false

  // crontab readable
  try {
    await readCrontab()
    console.log('  crontab 읽기: 성공했어요')
  } catch (e) {
    console.log(`  crontab 읽기: 실패했어요 (${e.message})`)
    ok = false
  }

  // managed entries count
  try {
    const raw = await readCrontab()
    const blocks = parseBlocks(raw)
    console.log(`  관리 중인 엔트리는 ${blocks.length}개예요`)
  } catch {
    // already reported
  }

  console.log()
  console.log(ok ? '모든 점검을 통과했어요.' : '일부 항목에 문제가 있어요.')
}
