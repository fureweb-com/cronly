import { spawn } from 'child_process'
import { once } from 'events'
import { closeSync, openSync } from 'fs'
import { homedir } from 'os'
import { splitCommandWords } from './entry.mjs'
import { t } from './i18n.mjs'

// Cron has no run-now API. Recognize the argv, cd, PATH and redirections
// written by Cronly (including older layouts) and start the script directly.
export async function runCronJob(job) {
  const words = splitCommandWords(job.command)
  let logPath
  if (words[words.length - 3] === '>>' && words[words.length - 1] === '2>&1') {
    logPath = words.splice(-3)[1]
  }
  if (words[0] === '{' && words.slice(-2).join(' ') === '; }') {
    words.shift()
    words.splice(-2)
  }
  let cwd = homedir()
  if (words[0] === 'cd' && words[2] === '&&') cwd = words.splice(0, 3)[1]
  const env = { ...process.env }
  if (words[0]?.startsWith('PATH=')) env.PATH = words.shift().slice(5)
  if (words.length > 2 || words[words.length - 1] !== job.path) throw new Error(t('run.cron_layout'))
  const log = logPath ? openSync(logPath, 'a') : undefined
  try {
    const child = spawn(words[0], words.slice(1), { cwd, env, stdio: ['ignore', log ?? 'inherit', log ?? 'inherit'] })
    const [code, signal] = await once(child, 'close')
    if (signal) throw new Error(t('run.signal', { signal }))
    return code
  } finally {
    if (log !== undefined) closeSync(log)
  }
}
