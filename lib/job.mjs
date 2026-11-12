import { accessSync, closeSync, constants, existsSync, openSync, readFileSync, readSync, readdirSync, statSync } from 'fs'
import { homedir } from 'os'
import { basename, delimiter, dirname, isAbsolute, join, resolve } from 'path'
import { inferRuntime, inspectCommand, makeId } from './entry.mjs'
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
export function findEntriesForFile(blocks, absolutePath) {
  const id = makeId(absolutePath)
  return blocks.filter((b) => b.id === id || isSameFile(b.path, absolutePath))
}

function hasAccess(filePath, mode, directory = false) {
  try {
    accessSync(filePath, mode)
    const stat = statSync(filePath)
    return directory ? stat.isDirectory() : stat.isFile()
  } catch {
    return false
  }
}

function isExecutableFile(filePath) {
  return hasAccess(filePath, constants.X_OK)
}

/**
 * Absolute path of a command found through the absolute directories in PATH,
 * or null. Done here rather than with `which`, which minimal images lack.
 */
export function findExecutable(name, env = process.env) {
  const candidates = (env.PATH || '').split(delimiter).filter(isAbsolute).map((dir) => join(dir, name))
  return candidates.find(isExecutableFile) || null
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

  const found = runtime.includes('/')
    ? [resolve(runtime)].find(isExecutableFile)
    : findExecutable(runtime, env)
  if (!found) throw new Error(t('commands.add.runtime_not_found', { runtime }))
  return found
}

const CRON_DAEMON_NAMES = new Set(['cron', 'crond', 'fcron'])
// systemd-cron runs crontabs from timer units and has no daemon of its own.
const SYSTEMD_CRON_GENERATORS = [
  '/usr/lib/systemd/system-generators/systemd-crontab-generator',
  '/lib/systemd/system-generators/systemd-crontab-generator',
]

/**
 * Where the process list is read from. CRONLY_PROC_DIR lets tests supply one;
 * pointing it at a missing directory skips the cron daemon check. A substituted
 * list stands for another system, so this system's systemd-cron generator is
 * then not consulted either.
 */
export function getProcDir(env = process.env) {
  return env.CRONLY_PROC_DIR || '/proc'
}

function commandName(procDir, pid) {
  const args = readFileSync(join(procDir, pid, 'cmdline'), 'utf8').split('\0')
  // "busybox crond -f" names the applet in its first argument
  return basename(basename(args[0]) === 'busybox' && args[1] ? args[1] : args[0])
}

/**
 * Whether something on this machine runs crontabs: true, false, or null when
 * the process list cannot tell. It cannot without /proc (macOS, where cron is
 * started on demand) or when /proc hides the processes of other users, which
 * shows as an unreadable PID 1.
 */
export function isCronDaemonRunning(procDir = getProcDir(), generators = procDir === '/proc' ? SYSTEMD_CRON_GENERATORS : []) {
  let pids
  try {
    commandName(procDir, '1')
    pids = readdirSync(procDir).filter((name) => /^\d+$/.test(name))
  } catch {
    return null
  }
  if (generators.some((path) => existsSync(path))) return true
  return pids.some((pid) => {
    try {
      return CRON_DAEMON_NAMES.has(commandName(procDir, pid))
    } catch {
      return false // the process ended while the list was being read
    }
  })
}

// The kernel reads at most 255 bytes of a #! line (127 before Linux 5.1).
const SHEBANG_BYTES = 256

/**
 * The words on the #! line of a script, or null when it has no such line or
 * cannot be read.
 */
function readShebangWords(scriptPath) {
  let head
  try {
    const fd = openSync(scriptPath, 'r')
    try {
      const buffer = Buffer.alloc(SHEBANG_BYTES)
      head = buffer.toString('utf8', 0, readSync(fd, buffer, 0, SHEBANG_BYTES, 0))
    } finally {
      closeSync(fd)
    }
  } catch {
    return null
  }
  if (!head.startsWith('#!')) return null
  const words = head.slice(2).split('\n')[0].trim().split(/\s+/).filter(Boolean)
  return words.length > 0 ? words : null
}

