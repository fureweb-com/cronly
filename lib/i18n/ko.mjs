export default {
  usage: `Cronly — 스크립트를 쉽게 예약 실행해요

사용법:
  cronly add <file> [스케줄 옵션] [--runtime node|sh|exec]
  cronly list
  cronly remove <file>
  cronly remove --id <id>
  cronly print
  cronly doctor

스케줄 옵션 (하나만 사용):
  --daily HH:MM              매일 지정 시각에 실행
  --every-hours N            N시간마다 실행 (1~23)
  --every-minutes N          N분마다 실행 (1~59)
  --weekly <day> --at HH:MM  매주 특정 요일에 실행
  --days <d,...> --at HH:MM  지정 요일들에 실행
  --weekdays --at HH:MM     평일(월~금)에 실행
  --weekends --at HH:MM     주말(토~일)에 실행
  --reboot                   부팅 시 1회 실행
  --schedule "<cron>"        cron expression 직접 지정

  요일: sun, mon, tue, wed, thu, fri, sat (대소문자 무관)
  시간: HH:MM (24시간제, 예: 09:00, 23:30)

명령어:
  add       스크립트 파일을 crontab에 등록해요 (이미 있으면 업데이트해요)
  list      이 도구가 관리하는 엔트리 목록을 보여줘요
  remove    파일 경로 또는 id로 엔트리를 삭제해요
  print     관리 중인 엔트리의 실제 crontab 블록을 출력해요
  doctor    환경을 점검해요 (Node.js, crontab 명령 등)

기타 옵션:
  --runtime     런타임을 지정해요: node, sh, exec (생략하면 확장자로 추론해요)
  --id          엔트리 id로 삭제해요 (remove 할 때)
  --lang        출력 언어를 지정해요: en, ko, ja, zh
  --help, -h    이 도움말을 보여줘요
  --version, -v 버전을 표시해요

예시:
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

  'schedule.SCHEDULE_REQUIRED': '스케줄을 지정해 주세요. 예: --daily 09:00, --every-hours 4, --schedule "*/5 * * * *"',
  'schedule.SCHEDULE_CONFLICT': ({ detail }) => `스케줄 옵션은 하나만 쓸 수 있어요 (${detail})`,
  'schedule.AT_REQUIRED': ({ detail }) => `${detail}은(는) --at HH:MM 옵션이 필요해요. 예: ${detail} --at 09:00`,
  'schedule.AT_FORBIDDEN': ({ detail }) => `${detail}에는 --at 옵션을 함께 쓸 수 없어요.`,
  'schedule.AT_ALONE': '--at은 단독으로 쓸 수 없어요. --weekdays --at 09:00처럼 스케줄 옵션과 함께 써 주세요.',
  'schedule.INVALID_TIME': ({ detail }) => `올바른 시간 형식이 아니에요: ${detail} (HH:MM, 00:00~23:59)`,
  'schedule.INVALID_WEEKDAY': ({ detail }) => `인식할 수 없는 요일이에요: ${detail} (sun, mon, tue, wed, thu, fri, sat)`,
  'schedule.WEEKDAY_EMPTY': '요일을 1개 이상 지정해 주세요. 예: --days mon,wed,fri',
  'schedule.INVALID_INTERVAL': ({ flag, value, reason, min, max }) => {
    if (reason === 'no_value') return `--${flag}에 값이 필요해요.`
    if (reason === 'not_integer') return `--${flag} ${value}: 정수가 필요해요.`
    return `--${flag} ${value}: ${min}~${max} 범위여야 해요.`
  },
  'schedule.INTERVAL_HINT': ({ flag, value, hint }) => `--${flag} ${value}은(는) 지원하지 않아요. 대신 ${hint}을(를) 써 주세요.`,
  'schedule.INVALID_CRON': ({ detail }) => `유효하지 않은 cron 표현식이에요: ${detail}`,
  'schedule.INVALID_CRON_EMPTY': '--schedule에 cron 표현식이 필요해요.',
  'schedule.INVALID_CRON_FIELDS': ({ expected, actual }) => `cron 표현식은 ${expected}개 필드가 필요한데 ${actual}개예요.`,
  'schedule.INVALID_CRON_FIELD': ({ field, value }) => `cron '${field}' 필드가 올바르지 않아요: ${value}`,

  'commands.add.no_file': '파일 경로를 지정해 주세요.',
  'commands.add.no_schedule': '스케줄이 지정되지 않았어요.',
  'commands.add.file_not_found': ({ path }) => `파일이 없어요: ${path}`,
  'commands.add.no_runtime': '런타임을 추론할 수 없어요. --runtime 옵션을 써 주세요. (node|sh|exec)',
  'commands.add.created': ({ path, id }) => `등록했어요: ${path} (id=${id})`,
  'commands.add.updated': ({ path, id }) => `업데이트했어요: ${path} (id=${id})`,

  'commands.list.empty': '관리 중인 crontab 엔트리가 없어요.',

  'commands.remove.no_target': '삭제할 파일 경로 또는 --id를 지정해 주세요.',
  'commands.remove.id_not_found': ({ id }) => `해당 id의 엔트리를 찾을 수 없어요: ${id}`,
  'commands.remove.file_not_found': ({ path }) => `해당 파일의 엔트리를 찾을 수 없어요: ${path}`,
  'commands.remove.done': ({ path, id }) => `삭제했어요: ${path} (id=${id})`,

  'commands.print.empty': '관리 중인 crontab 엔트리가 없어요.',

  'doctor.node_warning': '  ⚠ Node.js 14.8.0 이상이 필요해요.',
  'doctor.crontab_found': '  crontab 명령: 있어요',
  'doctor.crontab_missing': '  crontab 명령: 없어요',
  'doctor.read_ok': '  crontab 읽기: 성공했어요',
  'doctor.read_fail': ({ message }) => `  crontab 읽기: 실패했어요 (${message})`,
  'doctor.entries': ({ count }) => `  관리 중인 엔트리: ${count}개`,
  'doctor.summary_ok': '모든 점검을 통과했어요.',
  'doctor.summary_fail': '일부 항목에 문제가 있어요.',

  'entry.newline_path': '경로에 줄바꿈 문자를 포함할 수 없어요. crontab에 안전하게 기록할 수 있는 경로만 지원해요.',

  'errors.extra_args': ({ command, extra }) => `'${command}' 명령에 불필요한 인자가 있어요: ${extra}`,
  'errors.unknown_option': ({ flags }) => `알 수 없는 옵션이에요: ${flags}`,
  'errors.unknown_command': ({ command }) => `알 수 없는 명령어예요: ${command}`,
  'errors.runtime': ({ message }) => `오류가 났어요: ${message}`,
  'errors.invalid_lang': ({ lang }) => `지원하지 않는 언어예요: ${lang}. 지원: en, ko, ja, zh`,
}
