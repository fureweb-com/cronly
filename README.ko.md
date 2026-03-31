# crontab-agent

`crontab -e`를 직접 열지 않고 스크립트를 cron 일정에 올리는 도구예요.
파일 하나를 등록하고, 지금 뭐가 등록되어 있는지 확인하고, 나중에 필요 없으면 다시 지울 수 있어요.

[English](./README.md) | **[한국어](./README.ko.md)** | [日本語](./README.ja.md) | [中文](./README.zh.md)

## 1분 사용 예

```bash
# 이 스크립트를 10분마다 실행
crontab-agent add ./report.mjs --schedule "*/10 * * * *"

# 이 도구가 관리하는 항목 확인
crontab-agent list

# 나중에 제거
crontab-agent remove ./report.mjs
```

이런 경우에 잘 맞아요:

- Node.js 스크립트나 셸 스크립트를 cron으로 돌리고 싶을 때
- 기존 crontab의 다른 항목은 건드리고 싶지 않을 때
- 같은 파일을 다시 등록해서 스케줄만 업데이트하고 싶을 때

## 왜 필요한가?

`crontab -e`로 수동 관리하면 이런 문제가 생겨요:

- 같은 스크립트를 실수로 두 번 등록
- 어떤 항목이 어떤 스크립트인지 한눈에 파악 어려움
- 등록/수정/삭제 시 다른 cron 항목을 실수로 건드림
- 스크립트 경로 변경 시 crontab 동기화 누락

**crontab-agent**는 이 문제를 해결해요:

| 수동 crontab 관리 | crontab-agent |
|---|---|
| 중복 등록 가능 | path 기준 자동 dedupe |
| 다른 항목 실수로 편집 위험 | 관리 블록만 격리해서 수정 |
| 어떤 항목인지 알기 어려움 | 메타데이터 주석으로 식별 |
| 스크립트 변경 시 수동 동기화 | `add`가 upsert로 동작 |

## 특징

- 외부 npm dependency 0개 — Node.js 내장 모듈만 사용해요
- 별도 DB, 서버, daemon이 없어요 — source of truth는 실제 crontab이에요
- 관리 엔트리에 메타데이터 주석을 붙여 기존 수동 항목과 완전히 격리해요
- 공백, single quote, `%`가 포함된 경로를 안전하게 shell-quote 처리해요
- cron alias를 지원해요 (`@reboot`, `@daily`, `@weekly` 등)
- ESM 기반 (`"type": "module"`)
- Node.js >= 14.8.0

## 설치

```bash
# npm에서 설치
npm install -g crontab-agent

# 설치 없이 사용
npx crontab-agent

# 로컬 개발
git clone https://github.com/fureweb/crontab-agent.git
cd crontab-agent
npm link
```

## 사용법

### 스크립트 등록

```bash
# .sh 파일 → 런타임 자동 추론 (sh)
crontab-agent add ./backup.sh --schedule "0 2 * * *"

# .mjs 파일 → 런타임 자동 추론 (node)
crontab-agent add ./report.mjs --schedule "*/10 * * * *"

# 런타임 명시
crontab-agent add ./custom-binary --schedule "0 * * * *" --runtime exec

# cron alias
crontab-agent add ./startup.sh --schedule "@reboot"
```

같은 파일을 다시 `add`하면 **추가가 아닌 업데이트**로 동작해요:

```bash
# 처음: 등록
crontab-agent add ./backup.sh --schedule "0 2 * * *"

# 다시: schedule 변경 (중복 등록 아님)
crontab-agent add ./backup.sh --schedule "0 3 * * *"
```

### 목록 조회

```bash
crontab-agent list
```

출력 예시:
```
  a1b2c3d4  0 2 * * *        /home/user/backup.sh      (sh)
  e5f6a7b8  */10 * * * *     /home/user/report.mjs     (node)
```

### 삭제

```bash
# 파일 경로로 삭제
crontab-agent remove ./backup.sh

# id로 삭제
crontab-agent remove --id a1b2c3d4
```

### Raw 출력

```bash
crontab-agent print
```

관리 중인 엔트리의 실제 crontab 블록을 출력해요.

### 환경 점검

```bash
crontab-agent doctor
```

Node.js 버전, `crontab` 명령 존재 여부, crontab 읽기 가능 여부를 점검해요.

## 중복 등록 방지 방식

1. 스크립트 파일의 **절대 경로**를 정규화 (`path.resolve`)
2. 절대 경로의 **SHA-256 해시 앞 8자**를 dedupe id로 사용
3. `add` 시 기존 crontab에서 같은 id의 블록이 있으면 **교체** (upsert)
4. 없으면 **추가**

### crontab 내부 형태

```crontab
# 기존 수동 항목 (건드리지 않음)
0 * * * * /usr/bin/some-other-job

# [crontab-agent:begin] id=a1b2c3d4 path=/home/user/backup.sh runtime=sh
0 2 * * * '/bin/sh' '/home/user/backup.sh'
# [crontab-agent:end] id=a1b2c3d4
```

`# [crontab-agent:begin]` / `# [crontab-agent:end]` 블록으로 감싸서 다른 수동 항목과 완전히 격리해요.

## 테스트

```bash
npm test
```

## 프로젝트 구조

```
├── bin/crontab-agent.mjs      # CLI 진입점
├── lib/
│   ├── cli.mjs                # argv 파싱, 도움말
│   ├── commands.mjs           # add/list/remove/print/doctor 구현
│   ├── crontab.mjs            # crontab 읽기/쓰기 (child_process)
│   └── entry.mjs              # 엔트리 빌드/파싱/dedupe
├── test/
│   ├── test.mjs               # 단위 테스트
│   └── integration.mjs        # 통합 테스트 (실제 crontab)
├── package.json
└── LICENSE
```

## 향후 확장 포인트

- **dry-run 모드**: `--dry-run` 플래그로 실제 crontab 수정 없이 미리보기
- **import/export**: 관리 엔트리를 JSON으로 백업/복원
- **로그 경로 자동 설정**: `>> /path/to/log 2>&1` 자동 추가 옵션
- **환경 변수 주입**: cron 실행 시 PATH 등 환경 변수 설정
- **MAILTO 설정**: 엔트리별 에러 알림 이메일 설정
- **그룹/태그**: 엔트리를 그룹으로 묶어서 일괄 관리
- **cron 표현식 검증**: schedule 값의 유효성 사전 검사
- **overlap 방지**: flock 기반 동시 실행 방지 래핑

## 제약 사항

- user crontab만 지원해요 (`crontab -l` / `crontab -`)
- systemd timer, `/etc/cron.d`는 지원하지 않아요
- 분산 환경은 지원하지 않아요 (단일 머신 전제예요)
- overlap execution 방지는 포함하지 않아요
- 줄바꿈 또는 carriage return 문자가 포함된 경로는 지원하지 않아요

## 라이선스

MIT
