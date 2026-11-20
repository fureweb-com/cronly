import { execFile } from 'child_process'
import { randomBytes } from 'crypto'
import { existsSync, renameSync, statSync, unlinkSync, writeFileSync } from 'fs'
import { join } from 'path'
import { createInterface } from 'readline'
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

export function prepareNativeJob(backend, file, schedule, runtime, name) {
  const path = nativeScriptPath(file, schedule)
  const { runtime: jobRuntime, runtimePath } = resolveJobRuntime(path, runtime)
  const id = makeId(path, name)
  const logPath = join(getLogDir(), `${id}.log`)
  const pathEnv = getCronPath()
  if ([path, runtimePath, pathEnv, logPath].some((value) => /[\r\n]/.test(value))) throw new Error(t('entry.newline_path'))
  return { backend, id, path, name, runtime: jobRuntime, runtimePath, schedule, pathEnv, logPath }
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

export function runScheduler(command, args, trackProcess, input, replyToLine) {
  return new Promise((resolve, reject) => {
    let untrack = () => {}
    let replyError
    const proc = execFile(command, args, { maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
      untrack()
      if (replyError) return reject(replyError)
      const output = replyToLine ? stdout.slice(stdout.indexOf('\n') + 1) : stdout
      resolve({ ok: !err, output, detail: stderr.trim() || (err ? err.message : '') })
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
      if (replyToLine) {
        // Keep the Windows bridge and its COM connection alive while Node
        // regenerates the expected definitions from the first response.
        const lines = createInterface({ input: proc.stdout, crlfDelay: Infinity })
        lines.once('line', line => {
          let reply
          try { reply = replyToLine(line) } catch (err) { replyError = err }
          proc.stdin.end(reply)
        })
        proc.stdin.write(input + '\n')
      } else proc.stdin.end(input)
    }
  })
}
