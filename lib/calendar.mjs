import { validateCron } from './schedule.mjs'
import { t } from './i18n.mjs'

const ALIASES = {
  '@yearly': '0 0 1 1 *', '@annually': '0 0 1 1 *', '@monthly': '0 0 1 * *',
  '@weekly': '0 0 * * 0', '@daily': '0 0 * * *', '@hourly': '0 * * * *',
}
export const FIELDS = [['Minute', 0, 59], ['Hour', 0, 23], ['Day', 1, 31], ['Month', 1, 12], ['Weekday', 0, 7]]

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

export function parseCalendar(schedule) {
  const expression = schedule.trim().toLowerCase().replace(/\s+/g, ' ')
  if (validateCron(expression)) throw new Error(t('schedule.INVALID_CRON', { detail: schedule }))
  if (expression === '@reboot') return null
  const fields = (ALIASES[expression] || expression).split(' ')
  const values = FIELDS.map(([, min, max], i) => expandField(fields[i], min, max, i === 4))
  const cronUsesAnd = fields[2].startsWith('*') || fields[4].startsWith('*')
  return { values, cronUsesAnd }
}
