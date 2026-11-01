import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CodexAccount, accountStatusLine, parseAccountLimits, parseAccountStatus, parseAccountUsage } from './codexAccount.mjs'
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
test('sign-in status comes from the CLI whatever stores the credential, and the email is never kept', () => {
  const chatgpt = parseAccountStatus({ account: { type: 'chatgpt', email: 'someone@example.com', planType: 'pro' }, requiresOpenaiAuth: true })
  assert.ok(!JSON.stringify(chatgpt).includes('someone'))
  assert.deepEqual(accountStatusLine(chatgpt), { connected: true, value: 'connected · Pro', detail: 'Reported by the Codex CLI · rate limits and account usage' })
  const named = (planType) => accountStatusLine(parseAccountStatus({ account: { type: 'chatgpt', planType }, requiresOpenaiAuth: true })).value
  assert.equal(named('self_serve_business_prolite'), 'connected · Business Pro Lite')
  assert.equal(named('enterprise_cbp_usage_based'), 'connected · Enterprise CBP usage based')
  assert.equal(named('unknown'), 'connected · ChatGPT')
  assert.equal(accountStatusLine(parseAccountStatus({ account: { type: 'apiKey' }, requiresOpenaiAuth: true })).value, 'connected · API key')
  assert.equal(accountStatusLine(parseAccountStatus({ account: { type: 'amazonBedrock', usesCodexManagedCredentials: true }, requiresOpenaiAuth: false })).value, 'connected · Amazon Bedrock')
  const out = accountStatusLine(parseAccountStatus({ account: null, requiresOpenaiAuth: true }))
  assert.equal(out.connected, false); assert.equal(out.value, 'not signed in')
  const none = accountStatusLine(parseAccountStatus({ account: null, requiresOpenaiAuth: false }))
  assert.equal(none.connected, true); assert.equal(none.value, 'no sign-in needed')
  assert.throws(() => parseAccountStatus({})); assert.throws(() => parseAccountStatus({ account: { type: 1 } }))
})
test('sign-in status separates not checked, no answer and a last known value', async () => {
  assert.equal(accountStatusLine(null).value, 'not checked yet')
  let now = 0, fail = true
  const account = new CodexAccount(async (method) => {
    assert.equal(method, 'account/read')
    if (fail) throw new Error('someone@example.com')
    return { account: { type: 'chatgpt', planType: 'plus' }, requiresOpenaiAuth: true }
  }, { now: () => now })
  const down = await account.get('status')
  assert.equal(accountStatusLine(down).value, 'unavailable'); assert.ok(!accountStatusLine(down).detail.includes('someone'))
  now += 30_001; fail = false
  assert.equal(accountStatusLine(await account.get('status')).value, 'connected · Plus')
  now += 60_001; fail = true
  const stale = accountStatusLine(await account.get('status'))
  assert.equal(stale.value, 'connected · Plus · last known'); assert.equal(stale.connected, true)
})
test('sign-out/account change clears cached data and rejects old in-flight results', async () => {
  let calls = 0
  const answers = []
  const account = new CodexAccount(() => { calls++; return new Promise((r) => answers.push(r)) })
  const tick = () => new Promise((r) => setImmediate(r))
  // The startup case: account/updated lands during the first read. The old answer is
  // dropped, the caller gets a fresh read, and a second caller shares it.
  const first = account.get('usage'); account.notification({ method: 'account/updated' })
  const second = account.get('usage')
  answers[0]({ summary }); await tick()
  answers[1]({ summary: { ...summary, lifetimeTokens: 7 } })
  assert.equal((await first).summary.lifetimeTokens, 7)
  assert.equal((await second).summary.lifetimeTokens, 7)
  assert.equal(calls, 2)
  assert.equal((await account.get('usage')).summary.lifetimeTokens, 7); assert.equal(calls, 2)
})
test('an account that keeps changing mid-read stops after two rereads and says so', async () => {
  let calls = 0
  const account = new CodexAccount(async () => { calls++; account.notification({ method: 'account/updated' }); return { account: null, requiresOpenaiAuth: true } })
  const status = await account.get('status')
  assert.equal(calls, 3); assert.equal(status.available, false); assert.match(status.note, /changed/)
})
