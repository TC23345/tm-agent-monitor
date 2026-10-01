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

test('shows a scoped weekly limit the endpoint marks inactive once it has usage (the 2026-09-30 response)', () => {
  // Trimmed from the live response: Fable in use, 13% of its weekly limit, is_active false.
  const parsed = parseClaudeUsage('You · Max', {
    five_hour: { utilization: 13, resets_at: '2026-09-30T10:10:00.399878+00:00' },
    seven_day: { utilization: 15, resets_at: '2026-10-06T11:00:00.399899+00:00' },
    seven_day_opus: null,
    seven_day_breakdown: { as_of: '2026-09-30T07:02:54Z', rows: [{ key: 'claude_code', display_name: 'Claude Code', percent: 99 }] },
    limits: [
      { kind: 'session', percent: 13, severity: 'normal', scope: null, is_active: false },
      { kind: 'weekly_all', percent: 15, severity: 'normal', scope: null, is_active: true },
      { kind: 'weekly_scoped', percent: 13, severity: 'normal', resets_at: '2026-10-06T11:00:00.400068+00:00', scope: { model: { id: null, display_name: 'Fable' }, surface: null }, is_active: false }
    ]
  })
  assert.deepEqual(parsed.quotas, [{ label: 'Weekly Fable', usedPct: 13, resetsAt: Date.parse('2026-10-06T11:00:00.400068+00:00'), tone: 'amber', severity: 'normal' }])
  assert.equal(parsed.session?.usedPct, 13)
  assert.equal(parsed.week?.usedPct, 15)
})

test('reports which windows and limits the response carried, including nulls and inactive limits', () => {
  const parsed = parseClaudeUsage('You · Max', {
    five_hour: { utilization: 14, resets_at: '2026-07-22T10:00:00Z' },
    seven_day: { utilization: 42, resets_at: '2026-07-27T10:00:00Z' },
    seven_day_fable: null,
    limits: [
      { kind: 'weekly_all', severity: 'normal' },
      { kind: 'weekly_scoped', is_active: false, percent: 0, scope: { model: { display_name: 'Fable' } } }
    ]
  })
  assert.deepEqual(parsed.windows, ['five_hour', 'seven_day', 'seven_day_fable:null', 'limit:weekly_all', 'limit:weekly_scoped:Fable:inactive'])
  assert.equal(parsed.quotas, undefined)
})
