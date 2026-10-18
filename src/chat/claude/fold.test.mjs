import test from 'node:test'
import assert from 'node:assert/strict'
import { emptyTranscript } from '../shared/chatModel.mjs'
import { foldSdkMessage, resultText, sessionMessagesToTranscript, sessionSummary, startFold, toolTitle, toolView } from './fold.mjs'

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
    message: { id: 'msg_1', role: 'assistant', content: [{ type: 'thinking', thinking: 'Let me look.' }, { type: 'text', text: 'Checking now.' }, { type: 'tool_use', id: 'toolu_1', name: 'Bash', input: { command: 'npm test', description: 'Run the tests' } }], usage: { input_tokens: 12, cache_read_input_tokens: 8000, cache_creation_input_tokens: 0, output_tokens: 30 } }
  })
  assert.equal(f.transcript.items.length, 3, 'the full message finalises streamed rows instead of duplicating them')
  assert.equal(f.transcript.items[1].streaming, false)
  assert.equal(f.transcript.items[2].title, 'npm test')
  assert.equal(f.transcript.items[2].input, 'npm test')
  assert.deepEqual([f.transcript.items[2].label, f.transcript.items[2].detail, f.transcript.items[2].view], ['Bash', 'Run the tests', 'command'])
  assert.equal(f.transcript.usage.contextTokens, 8042, 'the context is this call: its input, cached input and output')
  f = foldSdkMessage(f, { type: 'user', uuid: 'u2', session_id: 's1', parent_tool_use_id: null, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'ok\n12 passing', is_error: false }] } })
  assert.equal(f.transcript.items[2].status, 'done')
  assert.equal(f.transcript.items[2].output, 'ok\n12 passing')
  assert.equal(f.transcript.items.length, 3, 'a tool_result user message adds no user row')
  // A turn of 17 calls adds up to far more than any one window holds; the result must not overwrite the context with it.
  f = foldSdkMessage(f, { type: 'result', subtype: 'success', is_error: false, result: 'Done.', duration_ms: 1, duration_api_ms: 1, num_turns: 1, stop_reason: 'end_turn', total_cost_usd: 0.02, usage: { input_tokens: 204, output_tokens: 510, cache_read_input_tokens: 1_136_000, cache_creation_input_tokens: 0 }, modelUsage: { 'claude-haiku-4-5': { contextWindow: 200_000 }, 'claude-opus-5-5': { contextWindow: 1_000_000 } }, permission_denials: [], uuid: 'r', session_id: 's1' })
  assert.equal(f.transcript.status, 'idle')
  assert.equal(f.transcript.usage.contextTokens, 8042)
  assert.equal(f.transcript.usage.contextWindow, 1_000_000, 'the largest window when the session model is not named')
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
  assert.equal(f.transcript.items[0].id, 'msg_9:assistant:0')
})

// Claude Code delivers each block of an API message as its own `assistant`
// message, every one at content index 0, interleaved with the stream events.
const ev = (event) => ({ type: 'stream_event', event, parent_tool_use_id: null, uuid: `e${Math.random()}`, session_id: 's1' })
const block = (id, b) => ({ type: 'assistant', uuid: `a${Math.random()}`, session_id: 's1', parent_tool_use_id: null, message: { id, role: 'assistant', content: [b] } })

test('blocks delivered one assistant message each finalise their streamed rows, never duplicate them', () => {
  let f = fresh()
  f = foldSdkMessage(f, ev({ type: 'message_start', message: { id: 'msg_2' } }))
  f = foldSdkMessage(f, ev({ type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } }))
  f = foldSdkMessage(f, ev({ type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'Plan first.' } }))
  f = foldSdkMessage(f, block('msg_2', { type: 'thinking', thinking: 'Plan first.' }))
  f = foldSdkMessage(f, ev({ type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } }))
  f = foldSdkMessage(f, ev({ type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'Yes, I see it.' } }))
  f = foldSdkMessage(f, block('msg_2', { type: 'text', text: 'Yes, I see it.' }))
  f = foldSdkMessage(f, ev({ type: 'content_block_start', index: 2, content_block: { type: 'tool_use', id: 'toolu_2', name: 'Read', input: {} } }))
  f = foldSdkMessage(f, block('msg_2', { type: 'tool_use', id: 'toolu_2', name: 'Read', input: { file_path: 'C:\\p\\App.tsx' } }))
  assert.deepEqual(f.transcript.items.map((x) => [x.kind, x.text ?? x.title, !!x.streaming]), [
    ['thinking', 'Plan first.', false],
    ['assistant', 'Yes, I see it.', false],
    ['tool', 'Read App.tsx', false]
  ])
})

