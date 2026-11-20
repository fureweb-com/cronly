import assert from 'assert/strict'
import { execFileSync, spawnSync } from 'child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { fileURLToPath } from 'url'
import { makeId } from '../lib/entry.mjs'

if (process.platform !== 'win32') throw new Error('Run this integration test in a Windows login session.')
const dir = mkdtempSync(join(tmpdir(), 'cronly-windows-'))
const file = join(dir, "한글 & '%TEMP%' report.cjs")
const id = makeId(file)
const env = { ...process.env, CRONLY_LANG: 'en', CRONLY_HOME: dir }
delete env.CRONLY_BACKEND
const cli = fileURLToPath(new URL('../bin/cronly.mjs', import.meta.url))
const run = (...args) => execFileSync(process.execPath, [cli, ...args], { env, encoding: 'utf8' })
const log = join(dir, 'logs', id + '.log')
const account = execFileSync('whoami.exe', ['/user', '/fo', 'csv', '/nh'], { encoding: 'utf8' })
const sid = account.match(/S-1-[0-9-]+/)[0]
const nativeName = jobId => 'Cronly-' + sid + '-' + jobId
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
let registered = false
try {
  writeFileSync(file, "console.log(require('fs').readFileSync('message.txt','utf8')); console.error('stderr works')")
  writeFileSync(join(dir, 'message.txt'), 'scheduled 한글')
  run('add', file, '--reboot')
  registered = true
  assert.match(run('print'), /<LogonTrigger>/)
  assert.ok(run('list').includes(file))
  run('add', file, '--weekdays', '--at', '09:00')
  assert.match(run('print'), /<Monday\s*\/>/)
  run('add', file, '--schedule', '10 9 15 * *')
  assert.match(run('print'), /<ScheduleByMonth>/)
  run('add', file, '--schedule', '10 9 * 1 1')
  assert.match(run('print'), /<ScheduleByMonthDayOfWeek>/)
  run('add', file, '--every-minutes', '1')
  assert.match(run('print'), /<Repetition>/)
  assert.equal(run('list').split(/\r?\n/).filter(line => line.includes(file)).length, 1)
  // Wait for the scheduler itself to launch the registered action.
  const deadline = Date.now() + 100_000
  while (Date.now() < deadline && !(existsSync(log) && readFileSync(log, 'utf8').includes('stderr works'))) {
    await delay(1000)
  }
  if (!existsSync(log)) {
    const details = execFileSync('schtasks.exe', ['/query', '/tn', nativeName(id), '/fo', 'LIST', '/v'], { encoding: 'utf8' })
    assert.fail('No log from the calendar trigger within 100 seconds.\n' + details)
  }
  assert.match(readFileSync(log, 'utf8'), /scheduled 한글\r?\nstderr works/)
  run('doctor')
  run('add', file, '--reboot')
  // Edit our disposable task independently of Cronly, as Task Scheduler's GUI would.
  const edit = [
    "$ErrorActionPreference='Stop'",
    '$s=New-Object -ComObject Schedule.Service', '$s.Connect()', "$f=$s.GetFolder('\\')",
    '$t=$f.GetTask($env:CRONLY_TEST_TASK)', '$d=$t.Definition',
    "$d.Actions.Item(1).Arguments='changed'",
    '$null=$f.RegisterTaskDefinition($t.Name,$d,4,$d.Principal.UserId,$null,3,$null)',
  ].join(';')
  execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', edit], { env: { ...env, CRONLY_TEST_TASK: nativeName(id) } })
  assert.ok(run('list').includes(nativeName(id)))
  for (const args of [['doctor'], ['run', '--id', id]]) {
    assert.equal(spawnSync(process.execPath, [cli, ...args], { env }).status, 1)
  }
  run('remove', '--id', id)
  registered = false
  assert.ok(!run('list').includes(file))
  const psFile = join(dir, 'hello world.ps1')
  const psName = 'ps-' + id
  const psId = makeId(psFile, psName)
  const psLog = join(dir, 'logs', psId + '.log')
  writeFileSync(psFile, "Write-Output 'PowerShell works'")
  run('add', psFile, '--name', psName, '--reboot')
  try {
    assert.equal(existsSync(psLog), false)
    run('run', '--name', psName)
    const deadline = Date.now() + 30000
    while (Date.now() < deadline && !(existsSync(psLog) && readFileSync(psLog, 'utf8').includes('PowerShell works'))) {
      await delay(250)
    }
    assert.match(run('logs', '--name', psName), /PowerShell works/)
  } finally {
    run('remove', psFile)
  }
  console.log('Windows Task Scheduler registered, updated, ran and removed the job.')
} finally {
  if (registered) run('remove', '--id', id)
  rmSync(dir, { force: true, recursive: true })
}
