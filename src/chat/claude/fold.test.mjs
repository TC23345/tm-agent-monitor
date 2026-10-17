import test from 'node:test'
import assert from 'node:assert/strict'
import { emptyTranscript } from '../shared/chatModel.mjs'
import { foldSdkMessage, resultText, sessionMessagesToTranscript, sessionSummary, startFold, toolTitle } from './fold.mjs'

const fresh = () => startFold(emptyTranscript('claude', { cwd: 'C:\\p' }))

test('system init stamps session, model and cwd', () => {
  const f = foldSdkMessage(fresh(), { type: 'system', subtype: 'init', session_id: 's1', model: 'claude-opus-5-5', cwd: 'C:\\q', tools: [], uuid: 'u' })
  assert.equal(f.transcript.sessionId, 's1')
  assert.equal(f.transcript.model, 'claude-opus-5-5')
  assert.equal(f.transcript.cwd, 'C:\\q')
})

test('a streamed turn: text and tool blocks, then the full message and the result', () => {
  let f = fresh()
  const ev = (event) => ({ type: 'stream_event', event, parent_tool_use_id: null, uuid: 'x', session_id: 's1' })
  f = foldSdkMessage(f, ev({ type: 'message_start', message: { id: 'msg_1' } }))
  f = foldSdkMessage(f, ev({ type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } }))
  f = foldSdkMessage(f, ev({ type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'Let me look.' } }))
  f = foldSdkMessage(f, ev({ type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } }))
  f = foldSdkMessage(f, ev({ type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'Checking ' } }))
  f = foldSdkMessage(f, ev({ type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'now.' } }))
  f = foldSdkMessage(f, ev({ type: 'content_block_start', index: 2, content_block: { type: 'tool_use', id: 'toolu_1', name: 'Bash', input: {} } }))
  assert.deepEqual(f.transcript.items.map((x) => [x.kind, x.id]), [['thinking', 'msg_1:0'], ['assistant', 'msg_1:1'], ['tool', 'toolu_1']])
  assert.equal(f.transcript.items[1].text, 'Checking now.')
  assert.equal(f.transcript.items[1].streaming, true)
  f = foldSdkMessage(f, {
    type: 'assistant', uuid: 'a1', session_id: 's1', parent_tool_use_id: null,
    message: { id: 'msg_1', role: 'assistant', content: [{ type: 'thinking', thinking: 'Let me look.' }, { type: 'text', text: 'Checking now.' }, { type: 'tool_use', id: 'toolu_1', name: 'Bash', input: { command: 'npm test' } }] }
  })
  assert.equal(f.transcript.items.length, 3, 'the full message finalises streamed rows instead of duplicating them')
  assert.equal(f.transcript.items[1].streaming, false)
  assert.equal(f.transcript.items[2].title, 'npm test')
  assert.equal(f.transcript.items[2].input, 'npm test')
  f = foldSdkMessage(f, { type: 'user', uuid: 'u2', session_id: 's1', parent_tool_use_id: null, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'ok\n12 passing', is_error: false }] } })
  assert.equal(f.transcript.items[2].status, 'done')
  assert.equal(f.transcript.items[2].output, 'ok\n12 passing')
  assert.equal(f.transcript.items.length, 3, 'a tool_result user message adds no user row')
  f = foldSdkMessage(f, { type: 'result', subtype: 'success', is_error: false, result: 'Done.', duration_ms: 1, duration_api_ms: 1, num_turns: 1, stop_reason: 'end_turn', total_cost_usd: 0.02, usage: { input_tokens: 12, output_tokens: 30, cache_read_input_tokens: 8000, cache_creation_input_tokens: 0 }, modelUsage: {}, permission_denials: [], uuid: 'r', session_id: 's1' })
  assert.equal(f.transcript.status, 'idle')
  assert.equal(f.transcript.usage.contextTokens, 8012)
  assert.equal(f.transcript.usage.costUsd, 0.02)
})

