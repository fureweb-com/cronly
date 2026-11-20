// Stand-in for Windows PowerShell when exercising the CLI on a POSIX host.
const fs = require('fs')
const file = process.env.WINDOWS_TASK_STATE
const entries = JSON.parse(fs.readFileSync(file, 'utf8'))
const { createInterface } = require('readline')

async function main() {
  const lines = createInterface({ input: process.stdin, crlfDelay: Infinity })[Symbol.asyncIterator]()
  const req = JSON.parse((await lines.next()).value)
  fs.appendFileSync(file + '.ops', req.op + '\n')
  const blockedBy = req.checkScriptHost && fs.existsSync(file + '.policy') ? fs.readFileSync(file + '.policy', 'utf8') : null
  if (req.op === 'list') {
    const malformed = fs.existsSync(file + '.malformed') ? JSON.parse(fs.readFileSync(file + '.malformed', 'utf8')) : {}
    if (malformed.stderr) process.stderr.write(malformed.stderr)
    if (malformed.first !== undefined) {
      process.stdout.write(malformed.first + '\r\n')
      return
    }
    process.stdout.write(JSON.stringify({ sid: 'S-1-5-21-1234', entries, blockedBy }) + '\r\n')
    const expected = JSON.parse((await lines.next()).value)
    const changed = entries.filter(entry => expected[entry.id] && expected[entry.id] !== entry.xml)
    process.stdout.write(malformed.last !== undefined ? malformed.last : JSON.stringify(changed.map(entry => entry.id)))
    return
  }
  const before = entries.find(entry => entry.id === req.id)
  if (req.op === 'create' ? before : before.source !== 'Cronly/v1' || before.xml !== req.previousXml) throw new Error('Concurrent change')
  if (req.op === 'run') {
    if (blockedBy) process.stdout.write(blockedBy)
    else fs.writeFileSync(file + '.last-run', before.id)
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

main().catch(err => { console.error(err.message); process.exitCode = 1 })
