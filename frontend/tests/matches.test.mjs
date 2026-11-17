import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { build } from 'vite'

// Use the existing compiler and test runner; no frontend testing dependency.
const result = await build({ configFile: false, logLevel: 'silent', build: {
  write: false, minify: false, lib: { entry: resolve('src/services/matches.ts'), formats: ['es'] },
} })
const output = (Array.isArray(result) ? result[0] : result).output.find(item => item.type === 'chunk' && item.isEntry)
const { calendarDays, localDayKey, monthWindow, matchesPath } = await import(`data:text/javascript;base64,${Buffer.from(output.code).toString('base64')}`)

test('monthly calendar starts on Monday and includes leap day without duplicate dates', () => {
  const days = calendarDays(new Date(2028, 1, 1))
  assert.equal(days.length, 42)
  assert.equal(days[0].getDay(), 1)
  assert.equal(new Set(days.map(localDayKey)).size, 42)
  assert.equal(days.filter(day => day.getMonth() === 1).length, 29)
  assert.ok(days.some(day => localDayKey(day) === '2028-02-29'))
})

test('month boundaries follow local time across DST and year boundaries', () => {
  const previous = process.env.TZ
  try {
    process.env.TZ = 'Europe/Madrid'
    const march = monthWindow(new Date(2030, 2, 1))
    assert.equal(march.from, '2030-02-28T23:00:00.000Z')
    assert.equal(march.to, '2030-03-31T22:00:00.000Z')
    const december = monthWindow(new Date(2030, 11, 1))
    assert.equal(new Date(december.to).getFullYear(), 2031)
    assert.equal(new Date(december.to).getMonth(), 0)
  } finally {
    if (previous === undefined) delete process.env.TZ
    else process.env.TZ = previous
  }
})

test('calendar requests send real optional filters, aware date bounds and pagination', () => {
  const path = matchesPath(new Date(2030, 5, 1), '12', '8', 'FINISHED', 200)
  const url = new URL(path, 'http://gateway.test/api/sports/')
  assert.equal(url.pathname, '/matches')
  assert.equal(url.searchParams.get('team_id'), '12')
  assert.equal(url.searchParams.get('season_id'), '8')
  assert.equal(url.searchParams.get('status'), 'FINISHED')
  assert.equal(url.searchParams.get('offset'), '200')
  assert.equal(url.searchParams.get('limit'), '200')
  assert.ok(url.searchParams.get('date_from').endsWith('Z'))
  const all = new URL(matchesPath(new Date(2030, 5, 1), '', '', ''), 'http://gateway.test')
  assert.equal(all.searchParams.has('team_id'), false)
  assert.equal(all.searchParams.has('season_id'), false)
  assert.equal(all.searchParams.has('status'), false)
})
