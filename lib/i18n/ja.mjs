export default {
  usage: `Cronly — スクリプトをかんたんに予約実行

使い方:
  cronly add <file> [スケジュールオプション] [--runtime <runtime>] [--name <name>]
  cronly list
  cronly run <file> | --name <name> | --id <id>
  cronly logs (<file> | --name <name> | --id <id>) [--tail N]
  cronly remove <file>
  cronly remove --name <name>
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
  --reboot                   systemd ユーザーマネージャー起動時、macOS は登録・ログイン時、Windows は次回ログイン時
  --schedule "<cron>"        cron expression を直接指定

  曜日: sun, mon, tue, wed, thu, fri, sat (大文字小文字不問)
  時刻: HH:MM (24時間制、例: 09:00, 23:30)

コマンド:
  add       スクリプトを予約登録 (既存なら更新)
  run       登録したジョブを今すぐ実行します
  logs      登録したジョブのログを表示します
  list      このツールが管理するエントリ一覧を表示
  remove    パス、名前、ID でジョブを削除
  print     管理ジョブのスケジューラー設定を出力
  doctor    環境と登録済みエントリを点検

実行のしくみ:
  各ジョブはスクリプトのあるディレクトリで実行されます。
  出力とエラーは ~/.cronly/logs/<id>.log に追記されます (CRONLY_HOME で変更可能)。

その他のオプション:
  --tail N      ログの末尾 N 行を表示します
  --runtime     ランタイムを指定: node, sh, exec (省略時は拡張子から推論し、
                .sh ファイルは #! 行に従う)
                Windows では node、powershell、exec またはインストール済みのインタープリターを使用します。
  --name        予定に一意の名前を付けます
  --id          ID でジョブを選択
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

  'job.damaged': ({ id }) => `破損したジョブ ${id} は使用できません。`,
  'run.not_loaded': ({ id }) => `${id} は Cronly の定義から読み込まれていません。`,
  'run.requested': ({ id }) => `ジョブ ${id} の実行を要求しました。`,
  'run.cron_environment': `現在のシェル環境で直接実行します。cron による定期実行では環境変数が異なる場合があります。`,
  'run.cron_layout': `この cron コマンド形式は直接実行できません。cronly add で再登録してください。`,
  'run.signal': ({ signal }) => `ジョブはシグナル ${signal} で終了しました。`,
  'logs.unconfigured': ({ id }) => `ジョブ ${id} にログが設定されていません。`,
  'logs.invalid_tail': `--tail には 0 以上の整数で行数を指定してください。`,
  'logs.empty': ({ path }) => `ログファイルはまだありません: ${path}`,
  'job.invalid_name': `名前は文字または数字で始まる1〜64文字で、文字、数字、ピリオド、アンダースコア、ハイフンを使えます。`,
  'job.conflict': ({ id }) => `ジョブ ID ${id} は別の登録で使用中です。`,
  'job.name_used': ({ name, path }) => `ジョブ名 ${name} は ${path} で使用中です。`,
  'job.name_missing': ({ name }) => `${name} という名前のジョブはありません。`,
  'job.ambiguous': ({ ids }) => `複数のジョブが一致します。--name または --id で選択してください（${ids}）。`,
  'commands.remove.no_target': 'ファイルパス、--id または --name を指定してください。',
  'commands.remove.both_targets': 'ファイルパス、--id、--name のいずれか一つを指定してください。',
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
  'backend.invalid': ({ backend }) => `未対応のスケジューラーです: ${backend}。CRONLY_BACKEND に systemd、launchd、windows、cron のいずれかを指定してください。`,
  'systemd.conflict': ({ path }) => `systemd に登録済みです: ${path}。先に CRONLY_BACKEND=systemd cronly remove で削除してください。`,
  'systemd.legacy_conflict': ({ path }) => `cron に登録済みです: ${path}。先に CRONLY_BACKEND=cron cronly remove で削除してください。`,
  'windows.calendar_days': `Windows の予定では日付と曜日のどちらか一方を指定してください。`,
  'windows.trigger_limit': `Windows のタスクあたりの上限である48個のトリガーを超えています。`,
  'windows.runtime': `.js、.mjs、.cjs、.ps1、.exe ファイルを使うか、--runtime でインストール済みのインタープリターを指定してください。`,
  'windows.failed': ({ message }) => `Windows タスク スケジューラのエラー: ${message}`,
  'windows.launcher': ({ path }) => `Windows ランチャー ${path} が見つからないか変更されています。変更されたファイルを確認して移動し、cronly add を再実行してください。`,
  'windows.invalid': ({ id, nativeName }) => `Windows タスク ${nativeName} を管理できません。タスク スケジューラで所有元、トリガー、操作、実行アカウントを確認してください。Cronly 所有のタスクは cronly remove --id ${id} で削除できます。`,
  'windows.duplicates': `同じファイルを参照する Windows タスクが複数あります。ID で重複を削除してください。`,
  'windows.empty': `管理中の Windows タスクはありません。`,
  'windows.unhealthy': ({ id, result }) => `Windows タスク ${id} が無効か、終了コード ${result} を返しました。`,

  'systemd.empty': `管理中の systemd タイマーはありません。`,
  'systemd.foreign': ({ name }) => `${name} を管理できません。systemctl --user cat ${name} でユニットと追加設定を確認してください。`,
  'systemd.unavailable': ({ detail }) => `systemd のユーザーマネージャーに接続できません。ユーザーセッションで実行するか、cron がインストール済みなら CRONLY_BACKEND=cron を指定してください。${detail}`,
  'systemd.load_failed': ({ name, state }) => `systemd が ${name} を読み込めませんでした（LoadState=${state}）。systemd 242 以降が必要です。systemctl --user status ${name} で確認してください。`,
  'systemd.linger': `Linger=no です。ログアウトするとユーザータイマーが停止します。起動時から実行するには、このアカウントで loginctl enable-linger を使ってください。`,
  'systemd.invalid': ({ id, path, timer }) => `ユニットが欠けているか変更されています。Cronly 所有のユニットは add を再実行して修復するか、remove --id ${id} で削除できます。所有元が不明な場合は ${path} と ${timer} を確認してください。`,
  'systemd.rollback': ({ message, rollback }) => `${message}。以前のタイマーの復元にも失敗しました: ${rollback}`,
  'systemd.unhealthy': ({ id, timer, enabled, result }) => `  ${id}: タイマー ${timer} (${enabled})、サービス実行結果 ${result}`,
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
