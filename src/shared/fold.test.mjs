// Unit tests for the top-N + "other" fold. Run: npm test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { foldTopN } from './fold.mjs'

const row = (project, tokensOut, costUsd) => ({ project, tokensOut, costUsd })

test('returns short lists unchanged (no empty "other")', () => {
  const rows = [row('a', 10, 1), row('b', 5, 0.5)]
  assert.deepEqual(foldTopN(rows, 5), rows)
  assert.deepEqual(foldTopN([], 5), [])
})

test('exactly N rows stay unfolded', () => {
  const rows = [row('a', 1, 1), row('b', 1, 1), row('c', 1, 1)]
  assert.deepEqual(foldTopN(rows, 3), rows)
})

test('folds the tail into a summed "other"', () => {
  const rows = [row('a', 100, 5), row('b', 50, 2), row('c', 20, 1), row('d', 10, 0.5)]
  const out = foldTopN(rows, 2)
  assert.equal(out.length, 3)
  assert.deepEqual(out[2], { project: 'other', tokensOut: 30, costUsd: 1.5 })
})
