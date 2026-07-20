import assert from 'node:assert/strict'
import test from 'node:test'
import { buildUsageInsights, parseClaudeTranscriptLines, parseCodexRolloutLines } from './usageInsightsCore.mjs'

const NOW = new Date(2026, 6, 19, 12).getTime()

function claude(timestamp, id, usage, tools = []) {
  return JSON.stringify({
    type: 'assistant', timestamp: new Date(timestamp).toISOString(), cwd: 'C:\\work\\alpha',
    message: { id, usage, content: tools.map(([name, input]) => ({ type: 'tool_use', name, input })) }
  })
}

function codex(timestamp, last) {
  return JSON.stringify({
    timestamp: new Date(timestamp).toISOString(), type: 'event_msg',
    payload: { type: 'token_count', info: { total_token_usage: last, last_token_usage: last } }
  })
}

test('builds independent day/week characteristics from Claude and Codex ledgers', () => {
  const claudeSession = parseClaudeTranscriptLines([
    claude(NOW - 9 * 60 * 60_000, 'old', { input_tokens: 10, output_tokens: 10 }),
    claude(NOW, 'today', { input_tokens: 10_000, cache_read_input_tokens: 150_001, output_tokens: 999 }, [
      ['Skill', { command: 'ship' }], ['Agent', { subagent_type: 'Explore' }], ['mcp__playwright__browser_click', {}]
    ])
  ], { sessionId: 'claude-1' })
  const codexSession = parseCodexRolloutLines([
    JSON.stringify({ timestamp: new Date(NOW).toISOString(), type: 'session_meta', payload: { id: 'codex-1', cwd: 'C:\\work\\beta' } }),
    codex(NOW, { input_tokens: 1000, cached_input_tokens: 500, output_tokens: 100, total_tokens: 1100 })
  ], { sessionId: 'codex-1' })
  const result = buildUsageInsights([claudeSession, codexSession], NOW)
  assert.equal(result.day.sessions, 2)
  assert.equal(result.day.byProvider.claude, 161_020)
  assert.equal(result.day.byProvider.codex, 1100)
  assert.ok(result.day.metrics.find((metric) => metric.id === 'large-context').usedPct > 99)
  assert.ok(result.day.metrics.find((metric) => metric.id === 'subagent-heavy').usedPct > 99)
  assert.ok(result.day.metrics.find((metric) => metric.id === 'long-running').usedPct > 99)
  assert.equal(result.day.skills[0].name, 'ship')
  assert.equal(result.day.subagents[0].name, 'Explore')
  assert.equal(result.day.mcpServers[0].name, 'playwright')
})

test('deduplicates repeated Claude message ids and treats Codex cached input as a subset', () => {
  const claudeSession = parseClaudeTranscriptLines([
    claude(NOW, 'same', { input_tokens: 1, output_tokens: 10 }),
    claude(NOW, 'same', { input_tokens: 2, output_tokens: 20 })
  ])
  const codexSession = parseCodexRolloutLines([
    codex(NOW, { input_tokens: 100, cached_input_tokens: 90, output_tokens: 10, total_tokens: 110 })
  ])
  const result = buildUsageInsights([claudeSession, codexSession], NOW)
  assert.equal(result.day.byProvider.claude, 22)
  assert.equal(result.day.byProvider.codex, 110)
})
