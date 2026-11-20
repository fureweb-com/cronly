import { checkNamedJobs } from './named-jobs.mjs'
import assert from 'assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { add, doctor, list, print, remove, run } from '../lib/commands.mjs'
import { makeId, buildBlock } from '../lib/entry.mjs'
import { readSystemdEntries, timerDirectives } from '../lib/systemd.mjs'

async function sandbox(action) {
  const dir = mkdtempSync(join(tmpdir(), 'cronly-systemd-test-'))
  const bin = join(dir, 'bin')
  const unitDir = join(dir, 'systemd/user')
  mkdirSync(bin)
  const env = { PATH: bin, XDG_CONFIG_HOME: dir, CRONLY_HOME: dir, CRONLY_BACKEND: 'systemd', HOME: dir }
  const before = { ...process.env }
  Object.assign(process.env, env)
  const mock = readFileSync(new URL('./helpers/systemctl.cjs', import.meta.url), 'utf8')
  writeFileSync(join(bin, 'systemctl'), '#!' + process.execPath + '\n' + mock, { mode: 0o755 })
  const file = join(dir, 'test $HOME %s\t" \\.sh')
  writeFileSync(file, 'echo ok')
  const id = makeId(file)
  try {
    await action({
      dir, bin, file, id, unitDir,
      service: join(unitDir, `cronly-${id}.service`), timer: join(unitDir, `cronly-${id}.timer`),
      fail(...commands) { writeFileSync(join(dir, 'failures.json'), JSON.stringify(commands)) },
      properties(text) { writeFileSync(join(dir, 'state.json.properties'), text) },
      state() { return JSON.parse(readFileSync(join(dir, 'state.json')))[`cronly-${id}.timer`] },
      cron(content) {
        writeFileSync(join(bin, 'crontab'), '#!' + process.execPath + '\n' +
          "if (process.argv[2] !== '-l') process.exit(2)\nprocess.stdout.write(" + JSON.stringify(content) + ')', { mode: 0o755 })
      },
    })
  } finally {
    for (const key of Object.keys(env)) {
      if (before[key] === undefined) delete process.env[key]
      else process.env[key] = before[key]
    }
    rmSync(dir, { recursive: true, force: true })
  }
}

