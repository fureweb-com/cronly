import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { spawn, spawnSync } from 'child_process'

const CLI = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'bin', 'cronly.mjs')
export async function withLaunchdSandbox(action) {
  const dir = mkdtempSync(join(tmpdir(), 'cronly-launchd-'))
  const bin = join(dir, 'bin'); mkdirSync(bin)
  const statePath = join(dir, 'state.json')
  writeFileSync(statePath, '{}')
  const env = {
    PATH: `${bin}:${process.env.PATH}`, CRONLY_BACKEND: 'launchd', CRONLY_HOME: join(dir, 'home'),
    CRONLY_LAUNCHD_DIR: join(dir, 'agents'), LAUNCHD_TEST_STATE: statePath,
    LAUNCHD_TEST_FAIL: '', LAUNCHD_TEST_FAIL_ONCE: '', LAUNCHD_TEST_FAIL_AFTER: '', LAUNCHD_TEST_EXIT: '',
    LAUNCHD_TEST_BLOCK_TARGET: '', LAUNCHD_TEST_LEGACY: '', LAUNCHD_TEST_READ_FAIL: '', LAUNCHD_TEST_DELAY: '', CRONLY_LANG: 'en',
  }
  const previous = Object.fromEntries(Object.keys(env).map((key) => [key, process.env[key]]))
  Object.assign(process.env, env)
  writeFileSync(join(bin, 'crontab'), `#!${process.execPath}
if (process.argv[2] !== '-l') { console.error('crontab writes forbidden'); process.exit(99) }
if (process.env.LAUNCHD_TEST_READ_FAIL) { console.error('read denied'); process.exit(2) }
if (process.env.LAUNCHD_TEST_LEGACY) { process.stdout.write(process.env.LAUNCHD_TEST_LEGACY) }
else { console.error('no crontab for test'); process.exit(1) }
`, { mode: 0o755 })
  writeFileSync(join(bin, 'launchctl'), `#!${process.execPath}
const fs = require('fs');
const [command, target, file] = process.argv.slice(2);
const path = process.env.LAUNCHD_TEST_STATE;
const state = JSON.parse(fs.readFileSync(path, 'utf8'));
const label = target.split('/').slice(2).join('/');
fs.appendFileSync(path + '.calls', command + '\\n');
function fail(message) { console.error(message); process.exit(1) }
if (process.env.LAUNCHD_TEST_DELAY && command === 'bootstrap') awaitDelay();
function awaitDelay() { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,Number(process.env.LAUNCHD_TEST_DELAY)) }
if (process.env.LAUNCHD_TEST_FAIL === command) fail('operation denied');
if (process.env.LAUNCHD_TEST_FAIL_ONCE === command && !fs.existsSync(path+'.failed')) { fs.writeFileSync(path+'.failed',''); fail('temporary failure') }
if (command === 'print') {
  if (!label) { console.log('login session'); process.exit(0) }
  if (!state[label]) {
    if (process.env.LAUNCHD_TEST_BLOCK_TARGET) fs.mkdirSync(process.env.CRONLY_LAUNCHD_DIR + '/' + label + '.plist');
    fail('Could not find service');
  }
  console.log('state = waiting\\nlast exit code = ' + (process.env.LAUNCHD_TEST_EXIT || '0'));
} else if (command === 'bootstrap') {
  const raw = fs.readFileSync(file, 'utf8');
  const metadata = JSON.parse(Buffer.from(/<!-- cronly:([^ ]+) -->/.exec(raw)[1], 'base64').toString());
  const key = 'com.fureweb.cronly.' + metadata.id;
  if (state[key]) fail('already loaded');
  state[key] = metadata; fs.writeFileSync(path,JSON.stringify(state));
  if (process.env.LAUNCHD_TEST_FAIL_AFTER) fail('failed after loading');
} else if (command === 'bootout') {
  if (!state[label]) {
    if (process.env.LAUNCHD_TEST_BLOCK_TARGET) fs.mkdirSync(process.env.CRONLY_LAUNCHD_DIR + '/' + label + '.plist');
    fail('Could not find service');
  }
  delete state[label]; fs.writeFileSync(path,JSON.stringify(state));
} else fail('unsupported command');
`, { mode: 0o755 })
  const context = {
    dir, agents: env.CRONLY_LAUNCHD_DIR,
    script(name = 'job.mjs', source = '', mode = 0o755) { const file = join(dir, name); writeFileSync(file, source, { mode }); return file },
    state() { return JSON.parse(readFileSync(statePath, 'utf8')) },
    setState(state) { writeFileSync(statePath, JSON.stringify(state)) },
    calls() { return existsSync(statePath+'.calls') ? readFileSync(statePath+'.calls','utf8') : '' },
    cli(args) { return spawnSync(process.execPath, [CLI, ...args], { env: process.env, encoding: 'utf8', timeout: 15000 }) },
    cliAsync(args) { return new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [CLI, ...args], { env: { ...process.env } }); let stdout='',stderr='';
      child.stdout.on('data', d=>stdout+=d);child.stderr.on('data',d=>stderr+=d);child.on('error',reject);
      child.on('close',status=>resolve({status,stdout,stderr}));
    }) },
  }
  try { return await action(context) } finally {
    for (const [key,value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value }
    rmSync(dir, { recursive: true, force: true })
  }
}
