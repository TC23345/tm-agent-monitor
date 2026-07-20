import test from 'node:test'
import assert from 'node:assert/strict'

async function moduleOrSkip(t) {
  return import('./historyCore.mjs')
}

test('API-only dates create zero local usage and exact attribution', async (t) => {
  const m = await moduleOrSkip(t); if (!m) return
  const docs = m.dailyDocuments([], { date: '2026-07-17', tokensOut: 5, costUsd: 1.25 })
  assert.equal(docs.length, 1)
  assert.equal(docs[0].date, '2026-07-17')
  assert.equal(docs[0].tokensOut, 0)
  assert.equal(docs[0].apiCostUsd, 1.25)
})

test('metric-less API input never manufactures a zero history day', async (t) => {
  const m = await moduleOrSkip(t); if (!m) return
  assert.deepEqual(m.dailyDocuments([], { date: '2026-07-17' }), [])
})

test('Codex-only totals satisfy the real history flush payload guard', async (t) => {
  const m = await moduleOrSkip(t); if (!m) return
  const codex = [{ day: '2026-07-17', tokensOut: 9, costUsd: 0.1, byProject: [], byModel: [], valueComplete: true }]
  assert.equal(m.hasFlushPayload([], undefined, { codex }), true)
  assert.equal(m.hasFlushPayload([], undefined, {}), false)
})

test('legacy history is interpreted as Claude provider usage', async (t) => {
  const m = await moduleOrSkip(t); if (!m) return
  const day = m.normalizeDailyDocument({ date: '2026-07-16', tokensOut: 9, costUsd: 2 })
  assert.equal(day.byProvider.claude.tokensOut, 9)
  assert.equal(day.byProvider.codex, undefined)
})
