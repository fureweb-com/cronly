import { execFile } from 'child_process'
import { randomBytes } from 'crypto'
import { existsSync, renameSync, statSync, unlinkSync, writeFileSync } from 'fs'
import { join } from 'path'
import { makeId, normalizePath } from './entry.mjs'
import { getCronPath, getLogDir, resolveJobRuntime } from './job.mjs'
import { t } from './i18n.mjs'

export function nativeScriptPath(file, schedule) {
  if (!file) throw new Error(t('commands.add.no_file'))
  if (!schedule) throw new Error(t('commands.add.no_schedule'))
  const path = normalizePath(file)
  if (!existsSync(path)) throw new Error(t('commands.add.file_not_found', { path }))
  if (!statSync(path).isFile()) throw new Error(t('commands.add.not_a_file', { path }))
  return path
}

export function prepareNativeJob(backend, file, schedule, runtime) {
  const path = nativeScriptPath(file, schedule)
  const { runtime: jobRuntime, runtimePath } = resolveJobRuntime(path, runtime)
  const id = makeId(path)
  const logPath = join(getLogDir(), `${id}.log`)
  const pathEnv = getCronPath()
  if ([path, runtimePath, pathEnv, logPath].some((value) => /[\r\n]/.test(value))) throw new Error(t('entry.newline_path'))
  return { backend, id, path, runtime: jobRuntime, runtimePath, schedule, pathEnv, logPath }
}

export function atomicWrite(path, raw) {
  const temporary = `${path}.${randomBytes(6).toString('hex')}.tmp`
  try {
    writeFileSync(temporary, raw, { mode: 0o600, flag: 'wx' })
    renameSync(temporary, path)
  } finally {
    if (existsSync(temporary)) unlinkSync(temporary)
  }
}

export function runScheduler(command, args, trackProcess, input) {
  return new Promise((resolve) => {
    let untrack = () => {}
    const proc = execFile(command, args, { maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
      untrack()
      resolve({ ok: !err, output: stdout, detail: stderr.trim() || (err ? err.message : '') })
    })
    try {
      if (trackProcess && proc.pid) untrack = trackProcess(proc.pid)
    } catch {
      // The command is already running and ends within moments. Its result
      // must still be reported: a scheduler change that happened but looked like a
      // failure would not be undone when a later step fails.
    }
    if (input !== undefined) {
      // The bridge parses the entire JSON request before applying a change.
      // A missing command or a reader that exits early is reported by execFile.
      proc.stdin.on('error', () => {})
      proc.stdin.end(input)
    }
  })
}
