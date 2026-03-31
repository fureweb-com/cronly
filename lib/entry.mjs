import { createHash } from 'crypto'
import { resolve } from 'path'
import { t } from './i18n.mjs'

const PREFIX = 'cronly'
const LEGACY_PREFIXES = ['scriptclock', 'crontab-agent']
const PARSEABLE_PREFIXES = [PREFIX, ...LEGACY_PREFIXES]
const PREFIX_PATTERN = PARSEABLE_PREFIXES.map((value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')

/**
 * Generate a stable dedupe id from an absolute path.
 * Returns first 8 hex chars of SHA-256.
 */
export function makeId(absolutePath) {
  return createHash('sha256').update(absolutePath).digest('hex').slice(0, 8)
}

/**
 * Normalize and resolve a script path to absolute form.
 */
export function normalizePath(filePath) {
  return resolve(filePath)
}

/**
 * Infer runtime from file extension.
 */
export function inferRuntime(filePath) {
  if (/\.(m?js|cjs)$/.test(filePath)) return 'node'
  if (/\.sh$/.test(filePath)) return 'sh'
  return null
}

/**
 * Build the runtime command prefix.
 */
function runtimePrefix(runtime) {
  if (runtime === 'node') return process.execPath
  if (runtime === 'sh') return '/bin/sh'
  if (runtime === 'exec') return ''
  return runtime
}

function assertSupportedPath(absolutePath) {
  if (/[\r\n]/.test(absolutePath)) {
    throw new Error(t('entry.newline_path'))
  }
}

/**
 * Shell-quote a path for safe use in a cron command line.
 * Wraps in single quotes and escapes any embedded single quotes.
 * Also escapes % which has special meaning in crontab (newline).
 */
function quotePath(p) {
  const escaped = p.replace(/'/g, "'\\''").replace(/%/g, '\\%')
  return `'${escaped}'`
}

/**
 * Build a crontab block (begin comment + cron line + end comment).
 */
export function buildBlock({ schedule, absolutePath, runtime }) {
  assertSupportedPath(absolutePath)
  const id = makeId(absolutePath)
  const prefix = runtimePrefix(runtime)
  const quoted = quotePath(absolutePath)
  const command = prefix ? `${quotePath(prefix)} ${quoted}` : quoted

  const lines = [
    `# [${PREFIX}:begin] id=${id} path=${absolutePath} runtime=${runtime}`,
    `${schedule} ${command}`,
    `# [${PREFIX}:end] id=${id}`,
  ]
  return lines.join('\n')
}

/**
 * Parse all managed blocks from raw crontab text.
 * Returns array of { id, path, runtime, schedule, command, raw, beginLine, endLine }.
 */
export function parseBlocks(crontabText) {
  const lines = crontabText.split('\n')
  const blocks = []
  let i = 0

  while (i < lines.length) {
    const beginMatch = lines[i].match(
      new RegExp(`^# \\[(${PREFIX_PATTERN}):begin\\] id=(\\w+) path=(.+?) runtime=(\\S+)$`)
    )
    if (!beginMatch) {
      i++
      continue
    }

    const prefix = beginMatch[1]
    const id = beginMatch[2]
    const path = beginMatch[3]
    const runtime = beginMatch[4]
    const beginLine = i

    // Next line should be the cron expression + command
    const cronLine = lines[i + 1] || ''
    // 5-field standard: "*/5 * * * * command"
    const fiveFieldMatch = cronLine.match(/^(\S+\s+\S+\s+\S+\s+\S+\s+\S+)\s+(.+)$/)
    // Cron alias: "@reboot command", "@daily command", etc.
    const aliasMatch = !fiveFieldMatch && cronLine.match(/^(@\w+)\s+(.+)$/)
    const cronMatch = fiveFieldMatch || aliasMatch
    const schedule = cronMatch ? cronMatch[1] : ''
    const command = cronMatch ? cronMatch[2] : cronLine

    // Find matching end
    const endPattern = `# [${prefix}:end] id=${id}`
    let endLine = i + 2
    if (lines[endLine] && lines[endLine].trim() === endPattern) {
      // found
    } else {
      // try to find it further down (shouldn't happen normally)
      endLine = lines.indexOf(endPattern, i + 2)
      if (endLine === -1) endLine = i + 2
    }

    const raw = lines.slice(beginLine, endLine + 1).join('\n')
    blocks.push({ id, path, runtime, schedule, command, raw, beginLine, endLine })
    i = endLine + 1
  }

  return blocks
}
