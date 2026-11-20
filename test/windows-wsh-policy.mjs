import assert from 'assert/strict'
import { execFileSync, spawnSync } from 'child_process'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { fileURLToPath } from 'url'

// This check temporarily changes the real HKCU value that wscript.exe reads.
// The normal Windows integration suite can run under a developer's account.
if (process.platform !== 'win32' || !process.argv.includes('--disposable-account')) {
  throw new Error('Run with --disposable-account in a fresh Windows test account.')
}
const key = 'HKCU\\SOFTWARE\\Microsoft\\Windows Script Host\\Settings'
const view = /64/.test(process.env.PROCESSOR_ARCHITEW6432 || process.env.PROCESSOR_ARCHITECTURE) ? '/reg:64' : '/reg:32'
const query = (...args) => spawnSync('reg.exe', ['query', key, ...args, view]).status
const reg = (...args) => execFileSync('reg.exe', [...args, view])
assert.equal(query('/v', 'Enabled'), 1, 'The test account already has a Script Host policy.')
const keyExisted = query() === 0
const dir = mkdtempSync(join(tmpdir(), 'cronly-wsh-'))
const script = join(dir, 'probe.js')
const marker = join(dir, 'ran.txt')
const cli = fileURLToPath(new URL('../bin/cronly.mjs', import.meta.url))
const env = { ...process.env, CRONLY_BACKEND: 'windows', CRONLY_LANG: 'en', CRONLY_HOME: dir }
const host = join(process.env.SystemRoot, 'System32', 'wscript.exe')

function check(label, expected) {
  rmSync(marker, { force: true })
  const args = ['//B', '//NoLogo', '//E:JScript', script, marker]
  const result = spawnSync(host, args, { timeout: 8000, windowsHide: true })
  // A disabled GUI host can wait for a policy dialog even in batch mode.
  if (result.error && result.error.code !== 'ETIMEDOUT') throw result.error
  const ran = existsSync(marker)
  console.log(label + ': wscript.exe ' + (ran ? 'ran the script' : 'did not run the script') +
    ' (' + (result.error ? result.error.code : 'exit ' + result.status) + ')')
  assert.equal(ran, expected, label)
  if (ran) assert.equal(result.status, 73)
  else {
    const consoleHost = spawnSync(join(process.env.SystemRoot, 'System32', 'cscript.exe'), args, { timeout: 8000, encoding: 'utf8' })
    if (consoleHost.error) throw consoleHost.error
    console.log((consoleHost.stdout + consoleHost.stderr).trim())
    assert.equal(existsSync(marker), false)
  }
  const doctor = spawnSync(process.execPath, [cli, 'doctor'], { env, encoding: 'utf8' })
  assert.equal(doctor.status, ran ? 0 : 1, doctor.stdout + doctor.stderr)
  if (!ran) assert.match(doctor.stdout, /HKEY_CURRENT_USER\\.+Windows Script Host\\Settings\\Enabled/i)
}

let written = false
try {
  writeFileSync(script, 'new ActiveXObject("Scripting.FileSystemObject").CreateTextFile(WScript.Arguments.Item(0)).Close(); WScript.Quit(73);')
  check('Enabled absent', true)
  for (const [type, value, expected] of [
    ['REG_DWORD', '0', false], ['REG_SZ', '0', false], ['REG_SZ', '1', true], ['REG_DWORD', '1', true],
  ]) {
    reg('add', key, '/v', 'Enabled', '/t', type, '/d', value, '/f')
    written = true
    check(type + ' ' + value, expected)
  }
} finally {
  try {
    if (written) reg('delete', key, ...(keyExisted ? ['/v', 'Enabled'] : []), '/f')
  } finally { rmSync(dir, { recursive: true, force: true }) }
}
