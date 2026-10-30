import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseCodexRolloutLines } from './codexUsage.mjs'
import { CodexUsageLedger, normalizeLiveUsage, reconcileLiveUsage } from './codexLiveUsage.mjs'
const tokens = (n) => ({ inputTokens: n * 8, cachedInputTokens: n * 2, outputTokens: n * 2, reasoningOutputTokens: n, totalTokens: n * 10 })
const now = Date.now()
const event = (n, at = now, model = 'model-a') => ({ threadId: 'thread-1', at, cwd: 'C:\\project', model, total: tokens(n), last: tokens(1) })
const rows = (n) => [JSON.stringify({ type: 'session_meta', payload: { id: 'thread-1', cwd: 'C:/project' } }), JSON.stringify({ type: 'turn_context', payload: { model: 'model-a' } }), JSON.stringify({ type: 'event_msg', timestamp: new Date(now - 1000).toISOString(), payload: { type: 'token_count', info: { total_token_usage: Object.fromEntries(Object.entries(tokens(n)).map(([k, v]) => [k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`), v])) } } })]
test('normalization rejects unknown attribution and malformed counters', () => {
  const e = event(5), params = { threadId: e.threadId, tokenUsage: { total: e.total, last: e.last } }
  assert.equal(normalizeLiveUsage(params, {}), undefined)
  assert.equal(normalizeLiveUsage(params, e)?.threadId, e.threadId)
  assert.equal(normalizeLiveUsage({ ...params, tokenUsage: { total: {}, last: e.last } }, e), undefined)
})
test('transcript and live overlap never double count; delayed disk catches up exactly', () => {
  const disk = parseCodexRolloutLines(rows(5))
  assert.equal(reconcileLiveUsage([disk], [event(5)]).pendingEvents, 0)
  const live = reconcileLiveUsage([disk], [event(6), event(6), event(5)])
  assert.equal(live.pendingEvents, 1)
  assert.equal(live.results[0].usageEvents.reduce((n, e) => n + e.tokens.totalTokens, 0), 60)
  assert.equal(disk.usageEvents.length, 1)
  assert.equal(reconcileLiveUsage([parseCodexRolloutLines(rows(6))], [event(6)]).pendingEvents, 0)
})
test('new/resumed thread counts only last request, preserves model and day boundaries, resets wait for disk', () => {
  const first = new Date(2026, 9, 29, 23, 59).getTime(), second = new Date(2026, 9, 30, 0, 1).getTime()
  const merged = reconcileLiveUsage([], [event(100, first), event(101, second, 'model-b'), event(1, second + 1)])
  assert.deepEqual(merged.results[0].usageEvents.map((e) => [e.date, e.model, e.tokens.totalTokens]), [['2026-10-29', 'model-a', 10], ['2026-10-30', 'model-b', 10]])
})
test('worker ledger updates without a disk scan and rebuilds identically after disk catch-up/restart', async () => {
  const rootDir = await mkdtemp(join(tmpdir(), 'tm-live-ledger-'))
  try {
    const path = join(rootDir, 'rollout.jsonl'); await writeFile(path, rows(5).join('\n'))
    const ledger = new CodexUsageLedger({ rootDir }); assert.equal((await ledger.refresh()).totals.totalTokens, 50)
    assert.equal(ledger.ingest(event(6)).totals.totalTokens, 60)
    assert.equal(ledger.ingest(event(6)).totals.totalTokens, 60)
    await writeFile(path, rows(6).join('\n'))
    assert.equal((await ledger.refresh()).totals.totalTokens, 60)
    assert.equal((await new CodexUsageLedger({ rootDir }).refresh()).totals.totalTokens, 60)
  } finally { await rm(rootDir, { recursive: true, force: true }) }
})
