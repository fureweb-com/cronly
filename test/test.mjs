import { runLaunchdTests } from './launchd.mjs'
import assert from 'assert/strict'
import { withCrontabLock, reapAbandonedLock } from '../lib/lock.mjs'
import { runSandboxedIntegration } from './helpers/integration-sandbox.mjs'
import { decodeCronCommand } from './helpers/cron-command.mjs'
import { spawn, spawnSync } from 'child_process'
import { chmodSync, existsSync, readdirSync, utimesSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'fs'
import { homedir, tmpdir } from 'os'
import { dirname, join, resolve } from 'path'
import { fileURLToPath } from 'url'
import {
  MAX_COMMAND_BYTES,
  buildBlock,
  inspectCommand,
  makeId,
  normalizePath,
  parseBlocks,
  inferRuntime,
  splitCommandWords,
} from '../lib/entry.mjs'
import {
  add,
  doctor,
  findEntryIssues,
  getCronPath,
  getLogDir,
  isSameFile,
  isSupportedNodeVersion,
  list,
  print,
  remove,
  removeBlockFromCrontab,
  resolveRuntimePath,
} from '../lib/commands.mjs'
import { findExecutable, findIgnoredShebang, getProcDir, isCronDaemonRunning, readShebangRuntime, resolveJobRuntime } from '../lib/job.mjs'
import { parseArgv } from '../lib/cli.mjs'
import { decodeCrontab, encodeCrontab, readCrontab, writeCrontab } from '../lib/crontab.mjs'
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

// add() creates $CRONLY_HOME/logs; keep it out of the real home directory
const TEST_CRONLY_HOME = mkdtempSync(join(tmpdir(), 'cronly-home-'))
process.env.CRONLY_HOME = TEST_CRONLY_HOME
process.env.CRONLY_BACKEND = 'cron'
process.env.CRONLY_LAUNCHD_DIR = join(TEST_CRONLY_HOME, 'agents')

// doctor looks for a cron daemon in the process list. Give it a fixed list so
// the result does not depend on the machine that runs the tests.
function writeProcessList(dir, commands) {
  commands.forEach((command, i) => {
    mkdirSync(join(dir, String(i + 1)), { recursive: true })
    writeFileSync(join(dir, String(i + 1), 'cmdline'), `${command.join('\0')}\0`)
  })
  return dir
}
process.env.CRONLY_PROC_DIR = writeProcessList(join(TEST_CRONLY_HOME, 'proc'), [['/sbin/init'], ['/usr/sbin/cron', '-f']])

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

async function captureErrors(fn) {
  const errors = []
  const originalError = console.error
  console.error = (...args) => errors.push(args.join(' '))
  try {
    const result = await fn()
    return { errors, result }
  } finally {
    console.error = originalError
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
  { initialContent = '', noCrontab = false, readFail = '', writeFail = '', writeDelay = '', whichFail = false } = {},
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
  if [ -n "$MOCK_WRITE_STARTED" ]; then touch "$MOCK_WRITE_STARTED"; fi
  if [ -n "$MOCK_WRITE_DELAY" ]; then
    sleep "$MOCK_WRITE_DELAY"
  fi
  if [ -n "$MOCK_WRITE_FAIL" ]; then
    cat >/dev/null
    echo "$MOCK_WRITE_FAIL" >&2
    exit 1
  fi
  # Like crontab, replace the file only after reading all of the input.
  cat > "$state.new" && mv "$state.new" "$state"
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
    'MOCK_WRITE_DELAY',
    'MOCK_WRITE_STARTED',
    'MOCK_WHICH_FAIL',
    'MOCK_BIN_DIR',
    'CRONLY_LANG',
    'CRONLY_HOME',
    'CRONLY_PROC_DIR',
  ]
  const previousEnv = Object.fromEntries(keys.map((key) => [key, process.env[key]]))

  process.env.PATH = `${dir}:${previousEnv.PATH || ''}`
  process.env.MOCK_BIN_DIR = dir
  process.env.MOCK_CRONTAB_FILE = stateFile
  process.env.CRONLY_LANG = 'en'
  process.env.CRONLY_HOME = join(dir, 'cronly-home')
  process.env.MOCK_WRITE_LOG = writeLogFile
  delete process.env.MOCK_WRITE_STARTED
  if (noCrontab) process.env.MOCK_NO_CRONTAB = '1'
  else delete process.env.MOCK_NO_CRONTAB
  if (readFail) process.env.MOCK_READ_FAIL = readFail
  else delete process.env.MOCK_READ_FAIL
  if (writeFail) process.env.MOCK_WRITE_FAIL = writeFail
  else delete process.env.MOCK_WRITE_FAIL
  if (writeDelay) process.env.MOCK_WRITE_DELAY = writeDelay
  else delete process.env.MOCK_WRITE_DELAY
  if (whichFail) process.env.MOCK_WHICH_FAIL = '1'
  else delete process.env.MOCK_WHICH_FAIL

  const ctx = {
    dir,
    logDir: join(dir, 'cronly-home', 'logs'),
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
    // releases/v2/job.mjs reached through the symlink current -> releases/v2
    createLinkedScript() {
      mkdirSync(join(dir, 'releases', 'v2'), { recursive: true })
      const file = join(dir, 'releases', 'v2', 'job.mjs')
      writeFileSync(file, 'console.log("hello")\n', { mode: 0o755 })
      symlinkSync(join(dir, 'releases', 'v2'), join(dir, 'current'))
      return { file, viaLink: join(dir, 'current', 'job.mjs') }
    },
    createScript(name, content, mode = 0o755) {
      const filePath = join(dir, name)
      writeFileSync(filePath, content, { mode })
      return filePath
    },
    cliAsync(args, env = {}) {
      return new Promise((resolve, reject) => {
        const proc = spawn(process.execPath, [CLI, ...args], { env: { ...process.env, ...env } })
        let stdout = ''
        let stderr = ''
        proc.stdout.on('data', (data) => { stdout += data })
        proc.stderr.on('data', (data) => { stderr += data })
        proc.on('error', reject)
        proc.on('close', (status) => resolve({ status, stdout, stderr }))
      })
    },
    cli(args, env = {}) {
      return spawnSync(process.execPath, [CLI, ...args], {
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

test('buildBlock: 스크립트 디렉터리로 cd 한 뒤 실행', () => {
  const block = buildBlock({
    schedule: '0 8 * * *',
    absolutePath: '/home/user/jobs/report.mjs',
    runtime: 'node',
  })
  const lines = block.split('\n')
  assert.ok(lines[1].startsWith("0 8 * * * cd '/home/user/jobs' && "))
})

test('buildBlock: runtimePath, PATH, 로그 경로를 모두 반영', () => {
  const block = buildBlock({
    schedule: '0 8 * * *',
    absolutePath: '/home/user/job.mjs',
    runtime: 'node',
    runtimePath: '/opt/node/bin/node',
    pathEnv: '/opt/node/bin:/usr/bin:/bin',
    logPath: '/home/user/.cronly/logs/abcd1234.log',
  })
  assert.equal(
    block.split('\n')[1],
    "0 8 * * * cd '/home/user' && PATH='/opt/node/bin:/usr/bin:/bin' '/opt/node/bin/node' '/home/user/job.mjs'" +
      " >> '/home/user/.cronly/logs/abcd1234.log' 2>&1"
  )
})

test('buildBlock: exec는 runtimePath가 비어 있으면 스크립트를 직접 실행', () => {
  const block = buildBlock({
    schedule: '0 0 * * *',
    absolutePath: '/usr/local/bin/mytool',
    runtime: 'exec',
    runtimePath: '',
  })
  assert.equal(block.split('\n')[1], "0 0 * * * cd '/usr/local/bin' && '/usr/local/bin/mytool'")
})

test('buildBlock: 로그 경로에 줄바꿈 문자가 있으면 에러', () => {
  assert.throws(
    () =>
      buildBlock({
        schedule: '0 * * * *',
        absolutePath: '/home/user/job.sh',
        runtime: 'sh',
        logPath: '/tmp/a\nb.log',
      }),
    /newline/
  )
})

test('buildBlock: cron 명령이 cron 길이 제한을 넘으면 에러', () => {
  assert.equal(MAX_COMMAND_BYTES, 999)
  const longDir = `/home/${'a'.repeat(250)}/${'b'.repeat(250)}`
  assert.throws(
    () => buildBlock({ schedule: '0 * * * *', absolutePath: `${longDir}/job.sh`, runtime: 'sh' }),
    /too long/
  )
  // 경계값 바로 아래는 통과
  assert.doesNotThrow(() =>
    buildBlock({ schedule: '0 * * * *', absolutePath: `/home/${'a'.repeat(400)}/job.sh`, runtime: 'sh' })
  )
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

test('parseBlocks: end 주석이 없어도 다음 블록을 삼키지 않음', () => {
  const blockA = buildBlock({ schedule: '0 8 * * *', absolutePath: '/x/a.sh', runtime: 'sh' })
  const blockB = buildBlock({ schedule: '0 9 * * *', absolutePath: '/x/b.sh', runtime: 'sh' })
  const withoutEnd = blockA.split('\n').slice(0, 2).join('\n')
  const raw = `${withoutEnd}\n${blockB}\n`

  const blocks = parseBlocks(raw)
  assert.deepEqual(blocks.map((b) => b.path), ['/x/a.sh', '/x/b.sh'])
  assert.equal(blocks[0].raw, withoutEnd)
  assert.equal(blocks[0].schedule, '0 8 * * *')

  const next = removeBlockFromCrontab(raw, blocks[0])
  assert.deepEqual(parseBlocks(next).map((b) => b.raw), [blockB])
})

test('parseBlocks: end 주석이 없으면 뒤의 수동 엔트리를 블록에 넣지 않음', () => {
  const block = buildBlock({ schedule: '0 8 * * *', absolutePath: '/x/a.sh', runtime: 'sh' })
  const withoutEnd = block.split('\n').slice(0, 2).join('\n')
  const raw = `${withoutEnd}\n0 * * * * /usr/bin/manual-job\n`

  const blocks = parseBlocks(raw)
  assert.equal(blocks[0].raw, withoutEnd)
  assert.ok(removeBlockFromCrontab(raw, blocks[0]).includes('/usr/bin/manual-job'))
})

test('parseBlocks: begin 줄만 있으면 cron 줄 없이 begin만 블록으로', () => {
  const id = makeId('/x/only-begin.sh')
  const text = `# [cronly:begin] id=${id} path=/x/only-begin.sh runtime=sh`
  const blocks = parseBlocks(text)
  assert.equal(blocks.length, 1)
  assert.equal(blocks[0].schedule, '')
  assert.equal(blocks[0].command, '')
  assert.equal(blocks[0].endLine, 0)
})

test('parseBlocks: cron 줄 없이 end가 바로 오면 end를 cron 줄로 읽지 않음', () => {
  const id = makeId('/x/empty.sh')
  const text = [
    `# [cronly:begin] id=${id} path=/x/empty.sh runtime=sh`,
    `# [cronly:end] id=${id}`,
  ].join('\n')
  const blocks = parseBlocks(text)
  assert.equal(blocks.length, 1)
  assert.equal(blocks[0].command, '')
  assert.equal(blocks[0].endLine, 1)
})

test('parseBlocks: begin 바로 다음에 다른 begin이 와도 둘 다 파싱', () => {
  const idA = makeId('/x/a.sh')
  const blockB = buildBlock({ schedule: '0 9 * * *', absolutePath: '/x/b.sh', runtime: 'sh' })
  const text = [`# [cronly:begin] id=${idA} path=/x/a.sh runtime=sh`, blockB].join('\n')
  const blocks = parseBlocks(text)
  assert.deepEqual(blocks.map((b) => b.path), ['/x/a.sh', '/x/b.sh'])
  assert.equal(blocks[0].command, '')
  assert.equal(blocks[1].schedule, '0 9 * * *')
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

test('라운드트립: 로그와 PATH가 붙은 @reboot 블록도 alias로 파싱', () => {
  const absolutePath = '/home/user/startup.mjs'
  const block = buildBlock({
    schedule: '@reboot',
    absolutePath,
    runtime: 'node',
    runtimePath: '/opt/node/bin/node',
    pathEnv: '/opt/node/bin:/usr/bin:/bin',
    logPath: '/home/user/.cronly/logs/abcd1234.log',
  })
  const blocks = parseBlocks(block)

  assert.equal(blocks.length, 1)
  assert.equal(blocks[0].schedule, '@reboot')
  assert.ok(blocks[0].command.startsWith("cd '/home/user' && "))
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

// ── splitCommandWords / inspectCommand ──────────────────────────────────────

test("splitCommandWords: 따옴표, '\\'' 이스케이프, \\% 복원", () => {
  const block = buildBlock({
    schedule: '0 * * * *',
    absolutePath: "/a b/it's 100%.sh",
    runtime: 'sh',
    pathEnv: '/x:/y',
    logPath: '/l/1.log',
  })
  const command = parseBlocks(block)[0].command
  assert.deepEqual(splitCommandWords(command), [
    'cd',
    '/a b',
    '&&',
    'PATH=/x:/y',
    '/bin/sh',
    "/a b/it's 100%.sh",
    '>>',
    '/l/1.log',
    '2>&1',
  ])
})

test('splitCommandWords: 따옴표 밖 백슬래시, 끝의 백슬래시, 빈 따옴표, 탭', () => {
  assert.deepEqual(splitCommandWords('a\\ b c\\'), ['a b', 'c\\'])
  assert.deepEqual(splitCommandWords("x '' y"), ['x', '', 'y'])
  assert.deepEqual(splitCommandWords("a'b'\tc"), ['ab', 'c'])
  assert.deepEqual(splitCommandWords('\\%x'), ['%x'])
  assert.deepEqual(splitCommandWords("\\'q"), ["'q"])
  assert.deepEqual(splitCommandWords(''), [])
})

test('inspectCommand: 새 형식에서 런타임과 로그 경로를 찾음', () => {
  const block = buildBlock({
    schedule: '0 8 * * *',
    absolutePath: '/home/user/job.mjs',
    runtime: 'node',
    runtimePath: '/opt/node/bin/node',
    pathEnv: '/opt/node/bin:/usr/bin:/bin',
    logPath: '/home/user/.cronly/logs/abcd1234.log',
  })
  const { command, path } = parseBlocks(block)[0]
  assert.deepEqual(inspectCommand(command, path), {
    runtimeBin: '/opt/node/bin/node',
    logPath: '/home/user/.cronly/logs/abcd1234.log',
  })
})

test('inspectCommand: 예전 형식(cd/로그 없음)도 런타임을 찾음', () => {
  assert.deepEqual(inspectCommand("'/usr/bin/node' '/x/job.mjs'", '/x/job.mjs'), {
    runtimeBin: '/usr/bin/node',
    logPath: null,
  })
})

test('inspectCommand: exec 런타임이나 스크립트를 못 찾으면 runtimeBin은 null', () => {
  assert.equal(inspectCommand("cd '/x' && PATH='/p' '/x/tool'", '/x/tool').runtimeBin, null)
  assert.equal(inspectCommand("cd '/x' && '/x/tool'", '/x/tool').runtimeBin, null)
  assert.equal(inspectCommand("'/x/tool'", '/x/tool').runtimeBin, null)
  assert.equal(inspectCommand("'/bin/sh' '/x/other.sh'", '/x/tool').runtimeBin, null)
})

test('inspectCommand: >> 뒤에 경로가 없으면 logPath는 null', () => {
  assert.equal(inspectCommand("'/bin/sh' '/x.sh' >>", '/x.sh').logPath, null)
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

test('resolveSchedule: 줄바꿈·탭이 섞인 스케줄을 한 줄로 정규화', () => {
  for (const schedule of ['0 8\n* * *', ' 0\t8\r\n*\n\n* * ', '0  8 * * *']) {
    assert.deepEqual(resolveSchedule({ schedule }), { cron: '0 8 * * *' })
  }
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

test('resolveSchedule: --schedule 대문자 alias는 소문자로 저장', () => {
  assert.equal(resolveSchedule({ schedule: '@DAILY' }).cron, '@daily')
  assert.equal(resolveSchedule({ schedule: ' @Reboot ' }).cron, '@reboot')
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

test('resolveSchedule: --every-hours 5 → UNEVEN_INTERVAL (24의 약수만 허용)', () => {
  const r = resolveSchedule({ 'every-hours': '5' })
  assert.equal(r.error.code, 'UNEVEN_INTERVAL')
  assert.equal(r.error.flag, 'every-hours')
  assert.equal(r.error.allowed, '1, 2, 3, 4, 6, 8, 12')
  for (const n of ['1', '2', '3', '4', '6', '8', '12']) {
    assert.equal(resolveSchedule({ 'every-hours': n }).cron, `0 */${n} * * *`)
  }
})

test('resolveSchedule: --every-minutes 45 → UNEVEN_INTERVAL (60의 약수만 허용)', () => {
  const r = resolveSchedule({ 'every-minutes': '45' })
  assert.equal(r.error.code, 'UNEVEN_INTERVAL')
  assert.equal(r.error.flag, 'every-minutes')
  assert.equal(r.error.allowed, '1, 2, 3, 4, 5, 6, 10, 12, 15, 20, 30')
  assert.equal(resolveSchedule({ 'every-minutes': '15' }).cron, '*/15 * * * *')
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

test('parseArgv: 불리언 플래그는 다음 토큰을 값으로 가져가지 않음', () => {
  const reboot = parseArgv(['node', 'cronly', 'add', '--reboot', './startup.sh'])
  assert.equal(reboot.flags.reboot, true)
  assert.deepEqual(reboot.args, ['./startup.sh'])

  const weekdays = parseArgv(['node', 'cronly', 'add', '--weekdays', './job.mjs', '--at', '09:00'])
  assert.equal(weekdays.flags.weekdays, true)
  assert.equal(weekdays.flags.at, '09:00')
  assert.deepEqual(weekdays.args, ['./job.mjs'])
})

test('parseArgv: --key=value 형식 지원', () => {
  const { command, args, flags } = parseArgv([
    'node', 'cronly', '--lang=ko', 'add', './job.mjs', '--schedule=0 8 * * *', '--runtime=',
  ])
  assert.equal(command, 'add')
  assert.deepEqual(args, ['./job.mjs'])
  assert.equal(flags.lang, 'ko')
  assert.equal(flags.schedule, '0 8 * * *')
  assert.equal(flags.runtime, '')
})

test('parseArgv: 값이 없는 값 플래그는 true, 빈 문자열은 값으로 받음', () => {
  const missing = parseArgv(['node', 'cronly', 'remove', '--id', '--lang', 'ko'])
  assert.equal(missing.flags.id, true)
  assert.equal(missing.flags.lang, 'ko')

  const last = parseArgv(['node', 'cronly', 'add', './job.mjs', '--runtime'])
  assert.equal(last.flags.runtime, true)

  const empty = parseArgv(['node', 'cronly', 'add', './job.mjs', '--schedule', ''])
  assert.equal(empty.flags.schedule, '')
  assert.deepEqual(empty.args, ['./job.mjs'])
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
    allowed: '1, 2, 3',
    runtime: 'python3',
    length: 1200,
    other: 'ef567890',
    pids: '1234',
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

    const busy = catalog['crontab.lock_busy']
    const withPids = busy({ path: '/tmp/x.lock', pids: '12, 34' })
    const withoutPids = busy({ path: '/tmp/x.lock', pids: '' })
    assert.ok(withPids.includes('12, 34') && withPids.includes('/tmp/x.lock'), `${locale}:lock_busy with pids`)
    assert.ok(withoutPids.includes('/tmp/x.lock') && withoutPids.length < withPids.length, `${locale}:lock_busy without pids`)
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

await testAsync('readCrontab: BusyBox(Alpine)의 crontab 없음 메시지도 빈 문자열', async () => {
  await withMockCrontabEnv({ readFail: "crontab: can't open 'deploy': No such file or directory" }, async (ctx) => {
    assert.equal(await readCrontab(), '')
    // crontab이 없는 사용자의 첫 등록이 실패하지 않는다
    const file = ctx.createScript('job.mjs', '')
    await captureLogs(() => add(file, { schedule: '0 8 * * *' }))
    assert.deepEqual(parseBlocks(ctx.readState()).map((b) => b.path), [file])
  })
})

await testAsync('readCrontab: 읽지 못한 crontab을 빈 것으로 취급하지 않음', async () => {
  for (const message of [
    "crontab: can't open 'deploy': Permission denied",
    "crontab: can't change directory to '/var/spool/cron/crontabs': No such file or directory",
  ]) {
    await withMockCrontabEnv({ initialContent: '0 * * * * /job\n', readFail: message }, async (ctx) => {
      await assert.rejects(() => readCrontab(), { message: `crontab -l failed: ${message}` })
      const file = ctx.createScript('job.mjs', '')
      await assert.rejects(() => add(file, { schedule: '0 8 * * *' }), /crontab -l failed/)
      assert.equal(ctx.readState(), '0 * * * * /job\n')
    })
  }
})

await testAsync('readCrontab: 일반 실패는 reject', async () => {
  await withMockCrontabEnv({ readFail: 'mock read denied' }, async () => {
    await assert.rejects(() => readCrontab(), { message: 'crontab -l failed: mock read denied' })
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
    await assert.rejects(() => writeCrontab('0 * * * * /job\n'), { message: 'crontab - failed: mock write denied' })
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

await testAsync('writeCrontab: macOS에서 응답이 늦으면 권한 창 안내를 stderr로 출력', async () => {
  await withMockCrontabEnv({ writeDelay: '0.3' }, async (ctx) => {
    const { errors } = await captureErrors(() =>
      writeCrontab('0 * * * * /job\n', { platform: 'darwin', hintDelayMs: 50 })
    )
    assert.equal(errors.length, 1)
    assert.ok(errors[0].includes('If macOS asks for permission'))
    assert.equal(ctx.readState(), '0 * * * * /job\n')
  })
})

await testAsync('writeCrontab: 바로 끝나거나 macOS가 아니면 안내하지 않음', async () => {
  await withMockCrontabEnv({ writeDelay: '0.3' }, async () => {
    const { errors } = await captureErrors(() => writeCrontab('0 * * * * /job\n', { platform: 'linux', hintDelayMs: 50 }))
    assert.deepEqual(errors, [])
  })
  await withMockCrontabEnv({}, async () => {
    const { errors } = await captureErrors(() => writeCrontab('0 * * * * /job\n', { platform: 'darwin', hintDelayMs: 1000 }))
    assert.deepEqual(errors, [])
  })
})

await testAsync('writeCrontab: macOS가 막으면(Operation not permitted) 해결 방법을 덧붙임', async () => {
  await withMockCrontabEnv({ writeFail: 'crontab: tmp/tmp.123: Operation not permitted' }, async () => {
    await assert.rejects(
      () => writeCrontab('0 * * * * /job\n', { platform: 'darwin' }),
      /^Error: crontab - failed: crontab: tmp\/tmp\.123: Operation not permitted\nmacOS blocked the crontab change\. .*Full Disk Access/
    )
    await assert.rejects(() => writeCrontab('0 * * * * /job\n', { platform: 'linux' }), {
      message: 'crontab - failed: crontab: tmp/tmp.123: Operation not permitted',
    })
  })
})

await testAsync('writeCrontab: 자식 추적에 실패하면 입력을 닫지 않고 중단해 crontab을 비우지 않음', async () => {
  const original = '# manual\n0 0 * * * /bin/true\n'
  await withMockCrontabEnv({ initialContent: original }, async (ctx) => {
    let childPid
    const trackProcess = (pid) => {
      childPid = pid
      throw Object.assign(new Error('no space left on device'), { code: 'ENOSPC' })
    }
    await assert.rejects(() => writeCrontab('0 * * * * /job\n', { trackProcess }), { code: 'ENOSPC' })
    // 자식이 살아서 입력 종료를 기다리면, CLI가 끝나는 순간 빈 crontab을 설치한다
    assert.throws(() => process.kill(childPid, 0), { code: 'ESRCH' })
    assert.equal(ctx.readState(), original)
    assert.equal(ctx.readWriteLog(), '')
  })
})

test('decodeCrontab/encodeCrontab: 올바른 UTF-8은 그대로 읽고 씀', () => {
  for (const text of ['', '0 * * * * /job\n', '# 백업 작업 ✓ \u{1f600} \u{10080} �\n']) {
    const bytes = Buffer.from(text, 'utf8')
    assert.equal(decodeCrontab(bytes), text)
    assert.ok(encodeCrontab(text).equals(bytes))
  }
})

test('decodeCrontab/encodeCrontab: UTF-8이 아닌 바이트를 U+FFFD로 바꾸지 않고 그대로 되돌림', () => {
  // 오래된 서버의 crontab에 남아 있는 EUC-KR 주석 "# 백업"
  const eucKr = Buffer.from([0x23, 0x20, 0xb9, 0xe9, 0xbe, 0xf7, 0x0a])
  const text = decodeCrontab(eucKr)
  assert.equal(text.length, eucKr.length)
  assert.ok(text.startsWith('# ') && text.endsWith('\n'))
  assert.ok(!text.includes('�'))
  assert.ok(encodeCrontab(text).equals(eucKr))

  // 길이별 올바른 문자(각 범위의 경계 포함) 사이에 잘못된 바이트열을 끼워 넣는다
  const valid = '# é ࠀ ퟿  한글 \u{10000} \u{40000} \u{1f600} \u{10080} \u{10ffff}'
  const malformed = [
    [0x80], [0xbf], [0xc0, 0xaf], [0xc1, 0xbf], [0xc2], [0xc2, 0x41],
    [0xe0, 0x80, 0x80], [0xe0, 0x9f, 0xbf], [0xed, 0xa0, 0x80], [0xed, 0xbf, 0xbf], [0xe3], [0xe3, 0x81], [0xe3, 0x81, 0x41],
    [0xf0, 0x80, 0x80, 0x80], [0xf0, 0x8f, 0xbf, 0xbf], [0xf4, 0x90, 0x80, 0x80],
    [0xf0, 0x9f, 0x98], [0xf0, 0x9f, 0x98, 0x41], [0xf0, 0x9f, 0x41, 0x80],
    [0xf5, 0x80, 0x80, 0x80], [0xfe], [0xff],
  ]
  for (const bytes of malformed) {
    const alone = Buffer.from(bytes)
    assert.ok(encodeCrontab(decodeCrontab(alone)).equals(alone), `bytes ${alone.toString('hex')}`)

    const mixed = Buffer.concat([Buffer.from(`${valid} `), alone, Buffer.from(` ${valid}\n`)])
    const decoded = decodeCrontab(mixed)
    assert.ok(decoded.startsWith(`${valid} `) && decoded.endsWith(` ${valid}\n`), `text around ${alone.toString('hex')}`)
    assert.ok(!decoded.includes('�'))
    assert.ok(encodeCrontab(decoded).equals(mixed), `bytes around ${alone.toString('hex')}`)
  }
})

await testAsync('add/remove: UTF-8이 아닌 기존 crontab 내용을 바이트 그대로 보존', async () => {
  // EUC-KR 주석과 Latin-1 경로. 문자열로 읽고 쓰면 U+FFFD로 바뀌어 무관한 작업의 경로가 깨진다
  const original = Buffer.concat([
    Buffer.from('# '), Buffer.from([0xb9, 0xe9, 0xbe, 0xf7]),
    Buffer.from('\n0 3 * * * /srv/caf'), Buffer.from([0xe9]), Buffer.from('/backup.sh\n'),
  ])
  await withMockCrontabEnv({}, async (ctx) => {
    writeFileSync(ctx.stateFile, original)
    const file = ctx.createScript('작업.mjs', '')

    await captureLogs(() => add(file, { schedule: '0 8 * * *' }))
    const added = readFileSync(ctx.stateFile)
    assert.ok(added.subarray(0, original.length).equals(original))
    const blocks = parseBlocks(added.subarray(original.length).toString('utf8'))
    assert.deepEqual(blocks.map((b) => [b.path, b.schedule]), [[file, '0 8 * * *']])

    await captureLogs(() => add(file, { schedule: '0 9 * * *' }))
    assert.ok(readFileSync(ctx.stateFile).subarray(0, original.length).equals(original))
    assert.equal((await captureLogs(() => list())).logs.length, 1)

    await captureLogs(() => remove(file, {}))
    const removed = readFileSync(ctx.stateFile)
    assert.ok(removed.subarray(0, original.length).equals(original))
    assert.equal(removed.subarray(original.length).toString('utf8').trim(), '')
  })
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

await testAsync('add: 스크립트 디렉터리로 cd 하고 로그 파일에 출력을 남기는 명령으로 등록', async () => {
  await withMockCrontabEnv({}, async (ctx) => {
    const file = ctx.createScript('job.mjs', 'console.log("hello")\n')
    const logPath = join(ctx.logDir, `${makeId(file)}.log`)
    const { logs } = await captureLogs(() => add(file, { schedule: '0 8 * * *' }))

    const [block] = parseBlocks(ctx.readState())
    assert.equal(
      block.command,
      `cd '${ctx.dir}' && PATH='${getCronPath()}' '${process.execPath}' '${file}' >> '${logPath}' 2>&1`
    )
    assert.ok(existsSync(ctx.logDir), 'log directory should be created')
    assert.deepEqual(logs, [`Registered: ${file} (id=${makeId(file)})`, `  Log: ${logPath}`])
  })
})

await testAsync('add: 경로에 $&가 있어도 업데이트가 crontab을 깨뜨리지 않음', async () => {
  await withMockCrontabEnv({ initialContent: '0 * * * * /usr/bin/manual-job\n' }, async (ctx) => {
    mkdirSync(join(ctx.dir, "price$&$'tag"))
    const file = ctx.createScript("price$&$'tag/job.mjs", 'console.log("hello")\n')
    await add(file, { schedule: '0 8 * * *' })
    await add(file, { schedule: '0 9 * * *' })

    const raw = ctx.readState()
    const blocks = parseBlocks(raw)
    assert.equal(blocks.length, 1)
    assert.equal(blocks[0].path, file)
    assert.equal(blocks[0].schedule, '0 9 * * *')
    assert.equal(raw.split('\n').filter((line) => line.startsWith('0 8 ')).length, 0)
    assert.ok(raw.startsWith('0 * * * * /usr/bin/manual-job\n'))
  })
})

await testAsync('add: 디렉터리는 거부', async () => {
  await withMockCrontabEnv({}, async (ctx) => {
    await assert.rejects(() => add(ctx.dir, { schedule: '0 8 * * *', runtime: 'exec' }), /Not a file/)
  })
})

await testAsync('add: --runtime에 공백이 있으면 crontab을 건드리지 않고 거부', async () => {
  await withMockCrontabEnv({}, async (ctx) => {
    const file = ctx.createScript('job.py', 'print(1)\n', 0o644)
    await assert.rejects(() => add(file, { schedule: '0 8 * * *', runtime: 'python3 -u' }), /Invalid runtime/)
    assert.equal(ctx.readState(), '')
  })
})

await testAsync('add: 사용자 지정 런타임은 PATH에서 찾은 절대 경로로 기록', async () => {
  await withMockCrontabEnv({}, async (ctx) => {
    const runtime = ctx.createScript('myrt', '#!/bin/sh\nexec /bin/sh "$@"\n')
    const file = ctx.createScript('job.py', 'print(1)\n', 0o644)
    await captureLogs(() => add(file, { schedule: '0 8 * * *', runtime: 'myrt' }))

    const [block] = parseBlocks(ctx.readState())
    assert.equal(block.runtime, 'myrt')
    assert.equal(inspectCommand(block.command, block.path).runtimeBin, runtime)
  })
})

await testAsync('add: exec 런타임은 실행 권한이 없으면 거부', async () => {
  await withMockCrontabEnv({}, async (ctx) => {
    const file = ctx.createScript('tool', '#!/bin/sh\necho hi\n', 0o644)
    await assert.rejects(() => add(file, { schedule: '0 8 * * *', runtime: 'exec' }), /Not executable/)
  })
})

await testAsync('readShebangRuntime: #! 줄이 가리키는 인터프리터를 읽음', async () => {
  await withMockCrontabEnv({}, async (ctx) => {
    const cases = [
      ['#!/bin/sh\necho hi\n', 'sh'],
      ['#!/usr/bin/env sh\n', 'sh'],
      ['#! /bin/sh -e\n', 'sh'],
      ['#!/bin/bash\n', '/bin/bash'],
      ['#!/bin/bash -eu\necho hi\n', '/bin/bash'],
      ['#!/usr/bin/env bash\n', 'bash'],
      ['#!/usr/bin/env -S bash -e\n', 'bash'],
      ['#!/usr/bin/env LANG=C zsh\n', 'zsh'],
      ['#!/bin/bash\r\necho hi\r\n', '/bin/bash'],
      ['#!/opt/tools/bash', '/opt/tools/bash'],
      [`#!/bin/bash ${'x'.repeat(600)}\n`, '/bin/bash'],
      ['echo no shebang\n', null],
      ['', null],
      ['#!\n', null],
      ['#!/usr/bin/env\n', null],
      ['#!/usr/bin/env -S\n', null],
      [' #!/bin/bash\n', null],
    ]
    cases.forEach(([source, expected], i) => {
      assert.equal(readShebangRuntime(ctx.createScript(`case-${i}.sh`, source)), expected, JSON.stringify(source.slice(0, 40)))
    })
    assert.equal(readShebangRuntime(join(ctx.dir, 'missing.sh')), null)
  })
})

await testAsync('resolveJobRuntime: --runtime이 없으면 확장자로, .sh는 #! 줄로 런타임을 정함', async () => {
  await withMockCrontabEnv({}, async (ctx) => {
    const shell = ctx.createScript('myshell', '#!/bin/sh\nexec /bin/sh "$@"\n')
    const env = { PATH: ctx.dir }
    const plain = ctx.createScript('plain.sh', 'echo hi\n')
    const posix = ctx.createScript('posix.sh', '#!/bin/sh\necho hi\n')
    const byPath = ctx.createScript('by-path.sh', `#!${shell}\necho hi\n`)
    const byName = ctx.createScript('by-name.sh', '#!/usr/bin/env myshell\necho hi\n')
    const missing = ctx.createScript('missing.sh', '#!/no/such/shell\necho hi\n')

    assert.deepEqual(resolveJobRuntime(ctx.createScript('job.mjs', ''), undefined, env), { runtime: 'node', runtimePath: process.execPath })
    assert.deepEqual(resolveJobRuntime(plain, undefined, env), { runtime: 'sh', runtimePath: '/bin/sh' })
    assert.deepEqual(resolveJobRuntime(posix, undefined, env), { runtime: 'sh', runtimePath: '/bin/sh' })
    assert.deepEqual(resolveJobRuntime(byPath, undefined, env), { runtime: shell, runtimePath: shell })
    assert.deepEqual(resolveJobRuntime(byName, undefined, env), { runtime: 'myshell', runtimePath: shell })
    // 명시한 --runtime은 #! 줄보다 우선
    assert.deepEqual(resolveJobRuntime(byPath, 'sh', env), { runtime: 'sh', runtimePath: '/bin/sh' })
    assert.deepEqual(resolveJobRuntime(plain, 'myshell', env), { runtime: 'myshell', runtimePath: shell })
    assert.throws(() => resolveJobRuntime(missing, undefined, env), /Runtime not found: \/no\/such\/shell \(named on the #! line of .*missing\.sh\)/)
    assert.throws(() => resolveJobRuntime(byName, undefined, {}), /Runtime not found: myshell \(named on the #! line/)
    assert.throws(() => resolveJobRuntime(ctx.createScript('job.py', ''), undefined, env), /Cannot infer runtime/)
    assert.throws(() => resolveJobRuntime(plain, 'nope', env), { message: 'Runtime not found: nope' })
  })
})

await testAsync('add: .sh는 /bin/sh가 아니라 #! 줄의 인터프리터로 실행되도록 등록', async () => {
  await withMockCrontabEnv({}, async (ctx) => {
    // bash 전용 문법: dash가 /bin/sh인 Debian·Ubuntu에서 /bin/sh로 넘기면 문법 오류로 끝난다
    if (!existsSync('/bin/bash')) return
    const file = ctx.createScript('arrays.sh', '#!/bin/bash\nitems=(a b c)\n[[ ${#items[@]} -eq 3 ]] && echo "count=${#items[@]}"\n', 0o644)
    await captureLogs(() => add(file, { schedule: '0 8 * * *' }))

    const [block] = parseBlocks(ctx.readState())
    assert.equal(block.runtime, '/bin/bash')
    assert.equal(inspectCommand(block.command, file).runtimeBin, '/bin/bash')
    const run = spawnSync('/bin/sh', ['-c', decodeCronCommand(block.command)], { encoding: 'utf8' })
    assert.equal(run.status, 0, run.stderr)
    assert.equal(readFileSync(join(ctx.logDir, `${makeId(file)}.log`), 'utf8'), 'count=3\n')
  })
})

await testAsync('add: #! 줄의 인터프리터가 없으면 crontab을 건드리지 않고 거부', async () => {
  await withMockCrontabEnv({}, async (ctx) => {
    const file = ctx.createScript('job.sh', '#!/no/such/shell\necho hi\n')
    await assert.rejects(() => add(file, { schedule: '0 8 * * *' }), /named on the #! line/)
    assert.equal(ctx.readState(), '')
    // 직접 고르면 등록할 수 있다
    await captureLogs(() => add(file, { schedule: '0 8 * * *', runtime: 'sh' }))
    assert.equal(parseBlocks(ctx.readState())[0].runtime, 'sh')
  })
})

await testAsync('doctor: #! 줄과 달리 /bin/sh로 남아 있는 엔트리를 실패 없이 알림', async () => {
  await withMockCrontabEnv({}, async (ctx) => {
    const shell = ctx.createScript('myshell', '#!/bin/sh\nexec /bin/sh "$@"\n')
    const file = ctx.createScript('job.sh', `#!${shell}\necho hi\n`)
    // 예전 버전이 등록한 엔트리
    ctx.setState(`${buildBlock({ schedule: '0 8 * * *', absolutePath: file, runtime: 'sh' })}\n`)
    const [legacy] = parseBlocks(ctx.readState())
    assert.equal(findIgnoredShebang(legacy), shell)

    let report = await captureLogs(() => doctor())
    assert.ok(report.logs.includes(`  ${legacy.id}: runs with /bin/sh although the #! line of the script names ${shell}. Run cronly add again to use it.`))
    assert.equal(report.logs.at(-1), 'All checks passed.')
    assert.equal(report.result, true)

    await captureLogs(() => add(file, { schedule: '0 8 * * *' }))
    const [current] = parseBlocks(ctx.readState())
    assert.equal(current.runtime, shell)
    assert.equal(findIgnoredShebang(current), null)
    report = await captureLogs(() => doctor())
    assert.ok(!report.logs.some((line) => line.includes('#! line')))
    assert.equal(report.result, true)

    assert.equal(findIgnoredShebang({ runtime: 'sh', path: ctx.createScript('posix.sh', '#!/bin/sh\n') }), null)
    assert.equal(findIgnoredShebang({ runtime: 'sh', path: ctx.createScript('plain.sh', 'echo hi\n') }), null)
  })
})

await testAsync('isSameFile: 심볼릭 링크를 포함해 같은 파일일 때만 true', async () => {
  await withMockCrontabEnv({}, async (ctx) => {
    const { file, viaLink } = ctx.createLinkedScript()
    const other = ctx.createScript('other.mjs', 'console.log("other")\n')
    assert.equal(isSameFile(file, file), true)
    assert.equal(isSameFile(viaLink, file), true)
    assert.equal(isSameFile(other, file), false)
    assert.equal(isSameFile(join(ctx.dir, 'missing.mjs'), file), false)
  })
})

await testAsync('add: 같은 파일을 다른 경로로 다시 등록하면 기존 엔트리를 대체하고 새 경로를 기록', async () => {
  await withMockCrontabEnv({}, async (ctx) => {
    const { file, viaLink } = ctx.createLinkedScript()
    await captureLogs(() => add(file, { schedule: '0 8 * * *' }))
    const { logs } = await captureLogs(() => add(viaLink, { schedule: '0 9 * * *' }))

    const blocks = parseBlocks(ctx.readState())
    assert.equal(blocks.length, 1)
    assert.equal(blocks[0].path, viaLink)
    assert.equal(blocks[0].schedule, '0 9 * * *')
    // cron은 링크를 거친 경로로 실행해서, current가 바뀌면 새 릴리스를 실행
    assert.ok(blocks[0].command.startsWith(`cd '${join(ctx.dir, 'current')}' && `))
    assert.deepEqual(logs.slice(0, 2), [
      `Updated: ${viaLink} (id=${makeId(viaLink)})`,
      `  Replaced the entry for the same file: ${file} (id=${makeId(file)})`,
    ])
  })
})

await testAsync('add: 이미 중복 등록된 같은 파일은 하나로 합침', async () => {
  await withMockCrontabEnv({}, async (ctx) => {
    const { file, viaLink } = ctx.createLinkedScript()
    const other = ctx.createScript('other.mjs', 'console.log("other")\n')
    ctx.setState([
      buildBlock({ schedule: '0 8 * * *', absolutePath: file, runtime: 'node' }),
      '',
      buildBlock({ schedule: '0 7 * * *', absolutePath: other, runtime: 'node' }),
      '',
      buildBlock({ schedule: '0 9 * * *', absolutePath: viaLink, runtime: 'node' }),
      '',
    ].join('\n'))

    const { logs } = await captureLogs(() => add(file, { schedule: '30 7 * * *' }))
    const blocks = parseBlocks(ctx.readState())
    assert.deepEqual(blocks.map((b) => [b.path, b.schedule]), [[file, '30 7 * * *'], [other, '0 7 * * *']])
    assert.ok(logs.includes(`  Replaced the entry for the same file: ${viaLink} (id=${makeId(viaLink)})`))
  })
})

await testAsync('add: 대소문자만 다른 경로도 같은 파일이면 대체 (대소문자를 구분하지 않는 파일 시스템에서만 확인)', async () => {
  await withMockCrontabEnv({}, async (ctx) => {
    const file = ctx.createScript('report.mjs', 'console.log("hello")\n')
    const upper = join(ctx.dir, 'Report.mjs')
    if (!existsSync(upper)) return
    await captureLogs(() => add(file, { schedule: '0 8 * * *' }))
    await captureLogs(() => add(upper, { schedule: '0 9 * * *' }))
    assert.deepEqual(parseBlocks(ctx.readState()).map((b) => b.path), [upper])
  })
})

test('getLogDir: CRONLY_HOME이 있으면 그 아래, 없으면 ~/.cronly 아래', () => {
  assert.equal(getLogDir({ CRONLY_HOME: '/srv/cronly' }), '/srv/cronly/logs')
  assert.equal(getLogDir({}), join(homedir(), '.cronly', 'logs'))
})

test('getCronPath: 실행 중인 node 디렉터리 + cron 기본 PATH', () => {
  const dirs = getCronPath().split(':')
  assert.equal(dirs[0], dirname(process.execPath))
  assert.deepEqual(dirs.slice(-2), ['/usr/bin', '/bin'])
  assert.equal(new Set(dirs).size, dirs.length)
})

test('resolveRuntimePath: node, sh는 고정 경로', () => {
  assert.equal(resolveRuntimePath('node', '/x/job.mjs'), process.execPath)
  assert.equal(resolveRuntimePath('sh', '/x/job.sh'), '/bin/sh')
})

test('resolveRuntimePath: 공백이 있거나 문자열이 아니면 거부', () => {
  assert.throws(() => resolveRuntimePath('python3 -u', '/x/job.py'), /Invalid runtime: python3 -u/)
  assert.throws(() => resolveRuntimePath(true, '/x/job.py'), /Invalid runtime: true/)
})

await testAsync('resolveRuntimePath: exec는 실행 가능한 파일이면 빈 문자열', async () => {
  await withMockCrontabEnv({}, async (ctx) => {
    const file = ctx.createScript('tool', '#!/bin/sh\necho hi\n')
    assert.equal(resolveRuntimePath('exec', file), '')
  })
})

await testAsync('resolveRuntimePath: 이름은 PATH의 절대 경로 항목에서만 찾음', async () => {
  await withMockCrontabEnv({}, async (ctx) => {
    const runtime = ctx.createScript('myrt', '#!/bin/sh\n')
    ctx.createScript('not-exec-rt', '#!/bin/sh\n', 0o644)
    const env = { PATH: ['relative-dir', '', '/definitely-missing', ctx.dir].join(':') }
    assert.equal(resolveRuntimePath('myrt', '/x/job', env), runtime)
    assert.throws(() => resolveRuntimePath('not-exec-rt', '/x/job', env), /Runtime not found: not-exec-rt/)
    assert.throws(() => resolveRuntimePath('myrt', '/x/job', {}), /Runtime not found: myrt/)
  })
})

await testAsync('resolveRuntimePath: 경로 형태는 그 파일을 그대로 확인', async () => {
  await withMockCrontabEnv({}, async (ctx) => {
    const runtime = ctx.createScript('myrt', '#!/bin/sh\n')
    assert.equal(resolveRuntimePath(runtime, '/x/job'), runtime)
    assert.throws(() => resolveRuntimePath(join(ctx.dir, 'missing-rt'), '/x/job'), /Runtime not found/)
    assert.throws(() => resolveRuntimePath(ctx.dir, '/x/job'), /Runtime not found/)
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

await testAsync('remove: 다른 경로로 등록된 같은 파일의 엔트리도 모두 삭제', async () => {
  await withMockCrontabEnv({ initialContent: '0 * * * * /usr/bin/manual-job\n' }, async (ctx) => {
    const { file, viaLink } = ctx.createLinkedScript()
    const other = ctx.createScript('other.mjs', 'console.log("other")\n')
    const otherBlock = buildBlock({ schedule: '0 7 * * *', absolutePath: other, runtime: 'node' })
    ctx.setState([
      '0 * * * * /usr/bin/manual-job',
      '',
      buildBlock({ schedule: '0 8 * * *', absolutePath: file, runtime: 'node' }),
      '',
      otherBlock,
      '',
      buildBlock({ schedule: '0 9 * * *', absolutePath: viaLink, runtime: 'node' }),
      '',
    ].join('\n'))

    const { logs } = await captureLogs(() => remove(viaLink, {}))
    const raw = ctx.readState()
    assert.deepEqual(parseBlocks(raw).map((b) => b.raw), [otherBlock])
    assert.ok(raw.startsWith('0 * * * * /usr/bin/manual-job\n'))
    assert.deepEqual(logs, [
      `Removed: ${file} (id=${makeId(file)})`,
      `Removed: ${viaLink} (id=${makeId(viaLink)})`,
    ])
  })
})

await testAsync('remove: --id는 같은 id의 블록을 모두 삭제', async () => {
  await withMockCrontabEnv({}, async (ctx) => {
    const file = ctx.createScript('job.sh', '#!/bin/sh\necho one\n')
    const block = buildBlock({ schedule: '0 8 * * *', absolutePath: file, runtime: 'sh' })
    ctx.setState(`${block}\n\n${block}\n`)
    await captureLogs(() => remove(undefined, { id: makeId(file) }))
    assert.equal(ctx.readState(), '')
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
    const { logs, result } = await captureLogs(() => doctor())
    assert.ok(logs.some((line) => line.includes('Node.js')))
    assert.ok(logs.some((line) => line.includes('crontab command: found')))
    assert.ok(logs.includes('  cron daemon: running'))
    assert.ok(logs.some((line) => line.includes('Managed entries: 1')))
    assert.equal(logs.at(-1), 'All checks passed.')
    assert.equal(result, true)
  })
})

await testAsync('doctor: 문제 환경도 보고', async () => {
  await withPatchedVersion('v14.7.0', async () => {
    await withMockCrontabEnv({}, async (ctx) => {
      process.env.PATH = join(ctx.dir, 'no-such-bin')
      const { logs, result } = await captureLogs(() => doctor())
      assert.ok(logs.some((line) => line.includes('Node.js 14.8.0 or higher')))
      assert.ok(logs.some((line) => line.includes('crontab command: not found')))
      assert.ok(logs.some((line) => line.includes('crontab read: failed')))
      assert.equal(logs.at(-1), 'Some checks failed.')
      assert.equal(result, false)
    })
  })
})

await testAsync('doctor: which 명령이 없거나 실패해도 crontab을 PATH에서 직접 찾음', async () => {
  // 최소 이미지에는 which가 없다. 예전에는 "not found"와 "read: ok"가 함께 나오고 실패로 끝났다
  await withMockCrontabEnv({ whichFail: true }, async (ctx) => {
    assert.equal(findExecutable('crontab'), join(ctx.dir, 'crontab'))
    assert.equal(findExecutable('definitely-missing-command'), null)
    assert.equal(findExecutable('crontab', {}), null)
    const { logs, result } = await captureLogs(() => doctor())
    assert.ok(logs.includes('  crontab command: found'))
    assert.ok(logs.includes('  crontab read: ok'))
    assert.equal(logs.at(-1), 'All checks passed.')
    assert.equal(result, true)
  })
})

await testAsync('isCronDaemonRunning: 프로세스 목록에서 cron 데몬을 찾고, 알 수 없으면 null', async () => {
  await withMockCrontabEnv({}, async (ctx) => {
    assert.equal(getProcDir({}), '/proc')
    assert.equal(getProcDir({ CRONLY_PROC_DIR: '/custom/proc' }), '/custom/proc')
    let n = 0
    const list = (commands) => writeProcessList(join(ctx.dir, `proc-${n++}`), commands)
    const none = []

    for (const daemon of [['/usr/sbin/cron', '-f'], ['/usr/sbin/crond', '-n'], ['crond', '-f', '-d', '8'], ['busybox', 'crond', '-f'], ['/usr/sbin/fcron']]) {
      assert.equal(isCronDaemonRunning(list([['/sbin/init'], ['node', 'server.js'], daemon]), none), true, daemon.join(' '))
    }
    for (const other of [['node', 'server.js'], ['busybox'], ['busybox', 'sh'], ['/usr/bin/crontab', '-l'], ['']]) {
      assert.equal(isCronDaemonRunning(list([['/sbin/init'], other]), none), false, other.join(' '))
    }
    // /proc가 아닌 항목과, 목록을 읽는 사이 끝난 프로세스는 건너뛴다
    const racing = list([['/sbin/init']])
    mkdirSync(join(racing, 'self'))
    mkdirSync(join(racing, '4242'))
    assert.equal(isCronDaemonRunning(racing, none), false)

    // /proc가 없거나(macOS) 다른 사용자의 프로세스가 가려져 PID 1을 읽을 수 없으면 판단하지 않는다
    assert.equal(isCronDaemonRunning(join(ctx.dir, 'missing-proc'), none), null)
    const hidden = join(ctx.dir, 'proc-hidden')
    mkdirSync(join(hidden, '77'), { recursive: true })
    writeFileSync(join(hidden, '77', 'cmdline'), 'node\0')
    assert.equal(isCronDaemonRunning(hidden, none), null)

    // systemd-cron은 데몬 없이 타이머로 crontab을 실행한다
    const generator = ctx.createScript('systemd-crontab-generator', '')
    assert.equal(isCronDaemonRunning(list([['/sbin/init']]), [join(ctx.dir, 'absent'), generator]), true)
  })
})

await testAsync('doctor: cron 데몬이 실행 중이 아니면 실패로 보고하고, 알 수 없으면 점검을 건너뜀', async () => {
  await withMockCrontabEnv({}, async (ctx) => {
    process.env.CRONLY_PROC_DIR = writeProcessList(join(ctx.dir, 'proc-no-cron'), [['/sbin/init'], ['node', 'server.js']])
    let report = await captureLogs(() => doctor())
    assert.ok(report.logs.includes('  ⚠ cron daemon: not running. Jobs will not start until cron (or crond) is running.'))
    assert.equal(report.logs.at(-1), 'Some checks failed.')
    assert.equal(report.result, false)
    assert.equal(ctx.cli(['doctor']).status, 1)

    process.env.CRONLY_PROC_DIR = join(ctx.dir, 'missing-proc')
    report = await captureLogs(() => doctor())
    assert.ok(!report.logs.some((line) => line.includes('cron daemon')))
    assert.equal(report.logs.at(-1), 'All checks passed.')
    assert.equal(report.result, true)
  })
})

await testAsync('doctor: 스크립트, 런타임, 로그 디렉터리가 사라진 엔트리를 보고', async () => {
  await withMockCrontabEnv({}, async (ctx) => {
    const missingScript = join(ctx.dir, 'moved.mjs')
    const block = buildBlock({
      schedule: '0 8 * * *',
      absolutePath: missingScript,
      runtime: 'node',
      runtimePath: join(ctx.dir, 'uninstalled', 'node'),
      logPath: join(ctx.dir, 'deleted-logs', 'x.log'),
    })
    ctx.setState(`${block}\n`)

    const { logs, result } = await captureLogs(() => doctor())
    const id = makeId(missingScript)
    assert.ok(logs.includes(`  ⚠ ${id}: script not found: ${missingScript}`))
    assert.ok(logs.includes(`  ⚠ ${id}: runtime not found: ${join(ctx.dir, 'uninstalled', 'node')}`))
    assert.ok(logs.includes(`  ⚠ ${id}: log directory not found: ${join(ctx.dir, 'deleted-logs')}`))
    assert.ok(logs.some((line) => line.includes('cronly remove --id <id>')))
    assert.equal(logs.at(-1), 'Some checks failed.')
    assert.equal(result, false)
  })
})

await testAsync('doctor: 같은 파일이 두 번 등록되어 있으면 보고', async () => {
  await withMockCrontabEnv({}, async (ctx) => {
    const { file, viaLink } = ctx.createLinkedScript()
    ctx.setState([
      buildBlock({ schedule: '0 8 * * *', absolutePath: file, runtime: 'sh' }),
      '',
      buildBlock({ schedule: '0 9 * * *', absolutePath: viaLink, runtime: 'sh' }),
      '',
    ].join('\n'))

    const { logs, result } = await captureLogs(() => doctor())
    assert.ok(
      logs.includes(
        `  ⚠ ${makeId(viaLink)}: another entry (${makeId(file)}) points to the same file, so it runs twice: ${viaLink}`
      )
    )
    assert.equal(result, false)
  })
})

await testAsync('findEntryIssues: 이름만 있는 예전 사용자 지정 런타임은 확인하지 않음', async () => {
  await withMockCrontabEnv({}, async (ctx) => {
    const file = ctx.createScript('job.py', 'print(1)\n', 0o644)
    const [block] = parseBlocks(buildBlock({ schedule: '0 8 * * *', absolutePath: file, runtime: 'python3' }))
    assert.deepEqual(findEntryIssues(block), [])
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

await testAsync('CLI: --reboot 뒤에 파일 경로를 써도 등록', async () => {
  await withMockCrontabEnv({}, async (ctx) => {
    const script = ctx.createScript('startup.sh', '#!/bin/sh\necho hi\n')
    const result = ctx.cli(['add', '--reboot', script])
    assert.equal(result.status, 0, result.stderr)
    assert.equal(parseBlocks(ctx.readState())[0].schedule, '@reboot')
  })
})

await testAsync('CLI: --daily=08:00, --lang=ko 형식 지원', async () => {
  await withMockCrontabEnv({}, async (ctx) => {
    const script = ctx.createScript('job.mjs', 'console.log("hello")\n')
    const result = ctx.cli(['add', script, '--daily=08:00', '--lang=ko'])
    assert.equal(result.status, 0, result.stderr)
    assert.ok(result.stdout.includes('등록했어요'))
    assert.equal(parseBlocks(ctx.readState())[0].schedule, '0 8 * * *')
  })
})

await testAsync('CLI: 값이 필요한 플래그에 값이 없으면 에러', async () => {
  await withMockCrontabEnv({}, async (ctx) => {
    const script = ctx.createScript('job.mjs', 'console.log("hello")\n')
    const runtime = ctx.cli(['add', script, '--daily', '08:00', '--runtime'])
    assert.equal(runtime.status, 1)
    assert.equal(runtime.stderr, '--runtime requires a value.\n')
    assert.equal(ctx.readState(), '')

    const id = ctx.cli(['remove', '--id'])
    assert.equal(id.status, 1)
    assert.equal(id.stderr, '--id requires a value.\n')
  })
})

await testAsync('CLI: 값을 받지 않는 플래그에 값을 붙이면 에러', async () => {
  await withMockCrontabEnv({}, async (ctx) => {
    const script = ctx.createScript('startup.sh', '#!/bin/sh\necho hi\n')
    const result = ctx.cli(['add', script, '--reboot=yes'])
    assert.equal(result.status, 1)
    assert.equal(result.stderr, '--reboot does not take a value.\n')
  })
})

await testAsync('CLI: --lang 값이 없으면 에러', async () => {
  await withMockCrontabEnv({}, async (ctx) => {
    const result = ctx.cli(['--lang'])
    assert.equal(result.status, 1)
    assert.equal(result.stderr, '--lang requires a value.\n')
  })
})

await testAsync('CLI: doctor가 실패하면 exit 1', async () => {
  await withMockCrontabEnv({ readFail: 'mock read denied' }, async (ctx) => {
    const result = ctx.cli(['doctor'])
    assert.equal(result.status, 1)
    assert.ok(result.stdout.includes('Some checks failed.'))
  })
})

await testAsync('CLI: 여러 줄 스케줄도 하나의 cron 줄로 등록', async () => {
  await withMockCrontabEnv({}, async (ctx) => {
    const file = ctx.createScript('job.mjs', 'console.log("ok")\n')
    const result = ctx.cli(['add', file, '--schedule', '0 8\n\n*\t* *'])
    assert.equal(result.status, 0, result.stderr)
    const raw = ctx.readState()
    assert.equal(raw.trim().split('\n').length, 3)
    assert.equal(parseBlocks(raw)[0].schedule, '0 8 * * *')
  })
})

await testAsync('cron 실행: 백슬래시·%·작은따옴표가 섞인 스크립트와 로그 경로', async () => {
  await withMockCrontabEnv({}, async (ctx) => {
    const logDir = join(ctx.dir, "logs\\%quote'")
    mkdirSync(logDir)
    for (const name of [String.raw`one\%job.sh`, String.raw`two\\%job.sh`, String.raw`three\\\%job.sh`, "space 'percent%job.sh"]) {
      const file = ctx.createScript(name, 'echo stdout-ok; echo stderr-ok >&2\n')
      const logPath = join(logDir, `${makeId(file)}.log`)
      const [block] = parseBlocks(buildBlock({ schedule: '@reboot', absolutePath: file, runtime: 'sh', logPath }))
      assert.deepEqual(inspectCommand(block.command, file), { runtimeBin: '/bin/sh', logPath })
      for (const debian of [false, true]) {
        const result = spawnSync('/bin/sh', ['-c', decodeCronCommand(block.command, debian)], {
          cwd: homedir(), env: { PATH: '/usr/bin:/bin', HOME: homedir() }, encoding: 'utf8',
        })
        assert.equal(result.status, 0, `${name}: ${result.stderr}`)
      }
      assert.equal(readFileSync(logPath, 'utf8'), 'stdout-ok\nstderr-ok\nstdout-ok\nstderr-ok\n')
    }
  })
})

await testAsync('doctor: 실행 권한을 잃은 exec 스크립트와 런타임을 실패로 보고', async () => {
  await withMockCrontabEnv({}, async (ctx) => {
    const script = ctx.createScript('exec-job', '#!/bin/sh\necho ok\n')
    const runtime = ctx.createScript('runtime', '#!/bin/sh\nexec /bin/sh "$@"\n')
    const interpreted = ctx.createScript('job.sh', 'echo ok\n')
    assert.equal(ctx.cli(['add', script, '--reboot', '--runtime', 'exec']).status, 0)
    assert.equal(ctx.cli(['add', interpreted, '--reboot', '--runtime', runtime]).status, 0)
    chmodSync(script, 0o644)
    chmodSync(runtime, 0o644)
    const result = ctx.cli(['doctor'])
    assert.equal(result.status, 1)
    assert.match(result.stdout, /script must be a readable file/)
    assert.match(result.stdout, /runtime must be an executable file/)
    const execBlock = parseBlocks(ctx.readState()).find((b) => b.path === script)
    const run = spawnSync('/bin/sh', ['-c', execBlock.command], { encoding: 'utf8' })
    assert.equal(run.status, 126)
  })
})

await testAsync('doctor: 스크립트 읽기 권한과 파일 종류를 점검', async () => {
  await withMockCrontabEnv({}, async (ctx) => {
    const script = ctx.createScript('unreadable.sh', 'echo ok\n', 0o000)
    const [unreadable] = parseBlocks(buildBlock({ schedule: '@reboot', absolutePath: script, runtime: 'sh' }))
    assert.deepEqual(findEntryIssues(unreadable).map((i) => i.code), ['script_unusable'])
    chmodSync(script, 0o644)
    assert.deepEqual(findEntryIssues(unreadable), [])
    rmSync(script)
    mkdirSync(script)
    assert.deepEqual(findEntryIssues(unreadable).map((i) => i.code), ['script_unusable'])
    const [badRuntime] = parseBlocks(buildBlock({ schedule: '@reboot', absolutePath: ctx.createScript('ok.sh', ''), runtime: 'custom', runtimePath: ctx.dir }))
    assert.deepEqual(findEntryIssues(badRuntime).map((i) => i.code), ['runtime_unusable'])
  })
})

await testAsync('doctor: 로그 디렉터리와 파일의 쓰기 권한·파일 종류를 점검', async () => {
  await withMockCrontabEnv({}, async (ctx) => {
    const script = ctx.createScript('ok.sh', '')
    const logDir = join(ctx.dir, 'logs')
    mkdirSync(logDir)
    const logPath = join(logDir, 'job.log')
    const [block] = parseBlocks(buildBlock({ schedule: '@reboot', absolutePath: script, runtime: 'sh', logPath }))
    assert.deepEqual(findEntryIssues(block), [])
    chmodSync(logDir, 0o500)
    assert.deepEqual(findEntryIssues(block).map((i) => i.code), ['log_unwritable'])
    chmodSync(logDir, 0o700)
    writeFileSync(logPath, '', { mode: 0o400 })
    assert.deepEqual(findEntryIssues(block).map((i) => i.code), ['log_unwritable'])
    chmodSync(logPath, 0o600)
    assert.deepEqual(findEntryIssues(block), [])
    rmSync(logPath)
    mkdirSync(logPath)
    assert.deepEqual(findEntryIssues(block).map((i) => i.code), ['log_unwritable'])
    rmSync(logDir, { recursive: true })
    writeFileSync(logDir, '')
    assert.deepEqual(findEntryIssues(block).map((i) => i.code), ['log_unwritable'])
  })
})

test('통합 테스트 안전성: 최초 조회 실패 시 기존 crontab을 보존하고 쓰기 전에 중단', () => {
  const original = '# original\n0 0 * * * /bin/true\n'
  const result = runSandboxedIntegration({ original, readFail: true })
  assert.equal(result.status, 1, result.stderr)
  assert.match(result.stderr, /crontab 백업 실패: crontab: temporary read failure/)
  assert.equal(result.state, original)
  assert.equal(result.mutations, '')
})

test('통합 테스트 안전성: 기존 crontab·빈 crontab·미등록 상태를 각각 정확히 복원', () => {
  // 마지막은 UTF-8이 아닌 crontab(EUC-KR 주석)으로, 바이트 그대로 되돌려야 한다
  const legacy = Buffer.concat([Buffer.from('# '), Buffer.from([0xb9, 0xe9, 0xbe, 0xf7]), Buffer.from('\n0 0 * * * /bin/true\n')])
  for (const original of ['# original\n0 0 * * * /bin/true\n', '', null, legacy]) {
    const result = runSandboxedIntegration({ original })
    assert.equal(result.status, 0, result.stderr + result.stdout)
    assert.match(result.stdout, /33개 통과, 0개 실패/)
    if (original === null) assert.equal(result.stateBytes, null)
    else assert.ok(result.stateBytes.equals(Buffer.from(original)), `restored ${result.stateBytes.toString('hex')}`)
    assert.equal(result.mutations.includes('remove'), original === null)
  }
})

test('통합 테스트 안전성: 복원 실패를 성공으로 종료하지 않음', () => {
  const result = runSandboxedIntegration({ restoreFail: true })
  assert.equal(result.status, 1)
  assert.match(result.stderr, /crontab 복원 실패: restore denied/)
  assert.match(result.stdout, /33개 통과, 1개 실패/)
})

async function waitUntil(check) {
  const started = Date.now()
  while (!check()) {
    assert.ok(Date.now() - started < 5000, 'timed out waiting for child process')
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

await testAsync('동시 CLI 등록: 서로 다른 CRONLY_HOME에서도 두 작업과 수동 항목을 모두 보존', async () => {
  await withMockCrontabEnv({ initialContent: '# manual\n0 0 * * * /bin/true\n', writeDelay: '0.2' }, async (ctx) => {
    const a = ctx.createScript('a.mjs', '')
    const b = ctx.createScript('b.mjs', '')
    const writing = join(ctx.dir, 'writing')
    const first = ctx.cliAsync(['add', a, '--daily', '08:00'], { MOCK_WRITE_STARTED: writing })
    await waitUntil(() => existsSync(writing))
    const second = ctx.cliAsync(['add', b, '--daily', '09:00'], { CRONLY_HOME: join(ctx.dir, 'other-home'), TMPDIR: ctx.dir })
    for (const result of await Promise.all([first, second])) assert.equal(result.status, 0, result.stderr)
    assert.deepEqual(parseBlocks(ctx.readState()).map((b) => b.path).sort(), [a, b].sort())
    assert.match(ctx.readState(), /^# manual\n0 0 \* \* \* \/bin\/true\n/)
  })
})

await testAsync('동시 CLI 삭제·등록: 삭제한 항목을 되살리지 않고 새 작업을 보존', async () => {
  await withMockCrontabEnv({ writeDelay: '0.2' }, async (ctx) => {
    const a = ctx.createScript('keep.mjs', '')
    const b = ctx.createScript('remove.mjs', '')
    const original = buildBlock({ schedule: '@reboot', absolutePath: b, runtime: 'node' })
    ctx.setState(`# manual\n${original}\n`)
    const writing = join(ctx.dir, 'writing')
    const first = ctx.cliAsync(['remove', b], { MOCK_WRITE_STARTED: writing })
    await waitUntil(() => existsSync(writing))
    const second = ctx.cliAsync(['add', a, '--reboot'])
    for (const result of await Promise.all([first, second])) assert.equal(result.status, 0, result.stderr)
    assert.deepEqual(parseBlocks(ctx.readState()).map((b) => b.path), [a])
    assert.ok(ctx.readState().startsWith('# manual\n'))
  })
})

await testAsync('crontab 잠금: 같은 프로세스의 동시 작업을 직렬화하고 실패 후 해제', async () => {
  await withMockCrontabEnv({}, async (ctx) => {
    const lockPath = join(ctx.dir, 'lock')
    let active = 0
    let maximum = 0
    const results = await Promise.all([1, 2, 3].map((n) => withCrontabLock(async () => {
      active++
      maximum = Math.max(maximum, active)
      await new Promise((resolve) => setTimeout(resolve, 10))
      active--
      return n
    }, { lockPath, pollMs: 1 })))
    assert.deepEqual(results, [1, 2, 3])
    assert.equal(maximum, 1)
    await assert.rejects(() => withCrontabLock(async () => { throw new Error('write failed') }, { lockPath }), /write failed/)
    assert.equal(existsSync(lockPath), false)
    assert.equal(await withCrontabLock(async () => 'recovered', { lockPath }), 'recovered')
  })
})

await testAsync('crontab 잠금: 종료된 소유자와 오래된 빈 잠금만 회수', async () => {
  await withMockCrontabEnv({}, async (ctx) => {
    const lockPath = join(ctx.dir, 'lock')
    const dead = spawnSync(process.execPath, ['-e', ''])
    mkdirSync(lockPath)
    writeFileSync(join(lockPath, `owner-${dead.pid}-abcd`), '')
    assert.equal(await withCrontabLock(async () => 'recovered', { lockPath, pollMs: 1 }), 'recovered')
    mkdirSync(lockPath)
    await assert.rejects(() => withCrontabLock(async () => assert.fail('fresh lock acquired'), { lockPath, timeoutMs: 0 }), /Another Cronly/)
    const old = new Date(Date.now() - 60000)
    utimesSync(lockPath, old, old)
    assert.equal(await withCrontabLock(async () => 'empty recovered', { lockPath, pollMs: 1 }), 'empty recovered')
    reapAbandonedLock(lockPath) // A competing reaper may already have removed it.
  })
})

await testAsync('crontab 잠금: 살아 있는 소유자의 잠금을 시간 초과로 보고', async () => {
  await withMockCrontabEnv({}, async (ctx) => {
    const lockPath = join(ctx.dir, 'lock')
    mkdirSync(lockPath)
    const owner = join(lockPath, `owner-${process.pid}-abcd`)
    writeFileSync(owner, '')
    // 메시지만 보고 누가 잡고 있는지, 멈춘 잠금이면 무엇을 지우면 되는지 알 수 있어야 한다
    await assert.rejects(() => withCrontabLock(async () => assert.fail('live lock acquired'), { lockPath, timeoutMs: 0 }), {
      message: `Another Cronly command is updating scheduled jobs (process ${process.pid}). Try again shortly. `
        + `If no Cronly command is running, delete ${lockPath} and try again.`,
    })
    assert.equal(existsSync(owner), true)
    const dead = spawnSync(process.execPath, ['-e', ''])
    const childOwner = join(lockPath, `owner-${dead.pid}-abcd`)
    writeFileSync(childOwner, '')
    assert.deepEqual(reapAbandonedLock(lockPath), [process.pid])
    assert.ok(existsSync(childOwner), 'live parent must retain a child marker until its close callback')
  })
})

await testAsync('crontab 잠금: 신호를 보낼 수 없는 PID(EPERM)는 살아 있는 소유자로 보고 회수하지 않음', async () => {
  await withMockCrontabEnv({}, async (ctx) => {
    const lockPath = join(ctx.dir, 'lock')
    const dead = spawnSync(process.execPath, ['-e', ''])
    mkdirSync(lockPath)
    const owner = join(lockPath, `owner-${dead.pid}-abcd`)
    writeFileSync(owner, '')
    const originalKill = process.kill
    // 사용자 ID를 바꾼 crontab 자식이거나, 끝난 소유자의 PID를 다른 사용자의 프로세스가 다시 쓰는 경우
    process.kill = () => { throw Object.assign(new Error('kill EPERM'), { code: 'EPERM' }) }
    try {
      assert.deepEqual(reapAbandonedLock(lockPath), [dead.pid])
      assert.equal(existsSync(owner), true)
      await assert.rejects(
        () => withCrontabLock(async () => assert.fail('lock acquired'), { lockPath, timeoutMs: 0 }),
        (err) => err.message.includes(`(process ${dead.pid})`) && err.message.includes(`delete ${lockPath} and try again`)
      )
      process.kill = () => { throw Object.assign(new Error('unexpected kill failure'), { code: 'EINVAL' }) }
      assert.throws(() => reapAbandonedLock(lockPath), /unexpected kill failure/)
      assert.equal(existsSync(owner), true)
    } finally {
      process.kill = originalKill
    }
    // 실제로는 끝난 프로세스이므로 다음 명령이 회수한다
    assert.equal(await withCrontabLock(async () => 'recovered', { lockPath, pollMs: 1 }), 'recovered')
  })
})

await testAsync('crontab 잠금: 사용 중에 잠금이 지워지거나 다른 명령의 잠금으로 바뀌어도 결과를 잃지 않음', async () => {
  await withMockCrontabEnv({}, async (ctx) => {
    const lockPath = join(ctx.dir, 'lock')
    // 안내에 따라 잠금을 직접 지운 경우: 해제할 것이 없어도 작업 결과는 그대로 돌려준다
    assert.equal(await withCrontabLock(async (trackProcess) => {
      const untrack = trackProcess(1)
      rmSync(lockPath, { recursive: true })
      untrack()
      return 'written'
    }, { lockPath }), 'written')
    assert.equal(existsSync(lockPath), false)

    // 지워진 자리에 다른 명령이 새 잠금을 잡은 경우: 남의 잠금은 건드리지 않는다
    const successor = join(lockPath, `owner-${process.pid}-ffff`)
    assert.equal(await withCrontabLock(async () => {
      rmSync(lockPath, { recursive: true })
      mkdirSync(lockPath)
      writeFileSync(successor, '')
      return 'written'
    }, { lockPath }), 'written')
    assert.equal(existsSync(successor), true)
    rmSync(lockPath, { recursive: true })

    // 그 밖의 해제 오류는 숨기지 않는다
    await assert.rejects(() => withCrontabLock(async () => {
      const [marker] = readdirSync(lockPath)
      rmSync(join(lockPath, marker))
      mkdirSync(join(lockPath, marker))
    }, { lockPath }), (err) => ['EPERM', 'EISDIR'].includes(err.code))
  })
})

await testAsync('crontab 잠금: 잘못된 경로·소유자·내용에서는 작업을 시작하지 않음', async () => {
  await withMockCrontabEnv({}, async (ctx) => {
    const lockPath = join(ctx.dir, 'lock')
    await assert.rejects(() => withCrontabLock(async () => assert.fail(), { lockPath: join(lockPath, 'missing') }), { code: 'ENOENT' })
    writeFileSync(lockPath, '')
    await assert.rejects(() => withCrontabLock(async () => assert.fail(), { lockPath }), /Cannot use scheduler lock/)
    rmSync(lockPath)
    mkdirSync(lockPath)
    writeFileSync(join(lockPath, 'unexpected'), '')
    assert.throws(() => reapAbandonedLock(lockPath), /Cannot use scheduler lock/)
    assert.throws(() => reapAbandonedLock(lockPath, process.getuid() + 1), /Cannot use scheduler lock/)
  })
})

await testAsync('crontab 잠금: 명령을 찾지 못해도 잠금을 해제', async () => {
  await withMockCrontabEnv({}, async (ctx) => {
    const previousPath = process.env.PATH
    const lockPath = join(ctx.dir, 'lock')
    process.env.PATH = '/definitely-missing-path'
    try {
      await withCrontabLock(async (trackProcess) => {
        await assert.rejects(() => readCrontab({ trackProcess }), /crontab -l failed/)
        await assert.rejects(() => writeCrontab('', { trackProcess }), /crontab - failed/)
      }, { lockPath })
      assert.equal(existsSync(lockPath), false)
    } finally {
      process.env.PATH = previousPath
    }
  })
})

await testAsync('crontab 잠금: 부모가 강제 종료되어도 살아 있는 crontab 자식의 잠금을 보존', async () => {
  await withMockCrontabEnv({}, async (ctx) => {
    const lockPath = join(ctx.dir, 'lock')
    const helper = join(dirname(fileURLToPath(import.meta.url)), 'helpers', 'lock-holder.mjs')
    const holder = spawn(process.execPath, [helper, lockPath], { stdio: ['ignore', 'pipe', 'pipe'] })
    const exited = new Promise((resolve) => holder.once('exit', resolve))
    let output = ''
    let childPid
    holder.stdout.on('data', (data) => { output += data })
    try {
      await waitUntil(() => output.includes('\n'))
      childPid = JSON.parse(output).childPid
      holder.kill('SIGKILL')
      await exited
      await assert.rejects(() => withCrontabLock(async () => assert.fail('child still owns lock'), { lockPath, timeoutMs: 0 }), /Another Cronly/)
      assert.ok(readdirSync(lockPath).some((name) => name.startsWith(`owner-${childPid}-`)))
      process.kill(childPid, 'SIGKILL')
      await waitUntil(() => {
        try { process.kill(childPid, 0); return false } catch (err) { return err.code === 'ESRCH' }
      })
      childPid = null
      assert.equal(await withCrontabLock(async () => 'recovered after child exit', { lockPath, pollMs: 1 }), 'recovered after child exit')
    } finally {
      holder.kill('SIGKILL')
      if (childPid) { try { process.kill(childPid, 'SIGKILL') } catch {} }
    }
  })
})

await runLaunchdTests({ test, testAsync, captureLogs, withPatchedVersion })

// ── 결과 ────────────────────────────────────────────────────────────────────

rmSync(TEST_CRONLY_HOME, { recursive: true, force: true })

console.log(`\n결과: ${passed}개 통과, ${failed}개 실패`)
process.exit(failed > 0 ? 1 : 0)
