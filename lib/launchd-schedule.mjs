import { validateCron } from './schedule.mjs'
import { t } from './i18n.mjs'

export const MAX_CALENDAR_INTERVALS = 4096
const ALIASES = {
  '@yearly': '0 0 1 1 *', '@annually': '0 0 1 1 *', '@monthly': '0 0 1 * *',
  '@weekly': '0 0 * * 0', '@daily': '0 0 * * *', '@hourly': '0 * * * *',
}
const FIELDS = [['Minute', 0, 59], ['Hour', 0, 23], ['Day', 1, 31], ['Month', 1, 12], ['Weekday', 0, 7]]

function expandField(field, min, max, weekday) {
  const values = new Set()
  for (const part of field.split(',')) {
    const [range, step = '1'] = part.split('/')
    const [start, end] = range === '*' ? [min, max] : range.includes('-') ? range.split('-').map(Number) : [Number(range), Number(range)]
    for (let n = start; n <= end; n += Number(step)) values.add(weekday && n === 7 ? 0 : n)
  }
  const result = [...values].sort((a, b) => a - b)
  return result.length === (weekday ? 7 : max - min + 1) ? null : result
}

/** Translate cron's calendar semantics, never approximate an unsupported rule. */
export function compileLaunchdSchedule(schedule) {
  const expression = schedule.trim().toLowerCase().replace(/\s+/g, ' ')
  if (validateCron(expression)) throw new Error(t('schedule.INVALID_CRON', { detail: schedule }))
  if (expression === '@reboot') return { runAtLoad: true }
  const fields = (ALIASES[expression] || expression).split(' ')
  const values = FIELDS.map(([, min, max], i) => expandField(fields[i], min, max, i === 4))
  const [minute, hour, day, month, weekday] = values
  // launchd treats Day + Weekday as OR. Cron uses AND if either field starts
  // with *, including stepped wildcards; reject the nontrivial AND case.
  const cronUsesAnd = fields[2].startsWith('*') || fields[4].startsWith('*')
  if (cronUsesAnd && day && weekday) throw new Error(t('launchd.schedule_and'))
  const clauses = !cronUsesAnd && day && weekday
    ? [[minute, hour, day, month, null], [minute, hour, null, month, weekday]]
    : [values]
  // Full-range fields can be omitted, but a full day range in an OR expression
  // makes the day condition unconditional, including when written as 1-31.
  if (!cronUsesAnd && (!day || !weekday)) clauses.splice(0, clauses.length, [minute, hour, null, month, null])
  const unique = new Map()
  for (const clause of clauses) {
    let combinations = [{}]
    for (let i = 0; i < FIELDS.length; i++) {
      if (!clause[i]) continue
      if (combinations.length * clause[i].length > MAX_CALENDAR_INTERVALS) throw new Error(t('launchd.schedule_limit', { max: MAX_CALENDAR_INTERVALS }))
      combinations = combinations.flatMap((previous) => clause[i].map((n) => ({ ...previous, [FIELDS[i][0]]: n })))
    }
    for (const interval of combinations) unique.set(JSON.stringify(interval), interval)
    if (unique.size > MAX_CALENDAR_INTERVALS) throw new Error(t('launchd.schedule_limit', { max: MAX_CALENDAR_INTERVALS }))
  }
  return { calendar: [...unique.values()] }
}
