import { test } from 'node:test'
import assert from 'node:assert/strict'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  parseCodexRolloutFile,
  parseCodexRolloutText,
  scanCodexUsage
} from './codexUsage.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const fixture = (name) => join(here, 'fixtures', name)

test('parses cumulative counters as deltas and ignores repeated snapshots', async () => {
  const result = await parseCodexRolloutFile(fixture('codexUsage.standard.jsonl'))
  assert.deepEqual(result.session, {
    id: 'session-1',
    cwd: 'C:\\Projects\\alpha',
    modelProvider: 'openai',
    model: 'gpt-5.6'
  })
  assert.deepEqual(result.totals, {
    inputTokens: 180,
    cachedInputTokens: 35,
    outputTokens: 70,
    reasoningOutputTokens: 15,
    totalTokens: 300
  })
  assert.equal(result.usageEvents.length, 2)
  assert.equal(result.usageEvents[0].project, 'alpha')
  assert.equal(result.usageEvents[0].model, 'gpt-5.6')
  assert.equal(result.rateLimits.primary.usedPct, 14)
  assert.equal(result.rateLimits.primary.windowMinutes, 300)
  assert.equal(result.rateLimits.primary.resetsAt, 1_784_203_200_000)
  assert.equal(result.schemaDrift, false)
  assert.deepEqual(result.diagnostics, [])
})
test('isolates schema drift and still returns partial valid usage', async () => {
  const result = await parseCodexRolloutFile(fixture('codexUsage.drift.jsonl'))
  assert.equal(result.schemaDrift, true)
  assert.equal(result.totals.outputTokens, 20)
  const codes = new Set(result.diagnostics.map((d) => d.code))
  assert.equal(codes.has('malformed_json'), true)
  assert.equal(codes.has('unsupported_token_schema'), true)
  assert.equal(codes.has('rate_limit_schema'), true)
  assert.equal(codes.has('invalid_counter'), true)
  assert.equal(codes.has('invalid_timestamp'), true)
})

test('handles cumulative counter resets without negative totals', () => {
  const line = (timestamp, input, output) => JSON.stringify({
    timestamp,
    type: 'event_msg',
    payload: {
      type: 'token_count',
      info: { total_token_usage: {
        input_tokens: input,
        cached_input_tokens: 0,
        output_tokens: output,
        reasoning_output_tokens: 0,
        total_tokens: input + output
      } }
    }
  })
  const result = parseCodexRolloutText([
    line('2026-07-16T10:00:00Z', 100, 20),
    line('2026-07-16T10:01:00Z', 150, 30),
    line('2026-07-16T10:02:00Z', 10, 5)
  ].join('\n'))
  assert.equal(result.totals.inputTokens, 160)
  assert.equal(result.totals.outputTokens, 35)
  assert.equal(result.diagnostics.some((d) => d.code === 'counter_reset'), true)
})

test('scans recent files and aggregates by day, project, and model', async () => {
  const root = mkdtempSync(join(tmpdir(), 'tmam-codex-usage-'))
  try {
    const nested = join(root, '2026', '07', '16')
    mkdirSync(nested, { recursive: true })
    const path = join(nested, 'rollout.jsonl')
    copyFileSync(fixture('codexUsage.standard.jsonl'), path)
    const now = new Date('2026-07-16T10:03:00Z').getTime()
    utimesSync(path, new Date(), new Date())
    const result = await scanCodexUsage({ rootDir: root, now, lookbackMs: 5 * 60_000 })
    assert.equal(result.filesScanned, 1)
    assert.equal(result.totals.totalTokens, 300)
    assert.equal(result.byDay.length, 1)
    assert.equal(result.byDay[0].date, '2026-07-16')
    assert.equal(result.byDay[0].byProject[0].project, 'alpha')
    assert.equal(result.byDay[0].byModel[0].model, 'gpt-5.6')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('default retention includes the full seven-day local window', async () => {
  const root = mkdtempSync(join(tmpdir(), 'tmam-codex-yesterday-'))
  try {
    const nested = join(root, '2026', '07', '16')
    mkdirSync(nested, { recursive: true })
    const path = join(nested, 'rollout.jsonl')
    copyFileSync(fixture('codexUsage.standard.jsonl'), path)
    const oldestStart = new Date(2026, 6, 11, 0, 1)
    const endOfToday = new Date(2026, 6, 17, 23, 59).getTime()
    utimesSync(path, oldestStart, oldestStart)
    const result = await scanCodexUsage({ rootDir: root, now: endOfToday })
    assert.equal(result.filesScanned, 1)
    assert.equal(result.totals.outputTokens, 70)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('preserves project-by-model buckets for exact multi-model project value', async () => {
  const root = mkdtempSync(join(tmpdir(), 'tmam-codex-project-model-'))
  try {
    const nested = join(root, '2026', '07', '16')
    mkdirSync(nested, { recursive: true })
    const standard = readFileSync(fixture('codexUsage.standard.jsonl'), 'utf8')
    const first = join(nested, 'sol.jsonl')
    const second = join(nested, 'terra.jsonl')
    await import('node:fs/promises').then(({ writeFile }) => Promise.all([
      writeFile(first, standard),
      writeFile(second, standard.replaceAll('session-1', 'session-2').replaceAll('gpt-5.6', 'gpt-5.6-terra'))
    ]))
    const now = new Date('2026-07-16T10:03:00Z').getTime()
    const result = await scanCodexUsage({ rootDir: root, now, lookbackMs: 5 * 60_000 })
    assert.equal(result.byDay[0].byProject.length, 1)
    assert.equal(result.byDay[0].byProjectModel.length, 2)
    assert.deepEqual(new Set(result.byDay[0].byProjectModel.map((row) => row.model)), new Set(['gpt-5.6', 'gpt-5.6-terra']))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('unreadable files return diagnostics instead of throwing', async () => {
  const path = join(tmpdir(), `missing-${Date.now()}.jsonl`)
  const result = await parseCodexRolloutFile(path)
  assert.equal(result.totals.totalTokens, 0)
  assert.equal(result.diagnostics[0].code, 'file_read_error')
})
