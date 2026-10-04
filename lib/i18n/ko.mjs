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
  --every-hours N            N시간마다 실행 (1, 2, 3, 4, 6, 8, 12)
  --every-minutes N          N분마다 실행 (1, 2, 3, 4, 5, 6, 10, 12, 15, 20, 30)
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
  doctor    환경과 등록된 엔트리를 점검해요

실행 방식:
  각 작업은 스크립트가 있는 디렉터리에서 실행돼요.
  출력과 에러는 ~/.cronly/logs/<id>.log에 쌓여요 (CRONLY_HOME으로 위치를 바꿀 수 있어요).

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
  'schedule.UNEVEN_INTERVAL': ({ flag, value, allowed }) => `--${flag} ${value}: cron으로는 일정한 간격으로 반복할 수 없어요. ${allowed} 중에서 고르거나 --schedule로 직접 지정해 주세요.`,
  'schedule.INVALID_CRON': ({ detail }) => `유효하지 않은 cron 표현식이에요: ${detail}`,
  'schedule.INVALID_CRON_EMPTY': '--schedule에 cron 표현식이 필요해요.',
  'schedule.INVALID_CRON_FIELDS': ({ expected, actual }) => `cron 표현식은 ${expected}개 필드가 필요한데 ${actual}개예요.`,
  'schedule.INVALID_CRON_FIELD': ({ field, value }) => `cron '${field}' 필드가 올바르지 않아요: ${value}`,

  'commands.add.no_file': '파일 경로를 지정해 주세요.',
  'commands.add.no_schedule': '스케줄이 지정되지 않았어요.',
  'commands.add.file_not_found': ({ path }) => `파일이 없어요: ${path}`,
  'commands.add.not_a_file': ({ path }) => `파일이 아니에요: ${path}`,
  'commands.add.no_runtime': '런타임을 추론할 수 없어요. --runtime 옵션을 써 주세요. (node|sh|exec)',
  'commands.add.invalid_runtime': ({ runtime }) => `런타임이 올바르지 않아요: ${runtime}. node, sh, exec 또는 공백 없는 명령 이름이나 경로를 써 주세요.`,
  'commands.add.runtime_not_found': ({ runtime }) => `런타임을 찾을 수 없어요: ${runtime}`,
  'commands.add.not_executable': ({ path }) => `실행 권한이 없어요: ${path} (--runtime exec는 chmod +x가 필요해요)`,
  'commands.add.created': ({ path, id }) => `등록했어요: ${path} (id=${id})`,
  'commands.add.updated': ({ path, id }) => `업데이트했어요: ${path} (id=${id})`,
  'commands.add.replaced': ({ path, id }) => `  같은 파일을 가리키던 엔트리를 대체했어요: ${path} (id=${id})`,
  'commands.add.log_hint': ({ path }) => `  로그: ${path}`,

  'commands.list.empty': '관리 중인 crontab 엔트리가 없어요.',

  'commands.remove.no_target': '삭제할 파일 경로 또는 --id를 지정해 주세요.',
  'commands.remove.id_not_found': ({ id }) => `해당 id의 엔트리를 찾을 수 없어요: ${id}`,
  'commands.remove.file_not_found': ({ path }) => `해당 파일의 엔트리를 찾을 수 없어요: ${path}`,
  'commands.remove.done': ({ path, id }) => `삭제했어요: ${path} (id=${id})`,

  'commands.print.empty': '관리 중인 crontab 엔트리가 없어요.',
  'crontab.waiting_permission': 'crontab 응답을 기다리는 중이에요... macOS 권한 창이 떴다면 허용해 주세요 (다른 창 뒤에 가려져 있을 수 있어요).',
  'crontab.permission_denied': 'macOS가 crontab 변경을 막았어요. 권한 창에서 허용하거나, cronly를 실행하는 앱에 전체 디스크 접근 권한을 주세요 (시스템 설정 > 개인정보 보호 및 보안 > 전체 디스크 접근 권한).',

  'doctor.node_warning': '  ⚠ Node.js 14.8.0 이상이 필요해요.',
  'doctor.crontab_found': '  crontab 명령: 있어요',
  'doctor.crontab_missing': '  crontab 명령: 없어요',
  'doctor.read_ok': '  crontab 읽기: 성공했어요',
  'doctor.read_fail': ({ message }) => `  crontab 읽기: 실패했어요 (${message})`,
  'doctor.entries': ({ count }) => `  관리 중인 엔트리: ${count}개`,
  'doctor.script_missing': ({ id, path }) => `  ⚠ ${id}: 스크립트가 없어요: ${path}`,
  'doctor.runtime_missing': ({ id, path }) => `  ⚠ ${id}: 런타임이 없어요: ${path}`,
  'doctor.log_dir_missing': ({ id, path }) => `  ⚠ ${id}: 로그 디렉터리가 없어요: ${path}`,
  'doctor.duplicate': ({ id, path, other }) => `  ⚠ ${id}: 같은 파일을 가리키는 엔트리(${other})가 또 있어서 두 번 실행돼요: ${path}`,
  'doctor.entries_hint': '  해당 스크립트를 cronly add로 다시 등록하거나 cronly remove --id <id>로 삭제해 주세요.',
  'doctor.summary_ok': '모든 점검을 통과했어요.',
  'doctor.summary_fail': '일부 항목에 문제가 있어요.',

  'entry.newline_path': '경로에 줄바꿈 문자를 포함할 수 없어요. crontab에 안전하게 기록할 수 있는 경로만 지원해요.',
  'entry.command_too_long': ({ length, max }) => `cron 명령이 너무 길어요 (${length}바이트, cron 허용치 ${max}바이트). 스크립트를 더 짧은 경로로 옮겨 주세요.`,

  'errors.extra_args': ({ command, extra }) => `'${command}' 명령에 불필요한 인자가 있어요: ${extra}`,
  'errors.unknown_option': ({ flags }) => `알 수 없는 옵션이에요: ${flags}`,
  'errors.missing_value': ({ flag }) => `${flag}에 값이 필요해요.`,
  'errors.unexpected_value': ({ flag }) => `${flag}에는 값을 붙일 수 없어요.`,
  'errors.unknown_command': ({ command }) => `알 수 없는 명령어예요: ${command}`,
  'errors.runtime': ({ message }) => `오류가 났어요: ${message}`,
  'errors.invalid_lang': ({ lang }) => `지원하지 않는 언어예요: ${lang}. 지원: en, ko, ja, zh`,
}
