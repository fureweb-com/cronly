// Invoked as the sandbox's systemctl. Only model the calls Cronly makes.
const fs = require('fs')
const path = require('path')
const dir = process.env.XDG_CONFIG_HOME
const [user, ...args] = process.argv.slice(2)
const [command, unit] = args.filter(arg => !arg.startsWith('--'))
if (user !== '--user') throw new Error('expected --user')
const file = path.join(dir, 'state.json')
const state = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file)) : {}
const current = state[unit] || { active: false, enabled: false }
const fragment = path.join(dir, 'systemd/user', unit || '')
const failures = path.join(dir, 'failures.json')
if (fs.existsSync(failures)) {
  const queue = JSON.parse(fs.readFileSync(failures))
  if (queue[0] === command) {
    fs.writeFileSync(failures, JSON.stringify(queue.slice(1)))
    console.error('simulated ' + command + ' failure')
    process.exit(1)
  }
}
switch (command) {
  case 'show':
    if (unit) {
      const loaded = fs.existsSync(fragment)
      const overrides = fs.existsSync(file + '.properties') ? fs.readFileSync(file + '.properties', 'utf8') : ''
      const installed = loaded && fs.existsSync(file + '.installed') ? fs.readFileSync(file + '.installed', 'utf8') : ''
      console.log([
        'LoadState=' + (loaded ? 'loaded' : 'not-found'),
        'FragmentPath=' + (loaded ? fragment : ''),
        'DropInPaths=',
        'ActiveState=' + (current.active ? 'active' : 'inactive'),
        'UnitFileState=' + (current.enabled ? 'enabled' : 'disabled'),
        'Result=success', overrides, installed,
      ].join('\n'))
    }
    break
  case 'enable': current.enabled = true; break
  case 'disable':
    current.enabled = false
    if (args.includes('--now')) current.active = false
    break
  case 'start': current.active = true; break
  case 'stop': current.active = false; break
  case 'daemon-reload': break
  default: throw new Error('unexpected command: ' + command)
}
if (unit) state[unit] = current
fs.writeFileSync(file, JSON.stringify(state))
