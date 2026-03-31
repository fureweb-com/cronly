/**
 * Minimal argv parser.
 * Returns { command, args: [...positional], flags: { key: value } }
 *
 * The first non-flag positional token is the command,
 * so global flags like --lang can appear before the command.
 */
export function parseArgv(argv) {
  const raw = argv.slice(2)
  const args = []
  const flags = {}
  let command = null

  for (let i = 0; i < raw.length; i++) {
    const token = raw[i]
    if (token.startsWith('--')) {
      const key = token.slice(2)
      const next = raw[i + 1]
      if (next && !next.startsWith('-')) {
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
