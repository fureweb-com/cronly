# Cronly

[![npm version](https://img.shields.io/npm/v/%40fureweb%2Fcronly?logo=npm)](https://www.npmjs.com/package/@fureweb/cronly)
[![npm downloads](https://img.shields.io/npm/dm/%40fureweb%2Fcronly?logo=npm)](https://www.npmjs.com/package/@fureweb/cronly)
[![license](https://img.shields.io/github/license/fureweb-com/cronly)](https://github.com/fureweb-com/cronly/blob/main/LICENSE)
[![tests](https://github.com/fureweb-com/cronly/actions/workflows/ci.yml/badge.svg)](https://github.com/fureweb-com/cronly/actions/workflows/ci.yml)
[![coverage](https://codecov.io/github/fureweb-com/cronly/graph/badge.svg?branch=main)](https://app.codecov.io/github/fureweb-com/cronly)
[![stars](https://img.shields.io/github/stars/fureweb-com/cronly?style=social)](https://github.com/fureweb-com/cronly/stargazers)

Schedule scripts easily — no cron syntax needed.
Say what you mean: every day at 8, weekdays at 9, every 4 hours.
Cron expressions are still available when you need them. Cronly uses launchd on macOS and cron on Linux.

**[English](./README.md)** | [한국어](./README.ko.md) | [日本語](./README.ja.md) | [中文](./README.zh.md)

## In One Minute

```bash
# Every day at 8:00
cronly add ./daily-report.mjs --daily 08:00
# Same schedule with a cron expression
cronly add ./daily-report.mjs --schedule "0 8 * * *"

# Weekdays at 9:00
cronly add ./notify.mjs --weekdays --at 09:00
# Same schedule with a cron expression
cronly add ./notify.mjs --schedule "0 9 * * 1-5"

# Every 4 hours
cronly add ./sync.mjs --every-hours 4
# Same schedule with a cron expression
cronly add ./sync.mjs --schedule "0 */4 * * *"

# Every Saturday at midnight
cronly add ./weekly-cleanup.mjs --weekly sat --at 00:00
# Same schedule with a cron expression
cronly add ./weekly-cleanup.mjs --schedule "0 0 * * 6"

# See what this tool manages
cronly list
```

Use this when you want to:

- schedule scripts with plain English flags like `--daily`, `--weekdays`, or `--every-hours`
- skip learning cron syntax for everyday scheduling needs
- use cron expressions directly for advanced cases (`--schedule "0 */6 * * 1-3"`)
- avoid editing unrelated cron entries by hand
- update the schedule by running `add` again for the same file

## Why?

Managing crontab manually with `crontab -e` leads to common problems:

- Accidentally registering the same script twice
- Hard to tell which entry belongs to which script
- Risk of breaking other cron entries when editing
- Forgetting to sync crontab after changing a script path

**Cronly** solves these:

| Manual crontab | Cronly |
|---|---|
| Duplicate entries possible | Auto dedupe by file, across symlinks and letter case |
| Risk of editing other entries | Only touches managed blocks |
| Hard to identify entries | Metadata comments for identification |
| Manual sync on changes | `add` works as upsert |

## Features

- Zero external npm dependencies — only Node.js built-in modules
- No separate DB, server, or daemon — native LaunchAgent files or crontab are the source of truth
- Managed jobs have metadata and are isolated from unrelated scheduler entries
- Paths with spaces, single quotes, and `%` use native arguments on macOS and safe quoting for cron
- Jobs run from the script's directory and log their output to `~/.cronly/logs/<id>.log`
- Supports cron aliases (`@reboot`, `@daily`, `@weekly`, etc.)
- ESM-based (`"type": "module"`)
- Node.js >= 14.8.0

## Installation

```bash
# From npm
npm install -g @fureweb/cronly

# Or use without installing
npx @fureweb/cronly

# Local development
git clone https://github.com/fureweb-com/cronly.git
cd cronly
npm link
```

After installing globally, run the CLI as `cronly`.

## macOS and Linux schedulers

macOS uses a per-user `launchd` LaunchAgent by default; Linux uses cron. Commands and schedule flags stay the same. macOS stores each job in `~/Library/LaunchAgents/com.fureweb.cronly.<id>.plist` and passes executable arguments directly, without a shell. Registration failures restore the previous configuration. Cronly manages a plist only while it is exactly what Cronly wrote: a file edited by hand is skipped and reported by `list`, `print`, and `doctor`, without affecting other jobs. Run `cronly add` for its script again, or remove it with `cronly remove --id <id>`.

LaunchAgents require a GUI login session and run while that user is logged in. `--reboot`/`@reboot` runs on registration, re-registration, and login on macOS; cron retains its boot semantics. Calendar jobs missed during sleep can run once on wake. Protected files remain subject to macOS permissions.

Lists, ranges, steps, and aliases are converted to native calendar intervals. Date/weekday OR semantics are preserved. A stepped wildcard date combined with a restricted weekday (or the reverse), such as `0 0 */2 * 1`, cannot be represented exactly and is rejected. Schedules exceeding 4,096 calendar combinations are also rejected. Simplify the schedule or explicitly choose `CRONLY_BACKEND=cron`.

Existing cron jobs are not automatically migrated. `list`, `print`, and `doctor` identify legacy cron jobs; adding the same script to both schedulers is blocked. Move a script explicitly:

```bash
CRONLY_BACKEND=cron cronly list
CRONLY_BACKEND=cron cronly remove ./job.mjs
cronly add ./job.mjs --daily 08:00
```

`CRONLY_BACKEND=cron|launchd` selects a scheduler explicitly. `CRONLY_HOME` changes logs, not the normal LaunchAgents location. Tests can set `CRONLY_LAUNCHD_DIR` to isolate plist files; files outside `~/Library/LaunchAgents` are not automatically loaded on the next login.

## Usage

### Register a script

```bash
# Every day at 2:00 AM
cronly add ./backup.sh --daily 02:00

# Every 10 minutes
cronly add ./report.mjs --every-minutes 10

# Monday, Wednesday, Friday at 9:00
cronly add ./class.mjs --days mon,wed,fri --at 09:00

# Weekends at 10:00
cronly add ./weekend-job.mjs --weekends --at 10:00

# On reboot
cronly add ./startup.sh --reboot

# Explicit runtime
cronly add ./custom-binary --daily 08:00 --runtime exec
```

`--runtime` also accepts another interpreter by name or path (for example `--runtime python3`). It is resolved to an absolute path when you run `add`, so cron can find it. Options can be written as `--daily 08:00` or `--daily=08:00`.

Without `--runtime`, `.js`, `.mjs`, and `.cjs` files run with Node.js, and a `.sh` file follows its `#!` line. `#!/bin/bash` or `#!/usr/bin/env bash` runs it with that interpreter, resolved to an absolute path when you run `add`. A line with arguments, such as `#!/bin/bash -e` or `#!/bin/busybox sh`, is applied exactly by executing the script when it is executable; without the executable bit its options are not applied. Scripts for `sh` and scripts without a `#!` line run with `/bin/sh`, and `--runtime sh` always uses `/bin/sh`.

Re-adding the same file **updates instead of duplicating**:

```bash
# First time: register
cronly add ./backup.sh --daily 02:00

# Again: updates the schedule (no duplicate)
cronly add ./backup.sh --daily 03:00
```

### Easy schedule patterns

| Flag | Example | Cron equivalent |
|------|---------|-----------------|
| `--daily HH:MM` | `--daily 08:00` | `0 8 * * *` |
| `--every-hours N` | `--every-hours 4` | `0 */4 * * *` |
| `--every-minutes N` | `--every-minutes 10` | `*/10 * * * *` |
| `--weekly DAY --at HH:MM` | `--weekly mon --at 10:00` | `0 10 * * 1` |
| `--days D1,D2 --at HH:MM` | `--days mon,wed,fri --at 09:00` | `0 9 * * 1,3,5` |
| `--weekdays --at HH:MM` | `--weekdays --at 08:30` | `30 8 * * 1-5` |
| `--weekends --at HH:MM` | `--weekends --at 10:00` | `0 10 * * 0,6` |
| `--reboot` | `--reboot` | `@reboot` |

Weekday tokens: `sun`, `mon`, `tue`, `wed`, `thu`, `fri`, `sat` (case-insensitive)

`--every-hours` accepts 1, 2, 3, 4, 6, 8, 12 and `--every-minutes` accepts 1, 2, 3, 4, 5, 6, 10, 12, 15, 20, 30. cron restarts `*/N` every day (hours) or every hour (minutes), so other values would not repeat at even intervals. Use `--schedule` if you need them anyway.

### Cron expressions (advanced)

For patterns not covered above, use `--schedule` directly:

```bash
# Every 6 hours on Mon-Wed
cronly add ./report.mjs --schedule "0 */6 * * 1-3"

# 15th of every month at 9:00
cronly add ./monthly.mjs --schedule "0 9 15 * *"
```

### List entries

```bash
cronly list
```

Example output:
```
  a1b2c3d4  0 2 * * *        /home/user/backup.sh      (sh)
  e5f6a7b8  */10 * * * *     /home/user/report.mjs     (node)
```

### Remove

```bash
# By file path
cronly remove ./backup.sh

# By id
cronly remove --id a1b2c3d4
```

### Print raw blocks

```bash
cronly print
```

Outputs the LaunchAgent plist or cron block for managed jobs.

### Health check

```bash
cronly doctor
```

Checks Node.js, script/runtime permissions, writable logs, and duplicate registrations. On macOS it also checks the login session, loaded LaunchAgents, and the last exit status; cron checks crontab access instead and, on Linux, that a cron daemon (`cron`, `crond`, or `fcron`) is running, since nothing in a crontab runs without one. The daemon check is skipped when the process list cannot tell, for example when `/proc` hides other users' processes; set `CRONLY_PROC_DIR` to a missing directory to skip it yourself. Legacy cron jobs are reported for explicit migration. Any failed check exits with code 1.

### macOS permission dialog (`CRONLY_BACKEND=cron`)

On macOS, changing the crontab from an app without Full Disk Access opens a permission dialog, and `cronly add` and `cronly remove` wait until you answer it. The dialog can open behind other windows, so Cronly prints a reminder when the change takes more than a few seconds. To skip the dialog, grant Full Disk Access to the app you run Cronly from (System Settings > Privacy & Security > Full Disk Access).

## How scheduled jobs run

cron starts jobs with a minimal environment, so a script that works in your terminal can fail silently under cron. Cronly sets up each job so it behaves more like a manual run:

- **Working directory**: the job runs from the script's directory, so relative paths such as `.env` or `./config.json` resolve.
- **PATH**: the directory of the Node.js that ran `cronly add` comes first, followed by `/usr/bin:/bin`, so shell scripts can call `node`, `npm`, and `npx`. Call other tools by absolute path, or set `PATH` in your script.
- **Logs**: stdout and stderr are appended to `~/.cronly/logs/<id>.log`. Set `CRONLY_HOME` to use a different base directory. Logs are not rotated. With cron, a job that cannot enter its script's directory is recorded there as well.
- **Node.js version**: jobs run with the exact Node.js binary that registered them (for example an nvm version directory). If you remove that version, `cronly doctor` reports it; run `cronly add` again to switch to the current one.

Entries registered by an older version of Cronly keep their old command line until you run `cronly add` for them again. In particular, a `.sh` entry from 1.0.1 or earlier still runs with `/bin/sh`; `cronly doctor` points out the ones whose script names another interpreter.

## How duplicate prevention works

1. Normalize the script file to an **absolute path** (`path.resolve`)
2. Generate a **dedupe id** from the first 8 hex chars of its SHA-256 hash
3. On `add`, **replace** the block with the same id, along with any block whose path points to the same file (same inode, such as a symlink or a different letter case on macOS) (upsert)
4. Otherwise, **append** a new block

cron runs the path you passed to `add`, so a symlinked deploy such as `current -> releases/v2` keeps following the link. `remove <file>` removes every entry for that file.

### Crontab internal format

```crontab
# Existing manual entry (untouched)
0 * * * * /usr/bin/some-other-job

# [cronly:begin] id=a1b2c3d4 path=/home/user/backup.sh runtime=sh
0 2 * * * { cd '/home/user' && PATH='/usr/local/bin:/usr/bin:/bin' '/bin/sh' '/home/user/backup.sh' ; } >> '/home/user/.cronly/logs/a1b2c3d4.log' 2>&1
# [cronly:end] id=a1b2c3d4
```

Managed entries are wrapped in `# [cronly:begin]` / `# [cronly:end]` blocks, completely isolated from other entries.

## Testing

```bash
npm test
# macOS: real launchd daemon, isolated jobs and cleanup
npm run test:launchd
# Explicit legacy cron integration test
npm run test:integration
```

## Project structure

```
├── bin/cronly.mjs             # CLI entry point
├── lib/
│   ├── cli.mjs                # argv parsing
│   ├── commands.mjs           # add/list/remove/print/doctor
│   ├── backend.mjs            # macOS launchd / Linux cron
│   ├── launchd.mjs            # LaunchAgent lifecycle
│   ├── launchd-schedule.mjs   # native calendar conversion
│   ├── job.mjs                # shared runtime / diagnostics
│   ├── crontab.mjs            # crontab read/write (child_process)
│   ├── entry.mjs              # entry build/parse/dedupe
│   ├── schedule.mjs           # schedule flags → cron expression
│   ├── i18n.mjs               # locale detection, message lookup
│   └── i18n/                  # messages and help text (en, ko, ja, zh)
├── test/
│   ├── test.mjs               # Unit tests
│   ├── launchd-integration.mjs # real launchd daemon test
│   └── integration.mjs        # Integration tests (real crontab)
├── package.json
└── LICENSE
```

## Future extensions

- **dry-run mode**: Preview changes without modifying crontab
- **import/export**: Backup/restore managed entries as JSON
- **log options**: Custom log path and log rotation
- **environment variables**: Set custom env vars for cron execution
- **MAILTO**: Per-entry error notification email
- **groups/tags**: Batch manage entries by group
- **overlap prevention**: flock-based concurrent execution guard

## Limitations

- Per-user LaunchAgents on macOS; user crontab on Linux
- Concurrent Cronly `add`/`remove` commands are serialized per user. Concurrent edits through `crontab -e` or other tools are outside this lock. If a command is killed while it holds the lock and another process later reuses its process ID, the next command reports the lock directory under `/tmp` and that process ID; delete the directory if that process is neither `cronly` nor `crontab`.
- No systemd timer or `/etc/cron.d` support
- Single machine only (no distributed environments)
- No overlap execution prevention
- Logs are appended without rotation
- Cron commands longer than 999 bytes are rejected (Vixie-based cron truncates them)
- Paths containing newline or carriage return characters are not supported

## License

MIT
