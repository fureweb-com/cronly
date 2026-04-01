#!/usr/bin/env node

import { createRequire } from 'module'
import { parseArgv } from '../lib/cli.mjs'
import { normalizeLocale, detectLocale, setLocale, t, getUsage } from '../lib/i18n.mjs'
import { resolveSchedule } from '../lib/schedule.mjs'
import { add, list, remove, print, doctor } from '../lib/commands.mjs'

const { command, args, flags } = parseArgv(process.argv)

// ── validate --lang (must error before anything else) ──────────────────────

if (flags.lang && !normalizeLocale(flags.lang)) {
  console.error(t('errors.invalid_lang', { lang: flags.lang }))
  process.exit(1)
}

// ── --version / -v ─────────────────────────────────────────────────────────

if (flags.version) {
  const require = createRequire(import.meta.url)
  const { version } = require('../package.json')
  console.log(version)
  process.exit(0)
}

// ── detect and set locale ──────────────────────────────────────────────────

setLocale(detectLocale(flags))

// ── --help ─────────────────────────────────────────────────────────────────

if (flags.help) {
  console.log(getUsage())
  process.exit(0)
}

// ── no command ─────────────────────────────────────────────────────────────

if (!command) {
  const knownGlobal = new Set(['help', 'version', 'lang'])
  const unknownFlags = Object.keys(flags).filter((f) => !knownGlobal.has(f))
  if (unknownFlags.length > 0) {
    console.error(t('errors.unknown_option', { flags: unknownFlags.map((f) => `--${f}`).join(', ') }))
    console.error('')
    console.error(getUsage())
    process.exit(1)
  }
  console.log(getUsage())
  process.exit(0)
}

// ── unknown flag detection ──────────────────────────────────────────────────

const KNOWN_FLAGS = {
  add: new Set([
    'schedule', 'daily', 'every-hours', 'every-minutes',
    'weekly', 'days', 'weekdays', 'weekends', 'reboot',
    'at', 'runtime', 'lang', 'help', 'version',
  ]),
  remove: new Set(['id', 'lang', 'help', 'version']),
  list: new Set(['lang', 'help', 'version']),
  print: new Set(['lang', 'help', 'version']),
  doctor: new Set(['lang', 'help', 'version']),
}

const EXPECTED_ARGS = { add: 1, remove: 1, list: 0, print: 0, doctor: 0 }

function rejectUnknownFlags(cmd, flags) {
  const known = KNOWN_FLAGS[cmd]
  const unknown = Object.keys(flags).filter((f) => !known.has(f))
  if (unknown.length > 0) {
    console.error(t('errors.unknown_option', { flags: unknown.map((f) => `--${f}`).join(', ') }))
    process.exit(1)
  }
}

function rejectExtraArgs(cmd, args) {
  const max = EXPECTED_ARGS[cmd]
  if (max !== undefined && args.length > max) {
    const extra = args.slice(max).join(', ')
    console.error(t('errors.extra_args', { command: cmd, extra }))
    process.exit(1)
  }
}

// ── command dispatch ───────────────────────────────────────────────────────

try {
  switch (command) {
    case 'add': {
      rejectUnknownFlags('add', flags)
      rejectExtraArgs('add', args)
      const result = resolveSchedule(flags)
      if (result.error) {
        console.error(t(`schedule.${result.error.code}`, result.error))
        process.exit(1)
      }
      await add(args[0], { schedule: result.cron, runtime: flags.runtime })
      break
    }
    case 'list':
      rejectUnknownFlags('list', flags)
      rejectExtraArgs('list', args)
      await list()
      break
    case 'remove':
      rejectUnknownFlags('remove', flags)
      rejectExtraArgs('remove', args)
      await remove(args[0], { id: flags.id })
      break
    case 'print':
      rejectUnknownFlags('print', flags)
      rejectExtraArgs('print', args)
      await print()
      break
    case 'doctor':
      rejectUnknownFlags('doctor', flags)
      rejectExtraArgs('doctor', args)
      await doctor()
      break
    default:
      console.error(t('errors.unknown_command', { command }))
      console.log(getUsage())
      process.exit(1)
  }
} catch (err) {
  console.error(t('errors.runtime', { message: err.message }))
  process.exit(1)
}
