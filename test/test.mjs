import assert from 'assert/strict'
import { spawnSync } from 'child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { dirname, join, resolve } from 'path'
import { fileURLToPath } from 'url'
import { buildBlock, makeId, normalizePath, parseBlocks, inferRuntime } from '../lib/entry.mjs'
import { add, doctor, isSupportedNodeVersion, list, print, remove, removeBlockFromCrontab } from '../lib/commands.mjs'
import { parseArgv } from '../lib/cli.mjs'
import { readCrontab, writeCrontab } from '../lib/crontab.mjs'
import { normalizeLocale, detectLocale, setLocale, getLocale, t, getUsage } from '../lib/i18n.mjs'
import enCatalog from '../lib/i18n/en.mjs'
import koCatalog from '../lib/i18n/ko.mjs'
import jaCatalog from '../lib/i18n/ja.mjs'
import zhCatalog from '../lib/i18n/zh.mjs'
import {
  resolveSchedule,
  validateCron,
  parseTime,
  parseWeekday,
  parseWeekdays,
} from '../lib/schedule.mjs'

let passed = 0
let failed = 0

const LOCALE_CATALOGS = { en: enCatalog, ko: koCatalog, ja: jaCatalog, zh: zhCatalog }

const CLI = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'cronly.mjs')

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