test('a reply whose thinking streamed no text keeps one timed thinking row and one text row', () => {
  let f = fresh()
  f = foldSdkMessage(f, ev({ type: 'message_start', message: { id: 'msg_3' } }))
  f = foldSdkMessage(f, ev({ type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } }))
  const started = f.transcript.items[0].at
  f = foldSdkMessage(f, ev({ type: 'content_block_stop', index: 0 }))
  f = foldSdkMessage(f, block('msg_3', { type: 'thinking', thinking: '' }))
  f = foldSdkMessage(f, ev({ type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } }))
  f = foldSdkMessage(f, ev({ type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'Checking ' } }))
  f = foldSdkMessage(f, ev({ type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'the code.' } }))
  f = foldSdkMessage(f, block('msg_3', { type: 'text', text: 'Checking the code.' }))
  assert.deepEqual(f.transcript.items.map((x) => [x.kind, x.text]), [['thinking', ''], ['assistant', 'Checking the code.']])
  assert.equal(f.transcript.items[1].streaming, false)
  assert.equal(typeof f.transcript.items[0].durationMs, 'number', 'the stop event times the thinking block')
  assert.ok(f.transcript.items[0].durationMs >= 0 && f.transcript.items[0].at === started)
})

test('init carries the permission mode and the effort; a status message moves the mode', () => {
  let f = fresh()
  f = foldSdkMessage(f, { type: 'system', subtype: 'init', session_id: 's', model: 'claude-opus-5-5', cwd: 'C:\\p', permissionMode: 'acceptEdits', effort: 'xhigh', uuid: 'i' })
  assert.deepEqual([f.transcript.permissionMode, f.transcript.effort], ['acceptEdits', 'xhigh'])
  f = foldSdkMessage(f, { type: 'system', subtype: 'status', permissionMode: 'plan', uuid: 's2' })
  assert.equal(f.transcript.permissionMode, 'plan')
})

test('toolView follows the extension renderers', () => {
  assert.deepEqual(toolView('Read', { file_path: 'C:\\p\\src\\App.tsx', offset: 9, limit: 20 }), { label: 'Read', detail: 'App.tsx (lines 10-29)', detailMono: true, view: 'read' })
  const edit = toolView('Edit', { file_path: 'C:\\p\\a.ts', old_string: 'x', new_string: 'y' })
  assert.deepEqual([edit.label, edit.detail, edit.view, edit.edits], ['Edit', 'C:\\p\\a.ts', 'edit', [{ path: 'C:\\p\\a.ts', before: 'x', after: 'y' }]])
  assert.equal(toolView('MultiEdit', { file_path: 'b.ts', edits: [{ old_string: '1', new_string: '2' }, { old_string: '3', new_string: '4' }] }).edits.length, 2)
  assert.deepEqual([toolView('Write', { file_path: 'c.md', content: 'hi' }).view, toolView('Write', { file_path: 'c.md', content: 'hi' }).content], ['write', 'hi'])
  assert.equal(toolView('Glob', { pattern: '**/*.ts' }).detail, 'pattern: "**/*.ts"')
  assert.deepEqual(toolView('mcp__claude-in-chrome__browser_batch', { url: 'https://example.com/x' }), { label: 'browser_batch (Claude in Chrome)', detail: 'example.com', view: 'other' })
  assert.deepEqual(toolView('Bash', { command: 'ls' }), { label: 'Bash', detail: undefined, view: 'command' })
})

test('a stored session keeps image chips with their size and its last context', () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0x02, 0xbe, 0, 0, 0, 0xe7, ...new Array(40).fill(0)]).toString('base64')
  const t = sessionMessagesToTranscript({ sessionId: 's1', cwd: 'C:\\p' }, [
    { type: 'user', uuid: 'u1', session_id: 's1', message: { role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: png } }] }, parent_tool_use_id: null },
    { type: 'assistant', uuid: 'a1', session_id: 's1', message: { id: 'm1', content: [{ type: 'text', text: 'Nice.' }], usage: { input_tokens: 3, cache_read_input_tokens: 64_000, output_tokens: 2 } }, parent_tool_use_id: null }
  ])
  assert.deepEqual(t.items[0].attachments, [{ kind: 'image', name: 'image.png', width: 702, height: 231 }], 'an image-only message still gets its row')
  assert.equal(t.usage.contextTokens, 64_005)
})

test('a stored message split across lines keeps its thinking and its text apart', () => {
  const line = (uuid, b) => ({ type: 'assistant', uuid, session_id: 's1', message: { id: 'msg_4', content: [b] }, parent_tool_use_id: null, parent_agent_id: null })
  const t = sessionMessagesToTranscript({ sessionId: 's1', cwd: 'C:\\p' }, [
    line('a1', { type: 'thinking', thinking: 'First thought.' }),
    line('a2', { type: 'thinking', thinking: 'Second thought.' }),
    line('a3', { type: 'text', text: 'The answer.' }),
    line('a4', { type: 'tool_use', id: 'toolu_4', name: 'Grep', input: { pattern: 'x' } })
  ])
  assert.deepEqual(t.items.map((x) => [x.kind, x.text ?? x.title]), [
    ['thinking', 'First thought.'],
    ['thinking', 'Second thought.'],
    ['assistant', 'The answer.'],
    ['tool', 'Grep x']
  ])
  assert.equal(new Set(t.items.map((x) => x.id)).size, t.items.length, 'every row has its own id')
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
