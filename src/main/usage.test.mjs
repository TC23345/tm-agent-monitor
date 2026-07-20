import assert from 'node:assert/strict'
import test from 'node:test'
import { fetchApiUsage, parseDecimalCents, sumNumericField } from './usageCore.mjs'

test('decimal-string cents are converted to USD across every result and page', async () => {
  const requested = []
  const fetchImpl = async (input) => {
    const url = new URL(input)
    requested.push(url)
    const page = url.searchParams.get('page')
    if (url.pathname.endsWith('/usage_report/messages')) {
      return response(page
        ? { data: [{ usage: { output_tokens: 20 } }], has_more: false }
        : { data: [{ usage: { output_tokens: 10 } }], has_more: true, next_page: 'usage-2' })
    }
    return response(page
      ? { data: [{ amount: '76.00' }], has_more: false }
      : { data: [{ amount: '123.45' }, { nested: { amount: '0.55' } }], has_more: true, next_page: 'cost-2' })
  }
  // Local evening on July 17 is already July 18 UTC.
  const now = Date.parse('2026-07-17T23:59:00-05:00')
  const result = await fetchApiUsage('admin', {
    label: 'Test Org',
    dailyBudgetUsd: 4,
    now,
    fetchImpl,
    baseUrl: 'https://example.test/v1/organizations'
  })

  assert.equal(result.available, true)
  assert.equal(result.label, 'Test Org')
  assert.equal(result.sourceDate, '2026-07-18')
  assert.equal(result.todayTokensOut, 30)
  assert.equal(result.todayCostUsd, 2)
  assert.equal(result.budget.usedPct, 50)
  assert.equal(result.budget.resetsAt, Date.parse('2026-07-19T00:00:00.000Z'))
  assert.ok(requested.every((url) => url.searchParams.get('starting_at') === '2026-07-18T00:00:00.000Z'))
  assert.deepEqual(requested.filter((url) => url.searchParams.has('page')).map((url) => url.searchParams.get('page')).sort(), ['cost-2', 'usage-2'])
})

test('malformed matching values are rejected instead of coerced', async () => {
  assert.throws(() => parseDecimalCents(12), /decimal string/)
  assert.throws(() => parseDecimalCents('-1.2'), /decimal string/)
  assert.throws(() => sumNumericField({ output_tokens: '12' }, 'output_tokens'), /finite non-negative/)

  const oldError = console.error
  console.error = () => {}
  try {
    const result = await fetchApiUsage('admin', {
      fetchImpl: async (input) => response(new URL(input).pathname.endsWith('/cost_report')
        ? { data: [{ amount: '10.00' }], has_more: false }
        : { data: [{ output_tokens: 'bad' }], has_more: false })
    })
    assert.equal(result.available, false)
  } finally {
    console.error = oldError
  }
})

test('a malformed cost page does not erase otherwise valid API usage', async () => {
  const oldError = console.error
  console.error = () => {}
  try {
    const result = await fetchApiUsage('admin', {
      dailyBudgetUsd: 10,
      fetchImpl: async (input) => response(new URL(input).pathname.endsWith('/cost_report')
        ? { data: [{ amount: 100 }], has_more: false }
        : { data: [{ output_tokens: 42 }], has_more: false })
    })
    assert.equal(result.available, true)
    assert.equal(result.todayTokensOut, 42)
    assert.equal(result.todayCostUsd, undefined)
    assert.equal(result.budget, undefined)
  } finally {
    console.error = oldError
  }
})

test('missing keys stay unavailable and honor the injected label', async () => {
  assert.deepEqual(await fetchApiUsage(undefined, { label: 'No Key Org' }), { available: false, label: 'No Key Org' })
})

function response(body) {
  return { ok: true, status: 200, json: async () => body }
}
