import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'

// Compile the real TypeScript store into an isolated ESM fixture. This keeps the
// production module authoritative without adding a runtime TS loader dependency.
const fixtureRoot = mkdtempSync(join(tmpdir(), 'agent-monitor-store-test-'))
mkdirSync(join(fixtureRoot, 'main'), { recursive: true })
mkdirSync(join(fixtureRoot, 'shared'), { recursive: true })
writeFileSync(join(fixtureRoot, 'package.json'), '{"type":"module"}')
for (const [source, target] of [
  ['src/main/store.ts', join(fixtureRoot, 'main', 'store.js')],
  ['src/shared/types.ts', join(fixtureRoot, 'shared', 'types.js')]
]) {
  const output = ts.transpileModule(readFileSync(source, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }
  }).outputText
  writeFileSync(target, output)
}
copyFileSync('src/shared/pricing.mjs', join(fixtureRoot, 'shared', 'pricing.mjs'))
after(() => rmSync(fixtureRoot, { recursive: true, force: true }))

const { AgentStore, validateMutableSettingsPatch } = await import(pathToFileURL(join(fixtureRoot, 'main', 'store.js')).href)
const AT = Date.UTC(2026, 6, 17, 12)
const DEFAULT_STALE_MINUS_ONE = 15 * 60 * 1000 - 1

function event(provider, sessionId, eventId, kind, extra = {}) {
  return {
    schemaVersion: 1,
    provider,
    sessionId,
    eventId,
    actor: { kind: 'root' },
    kind,
    timestamp: AT,
    ...extra
  }
}

test('provider-qualified identities make raw session collisions harmless', () => {
  const store = new AgentStore()
  store.applyEvent(event('claude', 'same-id', 'c1', 'session_started'))
  store.applyEvent(event('codex', 'same-id', 'x1', 'session_started'))
  assert.deepEqual(store.snapshot(AT).map((agent) => agent.id).sort(), ['claude:same-id', 'codex:same-id'])
})

test('escaped identities cannot collide with child separators', () => {
  const store = new AgentStore()
  store.applyEvent(event('claude', 's:a', 'root-colon', 'session_started'))
  store.applyEvent(event('claude', 's', 'child-a', 'subagent_started', {
    actor: { kind: 'subagent', id: 'a' }
  }))
  const ids = store.snapshot(AT).map((agent) => agent.id).sort()
  assert.deepEqual(ids, ['claude:s%3Aa', 'claude:s:a'])
})

test('agent cardinality is bounded before allocating a new identity', () => {
  const store = new AgentStore(1)
  assert.equal(store.applyEvent(event('claude', 'one', 'one', 'session_started')), true)
  assert.equal(store.applyEvent(event('codex', 'two', 'two', 'session_started')), false)
  assert.equal(store.snapshot(AT).length, 1)
})

test('settings patches allow only mutable fields with bounded runtime types', () => {
  assert.deepEqual(validateMutableSettingsPatch({ hotkey: 'Control+Alt+W', notifications: false }), {
    hotkey: 'Control+Alt+W', notifications: false
  })
  assert.equal(validateMutableSettingsPatch({ port: 9999 }), null)
  assert.equal(validateMutableSettingsPatch({ notifications: 'yes' }), null)
  assert.equal(validateMutableSettingsPatch({ hotkey: `Alt+W\nInjected` }), null)
  assert.deepEqual(validateMutableSettingsPatch({ sizeMode: 'left' }), { sizeMode: 'left' })
  assert.deepEqual(validateMutableSettingsPatch({ sizeMode: 'full' }), { sizeMode: 'full' })
  assert.equal(validateMutableSettingsPatch({ sizeMode: 'half' }), null)
  assert.equal(validateMutableSettingsPatch({ sizeMode: true }), null)
  assert.deepEqual(validateMutableSettingsPatch({ pushUrl: 'https://ntfy.sh/my-agents', pushAfterMin: 15 }), { pushUrl: 'https://ntfy.sh/my-agents', pushAfterMin: 15 })
  assert.deepEqual(validateMutableSettingsPatch({ pushUrl: '' }), { pushUrl: '' })
  assert.equal(validateMutableSettingsPatch({ pushUrl: 'ftp://x' }), null)
  assert.equal(validateMutableSettingsPatch({ pushUrl: 'https://a b' }), null)
  assert.equal(validateMutableSettingsPatch({ pushAfterMin: 0 }), null)
  assert.equal(validateMutableSettingsPatch({ pushAfterMin: 2.5 }), null)
  assert.equal(validateMutableSettingsPatch({ pushAfterMin: 241 }), null)
})

