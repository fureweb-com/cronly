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
  --every-hours N            N時間ごとに実行 (1〜23)
  --every-minutes N          N分ごとに実行 (1〜59)
  --weekly <day> --at HH:MM  毎週特定の曜日に実行
  --days <d,...> --at HH:MM  指定曜日に実行
  --weekdays --at HH:MM     平日(月〜金)に実行
  --weekends --at HH:MM     週末(土〜日)に実行
  --reboot                   起動時に1回実行
  --schedule "<cron>"        cron expression を直接指定

  曜日: sun, mon, tue, wed, thu, fri, sat (大文字小文字不問)
  時刻: HH:MM (24時間制、例: 09:00, 23:30)

コマンド:
  add       スクリプトを crontab に登録 (既存なら更新)
  list      このツールが管理するエントリ一覧を表示
  remove    ファイルパスまたは id でエントリを削除
  print     管理中エントリの実際の crontab ブロックを出力
  doctor    環境を点検 (Node.js, crontab コマンド等)

その他のオプション:
  --runtime     ランタイムを指定: node, sh, exec (省略時は拡張子から推論)
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
  'schedule.INVALID_CRON': ({ detail }) => `無効な cron 式です: ${detail}`,
  'schedule.INVALID_CRON_EMPTY': '--schedule には cron 式が必要です。',
  'schedule.INVALID_CRON_FIELDS': ({ expected, actual }) => `cron 式には${expected}個のフィールドが必要ですが、${actual}個です。`,
  'schedule.INVALID_CRON_FIELD': ({ field, value }) => `cron '${field}' フィールドが無効です: ${value}`,

  'commands.add.no_file': 'ファイルパスを指定してください。',
  'commands.add.no_schedule': 'スケジュールが指定されていません。',
  'commands.add.file_not_found': ({ path }) => `ファイルが見つかりません: ${path}`,
  'commands.add.no_runtime': 'ランタイムを推論できません。--runtime を指定してください。(node|sh|exec)',
  'commands.add.created': ({ path, id }) => `登録しました: ${path} (id=${id})`,
  'commands.add.updated': ({ path, id }) => `更新しました: ${path} (id=${id})`,

  'commands.list.empty': '管理中の crontab エントリはありません。',

  'commands.remove.no_target': '削除するファイルパスまたは --id を指定してください。',
  'commands.remove.id_not_found': ({ id }) => `該当 id のエントリが見つかりません: ${id}`,
  'commands.remove.file_not_found': ({ path }) => `該当ファイルのエントリが見つかりません: ${path}`,
  'commands.remove.done': ({ path, id }) => `削除しました: ${path} (id=${id})`,

  'commands.print.empty': '管理中の crontab エントリはありません。',

  'doctor.node_warning': '  ⚠ Node.js 14.8.0 以上が必要です。',
  'doctor.crontab_found': '  crontab コマンド: あり',
  'doctor.crontab_missing': '  crontab コマンド: なし',
  'doctor.read_ok': '  crontab 読み取り: 成功',
  'doctor.read_fail': ({ message }) => `  crontab 読み取り: 失敗 (${message})`,
  'doctor.entries': ({ count }) => `  管理中のエントリ: ${count}件`,
  'doctor.summary_ok': 'すべての点検に合格しました。',
  'doctor.summary_fail': '一部の項目に問題があります。',

  'entry.newline_path': 'パスに改行文字を含めることはできません。crontab に安全に記録できるパスのみサポートしています。',

  'errors.extra_args': ({ command, extra }) => `'${command}' コマンドに不要な引数があります: ${extra}`,
  'errors.unknown_option': ({ flags }) => `不明なオプションです: ${flags}`,
  'errors.unknown_command': ({ command }) => `不明なコマンドです: ${command}`,
  'errors.runtime': ({ message }) => `エラーが発生しました: ${message}`,
  'errors.invalid_lang': ({ lang }) => `サポートされていない言語です: ${lang}。対応: en, ko, ja, zh`,
}
