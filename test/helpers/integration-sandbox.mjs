import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { spawnSync } from 'child_process'

export function runSandboxedIntegration({ original = '# manual\n0 0 * * * /bin/true\n', readFail = false, restoreFail = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'cronly-safety-'))
  const bin = join(dir, 'bin')
  mkdirSync(bin)
  const state = join(dir, 'state')
  const mutations = join(dir, 'mutations')
  const backup = join(dir, 'backup')
  writeFileSync(backup, original || '')
  if (original !== null) writeFileSync(state, original)
  writeFileSync(join(bin, 'crontab'), `#!/bin/sh
if [ "$1" = "-l" ]; then
  if [ "$SAFETY_READ_FAIL" = "1" ] && [ ! -f "$SAFETY_DIR/read-once" ]; then
    touch "$SAFETY_DIR/read-once"
    echo "crontab: temporary read failure" >&2
    exit 1
  fi
  if [ -f "$SAFETY_DIR/state" ]; then cat "$SAFETY_DIR/state"; else echo "no crontab for test" >&2; exit 1; fi
elif [ "$1" = "-" ]; then
  cat > "$SAFETY_DIR/input"
  if [ "$SAFETY_RESTORE_FAIL" = "1" ] && [ -f "$SAFETY_DIR/mutations" ] && cmp -s "$SAFETY_DIR/input" "$SAFETY_DIR/backup"; then
    echo "restore denied" >&2
    exit 1
  fi
  mv "$SAFETY_DIR/input" "$SAFETY_DIR/state"
  echo write >> "$SAFETY_DIR/mutations"
elif [ "$1" = "-r" ]; then
  rm -f "$SAFETY_DIR/state"
  echo remove >> "$SAFETY_DIR/mutations"
else exit 1; fi
`, { mode: 0o755 })
  try {
    const integration = join(dirname(fileURLToPath(import.meta.url)), '..', 'integration.mjs')
    const result = spawnSync(process.execPath, [integration], {
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, SAFETY_DIR: dir,
        SAFETY_READ_FAIL: readFail ? '1' : '', SAFETY_RESTORE_FAIL: restoreFail ? '1' : '' },
      encoding: 'utf8', timeout: 30000,
    })
    return { ...result, state: existsSync(state) ? readFileSync(state, 'utf8') : null,
      mutations: existsSync(mutations) ? readFileSync(mutations, 'utf8') : '' }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}
