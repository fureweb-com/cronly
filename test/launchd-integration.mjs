/** Real launchd daemon verification. Uses unique disposable jobs and restores them. */
import assert from 'assert/strict'
import { spawn } from 'child_process'
import { randomBytes } from 'crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { makeId } from '../lib/entry.mjs'
import { getLaunchdDomain, LABEL_PREFIX } from '../lib/launchd.mjs'

if (process.platform !== 'darwin') throw new Error('This test requires macOS and a GUI login session.')
const CLI = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'cronly.mjs')
const root = mkdtempSync('/private/tmp/cronly-launchd-live-')
const work = join(root, "work '100% &<tag>\"")
mkdirSync(work)
const agents = join(root, 'agents')
const eventsPath = join(root, 'events.jsonl')
const nonce = randomBytes(8).toString('hex')
writeFileSync(join(work, '.env'), nonce)
const env = { ...process.env, CRONLY_BACKEND: 'launchd', CRONLY_HOME: join(root, "logs '50% &\""), CRONLY_LAUNCHD_DIR: agents, CRONLY_LANG: 'en' }
const jobs = []
let passed = false
let restored = false
let cancelled = false
const active = new Set()
const say = (phase, data = {}) => console.log(JSON.stringify({ phase, time: new Date().toISOString(), ...data }))
function run(file, args, input) {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { env, detached: true, stdio: ['pipe', 'pipe', 'pipe'] })
    active.add(child)
    let stdout = '', stderr = '', timedOut = false
    const timer = setTimeout(() => { timedOut = true; try { process.kill(-child.pid, 'SIGKILL') } catch {} }, 30000)
    child.stdout.on('data', d => { stdout += d }); child.stderr.on('data', d => { stderr += d })
    child.stdin.on('error', () => {})
    child.once('error', reject)
    child.once('close', code => { clearTimeout(timer); active.delete(child); timedOut ? reject(new Error(`${file} timed out`)) : resolve({ code, stdout, stderr }) })
    child.stdin.end(input)
  })
}
async function cli(...args) {
  if (cancelled) throw new Error('Cancelled')
  const result = await run(process.execPath, [CLI, ...args])
  assert.equal(result.code, 0, result.stderr)
  return result.stdout
}
async function cronSnapshot() {
  const result = await run('/usr/bin/crontab', ['-l'])
  if (result.code === 0) return { exists: true, content: result.stdout }
  assert.ok(result.code === 1 && /no crontab for/i.test(result.stderr), result.stderr)
  return { exists: false, content: '' }
}
function body(kind) {
  return `import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
const ancestors=[];let ancestorPid=process.ppid;
for(let depth=0;depth<8 && ancestorPid>0;depth++){
  const raw=execFileSync('/bin/ps',['-o','pid=,ppid=,comm=','-p',String(ancestorPid)],{encoding:'utf8'}).trim();
  const match=/^(\\d+)\\s+(\\d+)\\s+(.+)$/.exec(raw);if(!match)break;
  ancestors.push({pid:Number(match[1]),ppid:Number(match[2]),command:match[3]});ancestorPid=Number(match[2]);
}
const parent=ancestors[0]?.command;
const event={kind:${JSON.stringify(kind)},nonce:${JSON.stringify(nonce)},time:new Date().toISOString(),pid:process.pid,ppid:process.ppid,parent,ancestors,cwd:process.cwd(),config:fs.readFileSync('.env','utf8'),path:process.env.PATH};
fs.appendFileSync(${JSON.stringify(eventsPath)},JSON.stringify(event)+'\\n');
console.log('STDOUT:${kind}');console.error('STDERR:${kind}');\n`
}
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
  cancelled = true
  for (const child of active) { try { process.kill(-child.pid, 'SIGKILL') } catch {} }
})
const originalCron = await cronSnapshot()
try {
  for (const spec of [
    { kind: 'node', name: "node '100%'.mjs", runtime: 'node' },
    { kind: 'shell', name: "shell\\% 'check'.sh", runtime: 'sh' },
    { kind: 'exec', name: 'exec-check.mjs', runtime: 'exec' },
    { kind: 'startup', name: 'startup-check.mjs', runtime: 'exec' },
  ]) {
    const file = join(work, spec.name)
    const source = spec.kind === 'shell' ? '#!/bin/sh\nnode ./shell-probe.mjs\n' : (spec.runtime === 'exec' ? '#!/usr/bin/env node\n' : '') + body(spec.kind)
    writeFileSync(file, source, { mode: 0o700 })
    if (spec.kind === 'shell') writeFileSync(join(work, 'shell-probe.mjs'), body('shell'))
    const id = makeId(file)
    const job = { ...spec, file, id, label: `${LABEL_PREFIX}${id}` }
    const before = await run('/bin/launchctl', ['print', `${getLaunchdDomain()}/${job.label}`])
    assert.notEqual(before.code, 0, 'Test label already exists')
    jobs.push(job)
  }
  await Promise.all(jobs.map(job => cli('add', job.file, ...(job.kind === 'startup' ? ['--reboot'] : ['--every-minutes', '1']), '--runtime', job.runtime)))
  for (const job of jobs) {
    const lint = await run('/usr/bin/plutil', ['-lint', join(agents, `${job.label}.plist`)])
    assert.equal(lint.code, 0, lint.stderr)
  }
  assert.match(await cli('doctor'), /All checks passed/)
  say('registered', { backend: 'launchd', jobs: jobs.length, crontabUnchanged: true })
  const started = Date.now()
  let events = [], previous = ''
  while (Date.now() - started < 190000) {
    if (cancelled) throw new Error('Cancelled')
    if (existsSync(eventsPath)) events = readFileSync(eventsPath, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse)
    const counts = Object.fromEntries(jobs.map(job => [job.kind, events.filter(e => e.kind === job.kind).length]))
    if (JSON.stringify(counts) !== previous) { say('daemon-runs', { counts }); previous = JSON.stringify(counts) }
    if (counts.node >= 2 && counts.shell >= 2 && counts.exec >= 2 && counts.startup >= 1) break
    await new Promise(resolve => setTimeout(resolve, 2000))
  }
  for (const job of jobs) {
    const count = events.filter(e => e.kind === job.kind).length
    assert.ok(count >= (job.kind === 'startup' ? 1 : 2), `Missing executions: ${job.kind}: ${count}`)
    const log = readFileSync(join(env.CRONLY_HOME, 'logs', `${job.id}.log`), 'utf8')
    assert.ok((log.match(new RegExp(`STDOUT:${job.kind}`, 'g')) || []).length >= count)
    assert.ok((log.match(new RegExp(`STDERR:${job.kind}`, 'g')) || []).length >= count)
  }
  const { realpathSync } = await import('fs')
  for (const event of events) {
    assert.equal(event.nonce, nonce); assert.equal(event.config, nonce)
    assert.equal(event.cwd, realpathSync(work)); assert.equal(event.path.split(':')[0], dirname(process.execPath))
    assert.ok(event.ancestors.some(ancestor => ancestor.command === '/sbin/launchd'))
  }
  // Verify replacement against the real daemon as well as initial loading.
  await cli('add', jobs[2].file, '--every-hours', '1', '--runtime', 'exec')
  const updated = await run('/usr/bin/plutil', ['-convert', 'json', '-o', '-', join(agents, `${jobs[2].label}.plist`)])
  assert.equal(updated.code, 0, updated.stderr)
  assert.deepEqual(JSON.parse(updated.stdout).StartCalendarInterval, [{ Minute: 0 }])
  assert.match(await cli('doctor'), /All checks passed/)
  passed = true
  say('passed', { counts: Object.fromEntries(jobs.map(job => [job.kind, events.filter(e => e.kind === job.kind).length])), launchdParentVerified: true, relativeConfig: true, stdoutStderr: true })
} finally {
  let cleanupFailed = false
  for (const job of jobs) {
    try {
      const file = join(agents, `${job.label}.plist`)
      if (existsSync(file)) {
        const result = await run(process.execPath, [CLI, 'remove', '--id', job.id])
        assert.equal(result.code, 0, result.stderr)
      }
      const after = await run('/bin/launchctl', ['print', `${getLaunchdDomain()}/${job.label}`])
      assert.notEqual(after.code, 0)
      assert.match(after.stderr, /Could not find service|No such process/i)
      assert.equal(existsSync(file), false)
    } catch (error) { cleanupFailed = true; say('cleanup-failed', { label: job.label, message: error.message }) }
  }
  assert.deepEqual(await cronSnapshot(), originalCron)
  if (!cleanupFailed) { rmSync(root, { recursive: true, force: true }); restored = true }
  say('restored', { restored, crontabUnchanged: true, temporaryFilesRemoved: !existsSync(root), directory: cleanupFailed ? root : undefined })
}
assert.ok(passed && restored)
