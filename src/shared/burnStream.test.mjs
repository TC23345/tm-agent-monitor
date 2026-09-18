import test from 'node:test'
import assert from 'node:assert/strict'
import { MAX_STREAKS, STREAM_FLOATS, STREAM_RGB, burnRate, packStream, streamColor, streamParams } from './burnStream.mjs'

const HOUR = 3_600_000

test('burnRate is headroom over time left, and 0 whenever there is no projection', () => {
  const now = 1_000_000
  assert.equal(burnRate(72, now + 95 * 60_000, now), 28 / (95 / 60))
  assert.equal(burnRate(50, now + HOUR, now), 50)
  assert.equal(burnRate(50, undefined, now), 0)
  assert.equal(burnRate(50, now - 1, now), 0, 'a projection in the past is stale')
  assert.equal(burnRate(100, now + HOUR, now), 0, 'a spent window has no pace')
  assert.equal(burnRate(NaN, now + HOUR, now), 0)
})

test('streamParams scales count and speed with the rate, clamped, and is null without one', () => {
  const now = 0
  assert.equal(streamParams(40, undefined, now), null)
  const slow = streamParams(90, now + 10 * HOUR, now) // 1 pct/h
  assert.deepEqual(slow, { rate: 1, count: 4, speed: 14.5, fill: 0.9 })
  const fast = streamParams(10, now + HOUR, now) // 90 pct/h
  assert.equal(fast.count, MAX_STREAKS)
  assert.equal(fast.speed, 90)
  assert.equal(fast.fill, 0.1)
  const over = streamParams(150, now + HOUR, now)
  assert.equal(over, null)
})

test('streamColor follows the tone and goes hot when the bar is critical', () => {
  assert.deepEqual(streamColor('blue', 'normal'), STREAM_RGB.blue)
  assert.deepEqual(streamColor('amber', undefined), STREAM_RGB.amber)
  assert.deepEqual(streamColor('blue', 'critical'), STREAM_RGB.critical)
  assert.deepEqual(streamColor('nope', 'warning'), STREAM_RGB.amber)
})

test('packStream lays the parameters out as stream.wgsl declares them', () => {
  const p = streamParams(72, 95 * 60_000, 0)
  const data = packStream(p, { time: 3, w: 300, h: 6, sx: 2, sy: 2, color: STREAM_RGB.blue })
  assert.equal(data.length, STREAM_FLOATS)
  assert.equal((STREAM_FLOATS * 4) % 16, 0)
  assert.deepEqual([...data.slice(0, 4)], [3, 300, 6, p.count])
  assert.deepEqual([...data.slice(4, 8)].map((v) => Math.round(v * 1000) / 1000), [Math.round(p.speed * 1000) / 1000, 0.72, 2, 2])
  assert.deepEqual([...data.slice(8, 12)].map((v) => Math.round(v * 100) / 100), [0.5, 0.69, 1, 1])
  // Nothing to draw clears the buffer it is handed.
  const again = packStream(null, { time: 9, w: 1, h: 1, sx: 1, sy: 1, color: STREAM_RGB.blue }, data)
  assert.equal(again, data)
  assert.equal(data[3], 0)
  assert.equal(data[0], 0)
})
