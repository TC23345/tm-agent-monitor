import test from 'node:test'
import assert from 'node:assert/strict'
import { dayKey, historySeries, modelMix } from './history.mjs'

const DAYS = [
  { date: '2026-08-23', tokensOut: 1000, costUsd: 10, byProvider: { claude: { tokensOut: 700, costUsd: 7, byModel: [{ model: 'claude-fable-5', tokensOut: 700, costUsd: 7 }] }, codex: { tokensOut: 300, costUsd: 3, byModel: [{ model: 'gpt-5.4', tokensOut: 300, costUsd: 3 }] } }, apiCostUsd: 2 },
  { date: '2026-08-25', tokensOut: 500, costUsd: 4, valueComplete: false, byModel: [{ model: 'claude-fable-5', tokensOut: 500, costUsd: 4, valueComplete: false }] },
  { date: '2026-07-01', tokensOut: 99999, costUsd: 999 } // outside the window
]

test('dayKey is a local calendar key', () => {
  assert.equal(dayKey(new Date(2026, 7, 5)), '2026-08-05')
})

test('the series covers every calendar day ending today, zero where nothing was recorded', () => {
  const s = historySeries(DAYS, { count: 5, today: '2026-08-25' })
  assert.deepEqual(s.days.map((d) => d.date), ['2026-08-21', '2026-08-22', '2026-08-23', '2026-08-24', '2026-08-25'])
  assert.deepEqual(s.days.map((d) => d.tokens), [0, 0, 1000, 0, 500])
  assert.deepEqual(s.days.map((d) => d.recorded), [false, false, true, false, true])
  assert.equal(s.days[2].label, '23')
  assert.equal(s.maxTokens, 1000)
})

test('provider split is read from byProvider, and a legacy day counts as Claude', () => {
  const s = historySeries(DAYS, { count: 3, today: '2026-08-25' })
  assert.deepEqual(s.days[0].providers, { claude: { tokens: 700, value: 7, valueComplete: true }, codex: { tokens: 300, value: 3, valueComplete: true } })
  assert.deepEqual(s.days[2].providers, { claude: { tokens: 500, value: 4, valueComplete: false } })
  assert.equal(s.days[2].valueComplete, false)
})

test('totals add up across the window only, with API spend kept separate', () => {
  const s = historySeries(DAYS, { count: 30, today: '2026-08-25' })
  assert.equal(s.totals.tokens, 1500)
  assert.equal(s.totals.value, 14)
  assert.equal(s.totals.apiValue, 2)
  assert.equal(s.totals.recordedDays, 2)
  assert.deepEqual(s.totals.byProvider, { claude: { tokens: 1200, value: 11 }, codex: { tokens: 300, value: 3 } })
})

test('model mix aggregates across days and providers, largest value first, with shares', () => {
  const mix = modelMix(DAYS, { since: '2026-08-01' })
  assert.deepEqual(mix.map((r) => r.model), ['claude-fable-5', 'gpt-5.4'])
  assert.equal(mix[0].tokens, 1200)
  assert.equal(mix[0].value, 11)
  assert.equal(mix[0].valueComplete, false)
  assert.equal(mix[0].share.toFixed(3), (11 / 14).toFixed(3))
  assert.equal(modelMix(DAYS, { since: '2026-08-25' }).length, 1)
  assert.deepEqual(modelMix(undefined), [])
})

test('junk input is tolerated', () => {
  const s = historySeries([null, { nope: 1 }, { date: 5 }], { count: 2, today: '2026-08-25' })
  assert.equal(s.totals.tokens, 0)
  assert.equal(s.days.length, 2)
})
