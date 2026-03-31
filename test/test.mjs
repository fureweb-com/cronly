import assert from 'assert/strict'
import { resolve } from 'path'
import { buildBlock, makeId, normalizePath, parseBlocks, inferRuntime } from '../lib/entry.mjs'
import { isSupportedNodeVersion, removeBlockFromCrontab } from '../lib/commands.mjs'

let passed = 0
let failed = 0

function test(name, fn) {
  try {
    fn()
    passed++
    console.log(`  ✓ ${name}`)
  } catch (err) {
    failed++
    console.log(`  ✗ ${name}`)
    console.log(`    ${err.message}`)
  }
}

console.log('단위 테스트\n')

// ── makeId ──────────────────────────────────────────────────────────────────

test('makeId: 같은 경로는 같은 id를 반환', () => {
  const id1 = makeId('/usr/local/bin/backup.sh')
  const id2 = makeId('/usr/local/bin/backup.sh')
  assert.equal(id1, id2)
})

test('makeId: 다른 경로는 다른 id를 반환', () => {
  const id1 = makeId('/a/b.sh')
  const id2 = makeId('/a/c.sh')
  assert.notEqual(id1, id2)
})

test('makeId: 8자 hex 형식', () => {
  const id = makeId('/test/path.js')
  assert.match(id, /^[0-9a-f]{8}$/)
})

// ── normalizePath ───────────────────────────────────────────────────────────

test('normalizePath: 상대 경로를 절대 경로로 변환', () => {
  const result = normalizePath('./foo/bar.js')
  assert.equal(result, resolve('./foo/bar.js'))
  assert.ok(result.startsWith('/'))
})

// ── inferRuntime ────────────────────────────────────────────────────────────

test('inferRuntime: .js -> node', () => {
  assert.equal(inferRuntime('test.js'), 'node')
})

test('inferRuntime: .mjs -> node', () => {
  assert.equal(inferRuntime('test.mjs'), 'node')
})

test('inferRuntime: .cjs -> node', () => {
  assert.equal(inferRuntime('test.cjs'), 'node')
})

test('inferRuntime: .sh -> sh', () => {
  assert.equal(inferRuntime('test.sh'), 'sh')
})

test('inferRuntime: .py -> null', () => {
  assert.equal(inferRuntime('test.py'), null)
})

// ── Node.js version support ──────────────────────────────────────────────────

test('isSupportedNodeVersion: v14.8.0 이상 지원', () => {
  assert.equal(isSupportedNodeVersion('v14.8.0'), true)
  assert.equal(isSupportedNodeVersion('v14.9.0'), true)
  assert.equal(isSupportedNodeVersion('v16.20.2'), true)
})

test('isSupportedNodeVersion: v14.7.x 이하는 미지원', () => {
  assert.equal(isSupportedNodeVersion('v14.7.0'), false)
  assert.equal(isSupportedNodeVersion('v12.22.12'), false)
})

// ── buildBlock ──────────────────────────────────────────────────────────────

test('buildBlock: 올바른 3줄 블록 생성', () => {
  const block = buildBlock({
    schedule: '*/5 * * * *',
    absolutePath: '/home/user/job.mjs',
    runtime: 'node',
  })
  const lines = block.split('\n')
  assert.equal(lines.length, 3)
  assert.ok(lines[0].startsWith('# [crontab-agent:begin]'))
  assert.ok(lines[0].includes('path=/home/user/job.mjs'))
  assert.ok(lines[0].includes('runtime=node'))
  assert.ok(lines[1].startsWith('*/5 * * * *'))
  assert.ok(lines[1].includes('/home/user/job.mjs'))
  assert.ok(lines[2].startsWith('# [crontab-agent:end]'))
})

test('buildBlock: exec 런타임은 prefix 없이 경로만', () => {
  const block = buildBlock({
    schedule: '0 0 * * *',
    absolutePath: '/usr/local/bin/mytool',
    runtime: 'exec',
  })
  const lines = block.split('\n')
  assert.ok(lines[1].includes('/usr/local/bin/mytool'))
  assert.ok(!lines[1].includes('node'))
  assert.ok(!lines[1].includes('/bin/sh'))
})

