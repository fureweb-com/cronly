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
| Duplicate entries possible | Auto dedupe by absolute path |
| Risk of editing other entries | Only touches managed blocks |
| Hard to identify entries | Metadata comments for identification |
| Manual sync on changes | `add` works as upsert |

## Features

- Zero external npm dependencies — only Node.js built-in modules
- No DB, server, or daemon — the real crontab is the source of truth
- Managed entries are wrapped in metadata comments, fully isolated from manual entries
- Paths with spaces, single quotes, and `%` are safely shell-quoted
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

Checks Node.js version, `crontab` command availability, and crontab read access.

## How duplicate prevention works

1. Normalize the script file to an **absolute path** (`path.resolve`)
2. Generate a **dedupe id** from the first 8 hex chars of its SHA-256 hash
3. On `add`, if a block with the same id exists, **replace it** (upsert)
4. Otherwise, **append** a new block

### Crontab internal format

```crontab
# Existing manual entry (untouched)
0 * * * * /usr/bin/some-other-job

# [cronly:begin] id=a1b2c3d4 path=/home/user/backup.sh runtime=sh
0 2 * * * '/bin/sh' '/home/user/backup.sh'
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
│   ├── cli.mjs                # argv parsing, help text
│   ├── commands.mjs           # add/list/remove/print/doctor
│   ├── crontab.mjs            # crontab read/write (child_process)
│   └── entry.mjs              # entry build/parse/dedupe
├── test/
│   ├── test.mjs               # Unit tests
│   └── integration.mjs        # Integration tests (real crontab)
├── package.json
└── LICENSE
```

## Future extensions

- **dry-run mode**: Preview changes without modifying crontab
- **import/export**: Backup/restore managed entries as JSON
- **log path**: Auto-append `>> /path/to/log 2>&1`
- **environment variables**: Set PATH and other env vars for cron execution
- **MAILTO**: Per-entry error notification email
- **groups/tags**: Batch manage entries by group
- **cron expression validation**: Pre-validate schedule values
- **overlap prevention**: flock-based concurrent execution guard

## Limitations

- User crontab only (`crontab -l` / `crontab -`)
- No systemd timer or `/etc/cron.d` support
- Single machine only (no distributed environments)
- No overlap execution prevention
- Paths containing newline or carriage return characters are not supported

## License

MIT
