/**
 * Schedule resolver — translates easy-pattern flags into cron expressions.
 * Language-neutral: returns error codes, not user-facing messages.
 */

const SCHEDULE_FLAGS = [
  'schedule', 'daily', 'every-hours', 'every-minutes',
  'weekly', 'days', 'weekdays', 'weekends', 'reboot',
]

const AT_REQUIRED = new Set(['weekly', 'days', 'weekdays', 'weekends'])
const AT_FORBIDDEN = new Set(['schedule', 'daily', 'every-hours', 'every-minutes', 'reboot'])

const WEEKDAY_MAP = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 }

const CRON_ALIASES = new Set([
  '@reboot', '@yearly', '@annually', '@monthly', '@weekly', '@daily', '@hourly',
])

/**
 * Parse HH:MM (strict 2-digit:2-digit, 00:00–23:59).
 * Returns { hour, minute } or null.
 */
export function parseTime(value) {
  if (typeof value !== 'string') return null
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value)
  if (!m) return null
  return { hour: Number(m[1]), minute: Number(m[2]) }
}

/**
 * Parse a single weekday token (case-insensitive 3-letter English).
 * Returns 0–6 or null.
 */
export function parseWeekday(token) {
  if (typeof token !== 'string') return null
  const n = WEEKDAY_MAP[token.toLowerCase()]
  return n !== undefined ? n : null
}

/**
 * Parse comma-separated weekday tokens.
 * Returns { days: [sorted unique numbers] } or { error: 'bad-token' } or null (empty).
 */
export function parseWeekdays(csv) {
  if (typeof csv !== 'string') return null
  const tokens = csv.split(',').map((t) => t.trim()).filter(Boolean)
  if (tokens.length === 0) return null
  const nums = []
  for (const t of tokens) {
    const n = parseWeekday(t)
    if (n === null) return { error: t }
    nums.push(n)
  }
  return { days: [...new Set(nums)].sort((a, b) => a - b) }
}

// ── Raw cron validation ────────────────────────────────────────────────────

function validateCronField(field, min, max) {
  if (field === '*') return true
  const parts = field.split(',')
  for (const part of parts) {
    let m
    // */N
    m = /^\*\/(\d+)$/.exec(part)
    if (m) {
      const n = Number(m[1])
      if (n < 1 || n > max) return false
      continue
    }
    // N-M/S
    m = /^(\d+)-(\d+)\/(\d+)$/.exec(part)
    if (m) {
      const [a, b, s] = [Number(m[1]), Number(m[2]), Number(m[3])]
      if (a < min || b > max || a > b || s < 1) return false
      continue
    }
    // N-M
    m = /^(\d+)-(\d+)$/.exec(part)
    if (m) {
      const [a, b] = [Number(m[1]), Number(m[2])]
      if (a < min || b > max || a > b) return false
      continue
    }
    // N
    m = /^(\d+)$/.exec(part)
    if (m) {
      const n = Number(m[1])
      if (n < min || n > max) return false
      continue
    }
    return false
  }
  return true
}

/**
 * Validate a raw cron expression (5-field or alias).
 * Returns null on success, or { code, detail } on failure.
 */
const CRON_FIELD_NAMES = ['minute', 'hour', 'day', 'month', 'weekday']

export function validateCron(expr) {
  if (CRON_ALIASES.has(expr.toLowerCase())) return null
  const fields = expr.split(/\s+/)
  if (fields.length !== 5) {
    return { code: 'INVALID_CRON_FIELDS', expected: 5, actual: fields.length }
  }
  const checks = [
    { min: 0, max: 59 },
    { min: 0, max: 23 },
    { min: 1, max: 31 },
    { min: 1, max: 12 },
    { min: 0, max: 7 },
  ]
  for (let i = 0; i < 5; i++) {
    if (!validateCronField(fields[i], checks[i].min, checks[i].max)) {
      return { code: 'INVALID_CRON_FIELD', field: CRON_FIELD_NAMES[i], value: fields[i] }
    }
  }
  return null
}

// ── Main resolver ──────────────────────────────────────────────────────────

/**
 * Resolve flags into a cron expression.
 * Returns { cron } on success, or { error: { code, detail?, hint? } } on failure.
 */
