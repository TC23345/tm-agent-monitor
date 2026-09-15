import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isWake, tickAllowed } from './pauses.mjs'

test('ticks run only while neither locked nor suspended', () => {
  assert.equal(tickAllowed({}), true)
  assert.equal(tickAllowed(undefined), true)
  assert.equal(tickAllowed({ locked: true }), false)
  assert.equal(tickAllowed({ suspended: true }), false)
  assert.equal(tickAllowed({ locked: true, suspended: true }), false)
})

test('a wake is paused → running, nothing else', () => {
  assert.equal(isWake({ locked: true }, {}), true)
  assert.equal(isWake({ suspended: true }, { locked: false }), true)
  assert.equal(isWake({ locked: true, suspended: true }, { suspended: true }), false) // still suspended
  assert.equal(isWake({}, {}), false)
  assert.equal(isWake({}, { locked: true }), false)
})
