import assert from 'node:assert/strict'
import test from 'node:test'
import { parseCodexUsage } from './codexSubscriptionUsageCore.mjs'

test('maps Codex quota windows by duration instead of primary/secondary position', () => {
  const parsed = parseCodexUsage('Codex', {
    plan_type: 'team',
    rate_limit: {
      primary_window: { used_percent: 71, limit_window_seconds: 604800, reset_at: 1785006703 },
      secondary_window: null
    }
  })
  assert.equal(parsed.label, 'Codex · Team')
  assert.equal(parsed.session, undefined)
  assert.equal(parsed.week.label, 'Weekly (7 day)')
  assert.equal(parsed.week.usedPct, 71)
  assert.equal(parsed.week.resetsAt, 1_785_006_703_000)
})

test('maps the standard five-hour and weekly pair plus additional limits', () => {
  const parsed = parseCodexUsage('Codex', {
    rate_limit: {
      primary_window: { used_percent: 19, limit_window_seconds: 18000, reset_at: 100 },
      secondary_window: { used_percent: 47, limit_window_seconds: 604800, reset_at: 200 }
    },
    additional_rate_limits: [{
      limit_name: 'Code review',
      rate_limit: { primary_window: { used_percent: 8, limit_window_seconds: 604800, reset_at: 300 } }
    }]
  })
  assert.equal(parsed.session.label, 'Session (5hr)')
  assert.equal(parsed.week.label, 'Weekly (7 day)')
  assert.equal(parsed.quotas[0].label, 'Code review · Weekly (7 day)')
})
