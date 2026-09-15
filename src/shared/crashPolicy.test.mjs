import { test } from 'node:test'
import assert from 'node:assert/strict'
import { reloadBudget } from './crashPolicy.mjs'

test('three reloads in five minutes, then stop; old entries fall out of the window', () => {
  const t = 1_000_000
  let h = []
  for (let i = 0; i < 3; i++) {
    const r = reloadBudget(h, t + i * 1000)
    assert.equal(r.allow, true)
    h = r.history
  }
  assert.deepEqual(reloadBudget(h, t + 4000), { allow: false, history: h })
  // Five minutes later the first two have aged out and one slot is free again.
  const later = reloadBudget(h, t + 5 * 60_000 + 1500)
  assert.equal(later.allow, true)
  assert.equal(later.history.length, 2)
})

test('junk history is tolerated', () => {
  assert.equal(reloadBudget(null, 5).allow, true)
  assert.equal(reloadBudget([NaN, 'x', undefined], 5).allow, true)
})
