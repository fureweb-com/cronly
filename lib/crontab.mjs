import { execFile } from 'child_process'
import { t } from './i18n.mjs'

// macOS asks for permission when an app without Full Disk Access changes the
// crontab, and crontab waits silently until the dialog is answered. The dialog
// can open behind other windows, so say so instead of looking frozen.
const PERMISSION_HINT_DELAY_MS = 3000

/**
 * Read the current user crontab. Returns '' if no crontab exists.
 */
export function readCrontab() {
  return new Promise((resolve, reject) => {
    execFile('crontab', ['-l'], (err, stdout, stderr) => {
      if (err) {
        // "no crontab for <user>" is normal
        if (stderr && /no crontab/i.test(stderr)) {
          return resolve('')
        }
        return reject(new Error(`crontab -l failed: ${stderr.trim() || err.message}`))
      }
      resolve(stdout)
    })
  })
}

/**
 * Write new content to the user crontab via stdin pipe.
 */
export function writeCrontab(content, { platform = process.platform, hintDelayMs = PERMISSION_HINT_DELAY_MS } = {}) {
  const onMac = platform === 'darwin'
  return new Promise((resolve, reject) => {
    const timer = onMac ? setTimeout(() => console.error(t('crontab.waiting_permission')), hintDelayMs) : null
    const proc = execFile('crontab', ['-'], (err, _stdout, stderr) => {
      clearTimeout(timer)
      if (err) {
        const detail = stderr.trim() || err.message
        const hint = onMac && /operation not permitted/i.test(detail) ? `\n${t('crontab.permission_denied')}` : ''
        return reject(new Error(`crontab - failed: ${detail}${hint}`))
      }
      resolve()
    })
    proc.stdin.end(content)
  })
}
