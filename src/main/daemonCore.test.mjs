import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validateAgentEventV1, validateLegacyReport } from './daemonCore.mjs'

const NOW = Date.UTC(2026, 6, 17, 12)

test('legacy report validator sanitizes a valid bounded report', () => {
  assert.deepEqual(validateLegacyReport({
    event: 'PreToolUse', sessionId: 'abc', cwd: 'C:\\repo', toolName: 'Bash',
    tokensOut: 12, contextPct: 4.5, focusHwnd: '1234', focusPid: 44, ts: NOW
  }, NOW), {
    event: 'PreToolUse', sessionId: 'abc', cwd: 'C:\\repo', toolName: 'Bash',
    contextPct: 4.5, tokensOut: 12, focusHwnd: '1234', focusPid: 44, ts: NOW
  })
})

test('legacy report validator rejects unknown enums, non-finite numbers, future time and oversized strings', () => {
  assert.equal(validateLegacyReport({ event: 'Bogus', sessionId: 'a' }, NOW), null)
  assert.equal(validateLegacyReport({ event: 'Stop', sessionId: 'a', tokensOut: Infinity }, NOW), null)
  assert.equal(validateLegacyReport({ event: 'Stop', sessionId: 'a', ts: NOW + 300_001 }, NOW), null)
  assert.equal(validateLegacyReport({ event: 'Stop', sessionId: 'a'.repeat(257) }, NOW), null)
  assert.equal(validateLegacyReport({ event: 'Stop', sessionId: 'a', surprise: true }, NOW), null)
})

test('v1 validator accepts provider event with cumulative usage provenance', () => {
  const value = {
    schemaVersion: 1,
    provider: 'codex',
    eventId: 'evt-1',
    sessionId: 'session-1',
    turnId: 'turn-1',
    actor: { kind: 'root' },
    kind: 'tool_started',
    timestamp: NOW,
    cwd: 'C:\\repo',
    toolName: 'shell',
    usage: { kind: 'cumulative', outputTokens: 42, contextPct: 30, source: 'rollout' },
    transcript: { path: 'C:\\rollout.jsonl' },
    focus: { hwnd: '9001', pid: 55 }
  }
  assert.deepEqual(validateAgentEventV1(value, NOW), value)
})

test('v1 validator enforces subagent actor, delta message id and attention payload', () => {
  const base = {
    schemaVersion: 1, provider: 'claude', eventId: 'evt', sessionId: 's',
    actor: { kind: 'root' }, timestamp: NOW
  }
  assert.equal(validateAgentEventV1({ ...base, kind: 'subagent_started' }, NOW), null)
  assert.equal(validateAgentEventV1({ ...base, kind: 'tool_started', usage: { kind: 'delta', outputTokens: 1 } }, NOW), null)
  assert.equal(validateAgentEventV1({ ...base, kind: 'attention_required' }, NOW), null)
  assert.ok(validateAgentEventV1({
    ...base, kind: 'subagent_completed', actor: { kind: 'subagent', id: 'child' }
  }, NOW))
})

test('v1 validator rejects wrong versions, invalid timestamps and excessive cardinal values', () => {
  const base = {
    schemaVersion: 1, provider: 'codex', eventId: 'evt', sessionId: 's',
    actor: { kind: 'root' }, kind: 'turn_completed', timestamp: NOW
  }
  assert.equal(validateAgentEventV1({ ...base, schemaVersion: 2 }, NOW), null)
  assert.equal(validateAgentEventV1({ ...base, timestamp: NaN }, NOW), null)
  assert.equal(validateAgentEventV1({ ...base, usage: { kind: 'cumulative', outputTokens: 1e16 } }, NOW), null)
  assert.equal(validateAgentEventV1({ ...base, eventId: 'e'.repeat(513) }, NOW), null)
})
