# Cronly 2.0.0

[![npm version](https://img.shields.io/npm/v/%40fureweb%2Fcronly?logo=npm)](https://www.npmjs.com/package/@fureweb/cronly)
[![license](https://img.shields.io/github/license/fureweb-com/cronly)](https://github.com/fureweb-com/cronly/blob/main/LICENSE)
[![tests](https://github.com/fureweb-com/cronly/actions/workflows/ci.yml/badge.svg)](https://github.com/fureweb-com/cronly/actions/workflows/ci.yml)
[![coverage](https://codecov.io/github/fureweb-com/cronly/graph/badge.svg?branch=main)](https://app.codecov.io/github/fureweb-com/cronly)

**English** | [한국어](./README.ko.md) | [日本語](./README.ja.md) | [中文](./README.zh.md)

Schedule a script with `cronly add ./report.mjs --daily 08:00`. Cronly 2.0.0 uses **systemd user timers on Linux** and **launchd LaunchAgents on macOS**. Windows uses its built-in **Task Scheduler**. On Linux, a running systemd user manager is enough to schedule jobs without Cronie or `crontab`. Cronly has zero npm runtime dependencies.

Upgrading a Linux machine with existing jobs? [Move your 1.x cron jobs to systemd](#migration).

## Runtime requirements

| Platform | Required system components |
| --- | --- |
| Linux | systemd user manager, `systemctl --user`, and `/bin/sh` |
| macOS | GUI login session, `launchctl`, `/bin/sh`, and the system `crontab` utility to check for older jobs |
| Windows | Task Scheduler service and Windows PowerShell 5.1 |
| Optional cron (Unix) | `crontab`, an active cron scheduler, and `/bin/sh` |

## Install and schedule your first job

Cronly requires Node.js 14.8.0 or later. To install from a checkout of the 2.0.0 source, run these commands in the project directory. The version should be `2.0.0`. Download the [2.0.0 source](https://github.com/fureweb-com/cronly/tree/codex/release-2.0.0).

```bash
npm pack
npm install --global ./fureweb-cronly-2.0.0.tgz
cronly --version
```

Once 2.0.0 is published on npm, install that version with `npm install --global @fureweb/cronly@2.0.0` or try `npx @fureweb/cronly@2.0.0 --help`.

From the directory containing your script, schedule it for 09:00 every Monday through Friday.

```bash
cronly add ./report.mjs --weekdays --at 09:00
cronly list
```

For a script at `/home/lee/jobs/report.mjs`, the Linux listing looks like this.

```text
  9f9d9373  0 9 * * 1-5      /home/lee/jobs/report.mjs  (node, systemd)
```

To change the time, run `cronly add` again for the same file. Cronly also recognizes paths that point to the same file through a symlink.

<a id="migration"></a>

## Move 1.x Linux jobs to systemd

Upgrading the CLI leaves existing jobs in the user crontab. Keep cron installed and running while you migrate. To keep using cron on a machine without a systemd user manager, set `CRONLY_BACKEND=cron` for your Cronly commands.

1. As the user who owns the jobs, check that the systemd user manager is reachable. List the existing Cronly jobs and save each script’s path, schedule and runtime.

   ```bash
   systemctl --user list-timers --all
   CRONLY_BACKEND=cron cronly list
   CRONLY_BACKEND=cron cronly print
   ```

2. Move one script at a time. This example assumes the old job ran `report.mjs` with Node.js at 09:00 on weekdays. Substitute the path, schedule and runtime you recorded. Cronly blocks registration while the same file is still registered in cron.

   ```bash
   CRONLY_BACKEND=cron cronly remove ./report.mjs &&
     CRONLY_BACKEND=systemd cronly add ./report.mjs --schedule '0 9 * * 1-5' --runtime node
   ```

   If the new registration fails, you can restore the cron job with `CRONLY_BACKEND=cron cronly add` using the settings you saved.

3. Verify the registrations and next calendar runs. While legacy Cronly jobs remain, `doctor` reports them and exits with code 1. Before removing the cron package, check `crontab -l` and any other workloads on the machine that still use cron.

   ```bash
   CRONLY_BACKEND=systemd cronly list
   systemctl --user list-timers --all 'cronly-*.timer'
   CRONLY_BACKEND=systemd cronly doctor
   ```

## Schedule options

Choose one schedule per `add`. Times use the 24-hour clock. Weekday names are `sun`, `mon`, `tue`, `wed`, `thu`, `fri` and `sat`.

| When | Options |
| --- | --- |
| Every day at 08:00 | `--daily 08:00` |
| Every four hours | `--every-hours 4` |
| Every ten minutes | `--every-minutes 10` |
| Saturdays at 10:00 | `--weekly sat --at 10:00` |
| Monday, Wednesday and Friday at 09:00 | `--days mon,wed,fri --at 09:00` |
| Weekdays at 09:00 | `--weekdays --at 09:00` |
| Weekends at 10:00 | `--weekends --at 10:00` |
| The 15th of each month at 09:00 | `--schedule "0 9 15 * *"` |
| At startup (see platform behavior below) | `--reboot` |

For `--every-hours`, use **1, 2, 3, 4, 6 or 12**. For `--every-minutes`, use **1, 2, 3, 4, 5, 6, 10, 12, 15, 20 or 30**. These intervals divide the day or hour evenly. Use `--schedule` for other calendar patterns. It accepts five numeric cron fields with wildcards, lists, ranges and steps, plus aliases such as `@hourly`, `@monthly` and `@reboot`.

## How the schedulers run

### Linux · systemd

Cronly writes `cronly-<id>.service` and `cronly-<id>.timer` in `~/.config/systemd/user/`, or under `$XDG_CONFIG_HOME/systemd/user/` when an absolute config path is set. Calendar timers start waiting for their next run as soon as you register them. A trigger is skipped if the previous run of that service is still active.

A `--reboot` job first runs the **next time the user manager starts**. On a server where jobs must run from boot and continue after logout, enable lingering for the account with `loginctl enable-linger "$USER"`.

### macOS · launchd

Each job has a `~/Library/LaunchAgents/com.fureweb.cronly.<id>.plist` file and runs in the user’s GUI login session. A `--reboot` job runs on registration, re-registration and login. launchd can combine calendar events missed during sleep into one run on wake. Cronly rejects schedules that exceed 4,096 launchd calendar combinations or require a day/weekday condition that launchd cannot represent, such as `0 0 */2 * 1`.

### Windows · Task Scheduler

Cronly registers tasks for the current user. The user must be signed in for tasks to run. `--reboot` runs at the next login. JavaScript uses Node.js, `.ps1` uses Windows PowerShell with the system execution policy, and `.exe` runs directly. Select another installed executable with `--runtime`.

```powershell
cronly add .\report.ps1 --weekdays --at 09:00
cronly list
```

Windows rejects cron expressions that restrict both day of month and weekday, and schedules that need more than 48 native triggers. Task output is appended to `%USERPROFILE%\.cronly\logs\<id>.log` by default.

### Optional cron backend

Use `CRONLY_BACKEND=cron` with a working user crontab and cron scheduler. Cronly edits its marked blocks in the user crontab. On Linux, `doctor` also checks for a cron daemon when it can inspect the process list.

Cronly serializes its own changes to the crontab. If you also use `crontab -e`, finish that edit before adding or removing a Cronly job. The cron backend limits each generated command to 999 bytes.

## Scripts and logs

- Each job starts in the **script’s directory**, so relative paths like `./config.json` resolve there.
- **JavaScript files** ending in `.js`, `.mjs` or `.cjs` use the Node.js binary that ran `add`. On Unix, a `.sh` file follows its shebang (for example `#!/bin/bash`) or uses `/bin/sh` if the file has no shebang. Use `--runtime python3` for another interpreter, or `--runtime exec` to run an executable file directly. For a shebang such as `#!/bin/bash -e`, make the script executable to preserve the interpreter options.
- On Unix, the job’s **PATH** starts with the registering Node.js binary’s directory followed by `/usr/bin:/bin`. If you remove that Node.js installation, re-register its jobs with the new version. On Windows, Cronly prepends the Node.js directory to the inherited PATH.
- On registration, Cronly prints the **log path**. Both stdout and stderr append to `~/.cronly/logs/<id>.log`. Set `CRONLY_HOME` when adding a job to use `$CRONLY_HOME/logs/`. Log rotation is up to the operator.

## Inspect and remove jobs

| Command | What it does |
| --- | --- |
| `cronly list` | Show IDs, schedules, paths and runtimes. |
| `cronly print` | Print the managed unit files, LaunchAgent plists, Windows task XML or crontab blocks. |
| `cronly doctor` | Check scheduler state, script and runtime permissions, and log paths. A failed check sets exit code 1. |
| `cronly remove ./report.mjs` | Remove the registration for this file. |
| `cronly remove --id 9f9d9373` | Remove a registration using the ID from `list`. |

For the Linux job above, check the timer’s status and read the script’s most recent output after a run.

```bash
systemctl --user status cronly-9f9d9373.timer
tail -n 20 ~/.cronly/logs/9f9d9373.log
```

Use `cronly --lang en --help` for the full CLI reference. The supported language codes are `en`, `ko`, `ja` and `zh`. Set `CRONLY_LANG` to keep a language preference.

## Development

Use Node.js 22 to run the same coverage check as CI.

```bash
npm ci
npm test
npm run test:coverage
```

The integration commands use real schedulers. Run `npm run test:systemd` in a Linux user session, `npm run test:launchd` in a macOS GUI session, or `npm run test:integration` with a test user’s crontab. Run `npm run test:windows` in a signed-in Windows session to verify registration and an actual scheduled run.

## License

[MIT](./LICENSE)
