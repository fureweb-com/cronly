#!/usr/bin/env node

import { parseArgv, USAGE } from '../lib/cli.mjs'
import { add, list, remove, print, doctor } from '../lib/commands.mjs'

const { command, args, flags } = parseArgv(process.argv)

if (!command || flags.help) {
  console.log(USAGE)
  process.exit(0)
}

try {
  switch (command) {
    case 'add':
      await add(args[0], { schedule: flags.schedule, runtime: flags.runtime })
      break
    case 'list':
      await list()
      break
    case 'remove':
      await remove(args[0], { id: flags.id })
      break
    case 'print':
      await print()
      break
    case 'doctor':
      await doctor()
      break
    default:
      console.error(`알 수 없는 명령어예요: ${command}`)
      console.log(USAGE)
      process.exit(1)
  }
} catch (err) {
  console.error(`오류가 났어요: ${err.message}`)
  process.exit(1)
}
