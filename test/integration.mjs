/**
 * 통합 테스트 — 실제 crontab을 사용합니다.
 * 테스트 시작 시 기존 crontab을 백업하고, 종료 시 복원합니다.
 *
 * 실행: node test/integration.mjs
 */
import { execFileSync, spawnSync } from 'child_process'
import { writeFileSync, unlinkSync } from 'fs'
import { tmpdir } from 'os'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import assert from 'assert/strict'

const CLI = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'cronly.mjs')

// Default env forces English to avoid inheriting system locale
const defaultEnv = { ...process.env, CRONLY_LANG: 'en' }

function run(...args) {
  const result = spawnSync('node', [CLI, ...args], {
    encoding: 'utf8',
    timeout: 15000,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: defaultEnv,
  })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(result.stderr || `exit code ${result.status}`)
  return result.stdout
}

function runRaw(...args) {
  return spawnSync('node', [CLI, ...args], {
    encoding: 'utf8',
    timeout: 15000,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: defaultEnv,
  })
}

function runEnv(env, ...args) {
  const result = spawnSync('node', [CLI, ...args], {
    encoding: 'utf8',
    timeout: 15000,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...defaultEnv, ...env },
  })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(result.stderr || `exit code ${result.status}`)
  return result.stdout
}

function crontabRaw() {
  try {
    return execFileSync('crontab', ['-l'], { encoding: 'utf8' })
  } catch {
    return ''
  }
}

// ── 백업 ────────────────────────────────────────────────────────────────────
let backup
try {
  backup = crontabRaw()
} catch {
  backup = ''
}

// 임시 스크립트 파일 생성
const tmpScript1 = join(tmpdir(), 'cronly-test-1.sh')
const tmpScript2 = join(tmpdir(), 'cronly-test-2.mjs')
writeFileSync(tmpScript1, '#!/bin/sh\necho test1\n', { mode: 0o755 })
writeFileSync(tmpScript2, 'console.log("test2")\n')

let passed = 0
let failed = 0

async function test(name, fn) {
  try {
    await fn()
    passed++
    console.log(`  ✓ ${name}`)
  } catch (err) {
    failed++
    console.log(`  ✗ ${name}`)
    console.log(`    ${err.message}`)
  }
}

console.log('통합 테스트 (실제 crontab 사용)\n')

