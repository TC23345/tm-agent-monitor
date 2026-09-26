import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  autoKeyWidth, boundaryColumn, gripColumns, AUTO_KEY_MAX, readClipCols, resetColumn, resizeColumns, sanitizeWidths, templateFor, withClipCols,
  CLIP_COLUMNS, CLIP_COL_GAP, CLIP_COL_MAX
} from './clipColumns.mjs'

const pane = CLIP_COLUMNS.pane
const picker = CLIP_COLUMNS.picker

test('the untouched templates are the stylesheet variables, character for character', () => {
  const css = readFileSync(new URL('../renderer/src/styles.css', import.meta.url), 'utf8')
  const pick = (name) => new RegExp(`--${name}:\\s*([^;]+);`).exec(css)?.[1].trim()
  assert.equal(templateFor(pane, {}), pick('picker-cols'))
  assert.equal(templateFor(picker, {}), pick('picker-row-cols'))
})

test('the column models: pane icon·clip·source·when·key·star, picker star·icon·clip·source·when·key', () => {
  assert.deepEqual(pane.map((c) => c.id), ['icon', 'clip', 'source', 'when', 'key', 'star'])
  assert.deepEqual(picker.map((c) => c.id), ['star', 'icon', 'clip', 'source', 'when', 'key'])
  for (const model of [pane, picker]) assert.equal(model.filter((c) => c.flex).length, 1)
})

test('a boundary sizes the column left of it, or the one right of the clip column (inverted)', () => {
  assert.equal(boundaryColumn(pane, 0), null) // icon | clip: both would be fixed/flex
  assert.deepEqual(boundaryColumn(pane, 1), { index: 2, sign: -1 }) // clip | source → source, dragged left grows it
  assert.deepEqual(boundaryColumn(pane, 2), { index: 2, sign: 1 })
  assert.deepEqual(boundaryColumn(pane, 4), { index: 4, sign: 1 }) // key | star
  assert.equal(boundaryColumn(pane, 5), null) // the table's right edge
  assert.deepEqual(gripColumns(pane), [1, 2, 3, 4])
  assert.deepEqual(gripColumns(picker), [2, 3, 4])
  assert.equal(boundaryColumn(pane, -1), null)
  assert.equal(boundaryColumn(pane, 1.5), null)
})

// A 700 px header: 20 + clip + 34% source + 48 + 46 + 24, five 10 px gaps.
const available = 700
const measured = () => {
  const source = 0.34 * available
  const clip = available - CLIP_COL_GAP * 5 - (20 + source + 48 + 46 + 24)
  return [20, clip, source, 48, 46, 24]
}

test('dragging the clip|source boundary left widens the source column; the clip column absorbs it', () => {
  const next = resizeColumns(pane, measured(), 1, -150, available)
  assert.equal(next.source, Math.round(0.34 * available + 150))
  assert.deepEqual(Object.keys(next), ['source'])
})

test('the clip column never goes under its minimum', () => {
  const widths = measured()
  const next = resizeColumns(pane, widths, 1, -5000, available)
  const room = widths[1] - pane[1].min
  assert.equal(next.source, Math.round(widths[2] + room))
})

test('a column never goes under its own minimum or past the maximum', () => {
  assert.equal(resizeColumns(pane, measured(), 3, -500, available).when, pane[3].min)
  assert.equal(resizeColumns(pane, measured(), 1, 5000, available).source, pane[2].min)
  const huge = [20, 4000, 200, 48, 46, 24]
  assert.equal(resizeColumns(pane, huge, 2, 9000, 0).source, CLIP_COL_MAX)
})

test('a drag keeps the widths already stored and replaces only its own column', () => {
  const stored = { when: 60 }
  const next = resizeColumns(pane, measured(), 2, 40, available, stored)
  assert.equal(next.when, 60)
  assert.equal(next.source, Math.round(0.34 * available + 40))
  assert.deepEqual(stored, { when: 60 }) // never mutated
})

