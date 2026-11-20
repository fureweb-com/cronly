# Cronly 2.0.0

[![npm version](https://img.shields.io/npm/v/%40fureweb%2Fcronly?logo=npm)](https://www.npmjs.com/package/@fureweb/cronly)
[![license](https://img.shields.io/github/license/fureweb-com/cronly)](https://github.com/fureweb-com/cronly/blob/main/LICENSE)
[![tests](https://github.com/fureweb-com/cronly/actions/workflows/ci.yml/badge.svg)](https://github.com/fureweb-com/cronly/actions/workflows/ci.yml)
[![coverage](https://codecov.io/github/fureweb-com/cronly/graph/badge.svg?branch=main)](https://app.codecov.io/github/fureweb-com/cronly)

**English** | [한국어](./README.ko.md) | [日本語](./README.ja.md) | [中文](./README.zh.md)

Cronly schedules scripts with **systemd user timers on Linux**, **launchd LaunchAgents on macOS**, and the built-in **Task Scheduler on Windows**. On Linux, a running systemd user manager is enough to schedule jobs without Cronie or `crontab`. Cronly has zero npm runtime dependencies.

Upgrading a Linux machine with existing jobs? [Move your 1.x cron jobs to systemd](#migration).

## Runtime requirements

| Platform | Required system components |
| --- | --- |
| Linux | systemd 237+ user manager, `systemctl --user`, and `/bin/sh` |
| macOS | GUI login session, `launchctl`, and the system `crontab` utility to check for older jobs |
| Windows | Signed-in user, Task Scheduler, Windows PowerShell 5.1, and Windows Script Host (JScript) |
| Optional cron (Unix) | `crontab`, an active cron scheduler, and `/bin/sh` |

## Install and schedule your first job

Cronly requires Node.js 14.8.0 or later. On Windows, use Command Prompt for these examples. In PowerShell, use `npm.cmd`, `npx.cmd`, and `cronly.cmd` if the execution policy blocks npm's PowerShell launchers.

```bash
npm install --global @fureweb/cronly@2.0.0
cronly --version
```

The version should be `2.0.0`. To view help with npx, run `npx @fureweb/cronly@2.0.0 --help`. From a local checkout, run `npm pack` followed by `npm install --global ./fureweb-cronly-2.0.0.tgz`.

In an empty directory where you intend to keep the job, save this line as `report.mjs`.

```js
console.log(new Date().toISOString())
```

From that directory, register a weekday 09:00 schedule and request one run now.

```bash
cronly add ./report.mjs --name weekday-report --weekdays --at 09:00
cronly list
cronly run --name weekday-report
```

Read the output with `cronly logs --name weekday-report`. If the first read is empty, repeat the log command until the new UTC timestamp appears. To stop the example, run `cronly remove --name weekday-report`.

For a script at `/home/lee/jobs/report.mjs`, the Linux listing looks like this.

```text
  68b547a7  [weekday-report]  0 9 * * 1-5      /home/lee/jobs/report.mjs  (node, systemd)
```

## Named schedules

One script can have multiple schedules. A name is case-sensitive and unique within the user's selected scheduler. Use 1–64 Unicode letters or numbers, with `.`, `_`, and `-` also allowed after the first character.

Run `add` again with the same file and name to update the schedule. Cronly recognizes symlinks to the same file. An unnamed registration has its own schedule. For `run`, `logs`, and `remove`, supply one path, `--name`, or `--id`. If a path matches several jobs, select one by name or ID.

```sh
cronly add ./report.mjs --name weekday-report --weekdays --at 10:00
cronly add ./report.mjs --name weekend-report --weekends --at 11:00
cronly list
cronly remove --name weekend-report
```

## Using Cronly from scripts and agents

- Use the same OS account, scheduler, and job name for `add`, `run`, `logs`, and `remove`. Cronly selects the platform default. To select a backend explicitly, set `CRONLY_BACKEND` to `systemd`, `launchd`, `windows`, or `cron` on each invocation. `cronly --lang en doctor` prints English diagnostics and exits with 0 when all checks pass or 1 when a check fails.
- On systemd, launchd, and Windows, exit code 0 from `run` means the scheduler accepted the request. With the optional cron backend, `run` executes the script locally with its registered working directory, runtime, PATH, and redirection, inherits the shell's other environment variables, and returns the script's exit code. Cronly prints this environment notice to stderr.
- `logs` prints the entire log, including stdout and stderr from prior runs. Use `--tail 20` to read only the last 20 lines. If the log file doesn't exist yet, it prints a notice to stderr and exits with 0. To verify a particular run, poll for a new timestamp or marker with a timeout. Read the log before `remove`. The existing file remains at the path printed by `add`.

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

3. Verify the registrations and next calendar runs. The systemd `doctor` lists remaining cron jobs as an informational notice. Before removing the cron package, check `crontab -l` and any other workloads on the machine that still use cron.

   ```bash
   CRONLY_BACKEND=systemd cronly list
   systemctl --user list-timers --all 'cronly-*.timer'
   CRONLY_BACKEND=systemd cronly doctor
   ```

## Schedule options

Choose one schedule per `add`. Use zero-padded `HH:MM` in the scheduler's local time. Weekday names are `sun`, `mon`, `tue`, `wed`, `thu`, `fri` and `sat`.

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

For `--every-hours`, use **1, 2, 3, 4, 6, 8 or 12**. For `--every-minutes`, use **1, 2, 3, 4, 5, 6, 10, 12, 15, 20 or 30**. These intervals divide the day or hour evenly. For other patterns, pass `--schedule` a quoted expression in minute, hour, day of month, month, weekday order. Numeric fields accept wildcards, lists, ranges and steps. The aliases are `@hourly`, `@daily`, `@weekly`, `@monthly`, `@yearly`, `@annually`, and `@reboot`.

## How the schedulers run

### Linux · systemd

Run `systemctl --user list-timers --all` as the job owner to check that the session can reach the user manager. This also applies to SSH and CI sessions.

Cronly writes `cronly-<id>.service` and `cronly-<id>.timer` in `~/.config/systemd/user/`, or under `$XDG_CONFIG_HOME/systemd/user/` when an absolute config path is set. Calendar timers start waiting for their next run as soon as you register them. A trigger is skipped if the previous run of that service is still active.

If one of the two unit files is missing or edited, repeat the original `add` command to repair it, or use `cronly remove --id <id>` to remove it. Cronly preserves files whose ownership it cannot verify. If one original unit remains, `logs` and `remove` can still find the job by name or script path.

A `--reboot` job first runs the **next time the user manager starts**. On a server where jobs must run from boot and continue after logout, enable lingering for the account with `loginctl enable-linger "$USER"`.

### macOS · launchd

Each job has a `~/Library/LaunchAgents/com.fureweb.cronly.<id>.plist` file and runs in the user’s GUI login session. A `--reboot` job runs on registration, re-registration and login. launchd can combine calendar events missed during sleep into one run on wake. Cronly rejects schedules that exceed 4,096 launchd calendar combinations or require a day/weekday condition that launchd cannot represent, such as `0 0 */2 * 1`.

### Windows · Task Scheduler

Cronly registers tasks for the current user. The user must be signed in for tasks to run. `--reboot` runs at the next login. JavaScript uses Node.js and native `.exe` files run directly. Select another installed interpreter with `--runtime`.

Tasks run without a console window and report the script’s exit code. Cronly keeps the shared launcher at `%LOCALAPPDATA%\Cronly\windows-launcher-v1.js`. If policy disables Windows Script Host, `add` stops before registration and `doctor` names the registry setting.

PowerShell checks its execution policy when a scheduled `.ps1` runs. Under `Restricted`, registration can succeed and the scheduled script can still log `UnauthorizedAccess`. The JavaScript example works under that policy. [Windows PowerShell execution policies](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_execution_policies?view=powershell-5.1)

```powershell
Get-ExecutionPolicy
cronly.cmd add .\report.mjs --name weekday-report --weekdays --at 09:00
```

Windows rejects cron expressions that restrict both day of month and weekday, and schedules that need more than 48 native triggers. Task output is appended to `%USERPROFILE%\.cronly\logs\<id>.log` by default.

If the trigger, action, principal, battery settings, time limit or overlap policy changes in Task Scheduler, `doctor` identifies the task by its native name. Inspect the definition, then use `cronly remove --id <id>` for a Cronly-owned task and register it again.

### Optional cron backend

Use `CRONLY_BACKEND=cron` with a working user crontab and cron scheduler. Cronly edits its marked blocks in the user crontab. On Linux, `doctor` also checks for a cron daemon when it can inspect the process list.

Cronly serializes its own changes to the crontab. If you also use `crontab -e`, finish that edit before adding or removing a Cronly job. The cron backend limits each generated command to 999 bytes.

## Scripts and logs

- Each job starts in the **script’s directory**, so relative paths like `./config.json` resolve there.
- **JavaScript files** ending in `.js`, `.mjs` or `.cjs` use the Node.js binary that ran `add`. On Unix, a `.sh` file follows its shebang (for example `#!/bin/bash`) or uses `/bin/sh` if the file has no shebang. Use `--runtime python3` for another interpreter, or `--runtime exec` to run an executable file directly. For a shebang such as `#!/bin/bash -e`, make the script executable to preserve the interpreter options.
- On Unix, the job’s **PATH** starts with the registering Node.js binary’s directory followed by `/usr/bin:/bin`. If you remove that Node.js installation, re-register its jobs with the new version. On Windows, Cronly prepends the Node.js directory to the inherited PATH.
- On registration, Cronly prints the **log path**. Both stdout and stderr append to `~/.cronly/logs/<id>.log`. Set `CRONLY_HOME` when adding a job to use `$CRONLY_HOME/logs/`. All registrations still belong to the user's selected scheduler. Log rotation is up to the operator.

## Inspect and remove jobs

| Command | What it does |
| --- | --- |
| `cronly list` | Show IDs, names, schedules, paths and runtimes. |
| `cronly run --name weekday-report` | Start the registered job once. |
| `cronly logs --name weekday-report --tail 20` | Print the last 20 lines of the job log. |
| `cronly print` | Print the managed unit files, LaunchAgent plists, Windows task XML or crontab blocks. |
| `cronly doctor` | Check scheduler state, script and runtime permissions, and log paths. A failed check sets exit code 1. |
| `cronly remove ./report.mjs` | Remove the registration for this file. |
| `cronly remove --id 68b547a7` | Remove a registration using the ID from `list`. |

For the Linux job above, check the timer’s status and read the script’s most recent output after a run.

```bash
systemctl --user status cronly-68b547a7.timer
cronly logs --id 68b547a7 --tail 20
```

Use `cronly --lang en --help` for the full CLI reference. The supported language codes are `en`, `ko`, `ja` and `zh`. Set `CRONLY_LANG` to keep a language preference.

## Development

CI uses the Node.js LTS release pinned in `.nvmrc` on Linux, macOS and Windows. Linux also runs the real systemd suite on the minimum supported Node.js version, 14.8.0. Use the pinned LTS for coverage.

```bash
npm ci
npm test
npm run test:coverage
```

The integration commands use real schedulers. Run `npm run test:systemd` in a Linux user session, `npm run test:launchd` in a macOS GUI session, or `npm run test:integration` with a test user's crontab.

In a signed-in Windows session, `npm.cmd test` and `npm.cmd run test:windows` both run the Task Scheduler suite. It waits for a real one-minute JavaScript trigger, then runs an unsigned local `.ps1` by name. The final PowerShell assertion fails under `Restricted` even when the JavaScript checks pass.

## License

[MIT](./LICENSE)
