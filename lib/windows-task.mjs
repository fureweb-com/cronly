import { join } from 'path'
import { parseCalendar } from './calendar.mjs'
import { t } from './i18n.mjs'

const months = 'January February March April May June July August September October November December'.split(' ')
const weekdays = 'Sunday Monday Tuesday Wednesday Thursday Friday Saturday'.split(' ')
const range = (length, start = 0) => Array.from({ length }, (_, i) => start + i)
const elements = (name, values) => values.map(value => `<${name}>${value}</${name}>`).join('')
const names = values => values.map(value => `<${value}/>`).join('')

function calendarDays(day, month, weekday, cronUsesAnd) {
  // A full range in a cron day/weekday OR makes the whole condition true.
  if (!cronUsesAnd && (!day || !weekday)) { day = null; weekday = null }
  if (day && weekday) throw new Error(t('windows.calendar_days'))
  if (!day && !month && !weekday) return '<ScheduleByDay><DaysInterval>1</DaysInterval></ScheduleByDay>'
  const selectedMonths = '<Months>' + names((month || range(12, 1)).map(m => months[m - 1])) + '</Months>'
  if (!weekday) {
    return '<ScheduleByMonth><DaysOfMonth>' + elements('Day', day || range(31, 1)) + '</DaysOfMonth>' + selectedMonths + '</ScheduleByMonth>'
  }
  const days = '<DaysOfWeek>' + names(weekday.map(d => weekdays[d])) + '</DaysOfWeek>'
  if (!month) return '<ScheduleByWeek><WeeksInterval>1</WeeksInterval>' + days + '</ScheduleByWeek>'
  return '<ScheduleByMonthDayOfWeek><Weeks>' + elements('Week', [1, 2, 3, 4, 'Last']) + '</Weeks>' + days + selectedMonths + '</ScheduleByMonthDayOfWeek>'
}

export function windowsTriggers(schedule, sid) {
  const calendar = parseCalendar(schedule)
  if (!calendar) return `<LogonTrigger><UserId>${sid}</UserId></LogonTrigger>`
  const [minute, hour, day, month, weekday] = calendar.values
  const days = calendarDays(day, month, weekday, calendar.cronUsesAnd)
  const times = (hour || range(24)).flatMap(h => (minute || range(60)).map(m => h * 60 + m))
  const triggers = []
  for (let i = 0; i < times.length;) {
    const first = times[i++]
    const step = times[i] - first
    let last = first
    while (i < times.length && times[i] - last === step) last = times[i++]
    // Keep the end between the last requested run and the next whole minute.
    const repeat = last === first ? '' : `<Repetition><Interval>PT${step}M</Interval><Duration>PT${last - first}M30S</Duration></Repetition>`
    const hh = String(Math.floor(first / 60)).padStart(2, '0')
    const mm = String(first % 60).padStart(2, '0')
    // A local boundary (without a UTC offset) follows the user's wall clock.
    triggers.push(`<CalendarTrigger>${repeat}<StartBoundary>2000-01-01T${hh}:${mm}:00</StartBoundary>${days}</CalendarTrigger>`)
  }
  if (triggers.length > 48) throw new Error(t('windows.trigger_limit'))
  return triggers.join('\n')
}

function xml(value) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// Task Scheduler does not redirect stdout/stderr. Use the already-required
// Node executable and pass the job data as a single argument. No shell parses
// user paths and the registered action survives removing an npx cache.
export const windowsRunner = [
  "const fs=require('fs'), path=require('path'), cp=require('child_process');",
  "const j=JSON.parse(Buffer.from(process.argv[1],'base64').toString('utf8'));",
  "const log=fs.openSync(j.logPath,'a');",
  "process.env.PATH=path.dirname(process.execPath)+path.delimiter+(process.env.PATH||'');",
  "const r=cp.spawnSync(j.runtimePath,j.args,{cwd:path.dirname(j.path),windowsHide:true,stdio:['ignore',log,log]});",
  "if(r.error) fs.writeSync(log,r.error.message+'\\n');",
  "fs.closeSync(log); process.exitCode=r.status===null?1:r.status;",
].join(' ')

// WScript is a GUI executable. Run waits for Node and returns its exit code.
// Expand the executable path once through a private environment variable so a
// literal %NAME% in the path is not expanded by WScript.Shell.Run.
export const windowsLauncher = [
  'var shell = new ActiveXObject("WScript.Shell");',
  'var env = shell.Environment("Process");',
  'env.Item("CRONLY_WINDOWS_NODE") = WScript.Arguments.Item(0).replace(/\\|/g, "%");',
  'var command = ' + JSON.stringify('"%CRONLY_WINDOWS_NODE%" -e "' + windowsRunner + '" -- ') + ' + WScript.Arguments.Item(1);',
  'WScript.Quit(shell.Run(command, 0, true));',
  '',
].join('\r\n')

export function scriptHostPath() {
  return join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'wscript.exe')
}

export function launcherPath() {
  return join(process.env.LOCALAPPDATA, 'Cronly', 'windows-launcher-v1.js')
}

export function windowsAction(job) {
  const payload = Buffer.from(JSON.stringify(job)).toString('base64')
  // Task Scheduler expands %variables% in arguments. A pipe is not a valid
  // Windows filename character and can stand for a literal percent in argv.
  const node = job.nodePath.replace(/%/g, '|')
  return `//B //NoLogo //E:JScript "%LOCALAPPDATA%\\Cronly\\windows-launcher-v1.js" "${node}" ${payload}`
}

export function windowsTaskXml(job, sid) {
  const user = xml(sid)
  return [
    '<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">',
    '<RegistrationInfo><Source>Cronly/v1</Source><Description>' + xml(job.path) + '</Description><Documentation>' + xml(JSON.stringify(job)) + '</Documentation></RegistrationInfo>',
    '<Triggers>' + windowsTriggers(job.schedule, user) + '</Triggers>',
    '<Principals><Principal id="User"><UserId>' + user + '</UserId><LogonType>InteractiveToken</LogonType><RunLevel>LeastPrivilege</RunLevel></Principal></Principals>',
    '<Settings><MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy><DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries><StopIfGoingOnBatteries>false</StopIfGoingOnBatteries><ExecutionTimeLimit>PT0S</ExecutionTimeLimit></Settings>',
    '<Actions Context="User"><Exec><Command>' + xml(scriptHostPath()) + '</Command><Arguments>' + xml(windowsAction(job)) + '</Arguments></Exec></Actions>',
    '</Task>',
  ].join('\n')
}