export function resolveSchedule(flags) {
  const present = SCHEDULE_FLAGS.filter((f) => flags[f] !== undefined)

  if (present.length === 0 && !flags.at) {
    return { error: { code: 'SCHEDULE_REQUIRED' } }
  }
  if (present.length === 0) {
    return { error: { code: 'AT_ALONE' } }
  }
  if (present.length > 1) {
    return { error: { code: 'SCHEDULE_CONFLICT', detail: present.map((f) => `--${f}`).join(', ') } }
  }

  const selected = present[0]

  if (AT_REQUIRED.has(selected) && !flags.at) {
    return { error: { code: 'AT_REQUIRED', detail: `--${selected}` } }
  }
  if (AT_FORBIDDEN.has(selected) && flags.at) {
    return { error: { code: 'AT_FORBIDDEN', detail: `--${selected}` } }
  }

  switch (selected) {
    case 'schedule': {
      const val = flags.schedule
      if (typeof val !== 'string' || !val.trim()) {
        return { error: { code: 'INVALID_CRON_EMPTY' } }
      }
      const err = validateCron(val.trim())
      if (err) return { error: err }
      return { cron: val.trim() }
    }

    case 'daily': {
      const t = parseTime(typeof flags.daily === 'string' ? flags.daily : '')
      if (!t) return { error: { code: 'INVALID_TIME', detail: String(flags.daily) } }
      return { cron: `${t.minute} ${t.hour} * * *` }
    }

    case 'every-hours': {
      const raw = flags['every-hours']
      if (typeof raw !== 'string') {
        return { error: { code: 'INVALID_INTERVAL', flag: 'every-hours', reason: 'no_value' } }
      }
      const n = Number(raw)
      if (!Number.isInteger(n)) {
        return { error: { code: 'INVALID_INTERVAL', flag: 'every-hours', value: raw, reason: 'not_integer' } }
      }
      if (n === 24) {
        return { error: { code: 'INTERVAL_HINT', flag: 'every-hours', value: 24, hint: '--daily 00:00' } }
      }
      if (n < 1 || n > 23) {
        return { error: { code: 'INVALID_INTERVAL', flag: 'every-hours', value: n, reason: 'out_of_range', min: 1, max: 23 } }
      }
      return { cron: `0 */${n} * * *` }
    }

    case 'every-minutes': {
      const raw = flags['every-minutes']
      if (typeof raw !== 'string') {
        return { error: { code: 'INVALID_INTERVAL', flag: 'every-minutes', reason: 'no_value' } }
      }
      const n = Number(raw)
      if (!Number.isInteger(n)) {
        return { error: { code: 'INVALID_INTERVAL', flag: 'every-minutes', value: raw, reason: 'not_integer' } }
      }
      if (n === 60) {
        return { error: { code: 'INTERVAL_HINT', flag: 'every-minutes', value: 60, hint: '--every-hours 1' } }
      }
      if (n < 1 || n > 59) {
        return { error: { code: 'INVALID_INTERVAL', flag: 'every-minutes', value: n, reason: 'out_of_range', min: 1, max: 59 } }
      }
      return { cron: `*/${n} * * * *` }
    }

    case 'weekly': {
      const t = parseTime(typeof flags.at === 'string' ? flags.at : '')
      if (!t) return { error: { code: 'INVALID_TIME', detail: String(flags.at) } }
      const d = parseWeekday(typeof flags.weekly === 'string' ? flags.weekly : '')
      if (d === null) return { error: { code: 'INVALID_WEEKDAY', detail: String(flags.weekly) } }
      return { cron: `${t.minute} ${t.hour} * * ${d}` }
    }

    case 'days': {
      const t = parseTime(typeof flags.at === 'string' ? flags.at : '')
      if (!t) return { error: { code: 'INVALID_TIME', detail: String(flags.at) } }
      const result = parseWeekdays(typeof flags.days === 'string' ? flags.days : '')
      if (!result) return { error: { code: 'WEEKDAY_EMPTY' } }
      if (result.error) return { error: { code: 'INVALID_WEEKDAY', detail: result.error } }
      return { cron: `${t.minute} ${t.hour} * * ${result.days.join(',')}` }
    }

    case 'weekdays': {
      const t = parseTime(typeof flags.at === 'string' ? flags.at : '')
      if (!t) return { error: { code: 'INVALID_TIME', detail: String(flags.at) } }
      return { cron: `${t.minute} ${t.hour} * * 1-5` }
    }

    case 'weekends': {
      const t = parseTime(typeof flags.at === 'string' ? flags.at : '')
      if (!t) return { error: { code: 'INVALID_TIME', detail: String(flags.at) } }
      return { cron: `${t.minute} ${t.hour} * * 0,6` }
    }

    case 'reboot':
      return { cron: '@reboot' }
  }
}
