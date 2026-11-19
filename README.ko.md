# Cronly 2.0.0

[![npm version](https://img.shields.io/npm/v/%40fureweb%2Fcronly?logo=npm)](https://www.npmjs.com/package/@fureweb/cronly)
[![license](https://img.shields.io/github/license/fureweb-com/cronly)](https://github.com/fureweb-com/cronly/blob/main/LICENSE)
[![tests](https://github.com/fureweb-com/cronly/actions/workflows/ci.yml/badge.svg)](https://github.com/fureweb-com/cronly/actions/workflows/ci.yml)
[![coverage](https://codecov.io/github/fureweb-com/cronly/graph/badge.svg?branch=main)](https://app.codecov.io/github/fureweb-com/cronly)

[English](./README.md) | **한국어** | [日本語](./README.ja.md) | [中文](./README.zh.md)

`cronly add ./report.mjs --daily 08:00`으로 스크립트를 매일 아침 8시에 실행할 수 있어요. Cronly 2.0.0은 **Linux에서 systemd 사용자 타이머**, **macOS에서 launchd LaunchAgent**를 사용해요. Linux에서는 systemd 사용자 관리자가 실행 중이면 Cronie나 `crontab`을 설치할 필요가 없어요. 실행에 필요한 외부 npm 패키지도 없어요.

Linux에서 이미 작업을 예약해 두었다면 [1.x cron 작업을 systemd로 옮기는 방법](#migration)을 먼저 확인해 주세요.

## 설치하고 첫 작업 등록하기

Node.js 14.8.0 이상이 필요해요. 2.0.0 소스를 내려받았다면 프로젝트 디렉터리에서 설치한 다음, 출력되는 버전이 `2.0.0`인지 확인해 주세요. [2.0.0 소스 보기](https://github.com/fureweb-com/cronly/tree/00c8e814d6829474004158d192504052a3b110ec)

```bash
npm pack
npm install --global ./fureweb-cronly-2.0.0.tgz
cronly --version
```

2.0.0이 npm에 배포된 후에는 `npm install --global @fureweb/cronly@2.0.0`으로 설치하거나 `npx @fureweb/cronly@2.0.0 --help`로 도움말을 볼 수 있어요.

스크립트가 있는 디렉터리에서 다음 명령을 실행하면 월요일부터 금요일까지 매일 오전 9시에 작업이 실행돼요.

```bash
cronly add ./report.mjs --weekdays --at 09:00
cronly list
```

스크립트 경로가 `/home/lee/jobs/report.mjs`라면 Linux 목록에는 이렇게 표시돼요.

```text
  9f9d9373  0 9 * * 1-5      /home/lee/jobs/report.mjs  (node, systemd)
```

실행 시간을 바꿀 때는 같은 파일에 `cronly add`를 다시 실행하세요. 심볼릭 링크로 같은 파일을 가리켜도 기존 일정을 갱신해요.

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

3. 새로 등록된 작업과 다음 실행 시각을 확인하세요. 이전 Cronly 작업이 cron에 남아 있으면 `doctor`가 이를 알리고 종료 코드 1을 반환해요. cron 패키지까지 제거하려면 `crontab -l`의 수동 항목과 이 시스템에서 cron을 쓰는 다른 작업도 확인해 주세요.

   ```bash
   CRONLY_BACKEND=systemd cronly list
   systemctl --user list-timers --all 'cronly-*.timer'
   CRONLY_BACKEND=systemd cronly doctor
   ```

## 일정 지정하기

`add` 한 번에 일정 하나를 지정해요. 시간은 24시간제로, 요일은 `sun`, `mon`, `tue`, `wed`, `thu`, `fri`, `sat`로 입력해요.

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

`--every-hours`에는 **1, 2, 3, 4, 6, 12**를, `--every-minutes`에는 **1, 2, 3, 4, 5, 6, 10, 12, 15, 20, 30**을 쓸 수 있어요. 하루나 한 시간을 같은 간격으로 나눌 수 있는 값이에요. 다른 일정은 `--schedule`로 지정하세요. 숫자로 된 cron 필드 5개에 와일드카드, 목록, 범위, 간격을 쓸 수 있고 `@hourly`, `@monthly`, `@reboot` 같은 별칭도 지원해요.

## 스케줄러별 실행 방식

### Linux · systemd

작업마다 `cronly-<id>.service`와 `cronly-<id>.timer`를 만들어요. 기본 위치는 `~/.config/systemd/user/`이고, `XDG_CONFIG_HOME`을 절대 경로로 설정하면 `$XDG_CONFIG_HOME/systemd/user/`에 저장해요. 달력 일정은 등록하는 순간부터 다음 실행 시각을 기다려요. 그 시각에 같은 서비스가 아직 실행 중이면 해당 회차를 건너뛰어요.

`--reboot` 작업은 **사용자 관리자가 다음에 시작될 때** 처음 실행돼요. 서버에서 로그인 전부터 작업을 실행하고 로그아웃 뒤에도 예약 작업이 계속 돌아가야 한다면 해당 계정에서 `loginctl enable-linger "$USER"`로 linger를 켜 주세요.

### macOS · launchd

작업마다 `~/Library/LaunchAgents/com.fureweb.cronly.<id>.plist`를 만들고 사용자의 GUI 로그인 세션에서 실행해요. `--reboot` 작업은 등록, 재등록, 로그인 시 실행돼요. 잠든 동안 놓친 달력 일정은 깨어날 때 한 번으로 합쳐 실행될 수 있어요. 달력 조합이 4,096개를 넘거나 `0 0 */2 * 1`처럼 날짜와 요일 조건을 launchd에서 정확히 표현할 수 없으면 등록 단계에서 알려 줘요.

### cron을 선택한 경우

사용자 crontab과 이를 실행할 cron 스케줄러가 있는 환경에서 `CRONLY_BACKEND=cron`을 지정하세요. Cronly는 사용자 crontab에서 자신이 표시한 블록을 관리해요. Linux에서는 `doctor`가 프로세스 목록을 읽을 수 있을 때 cron 데몬도 확인해요.

Cronly는 자신의 crontab 변경을 한 번에 하나씩 처리해요. `crontab -e`로 직접 편집할 때는 편집을 마친 뒤 Cronly에서 작업을 추가하거나 삭제하세요. cron 백엔드가 생성하는 명령은 한 줄에 최대 999바이트예요.

## 스크립트 실행 환경과 로그

- 각 작업은 **스크립트가 있는 디렉터리**에서 실행하므로 `./config.json` 같은 상대 경로는 그 위치를 기준으로 해석돼요.
- **JavaScript 파일**(`.js`, `.mjs`, `.cjs`)은 `add`를 실행한 Node.js로 구동해요. `.sh` 파일은 첫 줄의 `#!` 선언에 지정된 인터프리터를 사용하고, 선언이 없으면 `/bin/sh`로 실행해요. 다른 인터프리터는 `--runtime python3`처럼 지정하고, 실행 권한이 있는 파일을 직접 실행할 때는 `--runtime exec`를 쓰세요. `#!/bin/bash -e`처럼 첫 줄에 인터프리터 옵션이 있으면 실행 권한을 부여해야 옵션까지 적용돼요.
- 작업의 **PATH**에는 등록에 사용한 Node.js의 디렉터리, `/usr/bin`, `/bin`이 차례로 들어가요. 해당 Node.js를 제거했다면 새 버전으로 작업을 다시 등록하세요.
- 등록할 때 **로그 경로**를 출력해요. 표준 출력과 오류는 모두 `~/.cronly/logs/<id>.log`에 이어 써요. 등록 시 `CRONLY_HOME`을 지정하면 `$CRONLY_HOME/logs/`에 저장해요. 로그 로테이션은 직접 설정해야 해요.

## 작업 조회와 삭제

| 명령 | 동작 |
| --- | --- |
| `cronly list` | 작업 ID, 일정, 경로, 런타임을 확인해요. |
| `cronly print` | 관리 중인 systemd 유닛, LaunchAgent plist 또는 crontab 블록 원문을 출력해요. |
| `cronly doctor` | 스케줄러 상태, 스크립트와 런타임 권한, 로그 경로를 점검해요. 문제가 있으면 종료 코드 1을 반환해요. |
| `cronly remove ./report.mjs` | 이 파일의 예약을 삭제해요. |
| `cronly remove --id 9f9d9373` | `list`에서 확인한 ID로 예약을 삭제해요. |

위 Linux 예제의 타이머 상태와 최근 실행 로그는 다음 명령으로 확인할 수 있어요.

```bash
systemctl --user status cronly-9f9d9373.timer
tail -n 20 ~/.cronly/logs/9f9d9373.log
```

한국어 전체 도움말은 `cronly --lang ko --help`로 볼 수 있어요. 지원하는 언어 코드는 `en`, `ko`, `ja`, `zh`이고, 기본 언어는 `CRONLY_LANG`으로 지정해요.

## 개발 및 테스트

CI와 같은 커버리지 검사를 실행하려면 Node.js 22를 사용하세요.

```bash
npm ci
npm test
npm run test:coverage
```

실제 스케줄러를 사용하는 통합 테스트도 있어요. Linux 사용자 세션에서는 `npm run test:systemd`, macOS GUI 세션에서는 `npm run test:launchd`를 실행하세요. cron 통합 테스트는 테스트용 계정의 crontab에서 `npm run test:integration`으로 실행해요.

## 라이선스

[MIT](./LICENSE)
