import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  BRIDGE_SCHEMA_VERSION,
  deliverHook,
  mapHookInput,
  readEndpoint
} from './bridge.mjs'

test('maps Codex permission and subagent events into the normalized envelope', () => {
  const permission = mapHookInput('codex', {
    hook_event_name: 'PermissionRequest',
    session_id: 'session-1',
    turn_id: 'turn-1',
    cwd: 'C:\\repo',
    model: 'gpt-5.6',
    tool_name: 'Bash',
    permission_mode: 'plan'
  }, { now: 123 })
  assert.deepEqual(permission, {
    schemaVersion: 1,
    provider: 'codex',
    eventId: 'codex:session-1:PermissionRequest:turn-1',
    sessionId: 'session-1',
    turnId: 'turn-1',
    actor: { kind: 'root' },
    kind: 'attention_required',
    timestamp: 123,
    cwd: 'C:\\repo',
    toolName: 'Bash',
    attention: { reason: 'permission', message: 'permission requested for Bash' },
    permissionMode: 'plan',
    model: 'gpt-5.6'
  })

  const subagent = mapHookInput('codex', {
    hook_event_name: 'SubagentStop',
    session_id: 'parent-session',
    turn_id: 'turn-2',
    agent_id: 'child-7',
    agent_type: 'reviewer'
  }, { now: 456 })
  assert.equal(subagent.kind, 'subagent_completed')
  assert.deepEqual(subagent.actor, { kind: 'subagent', id: 'child-7' })
  assert.equal(subagent.sessionId, 'parent-session')
  assert.equal('subagentId' in subagent, false)
})
test('maps Claude lifecycle events without treating SubagentStop as parent completion', () => {
  assert.equal(mapHookInput('claude', {
    hook_event_name: 'Stop', session_id: 's'
  }, { now: 1 }).kind, 'turn_completed')
  assert.equal(mapHookInput('claude', {
    hook_event_name: 'SubagentStop', session_id: 's', agent_id: 'a'
  }, { now: 1 }).kind, 'subagent_completed')
  assert.equal(mapHookInput('claude', {
    hook_event_name: 'SessionEnd', session_id: 's'
  }, { now: 1 }).kind, 'session_ended')
  assert.equal(mapHookInput('codex', {
    hook_event_name: 'SessionEnd', session_id: 's'
  }, { now: 1 }).kind, 'session_ended')
})

test('ignores informational Claude notifications and attributes child tools to the child', () => {
  assert.equal(mapHookInput('claude', {
    hook_event_name: 'Notification', session_id: 's', notification_type: 'auth_success'
  }, { now: 1 }), null)
  assert.equal(mapHookInput('claude', {
    hook_event_name: 'Notification', session_id: 's', notification_type: 'permission_prompt', message: 'Approve?'
  }, { now: 1 }).kind, 'attention_required')
  assert.deepEqual(mapHookInput('claude', {
    hook_event_name: 'PreToolUse', session_id: 's', agent_id: 'child', tool_name: 'Read'
  }, { now: 1 }).actor, { kind: 'subagent', id: 'child' })
})

test('maps Cursor conversation hooks into the provider-neutral envelope', () => {
  const event = mapHookInput('cursor', {
    hook_event_name: 'beforeSubmitPrompt',
    conversation_id: 'conversation-1',
    generation_id: 'generation-2',
    workspace_roots: ['C:\\repo'],
    prompt: 'Fix it'
  }, { now: 10 })
  assert.equal(event.provider, 'cursor')
  assert.equal(event.sessionId, 'conversation-1')
  assert.equal(event.kind, 'prompt_submitted')
  assert.equal(event.cwd, 'C:\\repo')
})

test('ignores Claude compatibility hooks invoked by Cursor', () => {
  assert.equal(mapHookInput('claude', {
    hook_event_name: 'SessionStart',
    session_id: 'cursor-session',
    cursor_version: '3.13.25'
  }, { now: 10 }), null)
})

test('rejects malformed endpoint discovery without making a request', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tmam-bridge-'))
  try {
    const path = join(dir, 'endpoint.json')
    writeFileSync(path, JSON.stringify({ schemaVersion: BRIDGE_SCHEMA_VERSION, port: 7459, token: 'short' }))
    assert.equal(readEndpoint(path), null)
    let called = false
    const ok = await deliverHook('codex', { hook_event_name: 'Stop', session_id: 's' }, {
      endpointPath: path,
      discoverFocus: false,
      fetchImpl: async () => { called = true; return { ok: true } }
    })
    assert.equal(ok, false)
    assert.equal(called, false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('delivers one authenticated /v1/events request and does not retry', async () => {
  const calls = []
  const ok = await deliverHook('codex', {
    hook_event_name: 'UserPromptSubmit',
    session_id: 's1',
    prompt: 'Fix   the tests',
    cwd: 'C:\\repo'
  }, {
    endpoint: { schemaVersion: 1, port: 8123, token: '1234567890abcdef' },
    discoverFocus: false,
    fetchImpl: async (url, init) => {
      calls.push({ url, init })
      return { ok: true }
    }
  })
  assert.equal(ok, true)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].url, 'http://127.0.0.1:8123/v1/events')
  assert.equal(calls[0].init.headers.authorization, 'Bearer 1234567890abcdef')
  const body = JSON.parse(calls[0].init.body)
  assert.equal(body.kind, 'prompt_submitted')
  assert.equal(body.activity, '» Fix the tests')
  assert.deepEqual(body.actor, { kind: 'root' })
})

test('timeouts and transport errors are swallowed', async () => {
  const ok = await deliverHook('claude', {
    hook_event_name: 'Stop', session_id: 's1'
  }, {
    endpoint: { schemaVersion: 1, port: 8123, token: '1234567890abcdef' },
    discoverFocus: false,
    timeoutMs: 50,
    fetchImpl: async (_url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(new Error('aborted')))
    })
  })
  assert.equal(ok, false)
})

test('a hung focus discovery cannot exceed the total delivery deadline', async () => {
  const started = Date.now()
  let delivered = false
  const ok = await deliverHook('codex', { hook_event_name: 'UserPromptSubmit', session_id: 's1' }, {
    endpoint: { schemaVersion: 1, port: 8123, token: '1234567890abcdef' },
    deadlineAt: Date.now() + 80,
    discoverFocusImpl: () => new Promise(() => {}),
    fetchImpl: async () => { delivered = true; return { ok: true } }
  })
  assert.equal(ok, true)
  assert.equal(delivered, true)
  assert.ok(Date.now() - started < 180)
})
