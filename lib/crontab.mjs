import { execFile } from 'child_process'

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
        return reject(new Error(`crontab -l failed: ${stderr || err.message}`))
      }
      resolve(stdout)
    })
  })
}

/**
 * Write new content to the user crontab via stdin pipe.
 */
export function writeCrontab(content) {
  return new Promise((resolve, reject) => {
    const proc = execFile('crontab', ['-'], (err, _stdout, stderr) => {
      if (err) return reject(new Error(`crontab - failed: ${stderr || err.message}`))
      resolve()
    })
    proc.stdin.end(content)
  })
}
