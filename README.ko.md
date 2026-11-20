# Cronly 2.0.0

[![npm version](https://img.shields.io/npm/v/%40fureweb%2Fcronly?logo=npm)](https://www.npmjs.com/package/@fureweb/cronly)
[![license](https://img.shields.io/github/license/fureweb-com/cronly)](https://github.com/fureweb-com/cronly/blob/main/LICENSE)
[![tests](https://github.com/fureweb-com/cronly/actions/workflows/ci.yml/badge.svg)](https://github.com/fureweb-com/cronly/actions/workflows/ci.yml)
[![coverage](https://codecov.io/github/fureweb-com/cronly/graph/badge.svg?branch=main)](https://app.codecov.io/github/fureweb-com/cronly)

[English](./README.md) | **한국어** | [日本語](./README.ja.md) | [中文](./README.zh.md)

Cronly는 **Linux의 systemd 사용자 타이머**, **macOS의 launchd LaunchAgent**, **Windows의 내장 작업 스케줄러**로 스크립트를 예약 실행해요. Linux에서는 systemd 사용자 관리자가 실행 중이면 Cronie나 `crontab`을 설치할 필요가 없어요. 실행에 필요한 외부 npm 패키지도 없어요.

Linux에서 이미 작업을 예약해 두었다면 [1.x cron 작업을 systemd로 옮기는 방법](#migration)을 먼저 확인해 주세요.

## 실행에 필요한 구성 요소

| 플랫폼 | 시스템 요구사항 |
| --- | --- |
| Linux | systemd 242 이상 사용자 관리자, `systemctl --user`, `/bin/sh` |
| macOS | GUI 로그인 세션, `launchctl`, 기존 작업 조회용 기본 `crontab` 명령 |
| Windows | 로그인한 사용자 세션, 작업 스케줄러 서비스, Windows PowerShell 5.1, Windows Script Host(JScript) |
| cron 선택 시(Unix) | `crontab`, 실행 중인 cron 스케줄러, `/bin/sh` |

## 설치하고 첫 작업 등록하기

Node.js 14.8.0 이상이 필요해요. 2.0.0이 npm에 배포되기 전에는 릴리스 브랜치에서 바로 설치할 수 있어요. Windows에서는 아래 명령을 명령 프롬프트에서 실행하세요. PowerShell 실행 정책이 npm의 실행 스크립트를 차단하면 `npm.cmd`, `npx.cmd`, `cronly.cmd`를 사용하세요.

```bash
npm install --global https://github.com/fureweb-com/cronly/archive/refs/heads/codex/release-2.0.0.tar.gz
cronly --version
```

출력되는 버전은 `2.0.0`이에요. 소스를 이미 내려받았다면 프로젝트 디렉터리에서 `npm pack`을 실행한 뒤 `npm install --global ./fureweb-cronly-2.0.0.tgz`로 설치할 수도 있어요. npm 배포 후에는 `npm install --global @fureweb/cronly@2.0.0`으로 설치하거나 `npx @fureweb/cronly@2.0.0 --help`로 도움말을 볼 수 있어요.

작업 파일을 보관할 빈 디렉터리에 다음 한 줄을 `report.mjs`로 저장하세요.

```js
console.log(new Date().toISOString())
```

같은 디렉터리에서 평일 오전 9시 일정을 등록하고, 지금 한 번 실행해 보세요.

```bash
cronly add ./report.mjs --name weekday-report --weekdays --at 09:00
cronly list
cronly run --name weekday-report
```

`cronly logs --name weekday-report`로 출력을 확인하세요. 첫 조회가 비어 있다면 로그 조회만 다시 실행하세요. 새 UTC 시각이 찍히면 스크립트가 실행된 거예요. 예제 일정을 끝내려면 `cronly remove --name weekday-report`를 실행하세요.

스크립트 경로가 `/home/lee/jobs/report.mjs`라면 Linux 목록에는 이렇게 표시돼요.

```text
  68b547a7  [weekday-report]  0 9 * * 1-5      /home/lee/jobs/report.mjs  (node, systemd)
```

## 이름으로 일정 관리하기

같은 스크립트에 여러 일정을 등록할 수 있어요. 이름은 대소문자를 구분하며 현재 사용자가 선택한 스케줄러 안에서 고유해요. 1~64자로, 첫 글자는 한글을 포함한 유니코드 문자나 숫자를 쓰세요. 이후에는 문자와 숫자 외에 `.`, `_`, `-`도 쓸 수 있어요.

같은 파일과 이름으로 `add`를 다시 실행하면 해당 일정을 갱신해요. 같은 파일을 가리키는 심볼릭 링크도 인식해요. 이름 없이 등록한 작업은 별도 일정이에요. `run`, `logs`, `remove`에는 경로, `--name`, `--id` 중 하나를 지정하세요. 한 경로에 일정이 여러 개라면 이름이나 ID로 선택하세요.

```sh
cronly add ./report.mjs --name weekday-report --weekdays --at 10:00
cronly add ./report.mjs --name weekend-report --weekends --at 11:00
cronly list
cronly remove --name weekend-report
```

## 스크립트와 에이전트에서 사용하기

- `add`, `run`, `logs`, `remove`에는 같은 OS 계정, 스케줄러, 작업 이름을 사용하세요. 기본 스케줄러는 OS에 따라 정해져요. 직접 선택할 때는 매번 `CRONLY_BACKEND`에 `systemd`, `launchd`, `windows`, `cron` 중 하나를 지정하세요. `cronly --lang en doctor`는 영어로 점검 결과를 출력하고, 모두 통과하면 종료 코드 0, 문제가 있으면 1을 반환해요.
- systemd, launchd, Windows에서 `run`의 종료 코드 0은 스케줄러가 실행 요청을 접수했다는 뜻이에요. 선택형 cron 백엔드에서는 등록된 작업 디렉터리·런타임·PATH·출력 설정으로 직접 실행하고, 다른 환경 변수는 호출한 셸에서 상속하며, 스크립트의 종료 코드를 반환해요. 이 환경 차이는 표준 오류로도 안내해요.
- `logs`는 이전 실행을 포함해 스크립트의 표준 출력과 오류가 담긴 로그 전체를 출력해요. `--tail 20`으로 마지막 20줄만 읽을 수 있어요. 로그 파일이 아직 없으면 표준 오류에 안내를 쓰고 종료 코드 0을 반환해요. 특정 실행의 완료를 확인하려면 제한 시간을 두고 새 시각이나 완료 문구가 기록됐는지 조회하세요. `remove` 전에 로그를 조회할 수 있고, 삭제 후에도 기존 로그 파일은 `add` 때 표시한 경로에 남아요.

<a id="migration"></a>

## Linux에서 1.x cron 작업을 systemd로 옮기기

CLI를 업그레이드해도 기존 작업은 사용자 crontab에 남아요. 옮기는 동안에는 cron을 설치하고 실행한 상태로 두세요. systemd 사용자 관리자가 없는 환경에서는 Cronly 명령에 `CRONLY_BACKEND=cron`을 지정해 계속 cron을 사용할 수 있어요.

1. 작업을 등록했던 계정에서 systemd 사용자 관리자에 연결되는지 확인하세요. 기존 Cronly 작업을 조회해 스크립트 경로, 일정, 런타임을 기록해 두세요.

   ```bash
   systemctl --user list-timers --all
   CRONLY_BACKEND=cron cronly list
   CRONLY_BACKEND=cron cronly print
   ```

2. 작업을 하나씩 옮기세요. 아래는 평일 오전 9시에 Node.js로 실행하던 `report.mjs`의 예시예요. 실제 작업에 맞게 경로, 일정, 런타임을 바꿔 주세요. 같은 파일이 cron에 등록돼 있으면 Cronly가 systemd에 중복 등록하는 것을 막아요.

   ```bash
   CRONLY_BACKEND=cron cronly remove ./report.mjs &&
     CRONLY_BACKEND=systemd cronly add ./report.mjs --schedule '0 9 * * 1-5' --runtime node
   ```

   새 작업 등록에 실패하면 기록해 둔 설정으로 `CRONLY_BACKEND=cron cronly add`를 실행해 cron 작업을 복구할 수 있어요.

3. 새로 등록된 작업과 다음 실행 시각을 확인하세요. systemd의 `doctor`는 cron에 남아 있는 작업을 참고 정보로 표시해요. cron 패키지까지 제거하려면 `crontab -l`의 수동 항목과 이 시스템에서 cron을 쓰는 다른 작업도 확인해 주세요.

   ```bash
   CRONLY_BACKEND=systemd cronly list
   systemctl --user list-timers --all 'cronly-*.timer'
   CRONLY_BACKEND=systemd cronly doctor
   ```

## 일정 지정하기

`add` 한 번에 일정 하나를 지정해요. 시각은 스케줄러의 현지 시간대로 시와 분을 두 자리씩 `HH:MM` 형식으로 입력하세요. 요일은 `sun`, `mon`, `tue`, `wed`, `thu`, `fri`, `sat`를 써요.

| 일정 | 옵션 |
| --- | --- |
| 매일 08:00 | `--daily 08:00` |
| 4시간마다 | `--every-hours 4` |
| 10분마다 | `--every-minutes 10` |
| 매주 토요일 10:00 | `--weekly sat --at 10:00` |
| 월·수·금 09:00 | `--days mon,wed,fri --at 09:00` |
| 평일 09:00 | `--weekdays --at 09:00` |
| 주말 10:00 | `--weekends --at 10:00` |
| 매월 15일 09:00 | `--schedule "0 9 15 * *"` |
| 시작 시 실행 (플랫폼별 시점은 아래 참고) | `--reboot` |

`--every-hours`에는 **1, 2, 3, 4, 6, 8, 12**를, `--every-minutes`에는 **1, 2, 3, 4, 5, 6, 10, 12, 15, 20, 30**을 쓸 수 있어요. 하루나 한 시간을 같은 간격으로 나눌 수 있는 값이에요. 다른 일정은 분·시·일·월·요일 순서의 표현식을 따옴표로 감싸 `--schedule`에 전달하세요. 숫자 필드에는 와일드카드, 목록, 범위, 간격을 쓸 수 있어요. 별칭은 `@hourly`, `@daily`, `@weekly`, `@monthly`, `@yearly`, `@annually`, `@reboot`를 지원해요.

## 스케줄러별 실행 방식

### Linux · systemd

작업을 소유한 계정으로 `systemctl --user list-timers --all`을 실행하면 현재 세션에서 사용자 관리자에 연결되는지 확인할 수 있어요. SSH나 CI에서 실행할 때도 같은 방법으로 확인하세요.

작업마다 `cronly-<id>.service`와 `cronly-<id>.timer`를 만들어요. 기본 위치는 `~/.config/systemd/user/`이고, `XDG_CONFIG_HOME`을 절대 경로로 설정하면 `$XDG_CONFIG_HOME/systemd/user/`에 저장해요. 달력 일정은 등록하는 순간부터 다음 실행 시각을 기다려요. 그 시각에 같은 서비스가 아직 실행 중이면 해당 회차를 건너뛰어요.

유닛 파일 하나가 없거나 수정됐다면 처음 사용한 `add` 명령으로 복구하거나 `cronly remove --id <id>`로 지울 수 있어요. 소유자를 확인할 수 없는 파일은 보존해요.

`--reboot` 작업은 **사용자 관리자가 다음에 시작될 때** 처음 실행돼요. 서버에서 로그인 전부터 작업을 실행하고 로그아웃 뒤에도 예약 작업이 계속 돌아가야 한다면 해당 계정에서 `loginctl enable-linger "$USER"`로 linger를 켜 주세요.

### macOS · launchd

작업마다 `~/Library/LaunchAgents/com.fureweb.cronly.<id>.plist`를 만들고 사용자의 GUI 로그인 세션에서 실행해요. `--reboot` 작업은 등록, 재등록, 로그인 시 실행돼요. 잠든 동안 놓친 달력 일정은 깨어날 때 한 번으로 합쳐 실행될 수 있어요. 달력 조합이 4,096개를 넘거나 `0 0 */2 * 1`처럼 날짜와 요일 조건을 launchd에서 정확히 표현할 수 없으면 등록 단계에서 알려 줘요.

### Windows · 작업 스케줄러

작업은 등록한 사용자가 로그인한 동안 실행돼요. `--reboot` 작업은 다음 로그인 때 실행돼요. JavaScript는 Node.js로, `.exe`는 직접 실행해요. 다른 인터프리터는 설치한 뒤 `--runtime`으로 지정할 수 있어요.

새로 등록한 작업은 콘솔 창 없이 실행되고 스크립트의 종료 코드를 반환해요. 공용 실행기는 `%LOCALAPPDATA%\Cronly\windows-launcher-v1.js`에 저장돼요. 기존 작업에는 `add`를 다시 실행하면 적용돼요.

PowerShell은 예약된 `.ps1`을 실행할 때 실행 정책을 적용해요. `Restricted`에서는 등록에 성공해도 실제 실행이 차단되어 로그에 `UnauthorizedAccess`가 기록될 수 있어요. 위 JavaScript 예제는 이 정책에서도 실행돼요. [Windows PowerShell 실행 정책](https://learn.microsoft.com/ko-kr/powershell/module/microsoft.powershell.core/about/about_execution_policies?view=powershell-5.1)

```powershell
Get-ExecutionPolicy
cronly.cmd add .\report.mjs --name weekday-report --weekdays --at 09:00
```

날짜와 요일을 동시에 제한하는 cron 표현식이나 트리거가 48개를 넘는 일정은 Windows에서 등록할 수 없어요. 기본 로그 경로는 `%USERPROFILE%\.cronly\logs\<id>.log`예요.

작업 스케줄러에서 작업 정의를 수정하면 `doctor`가 Windows 작업 이름을 표시해요. 정의를 확인하고 Cronly 소유 작업이라면 `cronly remove --id <id>`로 지운 뒤 다시 등록하세요.

### cron을 선택한 경우

사용자 crontab과 이를 실행할 cron 스케줄러가 있는 환경에서 `CRONLY_BACKEND=cron`을 지정하세요. Cronly는 사용자 crontab에서 자신이 표시한 블록을 관리해요. Linux에서는 `doctor`가 프로세스 목록을 읽을 수 있을 때 cron 데몬도 확인해요.

Cronly는 자신의 crontab 변경을 한 번에 하나씩 처리해요. `crontab -e`로 직접 편집할 때는 편집을 마친 뒤 Cronly에서 작업을 추가하거나 삭제하세요. cron 백엔드가 생성하는 명령은 한 줄에 최대 999바이트예요.

## 스크립트 실행 환경과 로그

- 각 작업은 **스크립트가 있는 디렉터리**에서 실행하므로 `./config.json` 같은 상대 경로는 그 위치를 기준으로 해석돼요.
- **JavaScript 파일**(`.js`, `.mjs`, `.cjs`)은 `add`를 실행한 Node.js로 구동해요. Unix에서 `.sh` 파일은 첫 줄의 `#!` 선언에 지정된 인터프리터를 사용하고, 선언이 없으면 `/bin/sh`로 실행해요. 다른 인터프리터는 `--runtime python3`처럼 지정하고, 실행 권한이 있는 파일을 직접 실행할 때는 `--runtime exec`를 쓰세요. `#!/bin/bash -e`처럼 첫 줄에 인터프리터 옵션이 있으면 실행 권한을 부여해야 옵션까지 적용돼요.
- Unix 작업의 **PATH**에는 등록에 사용한 Node.js의 디렉터리, `/usr/bin`, `/bin`이 차례로 들어가요. 해당 Node.js를 제거했다면 새 버전으로 작업을 다시 등록하세요. Windows에서는 상속받은 PATH 맨 앞에 Node.js 디렉터리를 추가해요.
- 등록할 때 **로그 경로**를 출력해요. 표준 출력과 오류는 모두 `~/.cronly/logs/<id>.log`에 이어 써요. 등록 시 `CRONLY_HOME`을 지정하면 로그는 `$CRONLY_HOME/logs/`에 저장하고, 작업은 같은 사용자의 스케줄러에서 관리해요. 로그 로테이션은 직접 설정해야 해요.

## 작업 조회와 삭제

| 명령 | 동작 |
| --- | --- |
| `cronly list` | 작업 ID, 이름, 일정, 경로, 런타임을 확인해요. |
| `cronly run --name weekday-report` | 등록된 작업을 한 번 실행해요. |
| `cronly logs --name weekday-report --tail 20` | 작업 로그의 마지막 20줄을 출력해요. |
| `cronly print` | 관리 중인 systemd 유닛, LaunchAgent plist, Windows 작업 XML 또는 crontab 블록 원문을 출력해요. |
| `cronly doctor` | 스케줄러 상태, 스크립트와 런타임 권한, 로그 경로를 점검해요. 문제가 있으면 종료 코드 1을 반환해요. |
| `cronly remove ./report.mjs` | 이 파일의 예약을 삭제해요. |
| `cronly remove --id 68b547a7` | `list`에서 확인한 ID로 예약을 삭제해요. |

위 Linux 예제의 타이머 상태와 최근 실행 로그는 다음 명령으로 확인할 수 있어요.

```bash
systemctl --user status cronly-68b547a7.timer
cronly logs --id 68b547a7 --tail 20
```

한국어 전체 도움말은 `cronly --lang ko --help`로 볼 수 있어요. 지원하는 언어 코드는 `en`, `ko`, `ja`, `zh`이고, 기본 언어는 `CRONLY_LANG`으로 지정해요.

## 개발 및 테스트

Linux, macOS, Windows CI는 `.nvmrc`에 고정한 Node.js LTS 버전을 사용해요. Linux에서는 최소 지원 버전인 14.8.0으로도 실제 systemd 통합 테스트를 실행해요. 로컬 커버리지 검사에는 고정된 LTS 버전을 사용하세요.

```bash
npm ci
npm test
npm run test:coverage
```

실제 스케줄러를 사용하는 통합 테스트도 있어요. Linux 사용자 세션에서는 `npm run test:systemd`, macOS GUI 세션에서는 `npm run test:launchd`를 실행하세요. cron 통합 테스트는 테스트용 계정의 crontab에서 `npm run test:integration`으로 실행해요.

Windows 로그인 세션에서는 `npm.cmd test`와 `npm.cmd run test:windows`가 같은 작업 스케줄러 테스트를 실행해요. 1분 예약으로 JavaScript가 실제 실행되는지 확인한 뒤, 서명되지 않은 로컬 `.ps1` 작업을 이름으로 실행해요. `Restricted`에서는 JavaScript 검사를 통과해도 마지막 PowerShell 검사가 실패해요.

## 라이선스

[MIT](./LICENSE)