test('buildBlock: 경로에 공백이 있으면 single-quote로 감싸기', () => {
  const block = buildBlock({
    schedule: '0 * * * *',
    absolutePath: '/home/user/my scripts/backup.sh',
    runtime: 'sh',
  })
  const lines = block.split('\n')
  assert.ok(lines[1].includes("'/home/user/my scripts/backup.sh'"))
})

test('buildBlock: 경로에 %가 있으면 \\%로 이스케이프', () => {
  const block = buildBlock({
    schedule: '0 * * * *',
    absolutePath: '/home/user/100%done.sh',
    runtime: 'sh',
  })
  const lines = block.split('\n')
  assert.ok(lines[1].includes('100\\%done'))
  assert.ok(!lines[1].includes('100%done'))
})

test("buildBlock: 경로에 single-quote가 있으면 이스케이프", () => {
  const block = buildBlock({
    schedule: '0 * * * *',
    absolutePath: "/home/user/it's a test.sh",
    runtime: 'sh',
  })
  const lines = block.split('\n')
  // single quote 내부의 ' 는 '\'' 패턴으로 이스케이프
  assert.ok(lines[1].includes("'\\''"))
})

test('buildBlock: 경로에 줄바꿈 문자가 있으면 에러', () => {
  assert.throws(
    () =>
      buildBlock({
        schedule: '0 * * * *',
        absolutePath: '/home/user/line1\nline2.sh',
        runtime: 'sh',
      }),
    /줄바꿈 문자/
  )
})

test('buildBlock: @reboot 스케줄 지원', () => {
  const block = buildBlock({
    schedule: '@reboot',
    absolutePath: '/home/user/startup.sh',
    runtime: 'sh',
  })
  const lines = block.split('\n')
  assert.ok(lines[1].startsWith('@reboot'))
  assert.ok(lines[1].includes('/home/user/startup.sh'))
})

// ── parseBlocks ─────────────────────────────────────────────────────────────

test('parseBlocks: 빈 문자열에서 빈 배열 반환', () => {
  const blocks = parseBlocks('')
  assert.equal(blocks.length, 0)
})

test('parseBlocks: 관리 블록이 없는 crontab', () => {
  const text = '0 * * * * /usr/bin/some-other-job\n'
  const blocks = parseBlocks(text)
  assert.equal(blocks.length, 0)
})

test('parseBlocks: 단일 블록 파싱', () => {
  const id = makeId('/home/user/job.mjs')
  const text = [
    `# [crontab-agent:begin] id=${id} path=/home/user/job.mjs runtime=node`,
    `*/5 * * * * /usr/local/bin/node /home/user/job.mjs`,
    `# [crontab-agent:end] id=${id}`,
  ].join('\n')

  const blocks = parseBlocks(text)
  assert.equal(blocks.length, 1)
  assert.equal(blocks[0].id, id)
  assert.equal(blocks[0].path, '/home/user/job.mjs')
  assert.equal(blocks[0].runtime, 'node')
  assert.equal(blocks[0].schedule, '*/5 * * * *')
})

test('parseBlocks: 수동 엔트리 사이에 있는 관리 블록 파싱', () => {
  const id = makeId('/home/user/job.sh')
  const text = [
    '0 * * * * /usr/bin/manual-job',
    '',
    `# [crontab-agent:begin] id=${id} path=/home/user/job.sh runtime=sh`,
    `0 2 * * * /bin/sh /home/user/job.sh`,
    `# [crontab-agent:end] id=${id}`,
    '',
    '30 * * * * /usr/bin/another-manual',
  ].join('\n')

  const blocks = parseBlocks(text)
  assert.equal(blocks.length, 1)
  assert.equal(blocks[0].path, '/home/user/job.sh')
})

test('parseBlocks: 여러 블록 파싱', () => {
  const id1 = makeId('/a.sh')
  const id2 = makeId('/b.js')
  const text = [
    `# [crontab-agent:begin] id=${id1} path=/a.sh runtime=sh`,
    `0 * * * * /bin/sh /a.sh`,
    `# [crontab-agent:end] id=${id1}`,
    '',
    `# [crontab-agent:begin] id=${id2} path=/b.js runtime=node`,
    `*/10 * * * * /usr/local/bin/node /b.js`,
    `# [crontab-agent:end] id=${id2}`,
  ].join('\n')

  const blocks = parseBlocks(text)
  assert.equal(blocks.length, 2)
  assert.equal(blocks[0].id, id1)
  assert.equal(blocks[1].id, id2)
})

