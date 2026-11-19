// Stand-in for Windows PowerShell when exercising the CLI on a POSIX host.
const fs = require('fs')
const file = process.env.WINDOWS_TASK_STATE
const entries = JSON.parse(fs.readFileSync(file, 'utf8'))
const req = JSON.parse(fs.readFileSync(0, 'utf8'))
if (req.op === 'list') {
  process.stdout.write(JSON.stringify({ sid: 'S-1-5-21-1234', entries }))
} else {
  const before = entries.find(entry => entry.id === req.id)
  if (req.op === 'create' ? before : before.xml !== req.previousXml) throw new Error('Concurrent change')
  if (req.op === 'run') {
    fs.writeFileSync(file + '.last-run', before.id)
    process.exit(0)
  }
  if (req.op !== 'create') entries.splice(entries.indexOf(before), 1)
  if (req.op !== 'remove') {
    const metadata = req.xml.match(/<Documentation>(.+)<\/Documentation>/)[1]
      .replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&amp;/g, '&')
    entries.push({ id: req.id, metadata, source: 'Cronly/v1', xml: req.xml, enabled: true, result: 0x41303 })
  }
  fs.writeFileSync(file, JSON.stringify(entries))
}