try {
  // ── 기본 명령어 ──────────────────────────────────────────────────────────

  await test('doctor 실행', () => {
    const out = run('doctor')
    assert.ok(out.includes('Node.js'))
    assert.ok(out.includes('crontab'))
  })

  await test('--version 출력', () => {
    const out = run('--version')
    assert.match(out.trim(), /^\d+\.\d+\.\d+$/)
  })

  await test('-v 출력', () => {
    const out = run('-v')
    assert.match(out.trim(), /^\d+\.\d+\.\d+$/)
  })

  await test('--help 기본 영어 출력', () => {
    const out = run('--help')
    assert.ok(out.includes('Cronly'))
    assert.ok(out.includes('Schedule scripts easily'))
    assert.ok(out.includes('--daily'))
    assert.ok(out.includes('--lang'))
  })

  await test('알 수 없는 플래그는 에러 (exit 1)', () => {
    const result = runRaw('--foo')
    assert.notEqual(result.status, 0)
    assert.ok(result.stderr.includes('--foo'))
  })

  // ── i18n ─────────────────────────────────────────────────────────────────

  await test('--lang ko: 한국어 도움말', () => {
    const out = run('--lang', 'ko', '--help')
    assert.ok(out.includes('스크립트를 쉽게 예약'))
  })

  await test('--lang ja: 일본어 도움말', () => {
    const out = run('--lang', 'ja', '--help')
    assert.ok(out.includes('スクリプトをかんたんに'))
  })

  await test('--lang zh: 중국어 도움말', () => {
    const out = run('--lang', 'zh', '--help')
    assert.ok(out.includes('轻松调度脚本'))
  })

  await test('--lang xx: 에러 (exit 1)', () => {
    const result = runRaw('--lang', 'xx', '--help')
    assert.notEqual(result.status, 0)
    assert.ok(result.stderr.includes('Unsupported locale'))
  })

  await test('CRONLY_LANG=ko: 한국어 도움말', () => {
    const out = runEnv({ CRONLY_LANG: 'ko' }, '--help')
    assert.ok(out.includes('스크립트를 쉽게 예약'))
  })

  await test('LANG=ko_KR.UTF-8: 한국어 도움말', () => {
    const out = runEnv({ CRONLY_LANG: '', LC_ALL: '', LC_MESSAGES: '', LANG: 'ko_KR.UTF-8' }, '--help')
    assert.ok(out.includes('스크립트를 쉽게 예약'))
  })

  await test('--lang이 CRONLY_LANG보다 우선', () => {
    const out = runEnv({ CRONLY_LANG: 'ko' }, '--lang', 'ja', '--help')
    assert.ok(out.includes('スクリプトをかんたんに'))
  })

  // ── --schedule (기존 방식) ───────────────────────────────────────────────

  await test('add: --schedule로 스크립트 등록', () => {
    const out = run('add', tmpScript1, '--schedule', '*/5 * * * *')
    assert.ok(out.includes('Registered'))
    const raw = crontabRaw()
    assert.ok(raw.includes(tmpScript1))
    assert.ok(raw.includes('cronly:begin'))
  })

  await test('add: --schedule로 같은 파일 업데이트', () => {
    const beforeCount = (crontabRaw().match(/cronly:begin/g) || []).length
    const out = run('add', tmpScript1, '--schedule', '0 * * * *')
    assert.ok(out.includes('Updated'))
    const raw = crontabRaw()
    const afterCount = (raw.match(/cronly:begin/g) || []).length
    assert.equal(afterCount, beforeCount, 'update should not increase block count')
    assert.ok(raw.includes('0 * * * *'))
  })

  // ── easy-pattern 플래그 ──────────────────────────────────────────────────

  await test('add: --daily로 업데이트', () => {
    const out = run('add', tmpScript1, '--daily', '09:00')
    assert.ok(out.includes('Updated'))
    const raw = crontabRaw()
    assert.ok(raw.includes('0 9 * * *'))
  })

  await test('add: --every-hours로 업데이트', () => {
    run('add', tmpScript1, '--every-hours', '4')
    const raw = crontabRaw()
    assert.ok(raw.includes('0 */4 * * *'))
  })

  await test('add: --every-minutes로 업데이트', () => {
    run('add', tmpScript1, '--every-minutes', '10')
    const raw = crontabRaw()
    assert.ok(raw.includes('*/10 * * * *'))
  })

  await test('add: --weekdays --at로 업데이트', () => {
    run('add', tmpScript1, '--weekdays', '--at', '08:30')
    const raw = crontabRaw()
    assert.ok(raw.includes('30 8 * * 1-5'))
  })

  await test('add: --weekends --at로 업데이트', () => {
    run('add', tmpScript1, '--weekends', '--at', '10:00')
    const raw = crontabRaw()
    assert.ok(raw.includes('0 10 * * 0,6'))
  })

  await test('add: --weekly --at로 업데이트', () => {
    run('add', tmpScript1, '--weekly', 'sat', '--at', '00:00')
    const raw = crontabRaw()
    assert.ok(raw.includes('0 0 * * 6'))
  })

  await test('add: --days --at로 업데이트', () => {
    run('add', tmpScript1, '--days', 'mon,wed,fri', '--at', '09:00')
    const raw = crontabRaw()
    assert.ok(raw.includes('0 9 * * 1,3,5'))
  })

  await test('add: --reboot로 등록', () => {
    run('add', tmpScript2, '--reboot')
    const raw = crontabRaw()
    assert.ok(raw.includes('@reboot'))
    assert.ok(raw.includes(tmpScript2))
  })

  // ── 에러 케이스 ──────────────────────────────────────────────────────────

  await test('add: 충돌하는 스케줄 옵션 거부', () => {
    const result = runRaw('add', tmpScript1, '--daily', '09:00', '--reboot')
    assert.notEqual(result.status, 0)
    assert.ok(result.stderr.includes('Only one'))
  })

  await test('add: --weekdays에 --at 누락 거부', () => {
    const result = runRaw('add', tmpScript1, '--weekdays')
    assert.notEqual(result.status, 0)
    assert.ok(result.stderr.includes('--at'))
  })

  await test('add: 스케줄 없이 add 거부', () => {
    const result = runRaw('add', tmpScript1)
    assert.notEqual(result.status, 0)
    assert.ok(result.stderr.includes('schedule'))
  })

  await test('add: 잘못된 cron 표현식 거부', () => {
    const result = runRaw('add', tmpScript1, '--schedule', '0 99 * * *')
    assert.notEqual(result.status, 0)
    assert.ok(result.stderr.includes('cron'))
  })

  // ── i18n 에러 메시지 ────────────────────────────────────────────────────

  await test('add: --lang ko 에러 메시지 한국어', () => {
    const result = runRaw('add', tmpScript1, '--weekdays', '--lang', 'ko')
    assert.notEqual(result.status, 0)
    assert.ok(result.stderr.includes('--at HH:MM 옵션이 필요해요'))
  })

  // ── list / print / remove ────────────────────────────────────────────────

  await test('list: 등록된 항목 확인', () => {
    const out = run('list')
    assert.ok(out.includes(tmpScript1))
    assert.ok(out.includes(tmpScript2))
  })

  await test('print: 블록 출력', () => {
    const out = run('print')
    assert.ok(out.includes('cronly:begin'))
    assert.ok(out.includes('cronly:end'))
  })

  await test('수동 항목 보존 확인', () => {
    if (backup.trim()) {
      const raw = crontabRaw()
      for (const line of backup.split('\n').filter((l) => l.trim())) {
        assert.ok(raw.includes(line), `수동 항목 보존 실패: ${line}`)
      }
    }
  })

  await test('remove: 파일 경로로 삭제', () => {
    const out = run('remove', tmpScript1)
    assert.ok(out.includes('Removed'))
    const listOut = run('list')
    assert.ok(!listOut.includes(tmpScript1))
    assert.ok(listOut.includes(tmpScript2))
  })

  await test('remove: 남은 항목도 삭제', () => {
    run('remove', tmpScript2)
    const out = run('list')
    assert.ok(!out.includes(tmpScript2))
  })
} finally {
  // ── 복원 ──────────────────────────────────────────────────────────────────
  try {
    execFileSync('crontab', ['-'], { input: backup, encoding: 'utf8' })
    console.log('\ncrontab 복원 완료.')
  } catch {
    console.log('\ncrontab 복원 (빈 상태).')
  }

  // 임시 파일 정리
  try { unlinkSync(tmpScript1) } catch {}
  try { unlinkSync(tmpScript2) } catch {}
}

console.log(`\n결과: ${passed}개 통과, ${failed}개 실패`)
process.exit(failed > 0 ? 1 : 0)
