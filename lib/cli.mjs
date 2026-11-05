/**
 * Flags that never take a value. They must not consume the next token,
 * otherwise `add --reboot ./job.sh` would swallow the file path.
 */
export const BOOLEAN_FLAGS = new Set(['reboot', 'weekdays', 'weekends', 'help', 'version'])

/**
 * Minimal argv parser.
 * Returns { command, args: [...positional], flags: { key: value } }
 *
 * The first non-flag positional token is the command,
 * so global flags like --lang can appear before the command.
 * Both `--key value` and `--key=value` are accepted. A value flag with
 * nothing after it is set to `true` so the caller can report it.
 */
export function parseArgv(argv) {
  const raw = argv.slice(2)
  const args = []
  const flags = {}
  let command = null

  for (let i = 0; i < raw.length; i++) {
    const token = raw[i]
    if (token.startsWith('--')) {
      const eq = token.indexOf('=')
      if (eq !== -1) {
        flags[token.slice(2, eq)] = token.slice(eq + 1)
        continue
      }
      const key = token.slice(2)
      const next = raw[i + 1]
      if (!BOOLEAN_FLAGS.has(key) && next !== undefined && !next.startsWith('-')) {
        flags[key] = next
        i++
      } else {
        flags[key] = true
      }
    } else if (token === '-v') {
      flags.version = true
    } else if (token === '-h') {
      flags.help = true
    } else if (!command) {
      command = token
    } else {
      args.push(token)
    }
  }

  return { command, args, flags }
}
