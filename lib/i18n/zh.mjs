export default {
  usage: `Cronly — 轻松调度脚本

用法:
  cronly add <file> [调度选项] [--runtime node|sh|exec]
  cronly list
  cronly remove <file>
  cronly remove --id <id>
  cronly print
  cronly doctor

调度选项 (只能选一个):
  --daily HH:MM              每天在指定时间运行
  --every-hours N            每 N 小时运行 (1–23)
  --every-minutes N          每 N 分钟运行 (1–59)
  --weekly <day> --at HH:MM  每周指定星期运行
  --days <d,...> --at HH:MM  在指定星期运行
  --weekdays --at HH:MM     工作日(周一至周五)运行
  --weekends --at HH:MM     周末(周六至周日)运行
  --reboot                   开机时运行一次
  --schedule "<cron>"        直接指定 cron expression

  星期: sun, mon, tue, wed, thu, fri, sat (不区分大小写)
  时间: HH:MM (24小时制, 例: 09:00, 23:30)

命令:
  add       将脚本注册到 crontab (已存在则更新)
  list      显示本工具管理的条目列表
  remove    通过文件路径或 id 删除条目
  print     输出管理中条目的实际 crontab 块
  doctor    检查环境 (Node.js, crontab 命令等)

其他选项:
  --runtime     指定运行时: node, sh, exec (省略时从扩展名推断)
  --id          通过条目 id 删除 (用于 remove)
  --lang        指定输出语言: en, ko, ja, zh
  --help, -h    显示此帮助
  --version, -v 显示版本

示例:
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

  'schedule.SCHEDULE_REQUIRED': '请指定调度方式。示例: --daily 09:00, --every-hours 4, --schedule "*/5 * * * *"',
  'schedule.SCHEDULE_CONFLICT': ({ detail }) => `只能使用一个调度选项 (${detail})`,
  'schedule.AT_REQUIRED': ({ detail }) => `${detail} 需要 --at HH:MM。示例: ${detail} --at 09:00`,
  'schedule.AT_FORBIDDEN': ({ detail }) => `${detail} 不能与 --at 一起使用。`,
  'schedule.AT_ALONE': '--at 不能单独使用。请配合调度选项使用，例如 --weekdays --at 09:00',
  'schedule.INVALID_TIME': ({ detail }) => `无效的时间格式: ${detail} (HH:MM, 00:00–23:59)`,
  'schedule.INVALID_WEEKDAY': ({ detail }) => `无法识别的星期: ${detail} (sun, mon, tue, wed, thu, fri, sat)`,
  'schedule.WEEKDAY_EMPTY': '请至少指定一个星期。示例: --days mon,wed,fri',
  'schedule.INVALID_INTERVAL': ({ flag, value, reason, min, max }) => {
    if (reason === 'no_value') return `--${flag} 需要一个值。`
    if (reason === 'not_integer') return `--${flag} ${value}: 必须是整数。`
    return `--${flag} ${value}: 范围应为 ${min}–${max}。`
  },
  'schedule.INTERVAL_HINT': ({ flag, value, hint }) => `--${flag} ${value} 不受支持。请改用 ${hint}。`,
  'schedule.INVALID_CRON': ({ detail }) => `无效的 cron 表达式: ${detail}`,
  'schedule.INVALID_CRON_EMPTY': '--schedule 需要一个 cron 表达式。',
  'schedule.INVALID_CRON_FIELDS': ({ expected, actual }) => `cron 表达式需要 ${expected} 个字段，但输入了 ${actual} 个。`,
  'schedule.INVALID_CRON_FIELD': ({ field, value }) => `cron '${field}' 字段无效: ${value}`,

  'commands.add.no_file': '请指定文件路径。',
  'commands.add.no_schedule': '未指定调度。',
  'commands.add.file_not_found': ({ path }) => `文件不存在: ${path}`,
  'commands.add.no_runtime': '无法推断运行时。请使用 --runtime (node|sh|exec)。',
  'commands.add.created': ({ path, id }) => `已注册: ${path} (id=${id})`,
  'commands.add.updated': ({ path, id }) => `已更新: ${path} (id=${id})`,

  'commands.list.empty': '没有管理中的 crontab 条目。',

  'commands.remove.no_target': '请指定要删除的文件路径或 --id。',
  'commands.remove.id_not_found': ({ id }) => `找不到该 id 的条目: ${id}`,
  'commands.remove.file_not_found': ({ path }) => `找不到该文件的条目: ${path}`,
  'commands.remove.done': ({ path, id }) => `已删除: ${path} (id=${id})`,

  'commands.print.empty': '没有管理中的 crontab 条目。',

  'doctor.node_warning': '  ⚠ 需要 Node.js 14.8.0 或更高版本。',
  'doctor.crontab_found': '  crontab 命令: 已找到',
  'doctor.crontab_missing': '  crontab 命令: 未找到',
  'doctor.read_ok': '  crontab 读取: 成功',
  'doctor.read_fail': ({ message }) => `  crontab 读取: 失败 (${message})`,
  'doctor.entries': ({ count }) => `  管理中的条目: ${count} 个`,
  'doctor.summary_ok': '所有检查均已通过。',
  'doctor.summary_fail': '部分项目存在问题。',

  'entry.newline_path': '路径不能包含换行符。仅支持可安全写入 crontab 的路径。',

  'errors.extra_args': ({ command, extra }) => `'${command}' 命令有多余的参数: ${extra}`,
  'errors.unknown_option': ({ flags }) => `未知选项: ${flags}`,
  'errors.unknown_command': ({ command }) => `未知命令: ${command}`,
  'errors.runtime': ({ message }) => `发生错误: ${message}`,
  'errors.invalid_lang': ({ lang }) => `不支持的语言: ${lang}。支持: en, ko, ja, zh`,
}
