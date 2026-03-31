export default {
  usage: `Cronly — Schedule scripts easily

Usage:
  cronly add <file> [schedule option] [--runtime node|sh|exec]
  cronly list
  cronly remove <file>
  cronly remove --id <id>
  cronly print
  cronly doctor

Schedule options (pick one):
  --daily HH:MM              Run at a specific time every day
  --every-hours N            Run every N hours (1–23)
  --every-minutes N          Run every N minutes (1–59)
  --weekly <day> --at HH:MM  Run on a specific weekday
  --days <d,...> --at HH:MM  Run on specific weekdays
  --weekdays --at HH:MM     Run on weekdays (Mon–Fri)
  --weekends --at HH:MM     Run on weekends (Sat–Sun)
  --reboot                   Run once at boot
  --schedule "<cron>"        Use a cron expression directly

  Weekdays: sun, mon, tue, wed, thu, fri, sat (case-insensitive)
  Time: HH:MM (24-hour, e.g. 09:00, 23:30)

Commands:
  add       Register a script to crontab (updates if already registered)
  list      Show entries managed by this tool
  remove    Remove an entry by file path or id
  print     Output the actual crontab blocks for managed entries
  doctor    Check the environment (Node.js, crontab command, etc.)

Other options:
  --runtime     Specify runtime: node, sh, exec (inferred from extension if omitted)
  --id          Remove by entry id (with remove)
  --lang        Set output language: en, ko, ja, zh
  --help, -h    Show this help
  --version, -v Show version

Examples:
  cronly add ./daily-report.mjs --daily 08:00
  cronly add ./sync.mjs --every-hours 4
  cronly add ./poll.mjs --every-minutes 10
  cronly add ./notify.mjs --weekdays --at 09:00
  cronly add ./cleanup.mjs --weekly sat --at 00:00
  cronly add ./class.mjs --days mon,wed,fri --at 09:00
  cronly add ./weekend.mjs --weekends --at 10:00
  cronly add ./startup.sh --reboot
  cronly add ./advanced.mjs --schedule "0 */6 * * 1-3"
  cronly list
  cronly remove ./daily-report.mjs
  cronly doctor
`,

  // Schedule errors
  'schedule.SCHEDULE_REQUIRED': 'Please specify a schedule. Example: --daily 09:00, --every-hours 4, --schedule "*/5 * * * *"',
  'schedule.SCHEDULE_CONFLICT': ({ detail }) => `Only one schedule option is allowed (${detail})`,
  'schedule.AT_REQUIRED': ({ detail }) => `${detail} requires --at HH:MM. Example: ${detail} --at 09:00`,
  'schedule.AT_FORBIDDEN': ({ detail }) => `${detail} cannot be used with --at.`,
  'schedule.AT_ALONE': '--at cannot be used alone. Use it with a schedule option, e.g. --weekdays --at 09:00',
  'schedule.INVALID_TIME': ({ detail }) => `Invalid time format: ${detail} (HH:MM, 00:00–23:59)`,
  'schedule.INVALID_WEEKDAY': ({ detail }) => `Unrecognized weekday: ${detail} (sun, mon, tue, wed, thu, fri, sat)`,
  'schedule.WEEKDAY_EMPTY': 'Please specify at least one weekday. Example: --days mon,wed,fri',
  'schedule.INVALID_INTERVAL': ({ flag, value, reason, min, max }) => {
    if (reason === 'no_value') return `--${flag} requires a value.`
    if (reason === 'not_integer') return `--${flag} ${value}: must be an integer.`
    return `--${flag} ${value}: out of range (${min}–${max}).`
  },
  'schedule.INTERVAL_HINT': ({ flag, value, hint }) => `--${flag} ${value} is not supported. Use ${hint} instead.`,
  'schedule.INVALID_CRON': ({ detail }) => `Invalid cron expression: ${detail}`,
  'schedule.INVALID_CRON_EMPTY': '--schedule requires a cron expression.',
  'schedule.INVALID_CRON_FIELDS': ({ expected, actual }) => `Cron expression requires ${expected} fields, got ${actual}.`,
  'schedule.INVALID_CRON_FIELD': ({ field, value }) => `Invalid cron '${field}' field: ${value}`,

  // Commands — add
  'commands.add.no_file': 'Please specify a file path.',
  'commands.add.no_schedule': 'No schedule specified.',
  'commands.add.file_not_found': ({ path }) => `File not found: ${path}`,
  'commands.add.no_runtime': 'Cannot infer runtime. Use --runtime (node|sh|exec).',
  'commands.add.created': ({ path, id }) => `Registered: ${path} (id=${id})`,
  'commands.add.updated': ({ path, id }) => `Updated: ${path} (id=${id})`,

  // Commands — list
  'commands.list.empty': 'No managed crontab entries.',

  // Commands — remove
  'commands.remove.no_target': 'Please specify a file path or --id to remove.',
  'commands.remove.id_not_found': ({ id }) => `Entry not found for id: ${id}`,
  'commands.remove.file_not_found': ({ path }) => `Entry not found for file: ${path}`,
  'commands.remove.done': ({ path, id }) => `Removed: ${path} (id=${id})`,

  // Commands — print
  'commands.print.empty': 'No managed crontab entries.',

  // Doctor
  'doctor.node_warning': '  ⚠ Node.js 14.8.0 or higher is required.',
  'doctor.crontab_found': '  crontab command: found',
  'doctor.crontab_missing': '  crontab command: not found',
  'doctor.read_ok': '  crontab read: ok',
  'doctor.read_fail': ({ message }) => `  crontab read: failed (${message})`,
  'doctor.entries': ({ count }) => `  Managed entries: ${count}`,
  'doctor.summary_ok': 'All checks passed.',
  'doctor.summary_fail': 'Some checks failed.',

  // Entry
  'entry.newline_path': 'Path cannot contain newline characters. Only paths safe for crontab are supported.',

  // Errors
  'errors.extra_args': ({ command, extra }) => `Unexpected argument for '${command}': ${extra}`,
  'errors.unknown_option': ({ flags }) => `Unknown option: ${flags}`,
  'errors.unknown_command': ({ command }) => `Unknown command: ${command}`,
  'errors.runtime': ({ message }) => `Error: ${message}`,
  'errors.invalid_lang': ({ lang }) => `Unsupported locale: ${lang}. Supported: en, ko, ja, zh`,
}
