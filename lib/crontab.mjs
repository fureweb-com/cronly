import { execFile } from 'child_process'
import { t } from './i18n.mjs'

// macOS asks for permission when an app without Full Disk Access changes the
// crontab, and crontab waits silently until the dialog is answered. The dialog
// can open behind other windows, so say so instead of looking frozen.
const PERMISSION_HINT_DELAY_MS = 3000

// `crontab -l` fails when the user has no crontab yet, which is normal:
//   Vixie cron, cronie, macOS: "no crontab for <user>"
//   BusyBox (Alpine):          "can't open '<user>': No such file or directory"
// Any other failure, such as a permission error, must not be read as empty:
// the next write would replace a crontab that merely could not be read.
const NO_CRONTAB_PATTERN = /no crontab|can't open '[^']*': No such file or directory/i

/**
 * Length of the well-formed UTF-8 sequence starting at bytes[i], or 0 when
 * there is none (stray or truncated bytes, overlong forms, surrogates and
 * values above U+10FFFF).
 */
function utf8SequenceLength(bytes, i) {
  const lead = bytes[i]
  if (lead < 0x80) return 1
  let length
  let min = 0x80
  let max = 0xbf
  if (lead >= 0xc2 && lead <= 0xdf) {
    length = 2
  } else if (lead >= 0xe0 && lead <= 0xef) {
    length = 3
    if (lead === 0xe0) min = 0xa0
    else if (lead === 0xed) max = 0x9f
  } else if (lead >= 0xf0 && lead <= 0xf4) {
    length = 4
    if (lead === 0xf0) min = 0x90
    else if (lead === 0xf4) max = 0x8f
  } else {
    return 0
  }
  if (i + length > bytes.length) return 0
  if (bytes[i + 1] < min || bytes[i + 1] > max) return 0
  for (let k = 2; k < length; k++) {
    if ((bytes[i + k] & 0xc0) !== 0x80) return 0
  }
  return length
}

/**
 * Decode crontab bytes as UTF-8 without losing any of them. A byte that is not
 * part of valid UTF-8 becomes a lone surrogate (U+DC80-U+DCFF), which
 * encodeCrontab turns back into the same byte. A crontab holding comments or
 * paths in another encoding (EUC-KR, Latin-1, ...) therefore survives a
 * read-modify-write cycle byte for byte instead of turning into U+FFFD.
 */
export function decodeCrontab(bytes) {
  const text = bytes.toString('utf8')
  if (Buffer.from(text, 'utf8').equals(bytes)) return text

  let decoded = ''
  let start = 0
  let i = 0
  while (i < bytes.length) {
    const length = utf8SequenceLength(bytes, i)
    if (length) {
      i += length
      continue
    }
    decoded += bytes.toString('utf8', start, i) + String.fromCharCode(0xdc00 + bytes[i])
    i++
    start = i
  }
  return decoded + bytes.toString('utf8', start)
}

/**
 * Encode crontab text as UTF-8, restoring the bytes decodeCrontab escaped.
 */
export function encodeCrontab(text) {
  const chunks = []
  let start = 0
  // With the u flag a low surrogate that completes a pair is not matched.
  for (const match of text.matchAll(/[\udc80-\udcff]/gu)) {
    chunks.push(Buffer.from(text.slice(start, match.index), 'utf8'), Buffer.from([match[0].charCodeAt(0) - 0xdc00]))
    start = match.index + 1
  }
  chunks.push(Buffer.from(text.slice(start), 'utf8'))
  return Buffer.concat(chunks)
}

/**
 * Read the current user crontab. Returns '' if no crontab exists.
 */
export function readCrontab({ trackProcess } = {}) {
  return new Promise((resolve, reject) => {
    let untrack = () => {}
    const proc = execFile('crontab', ['-l'], { encoding: 'buffer' }, (err, stdout, stderr) => {
      untrack()
      if (err) {
        const detail = stderr.toString().trim()
        if (NO_CRONTAB_PATTERN.test(detail)) {
          return resolve('')
        }
        return reject(new Error(`crontab -l failed: ${detail || err.message}`))
      }
      resolve(decodeCrontab(stdout))
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
    let inputError = null
    const timer = onMac ? setTimeout(() => console.error(t('crontab.waiting_permission')), hintDelayMs) : null
    const proc = execFile('crontab', ['-'], (err, _stdout, stderr) => {
      untrack()
      clearTimeout(timer)
      if (trackingError) return reject(trackingError)
      // Input that did not arrive in full is a failed write, whatever the
      // exit status says.
      const failure = err || inputError
      if (failure) {
        const detail = stderr.trim() || failure.message
        const hint = onMac && /operation not permitted/i.test(detail) ? `\n${t('crontab.permission_denied')}` : ''
        return reject(new Error(`crontab - failed: ${detail}${hint}`))
      }
      resolve()
    })
    // crontab can refuse without reading its input, for a user in cron.deny for
    // example. Writing a crontab larger than the pipe buffer then fails with
    // EPIPE. Left unhandled, that stream error would crash the CLI; the
    // callback above reports it together with what crontab itself said.
    proc.stdin.on('error', (err) => { inputError = err })
    // crontab installs whatever it has read as soon as its input closes, so an
    // input that closes early replaces every job with nothing. Hand over the
    // whole crontab before any step that can fail.
    proc.stdin.write(encodeCrontab(content))
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
