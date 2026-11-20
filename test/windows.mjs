import { checkNamedJobs } from './named-jobs.mjs'
import assert from 'assert/strict'
import { PassThrough } from 'stream'
import { spawnSync } from 'child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'fs'
import { homedir, tmpdir } from 'os'
import { dirname, join } from 'path'
import { getBackend } from '../lib/backend.mjs'
import { add, doctor, list, logs, print, remove, run } from '../lib/commands.mjs'
import { schedulerLockPath } from '../lib/lock.mjs'
import { windowsRuntime } from '../lib/windows.mjs'
import { launcherPath, scriptHostPath, windowsAction, windowsLauncher, windowsTriggers, windowsTaskXml } from '../lib/windows-task.mjs'

export async function runWindowsTests({ test, testAsync, captureLogs, withPatchedVersion }) {
  test('Windows: defaults and exact calendar triggers', () => {
    assert.equal(getBackend('win32', {}), 'windows')
    assert.equal(schedulerLockPath('win32'), join(homedir(), '.cronly-scheduler.lock'))
    const triggers = schedule => windowsTriggers(schedule, 'user')
    assert.match(triggers('@reboot'), /LogonTrigger><UserId>user/)
    assert.match(triggers('@daily'), /00:00:00.*<ScheduleByDay>/)
    assert.match(triggers('@weekly'), /ScheduleByWeek>.*<Sunday\/>/)
    assert.match(triggers('0 9 2 1,12 *'), /<Day>2<\/Day>.*<January\/><December\/>/)
    assert.match(triggers('0 9 * 1 1'), /ScheduleByMonthDayOfWeek>.*<Week>Last<\/Week>.*<Monday\/>/)
    assert.match(triggers('0 9 * 1 *'), /<Day>31<\/Day>/)
    assert.match(triggers('0 9 1-31 * 1'), /ScheduleByDay>/)
    assert.match(triggers('0 9 15 * 0-6'), /ScheduleByDay>/)
    assert.match(triggers('* * * * *'), /<Interval>PT1M<\/Interval><Duration>PT1439M30S/)
    assert.match(triggers('*/5 * * * *'), /<Interval>PT5M<\/Interval><Duration>PT1435M30S/)
    assert.throws(() => triggers('0 9 1 * 1'), /day of the month/)
    assert.throws(() => triggers('0,1,3,7,12,20,31,44 * * * *'), /48 triggers/)
  })

  await testAsync('Windows: task lifecycle, diagnostics and literal action arguments', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cronly-win-'))
    const ps = join(dir, 'System32/WindowsPowerShell/v1.0/powershell.exe')
    const file = join(dir, "한글 & %TEMP% ' <sample>.cjs")
    const state = join(dir, 'tasks.json')
    const read = () => JSON.parse(readFileSync(state, 'utf8'))
    const write = data => writeFileSync(state, JSON.stringify(data))
    const register = () => add(file, { schedule: '@daily' })
    const captured = fn => captureLogs(fn)
    const env = { SystemRoot: dir, LOCALAPPDATA: dir, WINDOWS_TASK_STATE: state, CRONLY_BACKEND: 'windows', CRONLY_HOME: dir, PATH: dir }
    const previous = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]]))
    try {
      Object.assign(process.env, env)
      mkdirSync(dirname(ps), { recursive: true })
      writeFileSync(ps, '#!' + process.execPath + '\n' + readFileSync(new URL('./helpers/windows-tasks.cjs', import.meta.url), 'utf8'), { mode: 0o755 })
      writeFileSync(file, "console.log(require('fs').readFileSync('input','utf8')); console.error('stderr'); process.exitCode=7")
      writeFileSync(join(dir, 'input'), 'from script cwd')
      write([])
      writeFileSync(state + '.malformed', '')
      await assert.rejects(list, SyntaxError)
      rmSync(state + '.malformed')
      await assert.rejects(register, /wscript.exe/)
      writeFileSync(scriptHostPath(), '')
      await checkNamedJobs(file, captureLogs)
      assert.deepEqual((await captured(list)).logs, ['No managed Windows tasks.'])
      assert.deepEqual(windowsRuntime('tool.exe').args, [])
      assert.deepEqual(windowsRuntime('task.ps1').args, ['-NoProfile', '-NonInteractive', '-File', 'task.ps1'])
      assert.throws(() => windowsRuntime('file.sh'), /installed interpreter/)
      assert.throws(() => windowsRuntime('file.ps1', 'exec'), /installed interpreter/)
      assert.throws(() => windowsRuntime(file, 'missing'), /not found/i)
      const custom = join(dir, 'custom runtime.exe')
      writeFileSync(custom, '')
      assert.equal(windowsRuntime(file, custom).runtimePath, custom)
      assert.equal(windowsRuntime(file, 'custom runtime').runtimePath, custom)
      mkdirSync(join(dir, 'directory.exe'))
      assert.throws(() => windowsRuntime(file, 'directory'), /not found/i)
      delete process.env.PATH
      assert.throws(() => windowsRuntime(file, 'other'), /not found/i)
      process.env.PATH = dir
      await captured(register)
      const [entry] = read()
      const job = JSON.parse(entry.metadata)
      writeFileSync(job.logPath, 'earlier output\n')
      writeFileSync(state + '.ops', '')
      await captured(list)
      await logs(file, {}, new PassThrough())
      assert.equal((await captured(() => run(file, {}))).result, 0)
      assert.deepEqual(readFileSync(state + '.ops', 'utf8').trim().split('\n'), ['list', 'list', 'list', 'run'])
      assert.equal(readFileSync(state + '.last-run', 'utf8'), entry.id)
      assert.ok((await captured(list)).logs[0].includes(file))
      assert.match((await captured(print)).logs[0], /&amp;.*&lt;sample&gt;/)
      const runAction = data => {
        const [, src, payload] = /^-e "(.+)" -- (\S+)$/.exec(windowsAction(data))
        return spawnSync(process.execPath, ['-e', src, '--', payload]).status
      }
      assert.match(windowsAction({ ...job, nodePath: 'C:\\%TEMP%\\node.exe' }), /C:\\\|TEMP\|\\node.exe/)
      assert.match(entry.xml, /wscript.exe/)
      const launcher = launcherPath()
      assert.equal(readFileSync(launcher, 'utf8'), windowsLauncher)
      writeFileSync(launcher, 'edited')
      assert.equal((await captured(doctor)).result, false)
      await assert.rejects(register, /changed Windows launcher/)
      await assert.rejects(() => run(file, {}), /changed Windows launcher/)
      rmSync(launcher)
      assert.equal((await captured(doctor)).result, false)
      await captured(register)
      const legacy = { ...job }
      delete legacy.launcher
      const oldXml = windowsTaskXml(legacy, 'S-1-5-21-1234')
      write([{ ...entry, metadata: JSON.stringify(legacy), xml: oldXml }])
      assert.equal((await captured(doctor)).result, true)
      write([entry])
      assert.equal(runAction(legacy), 7)
      assert.match(readFileSync(job.logPath, 'utf8'), /from script cwd\nstderr/)
      assert.equal(runAction({ ...legacy, runtimePath: join(dir, 'not found') }), 1)
      assert.match(readFileSync(job.logPath, 'utf8'), /ENOENT/)
      const alias = join(dir, 'alias.mjs')
      symlinkSync(file, alias)
      await captured(() => add(alias, { schedule: '@weekly' }))
      assert.deepEqual(read().map(e => e.id), [entry.id])
      assert.equal((await captured(doctor)).result, true)
      // The task retains its original ID after an update through a symlink.
      // Removing a deleted alias by its registered path must still find it.
      rmSync(alias)
      await captured(() => remove(alias, {}))
      assert.deepEqual(read(), [])
      symlinkSync(file, alias)
      for (const result of [0, 0x41301, 0x41303, 7]) {
        write([{ ...entry, result }])
        assert.equal((await captured(doctor)).result, result !== 7)
      }
      write([{ ...entry, enabled: false }])
      assert.equal((await captured(doctor)).result, false)
      const missing = { ...job, nodePath: join(dir, 'missing-node.exe'), runtimePath: join(dir, 'missing.exe') }
      const sid = 'S-1-5-21-1234'
      write([{ ...entry, metadata: JSON.stringify(missing), xml: windowsTaskXml(missing, sid) }])
      assert.equal((await captured(doctor)).result, false)
      write([entry, { ...entry, id: 'f00df00d', metadata: JSON.stringify({ ...job, id: 'f00df00d' }) }])
      await assert.rejects(register, /Multiple Windows tasks/)
      for (const override of [{ source: 'other' }, { metadata: 'null' }, ...[
        { backend: 'cron' }, { name: 'incorrect' }, { id: 'different' }, { path: 'relative' }, { runtime: null }, { schedule: null },
      ].map(overrides => ({ metadata: JSON.stringify({ ...job, ...overrides }) }))]) {
        write([{ ...entry, ...override }])
        assert.match((await captured(list)).logs[0], /Cannot manage Windows task/)
        assert.equal((await captured(doctor)).result, false)
        await assert.rejects(register, /Cannot manage Windows task/)
        if (override.source) {
          await assert.rejects(() => remove(null, { id: entry.id }), new RegExp('Cronly-' + sid + '-' + entry.id))
          assert.equal(read().length, 1)
        } else {
          await captured(() => remove(null, { id: entry.id }))
          assert.deepEqual(read(), [])
        }
      }
      for (const tag of ['CalendarTrigger', 'Exec', 'Principal']) {
        const xml = entry.xml.replace('<' + tag, '<Changed' + tag)
        write([{ ...entry, xml }])
        assert.match((await captured(list)).logs[0], /Task Scheduler/)
        assert.equal((await captured(doctor)).result, false)
        await assert.rejects(() => run(file, {}), /damaged registration/)
        await assert.rejects(() => remove(file, {}), /remove --id/)
        await captured(() => remove(null, { id: entry.id }))
        assert.deepEqual(read(), [])
      }
      write([entry])
      await withPatchedVersion('v14.7.0', async () => assert.equal((await captured(doctor)).result, false))
      await captured(() => remove(alias, {}))
      assert.deepEqual(read(), [])
      await assert.rejects(() => remove(null, {}), /specify a file/)
      await assert.rejects(() => remove(file, {}), /not found for file/)
      await assert.rejects(() => remove(null, { id: entry.id }), /not found for id/)
      delete process.env.SystemRoot
      assert.match(scriptHostPath(), /wscript.exe$/)
      await assert.rejects(register, /Windows Task Scheduler/)
      assert.equal((await captured(doctor)).result, false)
    } finally {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key]
        else process.env[key] = value
      }
      rmSync(dir, { force: true, recursive: true })
    }
  })
}
