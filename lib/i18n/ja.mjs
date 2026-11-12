export default {
  usage: `Cronly — スクリプトをかんたんに予約実行

使い方:
  cronly add <file> [スケジュールオプション] [--runtime node|sh|exec]
  cronly list
  cronly remove <file>
  cronly remove --id <id>
  cronly print
  cronly doctor

スケジュールオプション (1つだけ):
  --daily HH:MM              毎日指定時刻に実行
  --every-hours N            N時間ごとに実行 (1, 2, 3, 4, 6, 8, 12)
  --every-minutes N          N分ごとに実行 (1, 2, 3, 4, 5, 6, 10, 12, 15, 20, 30)
  --weekly <day> --at HH:MM  毎週特定の曜日に実行
  --days <d,...> --at HH:MM  指定曜日に実行
  --weekdays --at HH:MM     平日(月〜金)に実行
  --weekends --at HH:MM     週末(土〜日)に実行
  --reboot                   起動時に実行 (macOS: 登録・ログイン)
  --schedule "<cron>"        cron expression を直接指定

  曜日: sun, mon, tue, wed, thu, fri, sat (大文字小文字不問)
  時刻: HH:MM (24時間制、例: 09:00, 23:30)

コマンド:
  add       スクリプトを予約登録 (既存なら更新)
  list      このツールが管理するエントリ一覧を表示
  remove    ファイルパスまたは id でエントリを削除
  print     管理ジョブのスケジューラー設定を出力
  doctor    環境と登録済みエントリを点検

実行のしくみ:
  各ジョブはスクリプトのあるディレクトリで実行されます。
  出力とエラーは ~/.cronly/logs/<id>.log に追記されます (CRONLY_HOME で変更可能)。

その他のオプション:
  --runtime     ランタイムを指定: node, sh, exec (省略時は拡張子から推論し、
                .sh ファイルは #! 行に従う)
  --id          エントリ id で削除 (remove 時)
  --lang        出力言語を指定: en, ko, ja, zh
  --help, -h    このヘルプを表示
  --version, -v バージョンを表示

例:
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

  'schedule.SCHEDULE_REQUIRED': 'スケジュールを指定してください。例: --daily 09:00, --every-hours 4, --schedule "*/5 * * * *"',
  'schedule.SCHEDULE_CONFLICT': ({ detail }) => `スケジュールオプションは1つだけ使えます (${detail})`,
  'schedule.AT_REQUIRED': ({ detail }) => `${detail} には --at HH:MM が必要です。例: ${detail} --at 09:00`,
  'schedule.AT_FORBIDDEN': ({ detail }) => `${detail} に --at は使えません。`,
  'schedule.AT_ALONE': '--at は単独で使えません。--weekdays --at 09:00 のようにスケジュールオプションと組み合わせてください。',
  'schedule.INVALID_TIME': ({ detail }) => `無効な時刻形式です: ${detail} (HH:MM, 00:00–23:59)`,
  'schedule.INVALID_WEEKDAY': ({ detail }) => `認識できない曜日です: ${detail} (sun, mon, tue, wed, thu, fri, sat)`,
  'schedule.WEEKDAY_EMPTY': '曜日を1つ以上指定してください。例: --days mon,wed,fri',
  'schedule.INVALID_INTERVAL': ({ flag, value, reason, min, max }) => {
    if (reason === 'no_value') return `--${flag} には値が必要です。`
    if (reason === 'not_integer') return `--${flag} ${value}: 整数が必要です。`
    return `--${flag} ${value}: ${min}〜${max} の範囲で指定してください。`
  },
  'schedule.INTERVAL_HINT': ({ flag, value, hint }) => `--${flag} ${value} はサポートされていません。代わりに ${hint} を使ってください。`,
  'schedule.UNEVEN_INTERVAL': ({ flag, value, allowed }) => `--${flag} ${value}: cron では等間隔に繰り返せません。${allowed} のいずれかを指定するか、--schedule で直接指定してください。`,
  'schedule.INVALID_CRON': ({ detail }) => `無効な cron 式です: ${detail}`,
  'schedule.INVALID_CRON_EMPTY': '--schedule には cron 式が必要です。',
  'schedule.INVALID_CRON_FIELDS': ({ expected, actual }) => `cron 式には${expected}個のフィールドが必要ですが、${actual}個です。`,
  'schedule.INVALID_CRON_FIELD': ({ field, value }) => `cron '${field}' フィールドが無効です: ${value}`,

  'commands.add.no_file': 'ファイルパスを指定してください。',
  'commands.add.no_schedule': 'スケジュールが指定されていません。',
  'commands.add.file_not_found': ({ path }) => `ファイルが見つかりません: ${path}`,
  'commands.add.not_a_file': ({ path }) => `ファイルではありません: ${path}`,
  'commands.add.no_runtime': 'ランタイムを推論できません。--runtime を指定してください。(node|sh|exec)',
  'commands.add.invalid_runtime': ({ runtime }) => `無効なランタイムです: ${runtime}。node、sh、exec、または空白を含まないコマンド名かパスを指定してください。`,
  'commands.add.runtime_not_found': ({ runtime }) => `ランタイムが見つかりません: ${runtime}`,
  'commands.add.shebang_runtime_not_found': ({ runtime, path }) => `ランタイムが見つかりません: ${runtime} (${path} の #! 行で指定)。インストールするか、--runtime でランタイムを指定してください。`,
  'commands.add.not_executable': ({ path }) => `実行権限がありません: ${path} (--runtime exec には chmod +x が必要です)`,
  'commands.add.created': ({ path, id }) => `登録しました: ${path} (id=${id})`,
  'commands.add.updated': ({ path, id }) => `更新しました: ${path} (id=${id})`,
  'commands.add.replaced': ({ path, id }) => `  同じファイルを指していたエントリを置き換えました: ${path} (id=${id})`,
  'commands.add.log_hint': ({ path }) => `  ログ: ${path}`,

  'commands.list.empty': '管理中の crontab エントリはありません。',

  'commands.remove.no_target': '削除するファイルパスまたは --id を指定してください。',
  'commands.remove.both_targets': 'ファイルパスと --id はどちらか一方だけを指定してください。',
  'commands.remove.id_not_found': ({ id }) => `該当 id のエントリが見つかりません: ${id}`,
  'commands.remove.file_not_found': ({ path }) => `該当ファイルのエントリが見つかりません: ${path}`,
  'commands.remove.done': ({ path, id }) => `削除しました: ${path} (id=${id})`,

  'commands.print.empty': '管理中の crontab エントリはありません。',
  'crontab.waiting_permission': 'crontab の応答を待っています... macOS の許可ダイアログが表示されたら許可してください（他のウインドウの後ろに隠れている場合があります）。',
  'crontab.permission_denied': 'macOS が crontab の変更をブロックしました。許可ダイアログで許可するか、cronly を実行しているアプリにフルディスクアクセスを許可してください（システム設定 > プライバシーとセキュリティ > フルディスクアクセス）。',

  'doctor.node_warning': '  ⚠ Node.js 14.8.0 以上が必要です。',
  'doctor.crontab_found': '  crontab コマンド: あり',
  'doctor.crontab_missing': '  crontab コマンド: なし',
  'doctor.daemon_running': '  cron デーモン: 実行中',
  'doctor.daemon_missing': '  ⚠ cron デーモン: 実行されていません。cron (または crond) を起動するまでジョブは実行されません。',
  'doctor.read_ok': '  crontab 読み取り: 成功',
  'doctor.read_fail': ({ message }) => `  crontab 読み取り: 失敗 (${message})`,
  'doctor.entries': ({ count }) => `  管理中のエントリ: ${count}件`,
  'doctor.script_missing': ({ id, path }) => `  ⚠ ${id}: スクリプトが見つかりません: ${path}`,
  'doctor.runtime_missing': ({ id, path }) => `  ⚠ ${id}: ランタイムが見つかりません: ${path}`,
  'doctor.log_dir_missing': ({ id, path }) => `  ⚠ ${id}: ログディレクトリが見つかりません: ${path}`,
  'doctor.script_unusable': ({ id, path }) => `  ⚠ ${id}: スクリプトを読み取れないか、実行権限がありません: ${path}`,
  'doctor.runtime_unusable': ({ id, path }) => `  ⚠ ${id}: ランタイムを実行できません: ${path}`,
  'doctor.log_unwritable': ({ id, path }) => `  ⚠ ${id}: ログファイルまたはディレクトリに書き込めません: ${path}`,
  'doctor.duplicate': ({ id, path, other }) => `  ⚠ ${id}: 同じファイルを指すエントリ (${other}) が他にもあるため、2回実行されます: ${path}`,
  'doctor.shebang_ignored': ({ id, shebang }) => `  ${id}: スクリプトの先頭行は #!${shebang} ですが、/bin/sh で実行されます。cronly add で再登録するとその行に従います。`,
  'doctor.entries_hint': '  該当スクリプトを cronly add で再登録するか、cronly remove --id <id> で削除してください。',
  'doctor.summary_ok': 'すべての点検に合格しました。',
  'doctor.summary_fail': '一部の項目に問題があります。',

  'crontab.lock_busy': ({ path, pids }) => pids
    ? `別の Cronly コマンドが予約ジョブを変更中です (プロセス ${pids})。しばらくしてから再試行してください。そのプロセスが cronly でも crontab でもなければ、ロックが残っているだけです。${path} を削除してから再試行してください。`
    : '別の Cronly コマンドが予約ジョブを変更中です。しばらくしてから再試行してください。',
  'crontab.lock_invalid': ({ path }) => `スケジューラーロックの所有者と内容を確認してください: ${path}`,

  'entry.newline_path': 'パスに改行文字を含めることはできません。crontab に安全に記録できるパスのみサポートしています。',
  'entry.command_too_long': ({ length, max }) => `cron コマンドが長すぎます (${length} バイト、cron の上限は ${max} バイト)。スクリプトをより短いパスに移動してください。`,

  'backend.launchd_conflict': ({ path }) => `launchd に登録済みです: ${path}。CRONLY_BACKEND=launchd cronly remove で削除してから cron に登録してください。`,
  'backend.invalid': ({ backend }) => `未対応のスケジューラー: ${backend}。CRONLY_BACKEND=cron または launchd を使用してください。`,
  'launchd.empty': `管理中の launchd ジョブはありません。`,
  'launchd.schedule_and': `この日付と曜日の組み合わせは launchd で表現できません。簡略化するか CRONLY_BACKEND=cron を使用してください。`,
  'launchd.schedule_limit': ({ max }) => `日時の組み合わせが多すぎます（上限 ${max}）。範囲を絞るか CRONLY_BACKEND=cron を使用してください。`,
  'launchd.invalid_plist': ({ path }) => `Cronly LaunchAgent が不正です: ${path}`,
  'launchd.invalid_entry': ({ id, path }) => `  ⚠ ${id}: Cronly が書き出した内容と異なるため、この LaunchAgent はスキップしました: ${path}。該当スクリプトを cronly add で再登録するか、cronly remove --id ${id} で削除してください。`,
  'launchd.newer_entry': ({ id, path }) => `  ⚠ ${id}: より新しいバージョンの Cronly が書き出した LaunchAgent のため、スキップしました: ${path}。Cronly をアップグレードすると管理できます。`,
  'launchd.unreadable_entry': ({ path }) => `  ⚠ 読み取れないため、この LaunchAgent はスキップしました: ${path}。ファイルの権限を確認するか、ファイルを削除してください。`,
  'launchd.stray_entry': ({ path }) => `  ⚠ Cronly LaunchAgent の名前の形式ではないため、このファイルはスキップしました: ${path}。不要なコピーであれば削除してください。`,
  'launchd.command_failed': ({ command, message }) => `launchctl ${command} に失敗しました: ${message}`,
  'launchd.rollback_failed': ({ message, rollback }) => `${message}。元の LaunchAgent の復元にも失敗しました: ${rollback}`,
  'launchd.legacy_conflict': ({ path }) => `cron に登録済みです: ${path}。CRONLY_BACKEND=cron cronly remove で削除してから再登録してください。`,
  'launchd.legacy_hint': ({ count }) => `  以前の cron ジョブ: ${count}件。CRONLY_BACKEND=cron cronly list で確認してください。`,
  'launchd.orphan_loaded': ({ id }) => `対応する Cronly ファイルなしで LaunchAgent ${id} がロードされています。解除後に再登録してください。`,
  'launchd.session_ok': `  launchd ログインセッション: 利用可能`,
  'launchd.not_loaded': ({ id }) => `  ⚠ ${id}: LaunchAgent がロードされていません。cronly add で再登録してください。`,
  'launchd.last_failed': ({ id, code }) => `  ⚠ ${id}: 前回の実行に失敗しました（終了コード ${code}）。ログを確認してください。`,
  'launchd.check_failed': ({ message }) => `  launchd の点検に失敗しました: ${message}`,

  'errors.extra_args': ({ command, extra }) => `'${command}' コマンドに不要な引数があります: ${extra}`,
  'errors.unknown_option': ({ flags }) => `不明なオプションです: ${flags}`,
  'errors.missing_value': ({ flag }) => `${flag} には値が必要です。`,
  'errors.unexpected_value': ({ flag }) => `${flag} には値を指定できません。`,
  'errors.unknown_command': ({ command }) => `不明なコマンドです: ${command}`,
  'errors.runtime': ({ message }) => `エラーが発生しました: ${message}`,
  'errors.invalid_lang': ({ lang }) => `サポートされていない言語です: ${lang}。対応: en, ko, ja, zh`,
}
