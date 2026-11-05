import { randomBytes } from 'crypto'
import { lstatSync, mkdirSync, readdirSync, rmdirSync, unlinkSync, writeFileSync } from 'fs'
import { join } from 'path'
import { userInfo } from 'os'
import { t } from './i18n.mjs'

// User crontab is shared even when commands use different CRONLY_HOME/TMPDIR.
// Cronly targets POSIX systems; /tmp is shared by processes of the same user.
const LOCK_PATH = join('/tmp', `cronly-${userInfo().uid}-crontab.lock`)
const OWNER_PATTERN = /^owner-(\d+)-[a-f0-9]+$/
const EMPTY_LOCK_GRACE_MS = 30000

/** Reclaim only dead owners. Never recursively delete a successor's lock. */
export function reapAbandonedLock(lockPath, expectedUid = userInfo().uid) {
  try {
    const stat = lstatSync(lockPath)
    if (!stat.isDirectory() || stat.uid !== expectedUid) {
      throw new Error(t('crontab.lock_invalid', { path: lockPath }))
    }
    const owners = readdirSync(lockPath)
    if (owners.length === 0 && Date.now() - stat.mtimeMs < EMPTY_LOCK_GRACE_MS) return
    for (const owner of owners) {
      const match = OWNER_PATTERN.exec(owner)
      if (!match) throw new Error(t('crontab.lock_invalid', { path: lockPath }))
      try {
        process.kill(Number(match[1]), 0)
        // A live parent may still be handling a dead child's close callback.
        // Leave all markers alone until every recorded process has exited.
        return
      } catch (err) {
        if (err.code !== 'ESRCH') throw err
      }
    }
    // Removing specific owners first prevents two reapers from removing a
    // fresh lock: the second unlink fails with ENOENT. Never use recursive rm.
    for (const owner of owners) unlinkSync(join(lockPath, owner))
    rmdirSync(lockPath)
  } catch (err) {
    if (!['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes(err.code)) throw err
  }
}

/** Hold the lock across the entire read/modify/write operation. */
export async function withCrontabLock(action, { lockPath = LOCK_PATH, timeoutMs = 10000, pollMs = 50 } = {}) {
  const token = randomBytes(12).toString('hex')
  const owner = join(lockPath, `owner-${process.pid}-${token}`)
  const started = Date.now()
  while (true) {
    try {
      mkdirSync(lockPath, { mode: 0o700 })
      writeFileSync(owner, '', { mode: 0o600, flag: 'wx' })
      break
    } catch (err) {
      if (err.code !== 'EEXIST') throw err
      reapAbandonedLock(lockPath)
      if (Date.now() - started >= timeoutMs) throw new Error(t('crontab.lock_busy'))
      await new Promise((resolve) => setTimeout(resolve, pollMs))
    }
  }

  // A surviving crontab child must finish before another writer can reclaim
  // the lock, even if its parent CLI is killed during a macOS permission wait.
  const trackProcess = (pid) => {
    const childOwner = join(lockPath, `owner-${pid}-${token}`)
    writeFileSync(childOwner, '', { mode: 0o600, flag: 'wx' })
    return () => unlinkSync(childOwner)
  }
  try {
    return await action(trackProcess)
  } finally {
    unlinkSync(owner)
    rmdirSync(lockPath)
  }
}
