import { execFile } from 'child_process'
import { t } from './i18n.mjs'

// macOS asks for permission when an app without Full Disk Access changes the
// crontab, and crontab waits silently until the dialog is answered. The dialog
// can open behind other windows, so say so instead of looking frozen.
const PERMISSION_HINT_DELAY_MS = 3000

/**
 * Read the current user crontab. Returns '' if no crontab exists.
 */
export function readCrontab({ trackProcess } = {}) {
  return new Promise((resolve, reject) => {
    let untrack = () => {}
    const proc = execFile('crontab', ['-l'], (err, stdout, stderr) => {
      untrack()
      if (err) {
        // "no crontab for <user>" is normal
        if (stderr && /no crontab/i.test(stderr)) {
          return resolve('')
        }
        return reject(new Error(`crontab -l failed: ${stderr.trim() || err.message}`))
      }
      resolve(stdout)
    })
    if (trackProcess && proc.pid) untrack = trackProcess(proc.pid)
  })
}

/**
 * Write new content to the user crontab via stdin pipe.
 */
export function writeCrontab(content, { platform = process.platform, hintDelayMs = PERMISSION_HINT_DELAY_MS, trackProcess } = {}) {
  const onMac = platform === 'darwin'
  return new Promise((resolve, reject) => {
    let untrack = () => {}
    let trackingError = null
    const timer = onMac ? setTimeout(() => console.error(t('crontab.waiting_permission')), hintDelayMs) : null
    const proc = execFile('crontab', ['-'], (err, _stdout, stderr) => {
      untrack()
      clearTimeout(timer)
      if (trackingError) return reject(trackingError)
      if (err) {
        const detail = stderr.trim() || err.message
        const hint = onMac && /operation not permitted/i.test(detail) ? `\n${t('crontab.permission_denied')}` : ''
        return reject(new Error(`crontab - failed: ${detail}${hint}`))
      }
      resolve()
    })
    // crontab installs whatever it has read as soon as its input closes, so an
    // input that closes early replaces every job with nothing. Hand over the
    // whole crontab before any step that can fail.
    proc.stdin.write(content)
    try {
      if (trackProcess && proc.pid) untrack = trackProcess(proc.pid)
    } catch (err) {
      // Without a lock marker for the child the write is not safe to finish.
      // Stop the child while its input is still open: it then installs nothing.
      trackingError = err
      proc.kill('SIGKILL')
      return
    }
    proc.stdin.end()
  })
}
