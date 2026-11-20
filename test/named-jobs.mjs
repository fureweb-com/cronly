import assert from 'assert/strict'
import { add, list, remove } from '../lib/commands.mjs'
import { makeId } from '../lib/entry.mjs'

export async function checkNamedJobs(file, captureLogs) {
  const first = { name: '평일-report', schedule: '0 9 * * 1-5' }
  const second = { name: 'weekends', schedule: '0 11 * * 6,0' }
  const unnamed = { schedule: '@daily' }
  for (const options of [first, second, unnamed, { ...first, schedule: '@weekly' }, unnamed]) {
    await captureLogs(() => add(file, options))
  }
  const { logs } = await captureLogs(list)
  assert.equal(logs.filter(line => line.includes(file)).length, 3)
  assert.ok(logs.some(line => line.includes('[평일-report]') && line.includes('@weekly')))
  await assert.rejects(() => remove(file, {}), /Multiple jobs match/)
  await assert.rejects(() => remove(null, { name: 'unknown' }), /No job named/)
  await captureLogs(() => remove(null, { name: first.name }))
  await captureLogs(() => remove(null, { id: makeId(file, second.name) }))
  await captureLogs(() => remove(file, {}))
  assert.ok(!(await captureLogs(list)).logs.some(line => line.includes(file)))
}
