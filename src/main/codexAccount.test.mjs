import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CodexAccount, parseAccountLimits, parseAccountUsage } from './codexAccount.mjs'
const summary = { lifetimeTokens: 123, peakDailyTokens: 30, longestRunningTurnSec: 40, currentStreakDays: 2, longestStreakDays: 4 }
const limits = { rateLimits: { primary: { usedPercent: 8, windowDurationMins: 10080, resetsAt: 200 } } }
test('documented multi-bucket limits retain every window without duplicating codex', () => {
  const parsed = parseAccountLimits({ ...limits, rateLimitsByLimitId: { codex: limits.rateLimits, review: { limitName: 'Review', primary: { usedPercent: 10, windowDurationMins: 300 } } } })
  assert.equal(parsed.week.usedPct, 8); assert.equal(parsed.week.resetsAt, 200000)
  assert.equal(parsed.quotas.length, 1); assert.equal(parsed.quotas[0].label, 'Review · Session (5hr)')
  assert.equal(parseAccountLimits({}).available, false)
})
test('summary validates counters, retains zero, filters malformed dates and tokens', () => {
  const parsed = parseAccountUsage({ summary, dailyUsageBuckets: [{ startDate: '2026-10-30', tokens: 0 }, { startDate: 'bad', tokens: 2 }, { startDate: '2026-10-29', tokens: -1 }] }, 5)
  assert.equal(parsed.updatedAt, 5); assert.equal(parsed.dailyUsageBuckets.length, 1)
  assert.throws(() => parseAccountUsage({ summary: { ...summary, lifetimeTokens: NaN } }))
})
test('concurrent consumers coalesce, cache expires, errors preserve explicitly stale values and retry', async () => {
  let calls = 0, now = 0, fail = false
  const account = new CodexAccount(async () => { calls++; if (fail) throw new Error('sensitive error'); return { summary } }, { now: () => now })
  await Promise.all([account.get('usage'), account.get('usage')]); assert.equal(calls, 1)
  now = 300001; fail = true
  const stale = await account.get('usage'); assert.equal(stale.stale, true); assert.equal(stale.summary.lifetimeTokens, 123)
  assert.ok(!stale.note.includes('sensitive')); await account.get('usage'); assert.equal(calls, 2)
  now += 30001; fail = false; assert.equal((await account.get('usage')).stale, undefined)
})
test('sign-out/account change clears cached data and rejects old in-flight results', async () => {
  let finish
  const account = new CodexAccount(() => new Promise((r) => { finish = r }))
  const old = account.get('usage'); account.notification({ method: 'account/updated' }); finish({ summary })
  assert.equal((await old).available, false)
  const current = account.get('usage'); finish({ summary: { ...summary, lifetimeTokens: 7 } })
  assert.equal((await current).summary.lifetimeTokens, 7)
})
