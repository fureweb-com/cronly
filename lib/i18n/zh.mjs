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
  --every-hours N            每 N 小时运行 (1, 2, 3, 4, 6, 8, 12)
  --every-minutes N          每 N 分钟运行 (1, 2, 3, 4, 5, 6, 10, 12, 15, 20, 30)
  --weekly <day> --at HH:MM  每周指定星期运行
  --days <d,...> --at HH:MM  在指定星期运行
  --weekdays --at HH:MM     工作日(周一至周五)运行
  --weekends --at HH:MM     周末(周六至周日)运行
  --reboot                   启动时执行 (macOS：注册・登录)
  --schedule "<cron>"        直接指定 cron expression

  星期: sun, mon, tue, wed, thu, fri, sat (不区分大小写)
  时间: HH:MM (24小时制, 例: 09:00, 23:30)

命令:
  add       注册脚本执行计划 (已存在则更新)
  list      显示本工具管理的条目列表
  remove    通过文件路径或 id 删除条目
  print     输出受管理任务的调度器配置
  doctor    检查环境和已注册的条目

运行方式:
  每个任务都在脚本所在的目录中运行。
  输出和错误会追加到 ~/.cronly/logs/<id>.log (可用 CRONLY_HOME 更改位置)。

其他选项:
  --runtime     指定运行时: node, sh, exec (省略时从扩展名推断，
                .sh 文件则按 #! 行决定)
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
  'schedule.UNEVEN_INTERVAL': ({ flag, value, allowed }) => `--${flag} ${value}: cron 无法按固定间隔重复执行。请从 ${allowed} 中选择，或使用 --schedule 直接指定。`,
  'schedule.INVALID_CRON': ({ detail }) => `无效的 cron 表达式: ${detail}`,
  'schedule.INVALID_CRON_EMPTY': '--schedule 需要一个 cron 表达式。',
  'schedule.INVALID_CRON_FIELDS': ({ expected, actual }) => `cron 表达式需要 ${expected} 个字段，但输入了 ${actual} 个。`,
  'schedule.INVALID_CRON_FIELD': ({ field, value }) => `cron '${field}' 字段无效: ${value}`,

  'commands.add.no_file': '请指定文件路径。',
  'commands.add.no_schedule': '未指定调度。',
  'commands.add.file_not_found': ({ path }) => `文件不存在: ${path}`,
  'commands.add.not_a_file': ({ path }) => `不是文件: ${path}`,
  'commands.add.no_runtime': '无法推断运行时。请使用 --runtime (node|sh|exec)。',
  'commands.add.invalid_runtime': ({ runtime }) => `无效的运行时: ${runtime}。请使用 node、sh、exec，或不含空格的命令名或路径。`,
  'commands.add.runtime_not_found': ({ runtime }) => `找不到运行时: ${runtime}`,
  'commands.add.shebang_runtime_not_found': ({ runtime, path }) => `找不到运行时: ${runtime} (由 ${path} 的 #! 行指定)。请安装它，或用 --runtime 指定运行时。`,
  'commands.add.not_executable': ({ path }) => `没有执行权限: ${path} (--runtime exec 需要 chmod +x)`,
  'commands.add.created': ({ path, id }) => `已注册: ${path} (id=${id})`,
  'commands.add.updated': ({ path, id }) => `已更新: ${path} (id=${id})`,
  'commands.add.replaced': ({ path, id }) => `  已替换指向同一文件的条目: ${path} (id=${id})`,
  'commands.add.log_hint': ({ path }) => `  日志: ${path}`,

  'commands.list.empty': '没有管理中的 crontab 条目。',

  'commands.remove.no_target': '请指定要删除的文件路径或 --id。',
  'commands.remove.id_not_found': ({ id }) => `找不到该 id 的条目: ${id}`,
  'commands.remove.file_not_found': ({ path }) => `找不到该文件的条目: ${path}`,
  'commands.remove.done': ({ path, id }) => `已删除: ${path} (id=${id})`,

  'commands.print.empty': '没有管理中的 crontab 条目。',
  'crontab.waiting_permission': '正在等待 crontab 响应... 如果 macOS 弹出权限对话框，请点击允许（它可能被其他窗口遮挡）。',
  'crontab.permission_denied': 'macOS 阻止了对 crontab 的修改。请在权限对话框中允许，或为运行 cronly 的应用授予完全磁盘访问权限（系统设置 > 隐私与安全性 > 完全磁盘访问权限）。',

  'doctor.node_warning': '  ⚠ 需要 Node.js 14.8.0 或更高版本。',
  'doctor.crontab_found': '  crontab 命令: 已找到',
  'doctor.crontab_missing': '  crontab 命令: 未找到',
  'doctor.read_ok': '  crontab 读取: 成功',
  'doctor.read_fail': ({ message }) => `  crontab 读取: 失败 (${message})`,
  'doctor.entries': ({ count }) => `  管理中的条目: ${count} 个`,
  'doctor.script_missing': ({ id, path }) => `  ⚠ ${id}: 找不到脚本: ${path}`,
  'doctor.runtime_missing': ({ id, path }) => `  ⚠ ${id}: 找不到运行时: ${path}`,
  'doctor.log_dir_missing': ({ id, path }) => `  ⚠ ${id}: 找不到日志目录: ${path}`,
  'doctor.script_unusable': ({ id, path }) => `  ⚠ ${id}: 无法读取脚本或没有执行权限: ${path}`,
  'doctor.runtime_unusable': ({ id, path }) => `  ⚠ ${id}: 无法执行运行时文件: ${path}`,
  'doctor.log_unwritable': ({ id, path }) => `  ⚠ ${id}: 无法写入日志文件或目录: ${path}`,
  'doctor.duplicate': ({ id, path, other }) => `  ⚠ ${id}: 还有指向同一文件的条目 (${other})，会运行两次: ${path}`,
  'doctor.shebang_ignored': ({ id, runtime }) => `  ${id}: 脚本的 #! 行指定了 ${runtime}，但仍以 /bin/sh 运行。请用 cronly add 重新注册以生效。`,
  'doctor.entries_hint': '  请用 cronly add 重新注册相关脚本，或用 cronly remove --id <id> 删除。',
  'doctor.summary_ok': '所有检查均已通过。',
  'doctor.summary_fail': '部分项目存在问题。',

  'crontab.lock_busy': '其他 Cronly 命令正在修改计划任务，请稍后重试。',
  'crontab.lock_invalid': ({ path }) => `请检查 调度器锁的所有者和内容: ${path}`,

  'entry.newline_path': '路径不能包含换行符。仅支持可安全写入 crontab 的路径。',
  'entry.command_too_long': ({ length, max }) => `cron 命令过长 (${length} 字节，cron 上限为 ${max} 字节)。请将脚本移到更短的路径。`,

  'backend.launchd_conflict': ({ path }) => `该任务已注册在 launchd 中：${path}。请先用 CRONLY_BACKEND=launchd cronly remove 删除后再注册到 cron。`,
  'backend.invalid': ({ backend }) => `不支持的调度器：${backend}。请使用 CRONLY_BACKEND=cron 或 launchd。`,
  'launchd.empty': `没有受管理的 launchd 任务。`,
  'launchd.schedule_and': `launchd 无法表达此日期和星期组合。请简化计划或使用 CRONLY_BACKEND=cron。`,
  'launchd.schedule_limit': ({ max }) => `日期时间组合过多（上限 ${max}）。请缩小范围或使用 CRONLY_BACKEND=cron。`,
  'launchd.invalid_plist': ({ path }) => `Cronly LaunchAgent 文件无效：${path}`,
  'launchd.command_failed': ({ command, message }) => `launchctl ${command} 失败：${message}`,
  'launchd.rollback_failed': ({ message, rollback }) => `${message}；恢复原 LaunchAgent 也失败：${rollback}`,
  'launchd.legacy_conflict': ({ path }) => `该任务仍注册在 cron 中：${path}。请先用 CRONLY_BACKEND=cron cronly remove 删除后再注册。`,
  'launchd.legacy_hint': ({ count }) => `  旧 cron 任务：${count} 个。使用 CRONLY_BACKEND=cron cronly list 查看。`,
  'launchd.orphan_loaded': ({ id }) => `LaunchAgent ${id} 已加载，但缺少匹配的 Cronly 文件。请先卸载后再注册。`,
  'launchd.session_ok': `  launchd 登录会话：可用`,
  'launchd.not_loaded': ({ id }) => `  ⚠ ${id}：LaunchAgent 未加载。请用 cronly add 重新注册。`,
  'launchd.last_failed': ({ id, code }) => `  ⚠ ${id}：上次执行失败（退出码 ${code}）。请检查任务日志。`,
  'launchd.check_failed': ({ message }) => `  launchd 检查失败：${message}`,

  'errors.extra_args': ({ command, extra }) => `'${command}' 命令有多余的参数: ${extra}`,
  'errors.unknown_option': ({ flags }) => `未知选项: ${flags}`,
  'errors.missing_value': ({ flag }) => `${flag} 需要一个值。`,
  'errors.unexpected_value': ({ flag }) => `${flag} 不接受值。`,
  'errors.unknown_command': ({ command }) => `未知命令: ${command}`,
  'errors.runtime': ({ message }) => `发生错误: ${message}`,
  'errors.invalid_lang': ({ lang }) => `不支持的语言: ${lang}。支持: en, ko, ja, zh`,
}