/**
 * How a .sh file runs according to its #! line; null when it has none.
 *   'sh'            any sh, so these scripts keep running as they always have
 *   an interpreter  "#!/bin/bash" gives '/bin/bash' and "#!/usr/bin/env bash"
 *                   gives 'bash', pinned to an absolute path when the job is added
 *   'exec'          a line with arguments ("#!/bin/bash -e", "#!/bin/busybox sh",
 *                   "#!/usr/bin/env -S ...") on an executable file: only the
 *                   kernel applies such a line as written
 * Without the executable bit, a line with arguments keeps its interpreter when
 * the arguments are only options, which are then not applied. Otherwise the
 * script runs with sh as before: "busybox /path/job.sh" would look for an applet.
 */
export function readShebangRuntime(scriptPath) {
  const words = readShebangWords(scriptPath)
  if (!words) return null
  const viaEnv = basename(words[0]) === 'env'
  const [command, ...args] = viaEnv ? words.slice(1) : words
  if (command === undefined) return null

  // Options and assignments between env and the command are for env to read.
  const known = !viaEnv || !(command.startsWith('-') || command.includes('='))
  if (known && basename(command) === 'sh') return 'sh'
  if (known && args.length === 0) return command
  if (isExecutableFile(scriptPath)) return 'exec'
  return known && args.every((arg) => arg.startsWith('-')) ? command : 'sh'
}

/**
 * Runtime name and binary for a new job. Without --runtime the name comes from
 * the extension, and a .sh file follows its #! line (see readShebangRuntime):
 * /bin/sh is dash on Debian and Ubuntu, where a "#!/bin/bash" script handed to
 * it fails on the first array or [[ ]].
 */
export function resolveJobRuntime(scriptPath, requested, env = process.env) {
  const runtime = requested || inferRuntime(scriptPath)
  if (!runtime) throw new Error(t('commands.add.no_runtime'))

  const declared = !requested && runtime === 'sh' ? readShebangRuntime(scriptPath) : null
  if (!declared || declared === 'sh') {
    return { runtime, runtimePath: resolveRuntimePath(runtime, scriptPath, env) }
  }
  try {
    return { runtime: declared, runtimePath: resolveRuntimePath(declared, scriptPath, env) }
  } catch {
    throw new Error(t('commands.add.shebang_runtime_not_found', { runtime: declared, path: scriptPath }))
  }
}

/**
 * The #! line of a script (without the "#!") whose entry still runs it with
 * /bin/sh although adding it now would follow that line. Entries added before
 * Cronly read the #! line stay that way until they are added again. Returns
 * null when the entry and the script agree.
 */
export function findIgnoredShebang(block) {
  if (block.runtime !== 'sh') return null
  const declared = readShebangRuntime(block.path)
  return declared && declared !== 'sh' ? readShebangWords(block.path).join(' ') : null
}

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
  } else if (!hasAccess(block.path, block.runtime === 'exec' ? constants.X_OK : constants.R_OK)) {
    issues.push({ code: 'script_unusable', path: block.path })
  }
  const { runtimeBin, logPath } = block.backend === 'launchd'
    ? { runtimeBin: block.runtimePath, logPath: block.logPath }
    : inspectCommand(block.command, block.path)
  if (runtimeBin && isAbsolute(runtimeBin)) {
    if (!existsSync(runtimeBin)) {
      issues.push({ code: 'runtime_missing', path: runtimeBin })
    } else if (!isExecutableFile(runtimeBin)) {
      issues.push({ code: 'runtime_unusable', path: runtimeBin })
    }
  }
  if (logPath) {
    if (!existsSync(dirname(logPath))) {
      issues.push({ code: 'log_dir_missing', path: dirname(logPath) })
    } else if (!hasAccess(dirname(logPath), constants.W_OK | constants.X_OK, true)
      || (existsSync(logPath) && !hasAccess(logPath, constants.W_OK))) {
      issues.push({ code: 'log_unwritable', path: logPath })
    }
  }
  return issues
}