test('an unusable measurement or boundary changes nothing', () => {
  const stored = { source: 300 }
  assert.deepEqual(resizeColumns(pane, [1, 2], 2, 40, available, stored), stored)
  assert.deepEqual(resizeColumns(pane, measured(), 0, 40, available, stored), stored)
  assert.deepEqual(resizeColumns(pane, measured(), 2, NaN, available, stored), stored)
  assert.deepEqual(resizeColumns(pane, [20, NaN, 1, 1, 1, 1], 2, 40, available, stored), stored)
})

test('with the clip column already at its minimum a column may shrink but not grow', () => {
  const tight = [20, 120, 300, 48, 46, 24]
  const avail = tight.reduce((a, b) => a + b, 0) + CLIP_COL_GAP * 5
  assert.equal(resizeColumns(pane, tight, 2, 50, avail).source, 300)
  assert.equal(resizeColumns(pane, tight, 2, -50, avail).source, 250)
})

test('templateFor: a sized column is minmax(min, w), the clip column keeps its minimum', () => {
  assert.equal(templateFor(pane, { source: 420 }), '20px minmax(120px, 1fr) minmax(80px, 420px) 48px 46px 24px')
  assert.equal(templateFor(picker, { key: 90 }), '24px 20px minmax(120px, 1fr) minmax(0, 34%) 48px minmax(30px, 90px)')
})

test('resetColumn drops the boundary column back to its default', () => {
  assert.deepEqual(resetColumn(pane, { source: 400, when: 70 }, 1), { when: 70 })
  assert.deepEqual(resetColumn(pane, { source: 400 }, 0), { source: 400 })
})

test('sanitizeWidths keeps resizable ids with finite numbers, clamped and rounded', () => {
  assert.deepEqual(sanitizeWidths(pane, { source: 300.6, clip: 500, icon: 90, when: 2, key: 'x', star: 50, bogus: 10 }), { source: 301, when: 36 })
  assert.deepEqual(sanitizeWidths(pane, { source: 1e9 }), { source: CLIP_COL_MAX })
  assert.deepEqual(sanitizeWidths(pane, null), {})
  assert.deepEqual(sanitizeWidths(pane, [1, 2]), {})
})

test('the stored value keeps one bucket per window and drops junk', () => {
  const raw = { pane: { source: 400 }, picker: { when: 70, clip: 9 }, other: { source: 1 } }
  assert.deepEqual(readClipCols(raw, 'pane'), { source: 400 })
  assert.deepEqual(readClipCols(raw, 'picker'), { when: 70 })
  assert.deepEqual(readClipCols('nope', 'pane'), {})
  assert.deepEqual(readClipCols(raw, 'nope'), {})
  assert.deepEqual(withClipCols(raw, 'picker', { source: 200 }), { pane: { source: 400 }, picker: { source: 200 } })
  assert.deepEqual(withClipCols(raw, 'pane', {}), { picker: { when: 70 } })
})

test('the key column widens by default to fit the longest chord chip, unless dragged', () => {
  assert.equal(autoKeyWidth([]), 0)
  const w = autoKeyWidth(['Alt+K', 'Ctrl+Alt+Shift+F6'])
  assert.equal(w, Math.ceil('Ctrl+Alt+Shift+F6'.length * 6.1 + 12))
  assert.equal(autoKeyWidth(['x'.repeat(60)]), AUTO_KEY_MAX)
  assert.equal(templateFor(pane, {}, w), `20px minmax(0, 1fr) minmax(0, 34%) 48px ${w}px 24px`)
  assert.equal(templateFor(pane, {}, 0), templateFor(pane, {}), 'no keybinds: the stylesheet default')
  assert.equal(templateFor(pane, {}, 30), templateFor(pane, {}), 'never narrower than the default')
  assert.equal(templateFor(picker, {}, 500).split(' ').pop(), `${AUTO_KEY_MAX}px`, 'capped')
  assert.equal(templateFor(pane, { key: 60 }, w), '20px minmax(120px, 1fr) minmax(0, 34%) 48px minmax(30px, 60px) 24px', 'a dragged width wins')
  assert.equal(templateFor(pane, { source: 300 }, w), `20px minmax(120px, 1fr) minmax(80px, 300px) 48px ${w}px 24px`)
})
