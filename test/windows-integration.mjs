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
const env = { ...process.env, CRONLY_LANG: 'en', CRONLY_HOME: join(dir, 'logs %TEMP% & 한글') }
delete env.CRONLY_BACKEND
const cli = fileURLToPath(new URL('../bin/cronly.mjs', import.meta.url))
const run = (...args) => execFileSync(process.execPath, [cli, ...args], { env, encoding: 'utf8' })
const log = join(env.CRONLY_HOME, 'logs', id + '.log')
const account = execFileSync('whoami.exe', ['/user', '/fo', 'csv', '/nh'], { encoding: 'utf8' })
const sid = account.match(/S-1-[0-9-]+/)[0]
const nativeName = jobId => 'Cronly-' + sid + '-' + jobId
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))

function checkScriptHostPolicy() {
  // Use the real bridge and registry view, with its lookup redirected to a
  // disposable HKCU subkey so the account's actual Script Host policy stays in effect.
  const subkey = 'Software\\Cronly-WSH-test-' + id
  const key = 'HKCU\\' + subkey
  const bridge = readFileSync(new URL('../lib/windows-tasks.ps1', import.meta.url), 'utf8')
    .replace('SOFTWARE\\Microsoft\\Windows Script Host\\Settings', subkey)
  const request = JSON.stringify({ op: 'list', checkScriptHost: true }) + '\n{}'
  const probe = () => {
    const response = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', bridge], { input: request, encoding: 'utf8' })
    return JSON.parse(response.split('\n')[0]).blockedBy
  }
  const view = /64/.test(process.env.PROCESSOR_ARCHITEW6432 || process.env.PROCESSOR_ARCHITECTURE) ? '/reg:64' : '/reg:32'
  assert.equal(spawnSync('reg.exe', ['query', key, view]).status, 1)
  assert.equal(probe(), null)
  execFileSync('reg.exe', ['add', key, '/v', 'Enabled', '/t', 'REG_DWORD', '/d', '0', '/f', view])
  try {
    assert.equal(probe().toLowerCase(), ('HKEY_CURRENT_USER\\' + subkey + '\\Enabled').toLowerCase())
    execFileSync('reg.exe', ['add', key, '/v', 'Enabled', '/t', 'REG_DWORD', '/d', '1', '/f', view])
    assert.equal(probe(), null)
  } finally {
    execFileSync('reg.exe', ['delete', key, '/f', view])
  }
}

let registered = false
try {
  checkScriptHostPolicy()
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
  writeFileSync(file, "console.error('deliberate failure'); process.exitCode=7")
  run('run', '--id', id)
  const checkResult = "$s=New-Object -ComObject Schedule.Service;$s.Connect();$s.GetFolder('\\').GetTask($env:CRONLY_TEST_TASK).LastTaskResult"
  const deadlineForResult = Date.now() + 30000
  let result
  do {
    await delay(250)
    result = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', checkResult], { env: { ...env, CRONLY_TEST_TASK: nativeName(id) }, encoding: 'utf8' }).trim()
  } while (result !== '7' && Date.now() < deadlineForResult)
  assert.equal(result, '7')
  assert.match(run('logs', '--id', id), /deliberate failure/)
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
  const psLog = join(env.CRONLY_HOME, 'logs', psId + '.log')
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
