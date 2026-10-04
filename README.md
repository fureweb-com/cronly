# Cronly

[![npm version](https://img.shields.io/npm/v/%40fureweb%2Fcronly?logo=npm)](https://www.npmjs.com/package/@fureweb/cronly)
[![npm downloads](https://img.shields.io/npm/dm/%40fureweb%2Fcronly?logo=npm)](https://www.npmjs.com/package/@fureweb/cronly)
[![license](https://img.shields.io/github/license/fureweb-com/cronly)](https://github.com/fureweb-com/cronly/blob/main/LICENSE)
[![tests](https://github.com/fureweb-com/cronly/actions/workflows/ci.yml/badge.svg)](https://github.com/fureweb-com/cronly/actions/workflows/ci.yml)
[![coverage](https://codecov.io/github/fureweb-com/cronly/graph/badge.svg?branch=main)](https://app.codecov.io/github/fureweb-com/cronly)
[![stars](https://img.shields.io/github/stars/fureweb-com/cronly?style=social)](https://github.com/fureweb-com/cronly/stargazers)

Schedule scripts easily — no cron syntax needed.
Say what you mean: every day at 8, weekdays at 9, every 4 hours.
Cron expressions are still available when you need them. Cronly safely manages the crontab entries underneath.

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
- No DB, server, or daemon — the real crontab is the source of truth
- Managed entries are wrapped in metadata comments, fully isolated from manual entries
- Paths with spaces, single quotes, and `%` are safely shell-quoted
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

Outputs the actual crontab block for managed entries.

### Health check

```bash
cronly doctor
```

Checks the Node.js version, the `crontab` command, crontab read access, that each managed entry's script, runtime, and log directory still exist, and that no file is registered twice. Exits with code 1 if any check fails.

### macOS permission dialog

On macOS, changing the crontab from an app without Full Disk Access opens a permission dialog, and `cronly add` and `cronly remove` wait until you answer it. The dialog can open behind other windows, so Cronly prints a reminder when the change takes more than a few seconds. To skip the dialog, grant Full Disk Access to the app you run Cronly from (System Settings > Privacy & Security > Full Disk Access).

## How scheduled jobs run

cron starts jobs with a minimal environment, so a script that works in your terminal can fail silently under cron. Cronly sets up each job so it behaves more like a manual run:

- **Working directory**: the job runs from the script's directory, so relative paths such as `.env` or `./config.json` resolve.
- **PATH**: the directory of the Node.js that ran `cronly add` comes first, followed by `/usr/bin:/bin`, so shell scripts can call `node`, `npm`, and `npx`. Call other tools by absolute path, or set `PATH` in your script.
- **Logs**: stdout and stderr are appended to `~/.cronly/logs/<id>.log`. Set `CRONLY_HOME` to use a different base directory. Logs are not rotated.
- **Node.js version**: jobs run with the exact Node.js binary that registered them (for example an nvm version directory). If you remove that version, `cronly doctor` reports it; run `cronly add` again to switch to the current one.

Entries registered by an older version of Cronly keep their old command line until you run `cronly add` for them again.

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
0 2 * * * cd '/home/user' && PATH='/usr/local/bin:/usr/bin:/bin' '/bin/sh' '/home/user/backup.sh' >> '/home/user/.cronly/logs/a1b2c3d4.log' 2>&1
# [cronly:end] id=a1b2c3d4
```

Managed entries are wrapped in `# [cronly:begin]` / `# [cronly:end]` blocks, completely isolated from other entries.

## Testing

```bash
npm test
```

## Project structure

```
├── bin/cronly.mjs             # CLI entry point
├── lib/
│   ├── cli.mjs                # argv parsing
│   ├── commands.mjs           # add/list/remove/print/doctor
│   ├── crontab.mjs            # crontab read/write (child_process)
│   ├── entry.mjs              # entry build/parse/dedupe
│   ├── schedule.mjs           # schedule flags → cron expression
│   ├── i18n.mjs               # locale detection, message lookup
│   └── i18n/                  # messages and help text (en, ko, ja, zh)
├── test/
│   ├── test.mjs               # Unit tests
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

- User crontab only (`crontab -l` / `crontab -`)
- No systemd timer or `/etc/cron.d` support
- Single machine only (no distributed environments)
- No overlap execution prevention
- Logs are appended without rotation
- Cron commands longer than 999 bytes are rejected (Vixie-based cron truncates them)
- Paths containing newline or carriage return characters are not supported

## License

MIT
