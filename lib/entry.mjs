import { createHash } from 'crypto'
import { dirname, resolve } from 'path'
import { t } from './i18n.mjs'

const PREFIX = 'cronly'
const LEGACY_PREFIXES = ['scriptclock', 'crontab-agent']
const PARSEABLE_PREFIXES = [PREFIX, ...LEGACY_PREFIXES]
const PREFIX_PATTERN = PARSEABLE_PREFIXES.map((value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')
const BEGIN_PATTERN = new RegExp(`^# \\[(${PREFIX_PATTERN}):begin\\] id=(\\w+) path=(.+?) runtime=(\\S+)$`)

/**
 * Vixie-derived cron (macOS, Debian) silently truncates commands longer than this.
 */
export const MAX_COMMAND_BYTES = 999

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

function assertSupportedPath(value) {
  if (/[\r\n]/.test(value)) {
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
 *
 * The job runs from the script's directory, because cron otherwise starts
 * it in $HOME and relative paths (.env, config files) stop resolving.
 * runtimePath overrides the binary derived from runtime, pathEnv sets PATH
 * for the job, and logPath appends stdout/stderr to that file.
 */
export function buildBlock({ schedule, absolutePath, runtime, runtimePath, logPath, pathEnv }) {
  for (const value of [absolutePath, runtimePath, logPath, pathEnv]) {
    if (value) assertSupportedPath(value)
  }
  const id = makeId(absolutePath)
  const prefix = runtimePath !== undefined ? runtimePath : runtimePrefix(runtime)

  const words = ['cd', quotePath(dirname(absolutePath)), '&&']
  if (pathEnv) words.push(`PATH=${quotePath(pathEnv)}`)
  if (prefix) words.push(quotePath(prefix))
  words.push(quotePath(absolutePath))
  if (logPath) words.push('>>', quotePath(logPath), '2>&1')
  const command = words.join(' ')

  const length = Buffer.byteLength(command)
  if (length > MAX_COMMAND_BYTES) {
    throw new Error(t('entry.command_too_long', { length, max: MAX_COMMAND_BYTES }))
  }

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
    const beginMatch = lines[i].match(BEGIN_PATTERN)
    if (!beginMatch) {
      i++
      continue
    }

    const prefix = beginMatch[1]
    const id = beginMatch[2]
    const path = beginMatch[3]
    const runtime = beginMatch[4]
    const beginLine = i
    const endPattern = `# [${prefix}:end] id=${id}`

    // Next line should be the cron expression + command
    const next = lines[i + 1]
    const hasCronLine = next !== undefined && next.trim() !== endPattern && !BEGIN_PATTERN.test(next)
    const cronLine = hasCronLine ? next : ''
    // Cron alias: "@reboot command", "@daily command", etc.
    // Checked first: a long alias command also has five words in front.
    const aliasMatch = cronLine.match(/^(@\w+)\s+(.+)$/)
    // 5-field standard: "*/5 * * * * command"
    const fiveFieldMatch = !aliasMatch && cronLine.match(/^(\S+\s+\S+\s+\S+\s+\S+\s+\S+)\s+(.+)$/)
    const cronMatch = aliasMatch || fiveFieldMatch
    const schedule = cronMatch ? cronMatch[1] : ''
    const command = cronMatch ? cronMatch[2] : cronLine

    // Find the matching end, but never past the start of the next managed block.
    // Without an end marker the block covers only the begin and cron lines.
    let endLine = hasCronLine ? i + 1 : i
    for (let j = i + 1; j < lines.length && !BEGIN_PATTERN.test(lines[j]); j++) {
      if (lines[j].trim() === endPattern) {
        endLine = j
        break
      }
    }

    const raw = lines.slice(beginLine, endLine + 1).join('\n')
    blocks.push({ id, path, runtime, schedule, command, raw, beginLine, endLine })
    i = endLine + 1
  }

  return blocks
}

/**
 * Split a cron command into shell words, undoing the quoting buildBlock
 * applies ('...', '\'' and crontab's \%).
 */
export function splitCommandWords(command) {
  const words = []
  let word = null
  let quoted = false

  for (let i = 0; i < command.length; i++) {
    const ch = command[i]
    if (ch === '\\' && command[i + 1] === '%') {
      word = (word || '') + '%'
      i++
    } else if (quoted) {
      if (ch === "'") quoted = false
      else word += ch
    } else if (ch === "'") {
      quoted = true
      word = word || ''
    } else if (ch === '\\' && i + 1 < command.length) {
      word = (word || '') + command[i + 1]
      i++
    } else if (/\s/.test(ch)) {
      if (word !== null) words.push(word)
      word = null
    } else {
      word = (word || '') + ch
    }
  }
  if (word !== null) words.push(word)

  return words
}

/**
 * Find the runtime binary and log file used by a managed cron command.
 * Either is null when the command does not have one.
 */
export function inspectCommand(command, scriptPath) {
  const words = splitCommandWords(command)
  const before = words[words.indexOf(scriptPath) - 1]
  const runtimeBin = before && before !== '&&' && !before.startsWith('PATH=') ? before : null
  const logIndex = words.indexOf('>>')
  const logPath = logIndex === -1 ? null : words[logIndex + 1] || null
  return { runtimeBin, logPath }
}
