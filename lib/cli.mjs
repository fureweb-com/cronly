/**
 * Minimal argv parser.
 * Returns { command, args: [...positional], flags: { key: value } }
 */
export function parseArgv(argv) {
  // Strip node + script path
  const raw = argv.slice(2)

  const command = raw[0] && !raw[0].startsWith('-') ? raw[0] : null
  const rest = command ? raw.slice(1) : raw

  const args = []
  const flags = {}

  for (let i = 0; i < rest.length; i++) {
    const token = rest[i]
    if (token.startsWith('--')) {
      const key = token.slice(2)
      const next = rest[i + 1]
      if (next && !next.startsWith('--')) {
        flags[key] = next
        i++
      } else {
        flags[key] = true
      }
    } else {
      args.push(token)
    }
  }

  return { command, args, flags }
}

export const USAGE = `crontab-agent — crontab 대리인 CLI

사용법:
  crontab-agent add <file> --schedule "<cron>" [--runtime node|sh|exec]
  crontab-agent list
  crontab-agent remove <file>
  crontab-agent remove --id <id>
  crontab-agent print
  crontab-agent doctor

명령어:
  add       스크립트 파일을 crontab에 등록해요 (이미 있으면 업데이트해요)
  list      이 도구가 관리하는 엔트리 목록을 보여줘요
  remove    파일 경로 또는 id로 엔트리를 삭제해요
  print     관리 중인 엔트리의 raw crontab 표현을 출력해요
  doctor    환경을 점검해요 (Node.js, crontab 명령 등)

옵션:
  --schedule  cron 표현식이에요 (add 할 때 꼭 필요해요, 따옴표로 감싸 주세요)
  --runtime   런타임을 지정해요: node, sh, exec (생략하면 확장자로 추론해요)
  --id        엔트리 id로 삭제해요 (remove 할 때)
  --help      이 도움말을 보여줘요

예시:
  crontab-agent add ./backup.sh --schedule "0 2 * * *"
  crontab-agent add ./report.mjs --schedule "*/10 * * * *" --runtime node
  crontab-agent add ./startup.sh --schedule "@reboot"
  crontab-agent list
  crontab-agent remove ./backup.sh
  crontab-agent remove --id a1b2c3d4
  crontab-agent print
  crontab-agent doctor
`
