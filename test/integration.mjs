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

const CLI = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'crontab-agent.mjs')

function run(...args) {
  const result = spawnSync('node', [CLI, ...args], {
    encoding: 'utf8',
    timeout: 15000,
    stdio: ['pipe', 'pipe', 'pipe'],
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

function restore() {
  try {
    execFileSync('crontab', ['-'], { input: backup, encoding: 'utf8' })
  } catch {
    // 빈 crontab 복원 실패는 무시
  }
}

// 임시 스크립트 파일 생성
const tmpScript1 = join(tmpdir(), 'crontab-agent-test-1.sh')
const tmpScript2 = join(tmpdir(), 'crontab-agent-test-2.mjs')
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
  await test('doctor 실행', () => {
    const out = run('doctor')
    assert.ok(out.includes('Node.js'))
    assert.ok(out.includes('crontab'))
  })

  await test('add: 첫 번째 스크립트 등록', () => {
    const out = run('add', tmpScript1, '--schedule', '*/5 * * * *')
    assert.ok(out.includes('등록했어요'))
    const raw = crontabRaw()
    assert.ok(raw.includes(tmpScript1))
    assert.ok(raw.includes('crontab-agent:begin'))
  })

  await test('list: 등록된 항목 확인', () => {
    const out = run('list')
    assert.ok(out.includes(tmpScript1))
    assert.ok(out.includes('sh'))
  })

  await test('add: 같은 파일 다시 등록 → 업데이트', () => {
    const out = run('add', tmpScript1, '--schedule', '0 * * * *')
    assert.ok(out.includes('업데이트했어요'))
    // 중복 없는지 확인
    const raw = crontabRaw()
    const matches = raw.match(/crontab-agent:begin/g)
    assert.equal(matches.length, 1, '블록이 1개여야 함')
    assert.ok(raw.includes('0 * * * *'), '스케줄이 업데이트되어야 함')
  })

  await test('add: 두 번째 스크립트 등록', () => {
    run('add', tmpScript2, '--schedule', '*/10 * * * *')
    const out = run('list')
    assert.ok(out.includes(tmpScript1))
    assert.ok(out.includes(tmpScript2))
  })

  await test('print: raw 블록 출력', () => {
    const out = run('print')
    assert.ok(out.includes('crontab-agent:begin'))
    assert.ok(out.includes('crontab-agent:end'))
  })

  await test('수동 항목 보존 확인', () => {
    // 기존 backup에 있던 내용이 그대로 남아 있는지 (빈 경우 스킵)
    if (backup.trim()) {
      const raw = crontabRaw()
      // backup의 각 non-empty 라인이 남아 있어야 함
      for (const line of backup.split('\n').filter((l) => l.trim())) {
        assert.ok(raw.includes(line), `수동 항목 보존 실패: ${line}`)
      }
    }
  })

  await test('remove: 파일 경로로 삭제', () => {
    const out = run('remove', tmpScript1)
    assert.ok(out.includes('삭제했어요'))
    const list = run('list')
    assert.ok(!list.includes(tmpScript1))
    assert.ok(list.includes(tmpScript2))
  })

  await test('remove: 남은 항목도 삭제', () => {
    run('remove', tmpScript2)
    const out = run('list')
    assert.ok(out.includes('없어요'))
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
