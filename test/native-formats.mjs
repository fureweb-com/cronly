import assert from 'assert/strict'
import { readFileSync } from 'fs'
import { join } from 'path'
import { buildSystemdUnits } from '../lib/systemd.mjs'
import { windowsLauncher, windowsTaskXml } from '../lib/windows-task.mjs'

function fixture(name) {
  return readFileSync(new URL('./fixtures/native/' + name, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
}

export function testNativeFormats(test) {
  const jobs = JSON.parse(fixture('jobs.json'))
  for (const version of [1, 2]) {
    test(`systemd v${version}: installed service and timer bytes`, () => {
      const units = buildSystemdUnits(jobs.systemd, version)
      for (const kind of ['service', 'timer']) assert.equal(units[kind], fixture(`systemd-v${version}.${kind}`))
    })
  }
  test('Windows: installed direct and windowless task XML', () => {
    const sid = 'S-1-5-21-1234'
    assert.equal(windowsTaskXml(jobs.windows, sid) + '\n', fixture('windows-direct.xml'))
    const expected = fixture('windows-wscript-v1.xml').replace('C:\\Windows\\System32\\wscript.exe',
      join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'wscript.exe'))
    assert.equal(windowsTaskXml({ ...jobs.windows, launcher: 'wscript-v1' }, sid) + '\n', expected)
  })
  test('Windows: shared v1 JScript launcher bytes including CRLF', () => {
    assert.equal(windowsLauncher, fixture('windows-launcher-v1.txt').replace(/\n/g, '\r\n'))
  })
}
