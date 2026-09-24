import test from 'node:test'
import assert from 'node:assert/strict'
import { placePicker, PICKER_CARD, PICKER_SHADOW } from './pickerPlace.mjs'

const workArea = { x: 0, y: 0, width: 1920, height: 1040 }
const card = { width: 560, height: 420 }
const shadow = 28

test('the card opens at the pointer with the window sized to card plus shadow', () => {
  const p = placePicker({ cursor: { x: 300, y: 200 }, workArea, card, shadow })
  assert.deepEqual(p, { x: 306 - shadow, y: 206 - shadow, width: 560 + 2 * shadow, height: 420 + 2 * shadow, origin: 'top left' })
  assert.equal(PICKER_CARD.width, 560)
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