test('parseBlocks: @reboot cron alias 파싱', () => {
  const id = makeId('/home/user/startup.sh')
  const text = [
    `# [crontab-agent:begin] id=${id} path=/home/user/startup.sh runtime=sh`,
    `@reboot '/bin/sh' '/home/user/startup.sh'`,
    `# [crontab-agent:end] id=${id}`,
  ].join('\n')

  const blocks = parseBlocks(text)
  assert.equal(blocks.length, 1)
  assert.equal(blocks[0].schedule, '@reboot')
  assert.equal(blocks[0].path, '/home/user/startup.sh')
})

test('parseBlocks: @daily cron alias 파싱', () => {
  const id = makeId('/home/user/daily.sh')
  const text = [
    `# [crontab-agent:begin] id=${id} path=/home/user/daily.sh runtime=sh`,
    `@daily '/bin/sh' '/home/user/daily.sh'`,
    `# [crontab-agent:end] id=${id}`,
  ].join('\n')

  const blocks = parseBlocks(text)
  assert.equal(blocks.length, 1)
  assert.equal(blocks[0].schedule, '@daily')
})

// ── 라운드트립: buildBlock -> parseBlocks ───────────────────────────────────

test('라운드트립: buildBlock으로 생성 후 parseBlocks으로 파싱', () => {
  const absolutePath = '/home/user/report.mjs'
  const block = buildBlock({ schedule: '0 9 * * 1', absolutePath, runtime: 'node' })
  const blocks = parseBlocks(block)

  assert.equal(blocks.length, 1)
  assert.equal(blocks[0].id, makeId(absolutePath))
  assert.equal(blocks[0].path, absolutePath)
  assert.equal(blocks[0].runtime, 'node')
  assert.equal(blocks[0].schedule, '0 9 * * 1')
})

test('라운드트립: @reboot 스케줄 buildBlock -> parseBlocks', () => {
  const absolutePath = '/home/user/startup.sh'
  const block = buildBlock({ schedule: '@reboot', absolutePath, runtime: 'sh' })
  const blocks = parseBlocks(block)

  assert.equal(blocks.length, 1)
  assert.equal(blocks[0].schedule, '@reboot')
  assert.equal(blocks[0].path, absolutePath)
})

test('라운드트립: 공백 경로 buildBlock -> parseBlocks', () => {
  const absolutePath = '/home/user/my scripts/job.sh'
  const block = buildBlock({ schedule: '0 * * * *', absolutePath, runtime: 'sh' })
  const blocks = parseBlocks(block)

  assert.equal(blocks.length, 1)
  assert.equal(blocks[0].path, absolutePath)
  assert.equal(blocks[0].schedule, '0 * * * *')
})

test('중복 방지: 같은 path로 buildBlock 두 번 -> parseBlocks에서 같은 id', () => {
  const path = '/home/user/task.js'
  const block1 = buildBlock({ schedule: '*/5 * * * *', absolutePath: path, runtime: 'node' })
  const block2 = buildBlock({ schedule: '*/10 * * * *', absolutePath: path, runtime: 'node' })

  const combined = `${block1}\n\n${block2}`
  const blocks = parseBlocks(combined)

  assert.equal(blocks.length, 2)
  assert.equal(blocks[0].id, blocks[1].id) // 같은 id
})

test('removeBlockFromCrontab: 수동 엔트리의 공백 포맷을 전역 정리하지 않음', () => {
  const absolutePath = '/home/user/task.sh'
  const block = buildBlock({ schedule: '0 2 * * *', absolutePath, runtime: 'sh' })
  const raw = [
    'MAILTO=user@example.com',
    '',
    '',
    '0 * * * * /manual-job',
    '',
    block,
    '',
    '',
    '',
    '30 * * * * /another-manual',
    '',
  ].join('\n')

  const target = parseBlocks(raw)[0]
  const next = removeBlockFromCrontab(raw, target)

  assert.equal(next, raw.replace(target.raw, ''))
})

// ── 결과 ────────────────────────────────────────────────────────────────────

console.log(`\n결과: ${passed}개 통과, ${failed}개 실패`)
process.exit(failed > 0 ? 1 : 0)