export async function runSystemdTests({ test, testAsync, captureLogs, withPatchedVersion }) {
  await testAsync('systemd: independent named schedules', () => sandbox(ctx => checkNamedJobs(ctx.file, captureLogs)))
  await testAsync('systemd: immediate service start leaves the timer alone', () => sandbox(async ctx => {
    await captureLogs(() => add(ctx.file, { schedule: '@reboot' }))
    const before = ctx.state()
    await captureLogs(() => run(ctx.file, {}))
    assert.deepEqual(ctx.state(), before)
    assert.equal(JSON.parse(readFileSync(join(ctx.dir, 'state.json')))[`cronly-${ctx.id}.service`].active, true)
    ctx.properties('LoadState=not-found')
    await assert.rejects(() => run(ctx.file, {}), /not loaded/)
  }))
  test('systemd: 달력 일정의 월·날짜·요일 조합과 별칭', () => {
    const examples = [
      ['@reboot', 'OnStartupSec=0'],
      ['@daily', 'OnCalendar=*-*-* 0:0:00'],
      ['0 8 1 1,6 7', 'OnCalendar=*-1,6-1 8:0:00\nOnCalendar=Sun *-1,6-* 8:0:00'],
      ['0 0 */15 * 1-2', 'OnCalendar=Mon,Tue *-*-1,16,31 0:0:00'],
      ['0 * 1-31 * 1', 'OnCalendar=*-*-* *:0:00'],
      ['0 * 1 * 0-6', 'OnCalendar=*-*-* *:0:00'],
      ['*/15 */12 * * *', 'OnCalendar=*-*-* 0,12:0,15,30,45:00'],
    ]
    for (const [schedule, expected] of examples) assert.equal(timerDirectives(schedule), expected)
  })

  await testAsync('systemd: crontab 없이 등록·수정·조회·삭제 및 재부팅 일정', () => sandbox(async ctx => {
    assert.deepEqual((await captureLogs(list)).logs, ['No managed systemd timers.'])
    await captureLogs(() => add(ctx.file, { schedule: '@reboot' }))
    assert.deepEqual(ctx.state(), { enabled: true, active: false })
    assert.ok((await captureLogs(doctor)).result)
    await captureLogs(() => add(ctx.file, { schedule: '@daily' }))
    assert.deepEqual(ctx.state(), { enabled: true, active: true })
    assert.match((await captureLogs(list)).logs[0], /@daily.*systemd/)
    assert.match((await captureLogs(print)).logs[0], /ExecStart=[\s\S]*OnCalendar=/)
    assert.ok((await captureLogs(doctor)).result)
    const alias = join(ctx.dir, 'alias.sh')
    symlinkSync(ctx.file, alias)
    const { logs } = await captureLogs(() => add(alias, { schedule: '@weekly' }))
    assert.ok(logs.some(line => line.includes(ctx.file)))
    assert.equal(existsSync(ctx.timer), false)
    await captureLogs(() => remove(ctx.file, {}))
    assert.deepEqual(readSystemdEntries(), [])
    await assert.rejects(() => remove(undefined, {}), /specify a file/)
    await assert.rejects(() => remove(ctx.file, {}), /not found for file/)
    await assert.rejects(() => remove(undefined, { id: 'not-a-path' }), /not found for id/)
    // An XDG relative path is ignored.
    process.env.XDG_CONFIG_HOME = 'relative'
    assert.deepEqual(readSystemdEntries(), [])
  }))

  await testAsync('systemd: 전환 중 양방향 중복을 방지하고 기존 cron 작업을 안내', () => sandbox(async ctx => {
    ctx.cron(buildBlock({ schedule: '@daily', absolutePath: ctx.file, runtime: 'sh' }))
    assert.match((await captureLogs(list)).logs.join(' '), /Legacy cron jobs: 1/)
    assert.equal((await captureLogs(doctor)).result, true)
    await assert.rejects(() => add(ctx.file, { schedule: '@daily' }), /Still registered in cron/)
    ctx.cron('')
    await captureLogs(() => add(ctx.file, { schedule: '@daily' }))
    process.env.CRONLY_BACKEND = 'cron'
    await assert.rejects(() => add(ctx.file, { schedule: '@daily' }), /Already registered in systemd/)
  }))

  await testAsync('systemd: 유닛 손상과 다른 소유자의 파일을 보존', () => sandbox(async ctx => {
    await captureLogs(() => add(ctx.file, { schedule: '@daily' }))
    const service = readFileSync(ctx.service, 'utf8')
    const timer = readFileSync(ctx.timer, 'utf8')
    writeFileSync(ctx.timer, timer + '# edit\n')
    assert.match((await captureLogs(list)).logs[0], /modified unit pair/)
    assert.equal((await captureLogs(doctor)).result, false)
    await captureLogs(() => add(ctx.file, { schedule: '@daily' }))
    assert.equal(readFileSync(ctx.timer, 'utf8'), timer)
    writeFileSync(ctx.timer, 'foreign timer')
    await assert.rejects(() => add(ctx.file, { schedule: '@daily' }), /modified unit pair/)
    assert.equal(readFileSync(ctx.timer, 'utf8'), 'foreign timer')
    writeFileSync(ctx.timer, timer)
    writeFileSync(ctx.service, service.replace(/cronly-v1 .+/, 'cronly-v1 ' + Buffer.from(JSON.stringify({ backend: 'cron' })).toString('base64')))
    assert.ok(readSystemdEntries()[0].invalid)
    rmSync(ctx.service)
    assert.ok(readSystemdEntries()[0].invalid)
    symlinkSync(ctx.file, ctx.service)
    assert.ok(readSystemdEntries()[0].invalid)
    await assert.rejects(() => remove(undefined, { id: ctx.id }), /modified unit pair/)
    rmSync(ctx.service)
    writeFileSync(ctx.service, service)
    ctx.properties('DropInPaths=/usr/lib/systemd/user/service.d/defaults.conf')
    assert.ok((await captureLogs(doctor)).result)
    ctx.properties(`DropInPaths=/etc/systemd/user/cronly-${ctx.id}.timer.d/custom.conf`)
    await assert.rejects(() => remove(ctx.file, {}), /Cannot manage/)
    ctx.properties('FragmentPath=/etc/systemd/user/foreign.timer')
    await assert.rejects(() => add(ctx.file, { schedule: '@daily' }), /Cannot manage/)
    assert.equal(readFileSync(ctx.service, 'utf8'), service)
    mkdirSync(join(ctx.unitDir, 'unrelated.target.wants'))
    ctx.properties('')
    assert.equal(readSystemdEntries().length, 1)
    renameSync(ctx.unitDir, ctx.unitDir + '.save')
    writeFileSync(ctx.unitDir, 'not a directory')
    assert.throws(readSystemdEntries, { code: 'ENOTDIR' })
  }))

  await testAsync('systemd: repair partial units and restore original bytes and state on failure', () => sandbox(async ctx => {
    const register = () => add(ctx.file, { schedule: '@daily' })
    await captureLogs(register)
    rmSync(ctx.timer)
    ctx.fail('daemon-reload')
    await assert.rejects(register, /simulated daemon-reload failure/)
    assert.equal(existsSync(ctx.timer), false)
    assert.deepEqual(ctx.state(), { enabled: true, active: true })
    const wants = join(ctx.unitDir, 'timers.target.wants')
    writeFileSync(wants, 'not a directory')
    await assert.rejects(register, { code: 'ENOTDIR' })
    rmSync(wants)
    mkdirSync(wants)
    const link = join(wants, `cronly-${ctx.id}.timer`)
    symlinkSync(ctx.file, link)
    await assert.rejects(register, /Cannot manage/)
    rmSync(link)
    writeFileSync(link, '')
    await assert.rejects(register, /Cannot manage/)
    rmSync(link)
    symlinkSync(ctx.timer, link)
    await captureLogs(register)
    const edited = Buffer.concat([readFileSync(ctx.service), Buffer.from([0xff])])
    writeFileSync(ctx.service, edited)
    ctx.fail('enable')
    await assert.rejects(register, /simulated enable failure/)
    assert.deepEqual(readFileSync(ctx.service), edited)
    rmSync(ctx.timer)
    await captureLogs(() => remove(ctx.file, {}))
    assert.deepEqual(ctx.state(), { enabled: false, active: false })
    assert.deepEqual(readSystemdEntries(), [])
    await captureLogs(register)
    rmSync(ctx.service)
    await captureLogs(() => remove(null, { id: ctx.id }))
    assert.deepEqual(readSystemdEntries(), [])
    await captureLogs(register)
    rmSync(ctx.timer)
    ctx.properties('ActiveState=inactive\nUnitFileState=disabled')
    rmSync(link)
    ctx.fail('disable')
    await assert.rejects(register, /simulated disable failure/)
    assert.equal(existsSync(ctx.timer), false)
    ctx.properties('')
    rmSync(ctx.service)
  }))

  await testAsync('systemd: reject unloadable units and report session requirements', () => sandbox(async ctx => {
    const register = () => add(ctx.file, { schedule: '@daily' })
    ctx.properties('LoadState=not-found')
    await assert.rejects(register, /LoadState=not-found.*242/)
    assert.deepEqual(readSystemdEntries(), [])
    ctx.properties('')
    const loginctl = join(ctx.bin, 'loginctl')
    for (const value of ['no', 'yes']) {
      writeFileSync(loginctl, '#!/bin/sh\necho Linger=' + value, { mode: 0o755 })
      const { result, logs } = await captureLogs(doctor)
      assert.ok(result)
      assert.equal(logs.some(line => line.includes('Linger=no')), value === 'no')
    }
    rmSync(join(ctx.bin, 'systemctl'))
    await assert.rejects(register, /CRONLY_BACKEND=cron/)
    const diagnosis = await captureLogs(doctor)
    assert.equal(diagnosis.result, false)
    assert.match(diagnosis.logs.join(' '), /CRONLY_BACKEND=cron/)
  }))

  await testAsync('systemd: 등록과 갱신 실패 시 디스크와 활성 상태를 복원', () => sandbox(async ctx => {
    const register = () => add(ctx.file, { schedule: '@daily' })
    ctx.fail('start')
    await assert.rejects(register, /simulated start failure/)
    assert.deepEqual(readSystemdEntries(), [])
    await captureLogs(register)
    const before = readSystemdEntries()
    ctx.fail('enable')
    await assert.rejects(() => add(ctx.file, { schedule: '@hourly' }), /simulated enable failure/)
    assert.deepEqual(readSystemdEntries(), before)
    assert.deepEqual(ctx.state(), { enabled: true, active: true })
    ctx.fail('stop')
    await assert.rejects(() => remove(ctx.file, {}), /simulated stop failure/)
    assert.deepEqual(readSystemdEntries(), before)
    await captureLogs(() => add(ctx.file, { schedule: '@reboot' }))
    // An elapsed startup timer can still be active after the job has run.
    ctx.properties('ActiveState=active')
    ctx.fail('daemon-reload')
    await assert.rejects(() => remove(ctx.file, {}), /simulated daemon-reload failure/)
    assert.deepEqual(ctx.state(), { enabled: true, active: false })
    ctx.properties('UnitFileState=disabled')
    ctx.fail('daemon-reload')
    await assert.rejects(() => remove(ctx.file, {}), /simulated daemon-reload failure/)
    assert.equal(readSystemdEntries()[0].schedule, '@reboot')
    ctx.properties('')
    ctx.fail('enable', 'disable')
    await assert.rejects(register, /Restoring the previous timers also failed/)
    assert.equal(readSystemdEntries()[0].schedule, '@reboot')
  }))

  await testAsync('systemd: doctor가 사용자 세션, 비활성 타이머와 서비스 실패를 진단', () => sandbox(async ctx => {
    ctx.fail('show')
    assert.equal((await captureLogs(doctor)).result, false)
    await captureLogs(() => add(ctx.file, { schedule: '@daily' }))
    for (const properties of ['ActiveState=inactive', 'UnitFileState=disabled', 'LoadState=error', 'Result=exit-code']) {
      ctx.properties(properties)
      assert.equal((await captureLogs(doctor)).result, false)
    }
    await captureLogs(() => add(ctx.file, { schedule: '@reboot' }))
    ctx.properties('ActiveState=failed')
    assert.equal((await captureLogs(doctor)).result, false)
    ctx.properties('')
    rmSync(ctx.file)
    assert.match((await captureLogs(doctor)).logs.join(' '), /script not found/)
    await captureLogs(() => remove(undefined, { id: ctx.id }))
    await withPatchedVersion('v12.0.0', async () => assert.equal((await captureLogs(doctor)).result, false))
  }))
}
