import test from 'node:test'
import assert from 'node:assert/strict'
import {
  MAX_RECENT, RECENT_WINDOW_MS, STREAM_DEFAULT, STREAM_RESERVE, STREAM_SNAP,
  clampStreamHeight, packRows, readStreamHeight, recentList, sanitizeRecent, touchRecent
} from './projectStrip.mjs'

const NOW = Date.UTC(2026, 8, 29, 18)
const MIN = 60_000

test('recent: touches keep the newest time per folder, case- and slash-insensitive', () => {
  let map = {}
  map = touchRecent(map, [
    { cwd: 'C:\\Projects\\api', label: 'api', at: NOW - 30 * MIN },
    { cwd: 'c:/projects/API/', at: NOW - 5 * MIN },        // same folder, newer
    { cwd: 'C:\\Projects\\web', label: 'web', at: NOW - 10 * MIN },
    { cwd: 'C:\\Projects\\api', at: NOW - 50 * MIN }       // older: ignored
  ], NOW)
  assert.deepEqual(recentList(map, NOW).map((p) => [p.label, (NOW - p.at) / MIN]), [['api', 5], ['web', 10]])
})

test('recent: nothing older than four hours, nothing without a folder, and no change returns the same map', () => {
  const map = touchRecent({}, [
    { cwd: 'C:\\old', at: NOW - RECENT_WINDOW_MS - 1 },
    { cwd: '', at: NOW },
    { label: 'no folder', at: NOW },
    { cwd: 'C:\\p\\ok', at: NOW - MIN }
  ], NOW)
  assert.deepEqual(Object.values(map).map((p) => p.label), ['ok'])
  assert.equal(touchRecent(map, [{ cwd: 'C:\\p\\ok', at: NOW - 2 * MIN }], NOW), map, 'an older touch is not a change')
  assert.equal(touchRecent(map, [], NOW), map)
  // Time passing prunes on the next fold.
  assert.deepEqual(touchRecent(map, [], NOW + RECENT_WINDOW_MS), {})
  // A future timestamp is clamped to now, so it cannot pin a badge in front.
  const future = touchRecent({}, [{ cwd: 'C:\\p\\f', at: NOW + 60 * MIN }], NOW)
  assert.equal(Object.values(future)[0].at, NOW)
})

test('recent: the label falls back to the folder name, and the map is capped newest-first', () => {
  const one = touchRecent({}, [{ cwd: 'C:\\Users\\me\\Projects\\wow-forever-site\\', at: NOW }], NOW)
  assert.equal(Object.values(one)[0].label, 'wow-forever-site')
  const many = touchRecent({}, Array.from({ length: MAX_RECENT + 5 }, (_, i) => ({ cwd: `C:\\p\\${i}`, at: NOW - i * 1000 })), NOW)
  const labels = recentList(many, NOW).map((p) => p.label)
  assert.equal(labels.length, MAX_RECENT)
  assert.equal(labels[0], '0')
  assert.ok(!labels.includes(String(MAX_RECENT + 4)))
})

test('recent: sanitize drops junk and stale entries from storage', () => {
  const raw = {
    a: { cwd: 'C:\\p\\a', label: 'a', at: NOW - MIN },
    b: { cwd: 'C:\\p\\b', at: NOW - RECENT_WINDOW_MS - MIN },
    c: { cwd: 5, at: NOW },
    d: { cwd: 'C:\\p\\d', at: 'yesterday' },
    e: null,
    f: { cwd: 'C:\\p\\f', label: '  ', at: NOW - 2 * MIN }
  }
  const out = sanitizeRecent(raw, NOW)
  assert.deepEqual(recentList(out, NOW).map((p) => p.label), ['a', 'f'])
  assert.deepEqual(sanitizeRecent([], NOW), {})
  assert.deepEqual(sanitizeRecent('x', NOW), {})
})

test('packRows: everything that fits fills in reading order, wrapping once', () => {
  assert.deepEqual(packRows([50, 50, 50], 200, 6), { rows: [[0, 1, 2]], overflow: false })
  assert.deepEqual(packRows([80, 80, 80, 80], 200, 6), { rows: [[0, 1], [2, 3]], overflow: false })
  assert.deepEqual(packRows([], 200, 6), { rows: [[]], overflow: false })
})

test('packRows: overflow balances both rows so the newest sit at the left of each', () => {
  const { rows, overflow } = packRows([80, 80, 80, 80, 80, 80, 80], 200, 6)
  assert.equal(overflow, true)
  assert.deepEqual(rows, [[0, 2, 4, 6], [1, 3, 5]])
  // Uneven widths: each badge goes to the shorter row.
  assert.deepEqual(packRows([150, 40, 40, 40, 150, 40], 160, 6).rows, [[0, 5], [1, 2, 3, 4]])
})

test('packRows: a single badge wider than the strip still reads as overflow', () => {
  assert.deepEqual(packRows([300], 200, 6), { rows: [[0]], overflow: true })
})

test('stream height: snaps shut near zero, leaves room for the sections under it', () => {
  assert.equal(clampStreamHeight(STREAM_SNAP - 1, 900), 0)
  assert.equal(clampStreamHeight(STREAM_SNAP, 900), STREAM_SNAP)
  assert.equal(clampStreamHeight(250.4, 900), 250)
  assert.equal(clampStreamHeight(5_000, 900), 900 - STREAM_RESERVE)
  assert.equal(clampStreamHeight(120, 150), STREAM_SNAP, 'a tiny sidebar still allows the smallest stream')
  assert.equal(clampStreamHeight(NaN, 900), STREAM_DEFAULT)
  assert.equal(readStreamHeight('240'), 240)
  assert.equal(readStreamHeight('0'), 0)
  assert.equal(readStreamHeight(null), STREAM_DEFAULT)
  assert.equal(readStreamHeight('-5'), STREAM_DEFAULT)
  assert.equal(readStreamHeight('tall'), STREAM_DEFAULT)
})
