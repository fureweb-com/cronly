import { spawnSync } from 'child_process'

function failure(result) {
  return result.error || new Error(String(result.stderr || '').trim() || `crontab exited with ${result.status}`)
}

// Read existence and content together: a second read could observe another state.
// The bytes are kept as read, so a crontab that is not UTF-8 is restored unchanged.
export function readCrontabSnapshot() {
  const result = spawnSync('crontab', ['-l'])
  if (result.status === 0) return { exists: true, content: result.stdout.toString('utf8'), bytes: result.stdout }
  // "no crontab for <user>" (Vixie cron, cronie, macOS) or BusyBox's "can't open '<user>': No such file or directory"
  if (result.status === 1 && /^(?:crontab:\s*)?(?:no crontab for\b|can't open '[^']*': No such file or directory)/im.test(String(result.stderr || ''))) {
    return { exists: false, content: '', bytes: Buffer.alloc(0) }
  }
  throw failure(result)
}

// CRONLY_TEST_RESTORE marks this call for the sandboxed crontab used by the
// unit tests; the real crontab ignores it.
export function restoreCrontabSnapshot(snapshot) {
  const result = spawnSync('crontab', [snapshot.exists ? '-' : '-r'], {
    input: snapshot.bytes, env: { ...process.env, CRONLY_TEST_RESTORE: '1' },
  })
  if (result.status !== 0) throw failure(result)
}
