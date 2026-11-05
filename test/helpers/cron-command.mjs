// Command preprocessing from Vixie cron do_command.c; Debian cron additionally
// removes a backslash before another backslash. Run both before invoking sh.
// https://github.com/vixie/cron/blob/master/do_command.c
// https://sources.debian.org/src/cron/3.0pl1-197/do_command.c/
export function decodeCronCommand(command, collapseBackslashes = false) {
  let output = ''
  let escaped = false
  for (const ch of command) {
    output += ch
    if (escaped) {
      if (ch === '%' || (collapseBackslashes && ch === '\\')) {
        output = output.slice(0, -2) + ch
      }
      escaped = false
    } else if (ch === '\\') {
      escaped = true
    } else if (ch === '%') {
      return output.slice(0, -1)
    }
  }
  return output
}