test('the activity ring records root starts, waits, finishes, compactions, and ends, newest first', () => {
  const store = new AgentStore()
  store.applyEvent(event('claude', 's', 'e1', 'session_started', { timestamp: AT + 1_000, cwd: 'C:\\p\\api' }))
  store.applyEvent(event('claude', 's', 'e2', 'attention_required', { timestamp: AT + 2_000, attention: { reason: 'question', message: 'Deploy?' } }))
  store.applyEvent(event('claude', 's', 'e3', 'context_compacted', { timestamp: AT + 3_000 }))
  store.applyEvent(event('claude', 's', 'e4', 'turn_completed', { timestamp: AT + 4_000 }))
  // A subagent's completion is not a feed event; its wait is.
  store.applyEvent(event('claude', 's', 'e5', 'attention_required', { timestamp: AT + 5_000, actor: { kind: 'subagent', id: 'kid' }, attention: { reason: 'permission' } }))
  store.applyEvent(event('claude', 's', 'e6', 'subagent_completed', { timestamp: AT + 6_000, actor: { kind: 'subagent', id: 'kid' } }))
  store.applyEvent(event('claude', 's', 'e7', 'session_ended', { timestamp: AT + 7_000 }))
  const kinds = store.recentEvents().map((e) => `${e.kind}@${e.at - AT}`)
  assert.deepEqual(kinds, ['ended@7000', 'waiting@5000', 'finished@4000', 'compacted@3000', 'waiting@2000', 'started@1000'])
  assert.equal(store.recentEvents()[4].text, 'Deploy?')
  assert.equal(store.recentEvents()[0].project, 'api')
  assert.deepEqual(store.recentEvents(2).map((e) => e.kind), ['ended', 'waiting'])
})

test('deduplicates event ids and ignores older events per actor', () => {
  const store = new AgentStore()
  assert.equal(store.applyEvent(event('codex', 's', 'one', 'prompt_submitted', { timestamp: AT + 2_000 })), true)
  assert.equal(store.applyEvent(event('codex', 's', 'one', 'turn_completed', { timestamp: AT + 3_000 })), false)
  assert.equal(store.applyEvent(event('codex', 's', 'old', 'attention_required', {
    timestamp: AT + 1_000,
    attention: { reason: 'question', message: 'old question' }
  })), false)
  assert.equal(store.snapshot(AT + 2_000)[0].state, 'running')
})

test('idle transition persists so the next running duration resets', () => {
  const store = new AgentStore()
  store.applyEvent(event('claude', 's', 'one', 'prompt_submitted'))
  const idleAt = AT + 91_000
  assert.equal(store.snapshot(idleAt)[0].state, 'idle')
  store.applyEvent(event('claude', 's', 'two', 'tool_started', { timestamp: idleAt + 1_000 }))
  const running = store.snapshot(idleAt + 1_000)[0]
  assert.equal(running.state, 'running')
  assert.equal(running.since, idleAt + 1_000)
})

test('one subagent completing leaves its sibling and root active', () => {
  const store = new AgentStore()
  store.applyEvent(event('claude', 's', 'root', 'prompt_submitted'))
  store.applyEvent(event('claude', 's', 'a-start', 'subagent_started', {
    actor: { kind: 'subagent', id: 'a' }
  }))
  store.applyEvent(event('claude', 's', 'b-start', 'subagent_started', {
    actor: { kind: 'subagent', id: 'b' }
  }))
  store.applyEvent(event('claude', 's', 'a-stop', 'subagent_completed', {
    actor: { kind: 'subagent', id: 'a' }, timestamp: AT + 1
  }))
  const agents = store.snapshot(AT + 1)
  const root = agents.find((agent) => agent.id === 'claude:s')
  assert.equal(root.state, 'running')
  assert.equal(root.activeTasks, 1)
  assert.equal(agents.find((agent) => agent.id.endsWith(':a')).state, 'complete')
  assert.equal(agents.find((agent) => agent.id.endsWith(':b')).state, 'running')
})

test('session end is ordered against every child and tombstones late reports', () => {
  const store = new AgentStore()
  store.applyEvent(event('codex', 's', 'root', 'session_started'))
  store.applyEvent(event('codex', 's', 'child', 'subagent_started', {
    actor: { kind: 'subagent', id: 'worker' }, timestamp: AT + 200
  }))
  assert.equal(store.applyEvent(event('codex', 's', 'old-end', 'session_ended', { timestamp: AT + 100 })), false)
  assert.equal(store.snapshot(AT + 200).length, 2)
  assert.equal(store.applyEvent(event('codex', 's', 'new-end', 'session_ended', { timestamp: AT + 300 })), true)
  assert.equal(store.snapshot(AT + 300).length, 0)
  assert.equal(store.applyEvent(event('codex', 's', 'late-tool', 'tool_started', { timestamp: AT + 400 })), false)
  assert.equal(store.snapshot(AT + 400).length, 0)
  assert.equal(store.applyEvent(event('codex', 's', 'restart', 'session_started', { timestamp: AT + 500 })), true)
  assert.equal(store.applyEvent(event('codex', 's', 'old-child-generation', 'subagent_started', {
    actor: { kind: 'subagent', id: 'late' }, timestamp: AT + 400
  })), false)
  assert.equal(store.snapshot(AT + 500).length, 1)
})