async function testAsync(name, fn) {
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

async function captureLogs(fn) {
  const logs = []
  const originalLog = console.log
  console.log = (...args) => logs.push(args.join(' '))
  try {
    const result = await fn()
    return { logs, result }
  } finally {
    console.log = originalLog
  }
}

async function withPatchedVersion(version, fn) {
  const descriptor = Object.getOwnPropertyDescriptor(process, 'version')
  Object.defineProperty(process, 'version', { value: version })
  try {
    return await fn()
  } finally {
    Object.defineProperty(process, 'version', descriptor)
  }
}

async function withMockCrontabEnv(
  { initialContent = '', noCrontab = false, readFail = '', writeFail = '', whichFail = false } = {},
  fn
) {
  const dir = mkdtempSync(join(tmpdir(), 'cronly-unit-'))
  const stateFile = join(dir, 'crontab.txt')
  const writeLogFile = join(dir, 'last-write.txt')
  const crontabPath = join(dir, 'crontab')
  const whichPath = join(dir, 'which')

  if (!noCrontab) {
    writeFileSync(stateFile, initialContent)
  }

  writeFileSync(
    crontabPath,
    `#!/bin/sh
state="$MOCK_CRONTAB_FILE"
if [ "$1" = "-l" ]; then
  if [ -n "$MOCK_READ_FAIL" ]; then
    echo "$MOCK_READ_FAIL" >&2
    exit 1
  fi
  if [ "$MOCK_NO_CRONTAB" = "1" ]; then
    echo "no crontab for test" >&2
    exit 1
  fi
  if [ -f "$state" ]; then
    cat "$state"
  fi
  exit 0
fi
if [ "$1" = "-" ]; then
  if [ -n "$MOCK_WRITE_FAIL" ]; then
    cat >/dev/null
    echo "$MOCK_WRITE_FAIL" >&2
    exit 1
  fi
  cat > "$state"
  if [ -n "$MOCK_WRITE_LOG" ]; then
    cp "$state" "$MOCK_WRITE_LOG"
  fi
  exit 0
fi
echo "unsupported args: $*" >&2
exit 1
`,
    { mode: 0o755 }
  )

  writeFileSync(
    whichPath,
    `#!/bin/sh
if [ "$MOCK_WHICH_FAIL" = "1" ]; then
  exit 1
fi
if [ "$1" = "crontab" ]; then
  printf '%s/crontab\\n' "$MOCK_BIN_DIR"
  exit 0
fi
exit 1
`,
    { mode: 0o755 }
  )

  const keys = [
    'PATH',
    'MOCK_CRONTAB_FILE',
    'MOCK_WRITE_LOG',
    'MOCK_NO_CRONTAB',
    'MOCK_READ_FAIL',
    'MOCK_WRITE_FAIL',
    'MOCK_WHICH_FAIL',
    'MOCK_BIN_DIR',
    'CRONLY_LANG',
  ]
  const previousEnv = Object.fromEntries(keys.map((key) => [key, process.env[key]]))

  process.env.PATH = `${dir}:${previousEnv.PATH || ''}`
  process.env.MOCK_BIN_DIR = dir
  process.env.MOCK_CRONTAB_FILE = stateFile
  process.env.CRONLY_LANG = 'en'
  process.env.MOCK_WRITE_LOG = writeLogFile
  if (noCrontab) process.env.MOCK_NO_CRONTAB = '1'
  else delete process.env.MOCK_NO_CRONTAB
  if (readFail) process.env.MOCK_READ_FAIL = readFail
  else delete process.env.MOCK_READ_FAIL
  if (writeFail) process.env.MOCK_WRITE_FAIL = writeFail
  else delete process.env.MOCK_WRITE_FAIL
  if (whichFail) process.env.MOCK_WHICH_FAIL = '1'
  else delete process.env.MOCK_WHICH_FAIL

  const ctx = {
    dir,
    stateFile,
    writeLogFile,
    readState() {
      return existsSync(stateFile) ? readFileSync(stateFile, 'utf8') : ''
    },
    readWriteLog() {
      return existsSync(writeLogFile) ? readFileSync(writeLogFile, 'utf8') : ''
    },
    setState(content) {
      writeFileSync(stateFile, content)
    },
    createScript(name, content, mode = 0o755) {
      const filePath = join(dir, name)
      writeFileSync(filePath, content, { mode })
      return filePath
    },
    cli(args, env = {}) {
      return spawnSync('node', [CLI, ...args], {
        cwd: resolve('.'),
        encoding: 'utf8',
        env: { ...process.env, ...env },
      })
    },
  }

  try {
    return await fn(ctx)
  } finally {
    for (const key of keys) {
      if (previousEnv[key] === undefined) delete process.env[key]
      else process.env[key] = previousEnv[key]
    }
    rmSync(dir, { recursive: true, force: true })
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

test('isSupportedNodeVersion: 형식이 이상하면 false', () => {
  assert.equal(isSupportedNodeVersion('not-a-version'), false)
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
  assert.ok(lines[0].startsWith('# [cronly:begin]'))
  assert.ok(lines[0].includes('path=/home/user/job.mjs'))
  assert.ok(lines[0].includes('runtime=node'))
  assert.ok(lines[1].startsWith('*/5 * * * *'))
  assert.ok(lines[1].includes('/home/user/job.mjs'))
  assert.ok(lines[2].startsWith('# [cronly:end]'))
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

test('buildBlock: 사용자 지정 런타임은 그대로 prefix로 사용', () => {
  const block = buildBlock({
    schedule: '0 0 * * *',
    absolutePath: '/home/user/job.py',
    runtime: 'python3',
  })
  const lines = block.split('\n')
  assert.ok(lines[1].includes("'python3' '/home/user/job.py'"))
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
    /newline/
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
    `# [cronly:begin] id=${id} path=/home/user/job.mjs runtime=node`,
    `*/5 * * * * /usr/local/bin/node /home/user/job.mjs`,
    `# [cronly:end] id=${id}`,
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
    `# [cronly:begin] id=${id} path=/home/user/job.sh runtime=sh`,
    `0 2 * * * /bin/sh /home/user/job.sh`,
    `# [cronly:end] id=${id}`,
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
    `# [cronly:begin] id=${id1} path=/a.sh runtime=sh`,
    `0 * * * * /bin/sh /a.sh`,
    `# [cronly:end] id=${id1}`,
    '',
    `# [cronly:begin] id=${id2} path=/b.js runtime=node`,
    `*/10 * * * * /usr/local/bin/node /b.js`,
    `# [cronly:end] id=${id2}`,
  ].join('\n')

  const blocks = parseBlocks(text)
  assert.equal(blocks.length, 2)
  assert.equal(blocks[0].id, id1)
  assert.equal(blocks[1].id, id2)
})

test('parseBlocks: @reboot cron alias 파싱', () => {
  const id = makeId('/home/user/startup.sh')
  const text = [
    `# [cronly:begin] id=${id} path=/home/user/startup.sh runtime=sh`,
    `@reboot '/bin/sh' '/home/user/startup.sh'`,
    `# [cronly:end] id=${id}`,
  ].join('\n')

  const blocks = parseBlocks(text)
  assert.equal(blocks.length, 1)
  assert.equal(blocks[0].schedule, '@reboot')
  assert.equal(blocks[0].path, '/home/user/startup.sh')
})

test('parseBlocks: @daily cron alias 파싱', () => {
  const id = makeId('/home/user/daily.sh')
  const text = [
    `# [cronly:begin] id=${id} path=/home/user/daily.sh runtime=sh`,
    `@daily '/bin/sh' '/home/user/daily.sh'`,
    `# [cronly:end] id=${id}`,
  ].join('\n')

  const blocks = parseBlocks(text)
  assert.equal(blocks.length, 1)
  assert.equal(blocks[0].schedule, '@daily')
})

test('parseBlocks: legacy scriptclock 블록도 파싱', () => {
  const id = makeId('/home/user/legacy-scriptclock.sh')
  const text = [
    `# [scriptclock:begin] id=${id} path=/home/user/legacy-scriptclock.sh runtime=sh`,
    `0 8 * * * '/bin/sh' '/home/user/legacy-scriptclock.sh'`,
    `# [scriptclock:end] id=${id}`,
  ].join('\n')

  const blocks = parseBlocks(text)
  assert.equal(blocks.length, 1)
  assert.equal(blocks[0].id, id)
  assert.equal(blocks[0].path, '/home/user/legacy-scriptclock.sh')
  assert.equal(blocks[0].schedule, '0 8 * * *')
})

test('parseBlocks: legacy crontab-agent 블록도 파싱', () => {
  const id = makeId('/home/user/legacy.sh')
  const text = [
    `# [crontab-agent:begin] id=${id} path=/home/user/legacy.sh runtime=sh`,
    `0 8 * * * '/bin/sh' '/home/user/legacy.sh'`,
    `# [crontab-agent:end] id=${id}`,
  ].join('\n')

  const blocks = parseBlocks(text)
  assert.equal(blocks.length, 1)
  assert.equal(blocks[0].id, id)
  assert.equal(blocks[0].path, '/home/user/legacy.sh')
  assert.equal(blocks[0].schedule, '0 8 * * *')
})

test('parseBlocks: end 주석이 더 아래에 있어도 찾기', () => {
  const id = makeId('/home/user/recover.sh')
  const text = [
    `# [cronly:begin] id=${id} path=/home/user/recover.sh runtime=sh`,
    `0 8 * * * /bin/sh /home/user/recover.sh`,
    '# comment between lines',
    `# [cronly:end] id=${id}`,
  ].join('\n')

  const blocks = parseBlocks(text)
  assert.equal(blocks.length, 1)
  assert.equal(blocks[0].endLine, 3)
})

test('parseBlocks: end 주석이 없으면 기본 위치로 처리', () => {
  const id = makeId('/home/user/no-end.sh')
  const text = [
    `# [cronly:begin] id=${id} path=/home/user/no-end.sh runtime=sh`,
    `0 8 * * * /bin/sh /home/user/no-end.sh`,
  ].join('\n')

  const blocks = parseBlocks(text)
  assert.equal(blocks.length, 1)
  assert.equal(blocks[0].raw, text)
})

test('parseBlocks: cron 줄이 비어도 안전하게 파싱', () => {
  const id = makeId('/home/user/no-cron.sh')
  const text = [
    `# [cronly:begin] id=${id} path=/home/user/no-cron.sh runtime=sh`,
    '',
    `# [cronly:end] id=${id}`,
  ].join('\n')

  const blocks = parseBlocks(text)
  assert.equal(blocks.length, 1)
  assert.equal(blocks[0].schedule, '')
  assert.equal(blocks[0].command, '')
})

test('parseBlocks: 형식이 이상한 cron 줄은 command로 보존', () => {
  const id = makeId('/home/user/bad-cron.sh')
  const text = [
    `# [cronly:begin] id=${id} path=/home/user/bad-cron.sh runtime=sh`,
    'bad cron line',
    `# [cronly:end] id=${id}`,
  ].join('\n')

  const blocks = parseBlocks(text)
  assert.equal(blocks.length, 1)
  assert.equal(blocks[0].schedule, '')
  assert.equal(blocks[0].command, 'bad cron line')
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

// ── parseTime ───────────────────────────────────────────────────────────────

test('parseTime: 올바른 시간 파싱', () => {
  assert.deepEqual(parseTime('09:00'), { hour: 9, minute: 0 })
  assert.deepEqual(parseTime('23:59'), { hour: 23, minute: 59 })
  assert.deepEqual(parseTime('00:00'), { hour: 0, minute: 0 })
  assert.deepEqual(parseTime('12:30'), { hour: 12, minute: 30 })
})

test('parseTime: 앞자리 0 생략은 거부', () => {
  assert.equal(parseTime('9:00'), null)
  assert.equal(parseTime('1:30'), null)
})

test('parseTime: 범위 초과 거부', () => {
  assert.equal(parseTime('24:00'), null)
  assert.equal(parseTime('25:00'), null)
  assert.equal(parseTime('12:60'), null)
  assert.equal(parseTime('99:99'), null)
})

test('parseTime: 잘못된 형식 거부', () => {
  assert.equal(parseTime(''), null)
  assert.equal(parseTime('abc'), null)
  assert.equal(parseTime('12'), null)
  assert.equal(parseTime('12:'), null)
  assert.equal(parseTime(':30'), null)
  assert.equal(parseTime(null), null)
  assert.equal(parseTime(undefined), null)
  assert.equal(parseTime(true), null)
})

// ── parseWeekday ────────────────────────────────────────────────────────────

test('parseWeekday: 모든 요일 파싱', () => {
  assert.equal(parseWeekday('sun'), 0)
  assert.equal(parseWeekday('mon'), 1)
  assert.equal(parseWeekday('tue'), 2)
  assert.equal(parseWeekday('wed'), 3)
  assert.equal(parseWeekday('thu'), 4)
  assert.equal(parseWeekday('fri'), 5)
  assert.equal(parseWeekday('sat'), 6)
})

test('parseWeekday: 대소문자 무시', () => {
  assert.equal(parseWeekday('Mon'), 1)
  assert.equal(parseWeekday('MON'), 1)
  assert.equal(parseWeekday('FRI'), 5)
})

test('parseWeekday: 잘못된 토큰 거부', () => {
  assert.equal(parseWeekday('xyz'), null)
  assert.equal(parseWeekday('monday'), null)
  assert.equal(parseWeekday(''), null)
  assert.equal(parseWeekday('1'), null)
  assert.equal(parseWeekday(null), null)
  assert.equal(parseWeekday(undefined), null)
})

// ── parseWeekdays ───────────────────────────────────────────────────────────

test('parseWeekdays: 단일 요일', () => {
  assert.deepEqual(parseWeekdays('mon'), { days: [1] })
})

test('parseWeekdays: 여러 요일 파싱 및 정렬', () => {
  assert.deepEqual(parseWeekdays('mon,wed,fri'), { days: [1, 3, 5] })
  assert.deepEqual(parseWeekdays('fri,mon'), { days: [1, 5] })
  assert.deepEqual(parseWeekdays('sun,sat'), { days: [0, 6] })
})

test('parseWeekdays: 대소문자 무시 + 중복 제거', () => {
  assert.deepEqual(parseWeekdays('FRI,MON,FRI'), { days: [1, 5] })
  assert.deepEqual(parseWeekdays('Mon,mon,MON'), { days: [1] })
})

test('parseWeekdays: 잘못된 토큰은 error 반환', () => {
  const result = parseWeekdays('mon,xyz,fri')
  assert.ok(result.error)
  assert.equal(result.error, 'xyz')
})

test('parseWeekdays: 빈 문자열은 null 반환', () => {
  assert.equal(parseWeekdays(''), null)
  assert.equal(parseWeekdays(null), null)
})

// ── validateCron ────────────────────────────────────────────────────────────

test('validateCron: 유효한 5필드 표현식', () => {
  assert.equal(validateCron('* * * * *'), null)
  assert.equal(validateCron('0 8 * * *'), null)
  assert.equal(validateCron('*/5 * * * *'), null)
  assert.equal(validateCron('0 */4 * * *'), null)
  assert.equal(validateCron('30 8 * * 1-5'), null)
  assert.equal(validateCron('0 10 * * 0,6'), null)
  assert.equal(validateCron('0 9 15 * *'), null)
  assert.equal(validateCron('0 0 1-15/2 * *'), null)
  assert.equal(validateCron('0 0 * * 7'), null) // 7 = Sunday
})

test('validateCron: cron alias', () => {
  assert.equal(validateCron('@reboot'), null)
  assert.equal(validateCron('@daily'), null)
  assert.equal(validateCron('@weekly'), null)
  assert.equal(validateCron('@monthly'), null)
  assert.equal(validateCron('@yearly'), null)
  assert.equal(validateCron('@annually'), null)
  assert.equal(validateCron('@hourly'), null)
})

test('validateCron: alias는 대소문자 무시', () => {
  assert.equal(validateCron('@Reboot'), null)
  assert.equal(validateCron('@DAILY'), null)
})

test('validateCron: 필드 수 오류', () => {
  const err = validateCron('0 8 * *')
  assert.ok(err)
  assert.equal(err.code, 'INVALID_CRON_FIELDS')
  assert.equal(err.expected, 5)
  assert.equal(err.actual, 4)
})

test('validateCron: 필드 값 오류는 필드명 포함', () => {
  const err = validateCron('0 99 * * *')
  assert.ok(err)
  assert.equal(err.code, 'INVALID_CRON_FIELD')
  assert.equal(err.field, 'hour')
  assert.equal(err.value, '99')
})

test('validateCron: 범위 초과 거부', () => {
  assert.ok(validateCron('60 * * * *'))   // 분 > 59
  assert.ok(validateCron('0 24 * * *'))   // 시 > 23
  assert.ok(validateCron('0 0 32 * *'))   // 일 > 31
  assert.ok(validateCron('0 0 * 13 *'))   // 월 > 12
  assert.ok(validateCron('0 0 * * 8'))    // 요일 > 7
})

test('validateCron: 잘못된 토큰 거부', () => {
  assert.ok(validateCron('abc * * * *'))
  assert.ok(validateCron('0 * * * mon'))  // 이름 대신 숫자만 지원
})

test('validateCron: step/range 조합 오류 거부', () => {
  assert.ok(validateCron('*/0 * * * *'))
  assert.ok(validateCron('5-1 * * * *'))
  assert.ok(validateCron('1-5/0 * * * *'))
})

// ── resolveSchedule: 성공 케이스 ────────────────────────────────────────────

test('resolveSchedule: --schedule raw cron', () => {
  const r = resolveSchedule({ schedule: '*/5 * * * *' })
  assert.equal(r.cron, '*/5 * * * *')
})

test('resolveSchedule: --schedule @reboot', () => {
  const r = resolveSchedule({ schedule: '@reboot' })
  assert.equal(r.cron, '@reboot')
})

test('resolveSchedule: --daily 09:00', () => {
  const r = resolveSchedule({ daily: '09:00' })
  assert.equal(r.cron, '0 9 * * *')
})

test('resolveSchedule: --daily 00:00', () => {
  const r = resolveSchedule({ daily: '00:00' })
  assert.equal(r.cron, '0 0 * * *')
})

test('resolveSchedule: --every-hours 4', () => {
  const r = resolveSchedule({ 'every-hours': '4' })
  assert.equal(r.cron, '0 */4 * * *')
})

test('resolveSchedule: --every-minutes 10', () => {
  const r = resolveSchedule({ 'every-minutes': '10' })
  assert.equal(r.cron, '*/10 * * * *')
})

test('resolveSchedule: --weekly mon --at 10:00', () => {
  const r = resolveSchedule({ weekly: 'mon', at: '10:00' })
  assert.equal(r.cron, '0 10 * * 1')
})

test('resolveSchedule: --days mon,wed,fri --at 09:00', () => {
  const r = resolveSchedule({ days: 'mon,wed,fri', at: '09:00' })
  assert.equal(r.cron, '0 9 * * 1,3,5')
})

test('resolveSchedule: --days 중복 + 역순 → 정렬', () => {
  const r = resolveSchedule({ days: 'fri,mon,fri', at: '09:00' })
  assert.equal(r.cron, '0 9 * * 1,5')
})

test('resolveSchedule: --weekdays --at 08:30', () => {
  const r = resolveSchedule({ weekdays: true, at: '08:30' })
  assert.equal(r.cron, '30 8 * * 1-5')
})

test('resolveSchedule: --weekends --at 10:00', () => {
  const r = resolveSchedule({ weekends: true, at: '10:00' })
  assert.equal(r.cron, '0 10 * * 0,6')
})

test('resolveSchedule: --reboot', () => {
  const r = resolveSchedule({ reboot: true })
  assert.equal(r.cron, '@reboot')
})

// ── resolveSchedule: 에러 케이스 ────────────────────────────────────────────

test('resolveSchedule: 스케줄 없음 → SCHEDULE_REQUIRED', () => {
  const r = resolveSchedule({})
  assert.equal(r.error.code, 'SCHEDULE_REQUIRED')
})

test('resolveSchedule: --at 단독 → AT_ALONE', () => {
  const r = resolveSchedule({ at: '09:00' })
  assert.equal(r.error.code, 'AT_ALONE')
})

test('resolveSchedule: 여러 스케줄 플래그 → SCHEDULE_CONFLICT', () => {
  const r = resolveSchedule({ daily: '09:00', reboot: true })
  assert.equal(r.error.code, 'SCHEDULE_CONFLICT')
})

test('resolveSchedule: --every-hours + --every-minutes → SCHEDULE_CONFLICT', () => {
  const r = resolveSchedule({ 'every-hours': '4', 'every-minutes': '10' })
  assert.equal(r.error.code, 'SCHEDULE_CONFLICT')
})

test('resolveSchedule: --schedule + --daily → SCHEDULE_CONFLICT', () => {
  const r = resolveSchedule({ schedule: '0 8 * * *', daily: '09:00' })
  assert.equal(r.error.code, 'SCHEDULE_CONFLICT')
})

test('resolveSchedule: --weekdays + --weekends → SCHEDULE_CONFLICT', () => {
  const r = resolveSchedule({ weekdays: true, weekends: true, at: '09:00' })
  assert.equal(r.error.code, 'SCHEDULE_CONFLICT')
})

test('resolveSchedule: --weekdays에 --at 누락 → AT_REQUIRED', () => {
  const r = resolveSchedule({ weekdays: true })
  assert.equal(r.error.code, 'AT_REQUIRED')
})

test('resolveSchedule: --weekly에 --at 누락 → AT_REQUIRED', () => {
  const r = resolveSchedule({ weekly: 'mon' })
  assert.equal(r.error.code, 'AT_REQUIRED')
})

test('resolveSchedule: --days에 --at 누락 → AT_REQUIRED', () => {
  const r = resolveSchedule({ days: 'mon,wed' })
  assert.equal(r.error.code, 'AT_REQUIRED')
})

test('resolveSchedule: --weekends에 --at 누락 → AT_REQUIRED', () => {
  const r = resolveSchedule({ weekends: true })
  assert.equal(r.error.code, 'AT_REQUIRED')
})

test('resolveSchedule: --daily에 --at 사용 → AT_FORBIDDEN', () => {
  const r = resolveSchedule({ daily: '09:00', at: '10:00' })
  assert.equal(r.error.code, 'AT_FORBIDDEN')
})

test('resolveSchedule: --schedule에 --at 사용 → AT_FORBIDDEN', () => {
  const r = resolveSchedule({ schedule: '0 8 * * *', at: '10:00' })
  assert.equal(r.error.code, 'AT_FORBIDDEN')
})

test('resolveSchedule: --reboot에 --at 사용 → AT_FORBIDDEN', () => {
  const r = resolveSchedule({ reboot: true, at: '10:00' })
  assert.equal(r.error.code, 'AT_FORBIDDEN')
})

test('resolveSchedule: --daily 잘못된 시간 → INVALID_TIME', () => {
  assert.equal(resolveSchedule({ daily: '25:00' }).error.code, 'INVALID_TIME')
  assert.equal(resolveSchedule({ daily: '9:00' }).error.code, 'INVALID_TIME')
  assert.equal(resolveSchedule({ daily: 'abc' }).error.code, 'INVALID_TIME')
  assert.equal(resolveSchedule({ daily: true }).error.code, 'INVALID_TIME')
})

test('resolveSchedule: --weekly 잘못된 요일 → INVALID_WEEKDAY', () => {
  const r = resolveSchedule({ weekly: 'xyz', at: '09:00' })
  assert.equal(r.error.code, 'INVALID_WEEKDAY')
})

test('resolveSchedule: --weekly 값 누락 → INVALID_WEEKDAY', () => {
  const r = resolveSchedule({ weekly: true, at: '09:00' })
  assert.equal(r.error.code, 'INVALID_WEEKDAY')
})

test('resolveSchedule: --weekly 잘못된 시간 → INVALID_TIME', () => {
  const r = resolveSchedule({ weekly: 'mon', at: true })
  assert.equal(r.error.code, 'INVALID_TIME')
})

test('resolveSchedule: --days 잘못된 요일 → INVALID_WEEKDAY', () => {
  const r = resolveSchedule({ days: 'mon,xyz', at: '09:00' })
  assert.equal(r.error.code, 'INVALID_WEEKDAY')
})

test('resolveSchedule: --days 빈 값 → WEEKDAY_EMPTY', () => {
  const r = resolveSchedule({ days: true, at: '09:00' })
  assert.equal(r.error.code, 'WEEKDAY_EMPTY')
})

test('resolveSchedule: --days 잘못된 시간 → INVALID_TIME', () => {
  const r = resolveSchedule({ days: 'mon,wed', at: true })
  assert.equal(r.error.code, 'INVALID_TIME')
})

test('resolveSchedule: --weekdays 잘못된 시간 → INVALID_TIME', () => {
  const r = resolveSchedule({ weekdays: true, at: true })
  assert.equal(r.error.code, 'INVALID_TIME')
})

test('resolveSchedule: --weekends 잘못된 시간 → INVALID_TIME', () => {
  const r = resolveSchedule({ weekends: true, at: true })
  assert.equal(r.error.code, 'INVALID_TIME')
})

test('resolveSchedule: --every-hours 0 → INVALID_INTERVAL out_of_range', () => {
  const r = resolveSchedule({ 'every-hours': '0' })
  assert.equal(r.error.code, 'INVALID_INTERVAL')
  assert.equal(r.error.flag, 'every-hours')
  assert.equal(r.error.reason, 'out_of_range')
  assert.equal(r.error.min, 1)
  assert.equal(r.error.max, 23)
})

test('resolveSchedule: --every-hours 24 → INTERVAL_HINT', () => {
  const r = resolveSchedule({ 'every-hours': '24' })
  assert.equal(r.error.code, 'INTERVAL_HINT')
  assert.equal(r.error.flag, 'every-hours')
  assert.ok(r.error.hint.includes('--daily'))
})

test('resolveSchedule: --every-hours 25 → INVALID_INTERVAL out_of_range', () => {
  const r = resolveSchedule({ 'every-hours': '25' })
  assert.equal(r.error.code, 'INVALID_INTERVAL')
  assert.equal(r.error.reason, 'out_of_range')
})

test('resolveSchedule: --every-minutes 0 → INVALID_INTERVAL out_of_range', () => {
  const r = resolveSchedule({ 'every-minutes': '0' })
  assert.equal(r.error.code, 'INVALID_INTERVAL')
  assert.equal(r.error.reason, 'out_of_range')
  assert.equal(r.error.min, 1)
  assert.equal(r.error.max, 59)
})

test('resolveSchedule: --every-minutes 60 → INTERVAL_HINT', () => {
  const r = resolveSchedule({ 'every-minutes': '60' })
  assert.equal(r.error.code, 'INTERVAL_HINT')
  assert.equal(r.error.flag, 'every-minutes')
  assert.ok(r.error.hint.includes('--every-hours'))
})

test('resolveSchedule: --every-minutes 61 → INVALID_INTERVAL out_of_range', () => {
  const r = resolveSchedule({ 'every-minutes': '61' })
  assert.equal(r.error.code, 'INVALID_INTERVAL')
  assert.equal(r.error.reason, 'out_of_range')
})

test('resolveSchedule: --every-hours abc → INVALID_INTERVAL not_integer', () => {
  const r = resolveSchedule({ 'every-hours': 'abc' })
  assert.equal(r.error.code, 'INVALID_INTERVAL')
  assert.equal(r.error.reason, 'not_integer')
  assert.equal(r.error.value, 'abc')
})

test('resolveSchedule: --every-hours 값 누락 → INVALID_INTERVAL no_value', () => {
  const r = resolveSchedule({ 'every-hours': true })
  assert.equal(r.error.code, 'INVALID_INTERVAL')
  assert.equal(r.error.reason, 'no_value')
  assert.equal(r.error.flag, 'every-hours')
})

test('resolveSchedule: --every-minutes abc → INVALID_INTERVAL not_integer', () => {
  const r = resolveSchedule({ 'every-minutes': 'abc' })
  assert.equal(r.error.code, 'INVALID_INTERVAL')
  assert.equal(r.error.reason, 'not_integer')
})

test('resolveSchedule: --every-minutes 값 누락 → INVALID_INTERVAL no_value', () => {
  const r = resolveSchedule({ 'every-minutes': true })
  assert.equal(r.error.code, 'INVALID_INTERVAL')
  assert.equal(r.error.reason, 'no_value')
  assert.equal(r.error.flag, 'every-minutes')
})

test('resolveSchedule: --schedule 유효하지 않은 cron 필드 → INVALID_CRON_FIELD', () => {
  const r = resolveSchedule({ schedule: '0 99 * * *' })
  assert.equal(r.error.code, 'INVALID_CRON_FIELD')
})

test('resolveSchedule: --schedule 필드 수 오류 → INVALID_CRON_FIELDS', () => {
  const r = resolveSchedule({ schedule: '0 8 * *' })
  assert.equal(r.error.code, 'INVALID_CRON_FIELDS')
})

test('resolveSchedule: --schedule 빈 값 → INVALID_CRON_EMPTY', () => {
  const r = resolveSchedule({ schedule: true })
  assert.equal(r.error.code, 'INVALID_CRON_EMPTY')
})

// ── parseArgv: -v / -h 지원 ────────────────────────────────────────────────

test('parseArgv: -v → flags.version', () => {
  const { command, flags } = parseArgv(['node', 'cronly', '-v'])
  assert.equal(command, null)
  assert.equal(flags.version, true)
})

test('parseArgv: -h → flags.help', () => {
  const { command, flags } = parseArgv(['node', 'cronly', '-h'])
  assert.equal(command, null)
  assert.equal(flags.help, true)
})

test('parseArgv: --version → flags.version', () => {
  const { command, flags } = parseArgv(['node', 'cronly', '--version'])
  assert.equal(command, null)
  assert.equal(flags.version, true)
})

test('parseArgv: 플래그 값에 single-dash 토큰이 소비되지 않음', () => {
  const { flags } = parseArgv(['node', 'cronly', 'add', '--weekdays', '-v'])
  assert.equal(flags.weekdays, true)
  assert.equal(flags.version, true)
})

test('parseArgv: --days mon,wed,fri 파싱', () => {
  const { args, flags } = parseArgv([
    'node', 'cronly', 'add', './script.mjs', '--days', 'mon,wed,fri', '--at', '09:00',
  ])
  assert.equal(args[0], './script.mjs')
  assert.equal(flags.days, 'mon,wed,fri')
  assert.equal(flags.at, '09:00')
})

test('parseArgv: --lang before command', () => {
  const { command, args, flags } = parseArgv([
    'node', 'cronly', '--lang', 'ko', 'add', './script.mjs', '--daily', '09:00',
  ])
  assert.equal(command, 'add')
  assert.equal(args[0], './script.mjs')
  assert.equal(flags.lang, 'ko')
  assert.equal(flags.daily, '09:00')
})

// ── i18n: normalizeLocale ──────────────────────────────────────────────────

test('normalizeLocale: 기본 코드', () => {
  assert.equal(normalizeLocale('en'), 'en')
  assert.equal(normalizeLocale('ko'), 'ko')
  assert.equal(normalizeLocale('ja'), 'ja')
  assert.equal(normalizeLocale('zh'), 'zh')
})

test('normalizeLocale: 시스템 locale 형식', () => {
  assert.equal(normalizeLocale('en_US.UTF-8'), 'en')
  assert.equal(normalizeLocale('ko_KR.UTF-8'), 'ko')
  assert.equal(normalizeLocale('ja_JP.UTF-8'), 'ja')
  assert.equal(normalizeLocale('zh_CN.UTF-8'), 'zh')
})

test('normalizeLocale: 대소문자 무시', () => {
  assert.equal(normalizeLocale('EN'), 'en')
  assert.equal(normalizeLocale('Ko'), 'ko')
})

test('normalizeLocale: 미지원 locale은 null', () => {
  assert.equal(normalizeLocale('fr'), null)
  assert.equal(normalizeLocale('xx'), null)
  assert.equal(normalizeLocale(''), null)
  assert.equal(normalizeLocale(null), null)
})

// ── i18n: detectLocale ─────────────────────────────────────────────────────

test('detectLocale: --lang 최우선', () => {
  assert.equal(detectLocale({ lang: 'ko' }, { CRONLY_LANG: 'ja', LANG: 'zh_CN.UTF-8' }), 'ko')
})

test('detectLocale: CRONLY_LANG이 두 번째', () => {
  assert.equal(detectLocale({}, { CRONLY_LANG: 'ja', LC_ALL: 'ko_KR.UTF-8' }), 'ja')
})

test('detectLocale: LC_ALL → LC_MESSAGES → LANG 순서', () => {
  assert.equal(detectLocale({}, { LC_ALL: 'ko_KR.UTF-8', LC_MESSAGES: 'ja_JP.UTF-8', LANG: 'zh_CN.UTF-8' }), 'ko')
  assert.equal(detectLocale({}, { LC_MESSAGES: 'ja_JP.UTF-8', LANG: 'zh_CN.UTF-8' }), 'ja')
  assert.equal(detectLocale({}, { LANG: 'zh_CN.UTF-8' }), 'zh')
})

test('detectLocale: 미지원 env는 건너뛰고 fallback', () => {
  assert.equal(detectLocale({}, { CRONLY_LANG: 'fr', LANG: 'ko_KR.UTF-8' }), 'ko')
  assert.equal(detectLocale({}, { LANG: 'xx_XX.UTF-8' }), 'en')
})

test('detectLocale: 아무 것도 없으면 en', () => {
  assert.equal(detectLocale({}, {}), 'en')
})

// ── i18n: t() ──────────────────────────────────────────────────────────────

test('t: 기본 영어 번역', () => {
  setLocale('en')
  assert.ok(t('schedule.SCHEDULE_REQUIRED').includes('specify a schedule'))
  assert.ok(t('commands.add.created', { path: '/a.sh', id: '1234' }).includes('Registered'))
})

test('t: schedule 에러 메시지에 한국어가 섞이지 않음', () => {
  setLocale('en')
  const interval = t('schedule.INVALID_INTERVAL', { flag: 'every-hours', value: 'abc', reason: 'not_integer' })
  assert.ok(!(/[\u3131-\uD79D]/.test(interval)), `한국어 포함: ${interval}`)
  const empty = t('schedule.INVALID_CRON_EMPTY')
  assert.ok(!(/[\u3131-\uD79D]/.test(empty)), `한국어 포함: ${empty}`)
  const hint = t('schedule.INTERVAL_HINT', { flag: 'every-hours', value: 24, hint: '--daily 00:00' })
  assert.ok(!(/[\u3131-\uD79D]/.test(hint)), `한국어 포함: ${hint}`)
  const noVal = t('schedule.INVALID_INTERVAL', { flag: 'every-hours', reason: 'no_value' })
  assert.ok(!(/[\u3131-\uD79D]/.test(noVal)), `한국어 포함: ${noVal}`)
  const range = t('schedule.INVALID_INTERVAL', { flag: 'every-hours', value: 25, reason: 'out_of_range', min: 1, max: 23 })
  assert.ok(!(/[\u3131-\uD79D]/.test(range)), `한국어 포함: ${range}`)
})

test('t: 한국어 전환', () => {
  setLocale('ko')
  assert.ok(t('schedule.SCHEDULE_REQUIRED').includes('스케줄을 지정해 주세요'))
  assert.ok(t('commands.add.created', { path: '/a.sh', id: '1234' }).includes('등록했어요'))
  setLocale('en')
})

test('t: 일본어 전환', () => {
  setLocale('ja')
  assert.ok(t('schedule.SCHEDULE_REQUIRED').includes('スケジュールを指定'))
  setLocale('en')
})

test('t: 중국어 전환', () => {
  setLocale('zh')
  assert.ok(t('schedule.SCHEDULE_REQUIRED').includes('请指定调度'))
  setLocale('en')
})

test('t: 없는 키는 키 자체를 반환', () => {
  setLocale('en')
  assert.equal(t('nonexistent.key'), 'nonexistent.key')
})

test('t: 현재 locale에 없는 키는 영어 fallback', () => {
  setLocale('ko')
  // 한국어 catalog에 없는 가상 키 테스트 — 실제로는 모든 키가 있으므로 getUsage로 확인
  assert.ok(getUsage().includes('Cronly'))
  setLocale('en')
})

test('t: 지원하지 않는 현재 locale이어도 영어로 fallback', () => {
  setLocale('xx')
  assert.ok(t('schedule.SCHEDULE_REQUIRED').includes('Please specify a schedule'))
  setLocale('en')
})

test('setLocale/getLocale: 현재 locale을 유지해요', () => {
  setLocale('ja')
  assert.equal(getLocale(), 'ja')
  setLocale('en')
  assert.equal(getLocale(), 'en')
})

test('i18n catalogs: 함수형 메시지가 모든 locale에서 렌더링돼요', () => {
  const generic = {
    detail: '--weekdays',
    path: '/tmp/job.mjs',
    id: 'abcd1234',
    expected: 5,
    actual: 4,
    field: 'hour',
    value: '99',
    hint: '--daily 00:00',
    flag: 'every-hours',
    min: 1,
    max: 23,
    count: 2,
    message: 'boom',
    command: 'list',
    extra: 'extra-arg',
    flags: '--bogus',
    lang: 'xx',
  }

  for (const [locale, catalog] of Object.entries(LOCALE_CATALOGS)) {
    for (const [key, value] of Object.entries(catalog)) {
      if (typeof value !== 'function' || key === 'schedule.INVALID_INTERVAL') continue
      const rendered = value(generic)
      assert.equal(typeof rendered, 'string', `${locale}:${key} should render to string`)
      assert.ok(rendered.length > 0, `${locale}:${key} should not be empty`)
    }

    const interval = catalog['schedule.INVALID_INTERVAL']
    assert.equal(typeof interval({ flag: 'every-hours', reason: 'no_value' }), 'string', `${locale}:no_value`)
    assert.equal(typeof interval({ flag: 'every-hours', value: 'abc', reason: 'not_integer' }), 'string', `${locale}:not_integer`)
    assert.equal(typeof interval({ flag: 'every-hours', value: '25', reason: 'out_of_range', min: 1, max: 23 }), 'string', `${locale}:out_of_range`)
  }
})

test('getUsage: 영어 도움말', () => {
  setLocale('en')
  assert.ok(getUsage().includes('Schedule scripts easily'))
  assert.ok(getUsage().includes('--daily'))
  assert.ok(getUsage().includes('--lang'))
})

test('getUsage: 한국어 도움말', () => {
  setLocale('ko')
  assert.ok(getUsage().includes('스크립트를 쉽게 예약'))
  assert.ok(getUsage().includes('--lang'))
  setLocale('en')
})

// ── crontab.mjs / commands.mjs / bin/cronly.mjs ───────────────────────────

await testAsync('readCrontab: 정상 읽기', async () => {
  await withMockCrontabEnv({ initialContent: '0 * * * * /job\n' }, async () => {
    const raw = await readCrontab()
    assert.equal(raw, '0 * * * * /job\n')
  })
})

await testAsync('readCrontab: no crontab은 빈 문자열', async () => {
  await withMockCrontabEnv({ noCrontab: true }, async () => {
    const raw = await readCrontab()
    assert.equal(raw, '')
  })
})

await testAsync('readCrontab: 일반 실패는 reject', async () => {
  await withMockCrontabEnv({ readFail: 'mock read denied' }, async () => {
    await assert.rejects(() => readCrontab(), /crontab -l failed: mock read denied/)
  })
})

await testAsync('readCrontab: stderr가 없으면 err.message 사용', async () => {
  const previousPath = process.env.PATH
  process.env.PATH = '/definitely-missing-path'
  try {
    await assert.rejects(() => readCrontab(), /crontab -l failed:/)
  } finally {
    process.env.PATH = previousPath
  }
})

await testAsync('writeCrontab: 정상 쓰기', async () => {
  await withMockCrontabEnv({}, async (ctx) => {
    await writeCrontab('0 * * * * /job\n')
    assert.equal(ctx.readState(), '0 * * * * /job\n')
    assert.equal(ctx.readWriteLog(), '0 * * * * /job\n')
  })
})

await testAsync('writeCrontab: 실패 시 reject', async () => {
  await withMockCrontabEnv({ writeFail: 'mock write denied' }, async () => {
    await assert.rejects(() => writeCrontab('0 * * * * /job\n'), /crontab - failed: mock write denied/)
  })
})

await testAsync('writeCrontab: stderr가 없으면 err.message 사용', async () => {
  const previousPath = process.env.PATH
  process.env.PATH = '/definitely-missing-path'
  try {
    await assert.rejects(() => writeCrontab('0 * * * * /job\n'), /crontab - failed:/)
  } finally {
    process.env.PATH = previousPath
  }
})

await testAsync('add: 파일 경로 누락 거부', async () => {
  await assert.rejects(() => add(undefined, { schedule: '0 8 * * *' }), /file path/)
})

await testAsync('add: 스케줄 누락 거부', async () => {
  await assert.rejects(() => add('./job.mjs', { schedule: '' }), /schedule/)
})

await testAsync('add: 파일이 없으면 거부', async () => {
  await withMockCrontabEnv({}, async () => {
    await assert.rejects(() => add('/no/such/file.mjs', { schedule: '0 8 * * *' }), /File not found/)
  })
})

await testAsync('add: 런타임 추론 실패 시 거부', async () => {
  await withMockCrontabEnv({}, async (ctx) => {
    const file = ctx.createScript('job.py', 'print("hello")\n', 0o644)
    await assert.rejects(() => add(file, { schedule: '0 8 * * *' }), /Cannot infer runtime/)
  })
})

await testAsync('add: 새 엔트리 등록', async () => {
  await withMockCrontabEnv({}, async (ctx) => {
    const file = ctx.createScript('job.mjs', 'console.log("hello")\n')
    const { logs } = await captureLogs(() => add(file, { schedule: '0 8 * * *' }))
    assert.ok(logs.some((line) => line.includes('Registered')))
    const raw = ctx.readState()
    assert.ok(raw.includes('0 8 * * *'))
    assert.ok(raw.includes('cronly:begin'))
  })
})

await testAsync('add: 같은 파일은 업데이트', async () => {
  await withMockCrontabEnv({}, async (ctx) => {
    const file = ctx.createScript('job.mjs', 'console.log("hello")\n')
    await add(file, { schedule: '0 8 * * *' })
    const { logs } = await captureLogs(() => add(file, { schedule: '30 9 * * *' }))
    assert.ok(logs.some((line) => line.includes('Updated')))
    const raw = ctx.readState()
    assert.equal((raw.match(/cronly:begin/g) || []).length, 1)
    assert.ok(raw.includes('30 9 * * *'))
  })
})

await testAsync('add: 기존 수동 crontab 뒤에 append', async () => {
  await withMockCrontabEnv({ initialContent: 'MAILTO=user@example.com\n\n0 * * * * /manual-job\n' }, async (ctx) => {
    const file = ctx.createScript('job.mjs', 'console.log("hello")\n')
    await add(file, { schedule: '0 8 * * *' })
    const raw = ctx.readState()
    assert.ok(raw.startsWith('MAILTO=user@example.com'))
    assert.ok(raw.includes('/manual-job'))
    assert.ok(raw.includes('cronly:begin'))
  })
})

await testAsync('add: write 실패 시 성공 로그를 남기지 않음', async () => {
  await withMockCrontabEnv({ writeFail: 'mock write denied' }, async (ctx) => {
    const file = ctx.createScript('job.mjs', 'console.log("hello")\n')
    const { logs } = await captureLogs(async () => {
      await assert.rejects(() => add(file, { schedule: '0 8 * * *' }), /mock write denied/)
    })
    assert.equal(logs.length, 0)
  })
})

await testAsync('list: 빈 목록 메시지', async () => {
  await withMockCrontabEnv({}, async () => {
    const { logs } = await captureLogs(() => list())
    assert.deepEqual(logs, ['No managed crontab entries.'])
  })
})

await testAsync('list: 엔트리 출력', async () => {
  await withMockCrontabEnv({}, async (ctx) => {
    const file1 = ctx.createScript('short.sh', '#!/bin/sh\necho one\n')
    const file2 = ctx.createScript('very-long-script-name.mjs', 'console.log("two")\n')
    ctx.setState([
      buildBlock({ schedule: '0 8 * * *', absolutePath: file1, runtime: 'sh' }),
      '',
      buildBlock({ schedule: '30 9 * * 1-5', absolutePath: file2, runtime: 'node' }),
      '',
    ].join('\n'))

    const { logs } = await captureLogs(() => list())
    assert.equal(logs.length, 2)
    assert.ok(logs[0].includes(file1))
    assert.ok(logs[1].includes(file2))
  })
})

await testAsync('remove: 인자 없이 호출하면 거부', async () => {
  await assert.rejects(() => remove(undefined, {}), /file path or --id/)
})

await testAsync('remove: id로 삭제', async () => {
  await withMockCrontabEnv({}, async (ctx) => {
    const file = ctx.createScript('job.sh', '#!/bin/sh\necho one\n')
    const block = buildBlock({ schedule: '0 8 * * *', absolutePath: file, runtime: 'sh' })
    const id = makeId(file)
    ctx.setState(`${block}\n`)
    const { logs } = await captureLogs(() => remove(undefined, { id }))
    assert.ok(logs.some((line) => line.includes('Removed')))
    assert.equal(ctx.readState(), '')
  })
})

await testAsync('remove: 없는 id는 거부', async () => {
  await withMockCrontabEnv({}, async () => {
    await assert.rejects(() => remove(undefined, { id: 'deadbeef' }), /Entry not found for id/)
  })
})

await testAsync('remove: 없는 파일은 거부', async () => {
  await withMockCrontabEnv({}, async () => {
    await assert.rejects(() => remove('/missing/file.sh', {}), /Entry not found for file/)
  })
})

await testAsync('print: 빈 목록 메시지', async () => {
  await withMockCrontabEnv({}, async () => {
    const { logs } = await captureLogs(() => print())
    assert.deepEqual(logs, ['No managed crontab entries.'])
  })
})

await testAsync('print: raw 블록 출력', async () => {
  await withMockCrontabEnv({}, async (ctx) => {
    const file = ctx.createScript('job.sh', '#!/bin/sh\necho one\n')
    const block = buildBlock({ schedule: '0 8 * * *', absolutePath: file, runtime: 'sh' })
    ctx.setState(`${block}\n`)
    const { logs } = await captureLogs(() => print())
    assert.ok(logs[0].includes('cronly:begin'))
    assert.equal(logs[1], '')
  })
})

await testAsync('doctor: 정상 환경 점검', async () => {
  await withMockCrontabEnv({}, async (ctx) => {
    const file = ctx.createScript('job.sh', '#!/bin/sh\necho one\n')
    ctx.setState(`${buildBlock({ schedule: '0 8 * * *', absolutePath: file, runtime: 'sh' })}\n`)
    const { logs } = await captureLogs(() => doctor())
    assert.ok(logs.some((line) => line.includes('Node.js')))
    assert.ok(logs.some((line) => line.includes('crontab command: found')))
    assert.ok(logs.some((line) => line.includes('Managed entries: 1')))
    assert.equal(logs.at(-1), 'All checks passed.')
  })
})

await testAsync('doctor: 문제 환경도 보고', async () => {
  await withPatchedVersion('v14.7.0', async () => {
    await withMockCrontabEnv({ whichFail: true, readFail: 'mock read denied' }, async () => {
      const { logs } = await captureLogs(() => doctor())
      assert.ok(logs.some((line) => line.includes('Node.js 14.8.0 or higher')))
      assert.ok(logs.some((line) => line.includes('crontab command: not found')))
      assert.ok(logs.some((line) => line.includes('crontab read: failed')))
      assert.equal(logs.at(-1), 'Some checks failed.')
    })
  })
})

await testAsync('CLI: 인자 없이 실행하면 도움말', async () => {
  await withMockCrontabEnv({}, async (ctx) => {
    const result = ctx.cli([])
    assert.equal(result.status, 0)
    assert.ok(result.stdout.includes('Cronly'))
  })
})

await testAsync('CLI: --help', async () => {
  await withMockCrontabEnv({}, async (ctx) => {
    const result = ctx.cli(['--help'])
    assert.equal(result.status, 0)
    assert.ok(result.stdout.includes('--daily'))
  })
})

await testAsync('CLI: --version', async () => {
  await withMockCrontabEnv({}, async (ctx) => {
    const result = ctx.cli(['--version'])
    assert.equal(result.status, 0)
    assert.match(result.stdout.trim(), /^\d+\.\d+\.\d+$/)
  })
})

await testAsync('CLI: 알 수 없는 전역 플래그는 에러', async () => {
  await withMockCrontabEnv({}, async (ctx) => {
    const result = ctx.cli(['--foo'])
    assert.notEqual(result.status, 0)
    assert.ok(result.stderr.includes('--foo'))
  })
})

await testAsync('CLI: 알 수 없는 명령어는 에러', async () => {
  await withMockCrontabEnv({}, async (ctx) => {
    const result = ctx.cli(['wat'])
    assert.notEqual(result.status, 0)
    assert.ok(result.stderr.includes('Unknown command'))
  })
})

await testAsync('CLI: 스케줄 검증 오류를 보여줌', async () => {
  await withMockCrontabEnv({}, async (ctx) => {
    const script = ctx.createScript('job.mjs', 'console.log("hello")\n')
    const result = ctx.cli(['add', script, '--weekdays'])
    assert.notEqual(result.status, 0)
    assert.ok(result.stderr.includes('--at'))
  })
})

await testAsync('CLI: 실행 중 오류를 catch해서 출력', async () => {
  await withMockCrontabEnv({}, async (ctx) => {
    const result = ctx.cli(['add', '/missing/job.mjs', '--daily', '09:00'])
    assert.notEqual(result.status, 0)
    assert.ok(result.stderr.includes('File not found'))
  })
})

await testAsync('CLI: add/list/print/remove/doctor roundtrip', async () => {
  await withMockCrontabEnv({}, async (ctx) => {
    const script = ctx.createScript('job.mjs', 'console.log("hello")\n')

    const addResult = ctx.cli(['add', script, '--daily', '08:00'])
    assert.equal(addResult.status, 0)
    assert.ok(addResult.stdout.includes('Registered'))

    const listResult = ctx.cli(['list'])
    assert.equal(listResult.status, 0)
    assert.ok(listResult.stdout.includes(script))

    const printResult = ctx.cli(['print'])
    assert.equal(printResult.status, 0)
    assert.ok(printResult.stdout.includes('cronly:begin'))

    const doctorResult = ctx.cli(['doctor'])
    assert.equal(doctorResult.status, 0)
    assert.ok(doctorResult.stdout.includes('Node.js'))

    const removeResult = ctx.cli(['remove', script])
    assert.equal(removeResult.status, 0)
    assert.ok(removeResult.stdout.includes('Removed'))
  })
})

// ── i18n: CLI 통합 ─────────────────────────────────────────────────────────

await testAsync('CLI: 기본 locale은 영어', async () => {
  await withMockCrontabEnv({}, async (ctx) => {
    const result = ctx.cli(['--help'])
    assert.ok(result.stdout.includes('Schedule scripts easily'))
  })
})

await testAsync('CLI: --lang ko로 한국어 도움말', async () => {
  await withMockCrontabEnv({}, async (ctx) => {
    const result = ctx.cli(['--lang', 'ko', '--help'])
    assert.equal(result.status, 0)
    assert.ok(result.stdout.includes('스크립트를 쉽게 예약'))
  })
})

await testAsync('CLI: --lang ja로 일본어 도움말', async () => {
  await withMockCrontabEnv({}, async (ctx) => {
    const result = ctx.cli(['--lang', 'ja', '--help'])
    assert.equal(result.status, 0)
    assert.ok(result.stdout.includes('スクリプトをかんたんに'))
  })
})

await testAsync('CLI: --lang zh로 중국어 도움말', async () => {
  await withMockCrontabEnv({}, async (ctx) => {
    const result = ctx.cli(['--lang', 'zh', '--help'])
    assert.equal(result.status, 0)
    assert.ok(result.stdout.includes('轻松调度脚本'))
  })
})

await testAsync('CLI: --lang xx는 에러', async () => {
  await withMockCrontabEnv({}, async (ctx) => {
    const result = ctx.cli(['--lang', 'xx', '--help'])
    assert.notEqual(result.status, 0)
    assert.ok(result.stderr.includes('Unsupported locale'))
  })
})

await testAsync('CLI: CRONLY_LANG 환경변수', async () => {
  await withMockCrontabEnv({}, async (ctx) => {
    const result = ctx.cli(['--help'], { CRONLY_LANG: 'ko' })
    assert.equal(result.status, 0)
    assert.ok(result.stdout.includes('스크립트를 쉽게 예약'))
  })
})

await testAsync('CLI: --lang이 CRONLY_LANG보다 우선', async () => {
  await withMockCrontabEnv({}, async (ctx) => {
    const result = ctx.cli(['--lang', 'ja', '--help'], { CRONLY_LANG: 'ko' })
    assert.equal(result.status, 0)
    assert.ok(result.stdout.includes('スクリプトをかんたんに'))
  })
})

await testAsync('CLI: --lang ko로 스케줄 에러 한국어', async () => {
  await withMockCrontabEnv({}, async (ctx) => {
    const script = ctx.createScript('job.mjs', 'console.log("hello")\n')
    const result = ctx.cli(['add', script, '--weekdays', '--lang', 'ko'])
    assert.notEqual(result.status, 0)
    assert.ok(result.stderr.includes('--at HH:MM'))
  })
})

await testAsync('CLI: --lang ko로 add/remove 한국어', async () => {
  await withMockCrontabEnv({}, async (ctx) => {
    const script = ctx.createScript('job.mjs', 'console.log("hello")\n')
    const addResult = ctx.cli(['add', script, '--daily', '09:00', '--lang', 'ko'])
    assert.equal(addResult.status, 0)
    assert.ok(addResult.stdout.includes('등록했어요'))

    const removeResult = ctx.cli(['remove', script, '--lang', 'ko'])
    assert.equal(removeResult.status, 0)
    assert.ok(removeResult.stdout.includes('삭제했어요'))
  })
})

await testAsync('CLI: add에 미지원 플래그 → 에러', async () => {
  await withMockCrontabEnv({}, async (ctx) => {
    const script = ctx.createScript('job.mjs', 'console.log("hello")\n')
    const result = ctx.cli(['add', script, '--daily', '09:00', '--bogus'])
    assert.notEqual(result.status, 0)
    assert.ok(result.stderr.includes('--bogus'))
  })
})

await testAsync('CLI: list에 미지원 플래그 → 에러', async () => {
  await withMockCrontabEnv({}, async (ctx) => {
    const result = ctx.cli(['list', '--bogus'])
    assert.notEqual(result.status, 0)
    assert.ok(result.stderr.includes('--bogus'))
  })
})

await testAsync('CLI: remove에 미지원 플래그 → 에러', async () => {
  await withMockCrontabEnv({}, async (ctx) => {
    const result = ctx.cli(['remove', '/some/file', '--bogus'])
    assert.notEqual(result.status, 0)
    assert.ok(result.stderr.includes('--bogus'))
  })
})

await testAsync('CLI: --lang xx --version → 에러 (lang 검증 우선)', async () => {
  await withMockCrontabEnv({}, async (ctx) => {
    const result = ctx.cli(['--lang', 'xx', '--version'])
    assert.notEqual(result.status, 0)
    assert.ok(result.stderr.includes('Unsupported locale'))
  })
})

await testAsync('CLI: list에 불필요한 positional arg → 에러', async () => {
  await withMockCrontabEnv({}, async (ctx) => {
    const result = ctx.cli(['list', 'extraArg'])
    assert.notEqual(result.status, 0)
    assert.ok(result.stderr.includes('extraArg'))
  })
})

await testAsync('CLI: doctor에 불필요한 positional arg → 에러', async () => {
  await withMockCrontabEnv({}, async (ctx) => {
    const result = ctx.cli(['doctor', 'extraArg'])
    assert.notEqual(result.status, 0)
    assert.ok(result.stderr.includes('extraArg'))
  })
})

await testAsync('CLI: add에 불필요한 두 번째 positional arg → 에러', async () => {
  await withMockCrontabEnv({}, async (ctx) => {
    const script = ctx.createScript('job.mjs', 'console.log("hello")\n')
    const result = ctx.cli(['add', script, '--daily', '09:00', 'extraArg'])
    assert.notEqual(result.status, 0)
    assert.ok(result.stderr.includes('extraArg'))
  })
})

await testAsync('CLI: --lang만 있고 명령 없으면 해당 언어로 도움말', async () => {
  await withMockCrontabEnv({}, async (ctx) => {
    const result = ctx.cli(['--lang', 'ko'])
    assert.equal(result.status, 0)
    assert.ok(result.stdout.includes('스크립트를 쉽게 예약'))
  })
})

// ── 결과 ────────────────────────────────────────────────────────────────────

console.log(`\n결과: ${passed}개 통과, ${failed}개 실패`)
process.exit(failed > 0 ? 1 : 0)
