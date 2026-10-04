# Cronly

[![npm version](https://img.shields.io/npm/v/%40fureweb%2Fcronly?logo=npm)](https://www.npmjs.com/package/@fureweb/cronly)
[![npm downloads](https://img.shields.io/npm/dm/%40fureweb%2Fcronly?logo=npm)](https://www.npmjs.com/package/@fureweb/cronly)
[![license](https://img.shields.io/github/license/fureweb-com/cronly)](https://github.com/fureweb-com/cronly/blob/main/LICENSE)
[![tests](https://github.com/fureweb-com/cronly/actions/workflows/ci.yml/badge.svg)](https://github.com/fureweb-com/cronly/actions/workflows/ci.yml)
[![coverage](https://codecov.io/github/fureweb-com/cronly/graph/badge.svg?branch=main)](https://app.codecov.io/github/fureweb-com/cronly)
[![stars](https://img.shields.io/github/stars/fureweb-com/cronly?style=social)](https://github.com/fureweb-com/cronly/stargazers)

스크립트를 쉽게 예약 실행해요 — cron 문법을 몰라도 돼요.
매일 8시, 평일 9시, 4시간마다처럼 원하는 일정을 그대로 말하면 돼요.
필요하면 cron expression도 직접 쓸 수 있고, 내부적으로는 crontab에 안전하게 등록하고 관리해요.

[English](./README.md) | **[한국어](./README.ko.md)** | [日本語](./README.ja.md) | [中文](./README.zh.md)

## 1분 사용 예

```bash
# 매일 오전 8시에 실행
cronly add ./daily-report.mjs --daily 08:00
# 같은 뜻의 cron expression
cronly add ./daily-report.mjs --schedule "0 8 * * *"

# 평일 오전 9시에 실행
cronly add ./notify.mjs --weekdays --at 09:00
# 같은 뜻의 cron expression
cronly add ./notify.mjs --schedule "0 9 * * 1-5"

# 4시간마다 실행
cronly add ./sync.mjs --every-hours 4
# 같은 뜻의 cron expression
cronly add ./sync.mjs --schedule "0 */4 * * *"

# 매주 토요일 0시에 실행
cronly add ./weekly-cleanup.mjs --weekly sat --at 00:00
# 같은 뜻의 cron expression
cronly add ./weekly-cleanup.mjs --schedule "0 0 * * 6"

# 이 도구가 관리하는 항목 확인
cronly list
```

이런 경우에 잘 맞아요:

- `--daily`, `--weekdays`, `--every-hours` 같은 직관적인 플래그로 스크립트를 예약하고 싶을 때
- cron 문법을 외우지 않고도 일상적인 스케줄을 설정하고 싶을 때
- 복잡한 경우에는 cron expression을 직접 쓰고 싶을 때 (`--schedule "0 */6 * * 1-3"`)
- 기존 crontab의 다른 항목은 건드리고 싶지 않을 때
- 같은 파일을 다시 등록해서 스케줄만 업데이트하고 싶을 때

## 왜 필요한가?

`crontab -e`로 수동 관리하면 이런 문제가 생겨요:

- 같은 스크립트를 실수로 두 번 등록
- 어떤 항목이 어떤 스크립트인지 한눈에 파악 어려움
- 등록/수정/삭제 시 다른 cron 항목을 실수로 건드림
- 스크립트 경로 변경 시 crontab 동기화 누락

**Cronly**는 이 문제를 해결해요:

| 수동 crontab 관리 | Cronly |
|---|---|
| 중복 등록 가능 | 같은 파일이면 자동 dedupe (심볼릭 링크, 대소문자 차이 포함) |
| 다른 항목 실수로 편집 위험 | 관리 블록만 격리해서 수정 |
| 어떤 항목인지 알기 어려움 | 메타데이터 주석으로 식별 |
| 스크립트 변경 시 수동 동기화 | `add`가 upsert로 동작 |

## 특징

- 외부 npm dependency 0개 — Node.js 내장 모듈만 사용해요
- 별도 DB, 서버, daemon이 없어요 — source of truth는 실제 crontab이에요
- 관리 엔트리에 메타데이터 주석을 붙여 기존 수동 항목과 완전히 격리해요
- 공백, single quote, `%`가 포함된 경로를 안전하게 shell-quote 처리해요
- 작업은 스크립트가 있는 디렉터리에서 실행되고, 출력은 `~/.cronly/logs/<id>.log`에 남아요
- cron alias를 지원해요 (`@reboot`, `@daily`, `@weekly` 등)
- ESM 기반 (`"type": "module"`)
- Node.js >= 14.8.0

## 설치

```bash
# npm에서 설치
npm install -g @fureweb/cronly

# 설치 없이 사용
npx @fureweb/cronly

# 로컬 개발
git clone https://github.com/fureweb-com/cronly.git
cd cronly
npm link
```

전역 설치 후 실행 명령은 `cronly`예요.

## 사용법

### 스크립트 등록

```bash
# 매일 새벽 2시에 실행
cronly add ./backup.sh --daily 02:00

# 10분마다 실행
cronly add ./report.mjs --every-minutes 10

# 월, 수, 금 오전 9시에 실행
cronly add ./class.mjs --days mon,wed,fri --at 09:00

# 주말 오전 10시에 실행
cronly add ./weekend-job.mjs --weekends --at 10:00

# 부팅 시 1회 실행
cronly add ./startup.sh --reboot

# 런타임 명시
cronly add ./custom-binary --daily 08:00 --runtime exec
```

`--runtime`에는 다른 인터프리터의 이름이나 경로도 쓸 수 있어요 (예: `--runtime python3`). `add`할 때 절대 경로로 바꿔서 기록하기 때문에 cron에서도 찾을 수 있어요. 옵션은 `--daily 08:00`과 `--daily=08:00` 둘 다 쓸 수 있어요.

같은 파일을 다시 `add`하면 **추가가 아닌 업데이트**로 동작해요:

```bash
# 처음: 등록
cronly add ./backup.sh --daily 02:00

# 다시: schedule 변경 (중복 등록 아님)
cronly add ./backup.sh --daily 03:00
```

### 간편 스케줄 패턴

| 플래그 | 예시 | cron 변환 결과 |
|--------|------|---------------|
| `--daily HH:MM` | `--daily 08:00` | `0 8 * * *` |
| `--every-hours N` | `--every-hours 4` | `0 */4 * * *` |
| `--every-minutes N` | `--every-minutes 10` | `*/10 * * * *` |
| `--weekly 요일 --at HH:MM` | `--weekly mon --at 10:00` | `0 10 * * 1` |
| `--days 요일,... --at HH:MM` | `--days mon,wed,fri --at 09:00` | `0 9 * * 1,3,5` |
| `--weekdays --at HH:MM` | `--weekdays --at 08:30` | `30 8 * * 1-5` |
| `--weekends --at HH:MM` | `--weekends --at 10:00` | `0 10 * * 0,6` |
| `--reboot` | `--reboot` | `@reboot` |

요일 토큰: `sun`, `mon`, `tue`, `wed`, `thu`, `fri`, `sat` (대소문자 무관)

`--every-hours`는 1, 2, 3, 4, 6, 8, 12를, `--every-minutes`는 1, 2, 3, 4, 5, 6, 10, 12, 15, 20, 30을 받아요. cron은 `*/N`을 매일(시간) 또는 매시(분) 처음부터 다시 세기 때문에, 다른 값은 일정한 간격으로 반복되지 않아요. 그래도 필요하면 `--schedule`을 써 주세요.

### Cron expression 직접 입력 (고급)

위 패턴으로 표현하기 어려운 경우, `--schedule`로 직접 지정할 수 있어요:

```bash
# 월~수요일에 6시간마다
cronly add ./report.mjs --schedule "0 */6 * * 1-3"

# 매월 15일 오전 9시
cronly add ./monthly.mjs --schedule "0 9 15 * *"
```

### 목록 조회

```bash
cronly list
```

출력 예시:
```
  a1b2c3d4  0 2 * * *        /home/user/backup.sh      (sh)
  e5f6a7b8  */10 * * * *     /home/user/report.mjs     (node)
```

### 삭제

```bash
# 파일 경로로 삭제
cronly remove ./backup.sh

# id로 삭제
cronly remove --id a1b2c3d4
```

### Raw 출력

```bash
cronly print
```

관리 중인 엔트리의 실제 crontab 블록을 출력해요.

### 환경 점검

```bash
cronly doctor
```

Node.js 버전, `crontab` 명령, crontab 읽기 권한, 관리 중인 각 엔트리의 스크립트·런타임·로그 디렉터리가 아직 있는지, 같은 파일이 두 번 등록되지 않았는지 점검해요. 하나라도 실패하면 종료 코드 1로 끝나요.

### macOS 권한 창

macOS에서는 전체 디스크 접근 권한이 없는 앱이 crontab을 바꾸면 권한 창이 뜨고, `cronly add`와 `cronly remove`는 그 창에 응답할 때까지 기다려요. 권한 창이 다른 창 뒤에 가려질 수 있어서, 몇 초 넘게 걸리면 안내 문구를 출력해요. 권한 창 없이 쓰려면 Cronly를 실행하는 앱에 전체 디스크 접근 권한을 주세요 (시스템 설정 > 개인정보 보호 및 보안 > 전체 디스크 접근 권한).

## 예약 작업이 실행되는 방식

cron은 최소한의 환경으로 작업을 실행해서, 터미널에서는 잘 되던 스크립트가 cron에서는 조용히 실패하기 쉬워요. Cronly는 직접 실행할 때와 비슷하게 동작하도록 각 작업을 설정해요.

- **작업 디렉터리**: 스크립트가 있는 디렉터리에서 실행해요. 그래서 `.env`나 `./config.json` 같은 상대 경로가 그대로 동작해요.
- **PATH**: `cronly add`를 실행한 Node.js의 디렉터리를 맨 앞에 두고 `/usr/bin:/bin`을 붙여요. 셸 스크립트 안에서 `node`, `npm`, `npx`를 부를 수 있어요. 다른 도구는 절대 경로로 부르거나 스크립트에서 `PATH`를 지정해 주세요.
- **로그**: stdout과 stderr를 `~/.cronly/logs/<id>.log`에 이어서 기록해요. `CRONLY_HOME`으로 기준 디렉터리를 바꿀 수 있어요. 로그 로테이션은 하지 않아요.
- **Node.js 버전**: 작업은 등록할 때 쓴 Node.js 실행 파일 그대로 실행돼요 (예: nvm의 버전별 디렉터리). 그 버전을 지우면 `cronly doctor`가 알려 주니, `cronly add`를 다시 실행해서 현재 버전으로 바꿔 주세요.

예전 버전의 Cronly로 등록한 엔트리는 `cronly add`를 다시 실행하기 전까지 이전 명령 형태를 유지해요.

## 중복 등록 방지 방식

1. 스크립트 파일의 **절대 경로**를 정규화 (`path.resolve`)
2. 절대 경로의 **SHA-256 해시 앞 8자**를 dedupe id로 사용
3. `add` 시 같은 id의 블록과, 같은 파일을 가리키는 블록(같은 inode — 심볼릭 링크나 macOS의 대소문자 차이 등)을 **교체** (upsert)
4. 없으면 **추가**

cron은 `add`에 넘긴 경로를 그대로 실행해서, `current -> releases/v2` 같은 심볼릭 링크 배포 구조에서도 계속 링크를 따라가요. `remove <file>`은 그 파일의 엔트리를 모두 삭제해요.

### crontab 내부 형태

```crontab
# 기존 수동 항목 (건드리지 않음)
0 * * * * /usr/bin/some-other-job

# [cronly:begin] id=a1b2c3d4 path=/home/user/backup.sh runtime=sh
0 2 * * * cd '/home/user' && PATH='/usr/local/bin:/usr/bin:/bin' '/bin/sh' '/home/user/backup.sh' >> '/home/user/.cronly/logs/a1b2c3d4.log' 2>&1
# [cronly:end] id=a1b2c3d4
```

`# [cronly:begin]` / `# [cronly:end]` 블록으로 감싸서 다른 수동 항목과 완전히 격리해요.

## 테스트

```bash
npm test
```

## 프로젝트 구조

```
├── bin/cronly.mjs             # CLI 진입점
├── lib/
│   ├── cli.mjs                # argv 파싱
│   ├── commands.mjs           # add/list/remove/print/doctor 구현
│   ├── crontab.mjs            # crontab 읽기/쓰기 (child_process)
│   ├── entry.mjs              # 엔트리 빌드/파싱/dedupe
│   ├── schedule.mjs           # 스케줄 플래그 → cron 표현식 변환
│   ├── i18n.mjs               # 언어 감지, 메시지 조회
│   └── i18n/                  # 메시지와 도움말 (en, ko, ja, zh)
├── test/
│   ├── test.mjs               # 단위 테스트
│   └── integration.mjs        # 통합 테스트 (실제 crontab)
├── package.json
└── LICENSE
```

## 향후 확장 포인트

- **dry-run 모드**: `--dry-run` 플래그로 실제 crontab 수정 없이 미리보기
- **import/export**: 관리 엔트리를 JSON으로 백업/복원
- **로그 옵션**: 로그 경로 지정, 로그 로테이션
- **환경 변수 주입**: cron 실행 시 사용자 지정 환경 변수 설정
- **MAILTO 설정**: 엔트리별 에러 알림 이메일 설정
- **그룹/태그**: 엔트리를 그룹으로 묶어서 일괄 관리
- **overlap 방지**: flock 기반 동시 실행 방지 래핑

## 제약 사항

- user crontab만 지원해요 (`crontab -l` / `crontab -`)
- systemd timer, `/etc/cron.d`는 지원하지 않아요
- 분산 환경은 지원하지 않아요 (단일 머신 전제예요)
- overlap execution 방지는 포함하지 않아요
- 로그는 로테이션 없이 계속 쌓여요
- 999바이트를 넘는 cron 명령은 거부해요 (Vixie 계열 cron이 잘라 버리기 때문이에요)
- 줄바꿈 또는 carriage return 문자가 포함된 경로는 지원하지 않아요

## 라이선스

MIT