test('legacy SessionEnd removes children, tombstones the session, and rejects late reports', () => {
  const store = new AgentStore()
  store.apply({ event: 'SessionStart', sessionId: 'legacy', ts: AT })
  store.applyEvent(event('claude', 'legacy', 'child', 'subagent_started', {
    actor: { kind: 'subagent', id: 'worker' }, timestamp: AT + 1
  }))
  store.apply({ event: 'SessionEnd', sessionId: 'legacy', ts: AT + 2 })
  assert.equal(store.snapshot(AT + 2).length, 0)
  store.apply({ event: 'PreToolUse', sessionId: 'legacy', ts: AT + 3, toolName: 'Bash' })
  assert.equal(store.snapshot(AT + 3).length, 0)
})

test('session cleanup bypasses the allocation cap', () => {
  const store = new AgentStore(1)
  store.applyEvent(event('claude', 'orphan', 'child', 'subagent_started', {
    actor: { kind: 'subagent', id: 'worker' }
  }))
  assert.equal(store.snapshot(AT).length, 1)
  assert.equal(store.applyEvent(event('claude', 'orphan', 'end', 'session_ended', { timestamp: AT + 1 })), true)
  assert.equal(store.snapshot(AT + 1).length, 0)
})

test('a capacity-rejected v1 restart preserves the ended-session tombstone', () => {
  const store = new AgentStore(1)
  store.applyEvent(event('codex', 'ended', 'start-a', 'session_started'))
  store.applyEvent(event('codex', 'ended', 'end-a', 'session_ended', { timestamp: AT + 1 }))
  store.applyEvent(event('codex', 'busy', 'start-b', 'session_started', { timestamp: AT + 2 }))
  assert.equal(store.applyEvent(event('codex', 'ended', 'restart-a', 'session_started', { timestamp: AT + 3 })), false)
  store.applyEvent(event('codex', 'busy', 'end-b', 'session_ended', { timestamp: AT + 4 }))
  assert.equal(store.applyEvent(event('codex', 'ended', 'late-a', 'tool_started', { timestamp: AT + 5 })), false)
  assert.equal(store.snapshot(AT + 5).length, 0)
})

test('a capacity-rejected legacy restart preserves the ended-session tombstone', () => {
  const store = new AgentStore(1)
  store.apply({ event: 'SessionStart', sessionId: 'ended', ts: AT })
  store.apply({ event: 'SessionEnd', sessionId: 'ended', ts: AT + 1 })
  store.applyEvent(event('codex', 'busy', 'start-b', 'session_started', { timestamp: AT + 2 }))
  store.apply({ event: 'SessionStart', sessionId: 'ended', ts: AT + 3 })
  store.applyEvent(event('codex', 'busy', 'end-b', 'session_ended', { timestamp: AT + 4 }))
  store.apply({ event: 'PreToolUse', sessionId: 'ended', ts: AT + 5, toolName: 'Bash' })
  assert.equal(store.snapshot(AT + 5).length, 0)
})

test('child activity refreshes its root and stale roots remove their children', () => {
  const store = new AgentStore()
  store.applyEvent(event('claude', 's', 'root', 'session_started'))
  store.applyEvent(event('claude', 's', 'child', 'subagent_started', {
    actor: { kind: 'subagent', id: 'worker' }, timestamp: AT + DEFAULT_STALE_MINUS_ONE
  }))
  assert.equal(store.snapshot(AT + DEFAULT_STALE_MINUS_ONE).length, 2)
  assert.equal(store.snapshot(AT + DEFAULT_STALE_MINUS_ONE + 2).length, 2)

  const expired = AT + DEFAULT_STALE_MINUS_ONE + 15 * 60 * 1000 + 1
  assert.equal(store.snapshot(expired).length, 0)
})

test('legacy SubagentStop never completes its parent', () => {
  const store = new AgentStore()
  store.apply({ event: 'UserPromptSubmit', sessionId: 's', ts: AT })
  store.apply({ event: 'SubagentStop', sessionId: 's', ts: AT + 1 })
  assert.equal(store.snapshot(AT + 1)[0].state, 'running')
})

test('message costs retain the model used by each contribution', () => {
  const store = new AgentStore()
  store.apply({ event: 'PreToolUse', sessionId: 's', ts: AT, msgId: 'one', tokensOut: 1_000, model: 'claude-sonnet-4' })
  store.apply({ event: 'PostToolUse', sessionId: 's', ts: AT + 1, msgId: 'two', tokensOut: 1_000, model: 'claude-haiku-4' })
  const agent = store.snapshot(AT + 1)[0]
  assert.equal(agent.tokensOut, 2_000)
  assert.equal(agent.costUsd, 0.02)
  assert.equal(agent.valueComplete, true)
})

test('unknown models retain tokens without borrowing another provider price', () => {
  const store = new AgentStore()
  store.apply({ event: 'PreToolUse', sessionId: 's', ts: AT, msgId: 'one', tokensOut: 1_000, model: 'mystery-model' })
  const agent = store.snapshot(AT)[0]
  assert.equal(agent.tokensOut, 1_000)
  assert.equal(agent.costUsd, undefined)
  assert.equal(agent.valueComplete, false)
})
