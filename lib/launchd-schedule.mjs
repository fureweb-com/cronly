import { FIELDS, parseCalendar } from './calendar.mjs'
import { t } from './i18n.mjs'

export const MAX_CALENDAR_INTERVALS = 4096

/** Translate cron's calendar semantics, never approximate an unsupported rule. */
export function compileLaunchdSchedule(schedule) {
  const parsed = parseCalendar(schedule)
  if (!parsed) return { runAtLoad: true }
  const { values, cronUsesAnd } = parsed
  const [minute, hour, day, month, weekday] = values
  // launchd treats Day + Weekday as OR. Cron uses AND if either field starts
  // with *, including stepped wildcards; reject the nontrivial AND case.
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
