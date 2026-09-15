import { test } from 'node:test'
import assert from 'node:assert/strict'
import { blankBitmap, drawBadge } from './trayBadge.mjs'

const px = (buf, w, x, y) => Array.from(buf.subarray((y * w + x) * 4, (y * w + x) * 4 + 4))

test('an empty label leaves the bitmap untouched', () => {
  const buf = blankBitmap(16)
  drawBadge(buf, 16, 16, '')
  assert.ok(buf.every((b) => b === 0))
})

test('a badge paints a red disc in the bottom-right and white text inside it, nothing top-left', () => {
  const buf = drawBadge(blankBitmap(32), 32, 32, '2')
  assert.deepEqual(px(buf, 32, 0, 0), [0, 0, 0, 0])
  // Somewhere in the bottom-right quadrant there is red, and somewhere white.
  let red = 0, white = 0
  for (let y = 16; y < 32; y++) for (let x = 16; x < 32; x++) {
    const [b, g, r, a] = px(buf, 32, x, y)
    if (a === 255 && r === 0xe0 && g === 0x3c && b === 0x3c) red++
    if (a === 255 && r === 255 && g === 255 && b === 255) white++
  }
  assert.ok(red > 20, `red pixels: ${red}`)
  assert.ok(white >= 5, `white pixels: ${white}`)
})

test('a two-character label is wider than a one-character one and never writes out of bounds', () => {
  const one = drawBadge(blankBitmap(16), 16, 16, '1')
  const two = drawBadge(blankBitmap(16), 16, 16, '9+')
  const painted = (buf) => { let n = 0; for (let i = 3; i < buf.length; i += 4) if (buf[i]) n++; return n }
  assert.ok(painted(two) > painted(one))
  assert.equal(two.length, 16 * 16 * 4)
})
