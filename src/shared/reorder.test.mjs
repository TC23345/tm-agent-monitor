import test from 'node:test'
import assert from 'node:assert/strict'
import { dropSlot, moveTo, rowSlot } from './reorder.mjs'

const row = (i) => ({ top: i * 34, bottom: i * 34 + 34 })

test('rowSlot counts the rows whose middle is above the pointer', () => {
  const rows = [0, 1, 2].map(row)
  assert.equal(rowSlot(rows, -5), 0)
  assert.equal(rowSlot(rows, 10), 0, 'above the first row\'s middle')
  assert.equal(rowSlot(rows, 20), 1, 'past it')
  assert.equal(rowSlot(rows, 60), 2)
  assert.equal(rowSlot(rows, 500), 3, 'below everything is after the last')
  assert.equal(rowSlot([], 10), 0)
})

test('dropSlot walks wrapped chips: rows above count, the own row by middle, rows below never', () => {
  // Two rows of chips: three on the first (x 0–60, 70–130, 140–200), two on the second (0–60, 70–130).
  const chip = (left, top) => ({ left, right: left + 60, top, bottom: top + 26 })
  const chips = [chip(0, 0), chip(70, 0), chip(140, 0), chip(0, 40), chip(70, 40)]
  assert.equal(dropSlot(chips, 10, -10), 0, 'above every row')
  assert.equal(dropSlot(chips, 10, 10), 0, 'left half of the first chip')
  assert.equal(dropSlot(chips, 50, 10), 1, 'right half of the first chip')
  assert.equal(dropSlot(chips, 250, 10), 3, 'past the first row\'s last chip')
  assert.equal(dropSlot(chips, 10, 50), 3, 'second row, before its first chip')
  assert.equal(dropSlot(chips, 120, 50), 5, 'after the last chip')
  assert.equal(dropSlot(chips, 10, 33), 3, 'in the gap between rows: the row above counts whole')
  assert.equal(dropSlot(chips, 10, 500), 5, 'below every row')
})

test('moveTo moves one item into a slot and keeps the array when nothing changes', () => {
  const list = ['a', 'b', 'c', 'd']
  assert.deepEqual(moveTo(list, 0, 2), ['b', 'a', 'c', 'd'], 'down one')
  assert.deepEqual(moveTo(list, 0, 4), ['b', 'c', 'd', 'a'], 'to the end')
  assert.deepEqual(moveTo(list, 3, 0), ['d', 'a', 'b', 'c'], 'to the start')
  assert.deepEqual(moveTo(list, 2, 1), ['a', 'c', 'b', 'd'], 'up one')
  assert.equal(moveTo(list, 1, 1), list, 'its own slot is no move')
  assert.equal(moveTo(list, 1, 2), list, 'the slot right after it is no move either')
  assert.equal(moveTo(list, 9, 0), list, 'a bad index is ignored')
  assert.deepEqual(moveTo(list, 0, 99), ['b', 'c', 'd', 'a'], 'a slot past the end clamps')
  assert.deepEqual(list, ['a', 'b', 'c', 'd'], 'never mutates')
})
