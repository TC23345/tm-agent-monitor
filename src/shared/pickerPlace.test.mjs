import test from 'node:test'
import assert from 'node:assert/strict'
import { placePicker, resizePicker, sanitizePickerSize, PICKER_CARD, PICKER_MENUBAR, PICKER_MIN, PICKER_SHADOW } from './pickerPlace.mjs'

const workArea = { x: 0, y: 0, width: 1920, height: 1040 }
const card = { width: 560, height: 420 }
const shadow = 28

test('the card opens at the pointer with the window sized to card plus shadow', () => {
  const p = placePicker({ cursor: { x: 300, y: 200 }, workArea, card, shadow })
  assert.deepEqual(p, { x: 306 - shadow, y: 206 - shadow, width: 560 + 2 * shadow, height: 420 + 2 * shadow, origin: 'top left' })
  assert.equal(PICKER_CARD.width, 560)
  // The menu bar (the workspace title bar's height) sits on top of the old 420 px card; the list keeps its room.
  assert.equal(PICKER_MENUBAR, 41)
  assert.equal(PICKER_CARD.height, 420 + PICKER_MENUBAR)
  assert.equal(PICKER_SHADOW, 28)
})

test('near the right or bottom edge the card flips to the other side of the pointer and the origin follows', () => {
  const right = placePicker({ cursor: { x: 1800, y: 200 }, workArea, card, shadow })
  assert.equal(right.origin, 'top right')
  assert.equal(right.x + shadow + card.width, 1800 - 6)
  const bottom = placePicker({ cursor: { x: 300, y: 1000 }, workArea, card, shadow })
  assert.equal(bottom.origin, 'bottom left')
  assert.equal(bottom.y + shadow + card.height, 1000 - 6)
  const corner = placePicker({ cursor: { x: 1900, y: 1030 }, workArea, card, shadow })
  assert.equal(corner.origin, 'bottom right')
})

test('the card never leaves the work area even when a flip cannot fit, on any display origin', () => {
  const second = { x: 1920, y: -200, width: 1280, height: 700 }
  const p = placePicker({ cursor: { x: 1925, y: -195 }, workArea: second, card, shadow })
  assert.ok(p.x + shadow >= second.x && p.x + shadow + card.width <= second.x + second.width)
  assert.ok(p.y + shadow >= second.y && p.y + shadow + card.height <= second.y + second.height)
  const tiny = { x: 0, y: 0, width: 400, height: 300 }
  const q = placePicker({ cursor: { x: 390, y: 290 }, workArea: tiny, card, shadow })
  assert.equal(q.x + shadow, 0, 'clamped to the left edge when the card is wider than the area')
  assert.equal(q.y + shadow, 0)
})

test('a remembered size is whole pixels within the limits, or null', () => {
  assert.deepEqual(sanitizePickerSize({ width: 700.4, height: 520.6 }), { width: 700, height: 521 })
  assert.deepEqual(sanitizePickerSize({ width: 100, height: 9e9 }), { width: PICKER_MIN.width, height: 4000 })
  for (const bad of [null, undefined, 'big', [700, 500], { width: 700 }, { width: NaN, height: 400 }, { width: '700', height: 500 }]) assert.equal(sanitizePickerSize(bad), null)
})

test('a resize drag grows from the top-left corner, clamped to the minimum and the work area', () => {
  const start = { width: 560, height: 461 }
  const r = resizePicker({ start, dw: 140, dh: 60, cardX: 100, cardY: 100, workArea, shadow })
  assert.deepEqual(r.card, { width: 700, height: 521 })
  assert.deepEqual(r.bounds, { x: 100 - shadow, y: 100 - shadow, width: 700 + 2 * shadow, height: 521 + 2 * shadow })
  assert.deepEqual(resizePicker({ start, dw: -900, dh: -900, cardX: 100, cardY: 100, workArea, shadow }).card, { width: PICKER_MIN.width, height: PICKER_MIN.height })
  // Past the display's right/bottom edge the card stops there.
  assert.deepEqual(resizePicker({ start, dw: 5000, dh: 5000, cardX: 1500, cardY: 700, workArea, shadow }).card, { width: 1920 - 1500, height: 1040 - 700 })
  // A card already near the edge keeps at least the minimum; a junk delta is no move.
  assert.deepEqual(resizePicker({ start, dw: 10, dh: 10, cardX: 1800, cardY: 1000, workArea, shadow }).card, { width: PICKER_MIN.width, height: PICKER_MIN.height })
  assert.deepEqual(resizePicker({ start, dw: NaN, dh: Infinity, cardX: 100, cardY: 100, workArea, shadow }).card, start)
})
