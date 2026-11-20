// Run under a Linux systemd user manager. Only register the unique temporary script.
import { strict as assert } from 'assert'
import { execFileSync } from 'child_process'
import fs, { existsSync, lstatSync, mkdtempSync, readFileSync, unlinkSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { makeId } from '../lib/entry.mjs'

if (process.platform !== 'linux') throw new Error('This test requires Linux and a systemd user manager.')
const cli = join(dirname(fileURLToPath(import.meta.url)), '../bin/cronly.mjs')
const dir = mkdtempSync(join(tmpdir(), 'cronly-systemd-'))
const file = join(dir, "job ' \\ %n ${HOME} \".sh")
const id = makeId(file)
const env = { ...process.env, CRONLY_HOME: dir, CRONLY_LANG: 'en' }
delete env.CRONLY_BACKEND // Exercise Linux's default backend.
const run = (...args) => execFileSync(process.execPath, [cli, ...args], { env, encoding: 'utf8' })
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))

let registered = false
try {
  writeFileSync(file, 'node -p "process.cwd()"\necho "timer fired" >&2')
  run('add', file, '--reboot')
  registered = true
  const log = join(dir, 'logs', id + '.log')
  assert.equal(existsSync(log), false)
  assert.match(run('list'), new RegExp(id))
  const name = 'manual-' + id
  const namedLog = join(dir, 'logs', makeId(file, name) + '.log')
  run('add', file, '--name', name, '--reboot')
  try {
    run('run', '--name', name)
    const deadline = Date.now() + 10000
    while (Date.now() < deadline && !(existsSync(namedLog) && readFileSync(namedLog, 'utf8').includes('timer fired'))) await delay(100)
    assert.equal(run('logs', '--name', name).trim(), dir + '\ntimer fired')
    assert.equal(run('logs', '--name', name, '--tail', '1'), 'timer fired\n')
    assert.equal(existsSync(log), false)
    const service = `cronly-${makeId(file, name)}.service`
    const path = execFileSync('systemctl', ['--user', 'show', '--property=FragmentPath', '--value', service], { encoding: 'utf8' }).trim()
    unlinkSync(path)
    assert.equal(run('logs', '--name', name, '--tail', '1'), 'timer fired\n')
  } finally {
    run('remove', '--name', name)
  }
  run('add', file, '--every-minutes', '1')
  assert.match(run('print'), /OnCalendar=\*-\*-\* \*:\*:00/)
  const deadline = Date.now() + 75000
  while (!existsSync(log) && Date.now() < deadline) await delay(250)
  // The shell opens the file just before Node starts.
  while (existsSync(log) && !readFileSync(log, 'utf8').includes('timer fired') && Date.now() < deadline) await delay(100)
  assert.equal(readFileSync(log, 'utf8').trim(), dir + '\ntimer fired')
  run('doctor')
  const timer = `cronly-${id}.timer`
  const timerPath = execFileSync('systemctl', ['--user', 'show', '--property=FragmentPath', '--value', timer], { encoding: 'utf8' }).trim()
  const installLink = join(dirname(timerPath), 'timers.target.wants', timer)
  unlinkSync(timerPath)
  run('add', file, '--reboot')
  assert.ok(lstatSync(installLink).isSymbolicLink())
  unlinkSync(timerPath)
  run('remove', '--id', id)
  assert.throws(() => lstatSync(installLink), { code: 'ENOENT' })
  registered = false
  assert.ok(!run('list').includes(id))
  console.log('Linux default backend registered, ran, updated and removed a user timer.')
} finally {
  if (registered) run('remove', '--id', id)
  if (fs.rmSync) fs.rmSync(dir, { recursive: true, force: true })
  else fs.rmdirSync(dir, { recursive: true }) // Node 14.8 predates fs.rmSync.
}
