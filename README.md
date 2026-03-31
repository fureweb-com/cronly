# crontab-agent

Put a script on a cron schedule without opening `crontab -e`.
Add one file, check what is registered, and remove it later when you no longer need it.

**[English](./README.md)** | [한국어](./README.ko.md) | [日本語](./README.ja.md) | [中文](./README.zh.md)

## In One Minute

```bash
# Run this script every 10 minutes
crontab-agent add ./report.mjs --schedule "*/10 * * * *"

# See what this tool manages
crontab-agent list

# Remove it later
crontab-agent remove ./report.mjs
```

Use this when you want to:

- run a Node.js script or shell script on a schedule
- avoid editing unrelated cron entries by hand
- update the schedule by running `add` again for the same file

## Why?

Managing crontab manually with `crontab -e` leads to common problems:

- Accidentally registering the same script twice
- Hard to tell which entry belongs to which script
- Risk of breaking other cron entries when editing
- Forgetting to sync crontab after changing a script path

**crontab-agent** solves these:

| Manual crontab | crontab-agent |
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
npm install -g crontab-agent

# Or use without installing
npx crontab-agent

# Local development
git clone https://github.com/fureweb/crontab-agent.git
cd crontab-agent
npm link
```

## Usage

### Register a script

```bash
# .sh file → runtime auto-detected (sh)
crontab-agent add ./backup.sh --schedule "0 2 * * *"

# .mjs file → runtime auto-detected (node)
crontab-agent add ./report.mjs --schedule "*/10 * * * *"

# Explicit runtime
crontab-agent add ./custom-binary --schedule "0 * * * *" --runtime exec

# Cron aliases
crontab-agent add ./startup.sh --schedule "@reboot"
```

Re-adding the same file **updates instead of duplicating**:

```bash
# First time: register
crontab-agent add ./backup.sh --schedule "0 2 * * *"

# Again: updates the schedule (no duplicate)
crontab-agent add ./backup.sh --schedule "0 3 * * *"
```

### List entries

```bash
crontab-agent list
```

Example output:
```
  a1b2c3d4  0 2 * * *        /home/user/backup.sh      (sh)
  e5f6a7b8  */10 * * * *     /home/user/report.mjs     (node)
```

### Remove

```bash
# By file path
crontab-agent remove ./backup.sh

# By id
crontab-agent remove --id a1b2c3d4
```

### Print raw blocks

```bash
crontab-agent print
```

Outputs the raw crontab representation of managed entries.

### Health check

```bash
crontab-agent doctor
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

# [crontab-agent:begin] id=a1b2c3d4 path=/home/user/backup.sh runtime=sh
0 2 * * * '/bin/sh' '/home/user/backup.sh'
# [crontab-agent:end] id=a1b2c3d4
```

Managed entries are wrapped in `# [crontab-agent:begin]` / `# [crontab-agent:end]` blocks, completely isolated from other entries.

## Testing

```bash
npm test
```

## Project structure

```
├── bin/crontab-agent.mjs      # CLI entry point
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
