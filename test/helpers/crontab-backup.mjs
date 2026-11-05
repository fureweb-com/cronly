import { spawnSync } from 'child_process'

function failure(result) {
  return result.error || new Error((result.stderr || '').trim() || `crontab exited with ${result.status}`)
}

// Read existence and content together: a second read could observe another state.
export function readCrontabSnapshot() {
  const result = spawnSync('crontab', ['-l'], { encoding: 'utf8' })
  if (result.status === 0) return { exists: true, content: result.stdout }
  if (result.status === 1 && /^(?:crontab:\s*)?no crontab for\b/im.test(result.stderr || '')) {
    return { exists: false, content: '' }
  }
  throw failure(result)
}

export function restoreCrontabSnapshot(snapshot) {
  const result = spawnSync('crontab', [snapshot.exists ? '-' : '-r'], {
    input: snapshot.content, encoding: 'utf8',
  })
  if (result.status !== 0) throw failure(result)
}
