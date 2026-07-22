import test from 'node:test'
import assert from 'node:assert/strict'
import { parseClaudeUsage } from './subscriptionUsageCore.mjs'

test('preserves named weekly Fable quota returned by the OAuth endpoint', () => {
  const parsed = parseClaudeUsage('You · Max', {
    five_hour: { utilization: 14, resets_at: '2026-07-22T10:00:00Z' },
    seven_day: { utilization: 42, resets_at: '2026-07-27T10:00:00Z' },
    seven_day_fable: { utilization: 67, resets_at: '2026-07-25T10:00:00Z' }
  })
  assert.equal(parsed.quotas?.[0].label, 'Weekly Fable')
  assert.equal(parsed.quotas?.[0].usedPct, 67)
  assert.equal(parsed.week?.usedPct, 42)
})

test('deduplicates a named weekly quota already present in scoped limits', () => {
  const parsed = parseClaudeUsage('You · Max', {
    seven_day_fable: { utilization: 67 },
    limits: [{ kind: 'weekly_scoped', percent: 67, scope: { model: { display_name: 'Fable' } } }]
  })
  assert.equal(parsed.quotas?.length, 1)
})
