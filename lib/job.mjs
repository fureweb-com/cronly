import { accessSync, closeSync, constants, existsSync, openSync, readSync, statSync } from 'fs'
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

// The kernel reads at most 255 bytes of a #! line (127 before Linux 5.1).
const SHEBANG_BYTES = 256

/**
 * The interpreter a script names on its #! line: 'sh' for any sh, otherwise the
 * interpreter path, or the command name when the line goes through env.
 * Returns null when there is no #! line or the file cannot be read.
 */
export function readShebangRuntime(scriptPath) {
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

  const words = head.slice(2).split('\n')[0].trim().split(/\s+/)
  let interpreter = words[0]
  if (basename(interpreter) === 'env') {
    // "#!/usr/bin/env bash", possibly with options or assignments in front
    interpreter = words.slice(1).find((word) => !word.startsWith('-') && !word.includes('='))
  }
  if (!interpreter) return null
  return basename(interpreter) === 'sh' ? 'sh' : interpreter
}

/**
 * Runtime name and binary for a new job. Without --runtime the name comes from
 * the extension, and a .sh file runs with the interpreter its #! line names:
 * /bin/sh is dash on Debian and Ubuntu, where a "#!/bin/bash" script handed to
 * it fails on the first array or [[ ]]. Options on the #! line are not applied.
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
 * The interpreter a script asks for while its entry still runs it with /bin/sh.
 * Entries added before Cronly read the #! line keep doing so until they are
 * added again. Returns null when the entry and the script agree.
 */
export function findIgnoredShebang(block) {
  if (block.runtime !== 'sh') return null
  const declared = readShebangRuntime(block.path)
  return declared && declared !== 'sh' ? declared : null
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

