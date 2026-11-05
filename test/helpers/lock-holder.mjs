import { spawn } from 'child_process'
import { withCrontabLock } from '../../lib/lock.mjs'

// Mimic a crontab child that outlives its CLI during a permission wait.
await withCrontabLock(async (trackProcess) => {
  const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { stdio: 'ignore' })
  trackProcess(child.pid)
  console.log(JSON.stringify({ childPid: child.pid }))
  await new Promise(() => {})
}, { lockPath: process.argv[2] })