test('an error result and a permission denial surface as error rows', () => {
  let f = fresh()
  f = foldSdkMessage(f, { type: 'system', subtype: 'permission_denied', tool_name: 'Bash', tool_use_id: 't', message: 'Bash was denied', uuid: 'p', session_id: 's' })
  assert.equal(f.transcript.items[0].level, 'error')
  f = foldSdkMessage(f, { type: 'result', subtype: 'error_during_execution', is_error: true, errors: ['boom'], usage: {}, uuid: 'r', session_id: 's' })
  assert.equal(f.transcript.status, 'error')
  assert.equal(f.transcript.error, 'boom')
  assert.equal(foldSdkMessage(f, { type: 'tool_progress', tool_use_id: 't' }), f, 'progress heartbeats are no-ops')
})

test('unstreamed assistant messages still append their blocks', () => {
  let f = fresh()
  f = foldSdkMessage(f, { type: 'assistant', uuid: 'a', session_id: 's', parent_tool_use_id: 'toolu_parent', message: { id: 'msg_9', content: [{ type: 'text', text: 'Sub-agent says hi' }] } })
  assert.equal(f.transcript.items[0].text, 'Sub-agent says hi')
  assert.equal(f.transcript.items[0].id, 'msg_9:0')
})

test('toolTitle and resultText', () => {
  assert.equal(toolTitle('Edit', { file_path: 'C:\\p\\src\\App.tsx' }), 'Edit App.tsx')
  assert.equal(toolTitle('Grep', { pattern: 'foo' }), 'Grep foo')
  assert.equal(toolTitle('Bash', { command: '\n  git status\ngit diff' }), 'git status')
  assert.equal(toolTitle('mcp__x__y', {}), 'mcp__x__y')
  assert.equal(resultText([{ type: 'text', text: 'a' }, { type: 'image' }]), 'a\n[image]')
  assert.equal(resultText('s'), 's')
})

test('stored session messages become a transcript with the custom title', () => {
  const t = sessionMessagesToTranscript({ sessionId: 's1', cwd: 'C:\\p', info: { customTitle: 'Fix build' } }, [
    { type: 'user', uuid: 'u1', session_id: 's1', message: { role: 'user', content: 'fix the build' }, parent_tool_use_id: null, parent_agent_id: null, timestamp: '2026-10-17T06:09:17.671Z' },
    { type: 'assistant', uuid: 'a1', session_id: 's1', message: { id: 'msg_1', content: [{ type: 'text', text: 'On it.' }, { type: 'tool_use', id: 'toolu_1', name: 'Read', input: { file_path: 'a.ts' } }] }, parent_tool_use_id: null, parent_agent_id: null },
    { type: 'user', uuid: 'u2', session_id: 's1', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: [{ type: 'text', text: 'export {}' }] }] }, parent_tool_use_id: null, parent_agent_id: null },
    { type: 'system', uuid: 'c1', session_id: 's1', message: { subtype: 'compact_boundary' }, parent_tool_use_id: null, parent_agent_id: null }
  ])
  assert.equal(t.title, 'Fix build')
  assert.deepEqual(t.items.map((x) => x.kind), ['user', 'assistant', 'tool', 'system'])
  assert.equal(t.items[0].at, Date.parse('2026-10-17T06:09:17.671Z'))
  assert.equal(t.items[2].output, 'export {}')
  assert.equal(t.items[2].status, 'done')
})

test('sessionSummary feeds the picker from listSessions rows', () => {
  const s = sessionSummary({ sessionId: 'x', summary: 'sum', lastModified: 5, firstPrompt: 'hello\nworld', gitBranch: 'main', cwd: 'C:\\p' })
  assert.equal(s.title, 'hello')
  assert.equal(s.updatedAt, 5)
  assert.equal(sessionSummary({ sessionId: 'y', customTitle: 'Named', lastModified: 1 }).title, 'Named')
})
