import test from 'node:test'
import assert from 'node:assert/strict'
import { emptyTranscript } from '../shared/chatModel.mjs'
import { foldSdkMessage, resultText, sessionMessagesToTranscript, sessionSummary, startFold, toolOutcome, toolTitle, toolView } from './fold.mjs'

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
  assert.deepEqual(toolView('Read', { file_path: 'C:\\p\\src\\App.tsx', offset: 9, limit: 20 }), { label: 'Read', detail: 'App.tsx (lines 10-29)', detailMono: true, view: 'read', path: 'C:\\p\\src\\App.tsx' })
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
  assert.deepEqual(t.items.filter((x) => x.kind !== 'turn').map((x) => [x.kind, x.text ?? x.title]), [
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
  assert.deepEqual(t.items.map((x) => x.kind), ['user', 'assistant', 'tool', 'system', 'turn'])
  assert.equal(t.items[0].at, Date.parse('2026-10-17T06:09:17.671Z'))
  assert.equal(t.items[0].uuid, 'u1', 'a stored prompt keeps the uuid a rewind or a fork takes')
  assert.equal(t.items[2].output, 'export {}')
  assert.equal(t.items[2].status, 'done')
  assert.equal(t.items[3].variant, 'compact')
})

test('stored interrupts, slash commands, their output and a compaction summary read as the pane draws them live', () => {
  const user = (uuid, content, timestamp) => ({ type: 'user', uuid, session_id: 's', message: { role: 'user', content }, parent_tool_use_id: null, parent_agent_id: null, ...(timestamp ? { timestamp } : {}) })
  const t = sessionMessagesToTranscript({ sessionId: 's', cwd: 'C:\\p' }, [
    user('u1', 'do it', '2026-10-18T08:00:00.000Z'),
    { type: 'assistant', uuid: 'a1', session_id: 's', message: { id: 'm1', content: [{ type: 'text', text: 'Starting.' }] }, parent_tool_use_id: null, timestamp: '2026-10-18T08:00:02.000Z' },
    { type: 'assistant', uuid: 'a2', session_id: 's', message: { id: 'm2', content: [{ type: 'text', text: 'Still going.' }] }, parent_tool_use_id: null, timestamp: '2026-10-18T08:00:09.000Z' },
    user('u2', [{ type: 'text', text: '[Request interrupted by user]' }]),
    user('u3', '<command-name>/compact</command-name>\n<command-message>compact</command-message>\n<command-args>keep the plan</command-args>'),
    { type: 'system', uuid: 'c1', session_id: 's', message: { subtype: 'compact_boundary', compactMetadata: { trigger: 'manual', preTokens: 91000 } }, parent_tool_use_id: null },
    user('u4', 'This session is being continued from a previous conversation that ran out of context. Summary: …'),
    user('u5', '<local-command-stdout>Compacted. ctrl+o to see full summary</local-command-stdout>')
  ])
  assert.deepEqual(t.items.map((x) => [x.kind, x.variant ?? '', x.text]), [
    ['user', '', 'do it'],
    ['assistant', '', 'Starting.'],
    ['assistant', '', 'Still going.'],
    ['system', 'interrupt', 'Interrupted'],
    ['turn', '', undefined],
    ['user', '', '/compact keep the plan'],
    ['system', 'compact', 'Context compacted'],
    ['system', 'command', 'Compacted. ctrl+o to see full summary']
  ])
  assert.equal(t.items[4].durationMs, 7000, 'the footer spans the turn’s first step to its last')
  assert.equal(t.items[6].tokens, 91000)
  assert.match(t.items[6].detail, /^This session is being continued/)
})

test('an interrupted turn reads as Interrupted, not an error, and still gets its footer', () => {
  let f = fresh()
  f = foldSdkMessage(f, { type: 'assistant', uuid: 'a', session_id: 's', parent_tool_use_id: null, message: { id: 'm', content: [{ type: 'text', text: 'Working' }] } })
  f = foldSdkMessage(f, { type: 'result', subtype: 'error_during_execution', is_error: true, errors: ['aborted'], duration_ms: 4200, usage: { output_tokens: 90 }, uuid: 'r', session_id: 's' }, { interrupted: true })
  assert.equal(f.transcript.status, 'idle')
  assert.deepEqual(f.transcript.items.map((x) => [x.kind, x.variant ?? '']), [['assistant', ''], ['system', 'interrupt'], ['turn', '']])
  assert.deepEqual([f.transcript.items[2].durationMs, f.transcript.items[2].outputTokens], [4200, 90])
})

test('a replayed prompt leaves the queue for the transcript; a compaction keeps its summary and size', () => {
  let f = startFold({ ...emptyTranscript('claude', { cwd: 'C:\\p' }), queue: [{ kind: 'user', id: 'q1', uuid: 'q1', text: 'next', at: 1 }] })
  f = foldSdkMessage(f, { type: 'user', isReplay: true, uuid: 'q1', session_id: 's', parent_tool_use_id: null, message: { role: 'user', content: 'next' } })
  assert.deepEqual([f.transcript.queue.length, f.transcript.items.map((x) => x.id)], [0, ['q1']])
  assert.equal(f.transcript.status, 'running', 'a queued prompt read after the turn ended starts the next one')
  assert.equal(foldSdkMessage(f, { type: 'user', isReplay: true, uuid: 'q1', session_id: 's', parent_tool_use_id: null, message: { role: 'user', content: 'next' } }), f, 'a replay of a prompt sent idle adds nothing')
  f = foldSdkMessage(f, { type: 'system', subtype: 'status', status: 'compacting', uuid: 'st', session_id: 's' })
  assert.equal(f.transcript.activity, 'compacting')
  f = foldSdkMessage(f, { type: 'system', subtype: 'compact_boundary', compact_metadata: { trigger: 'auto', pre_tokens: 160000 }, uuid: 'cb', session_id: 's' })
  f = foldSdkMessage(f, { type: 'user', isSynthetic: true, uuid: 'sum', session_id: 's', parent_tool_use_id: null, message: { role: 'user', content: 'Summary of the work so far.' } })
  const row = f.transcript.items.at(-1)
  assert.deepEqual([row.variant, row.text, row.tokens, row.detail], ['compact', 'Context compacted automatically', 160000, 'Summary of the work so far.'])
  assert.equal(f.transcript.activity, null)
})

test('retries, thinking tokens, command output, suggestions and limits', () => {
  let f = fresh()
  f = foldSdkMessage(f, { type: 'system', subtype: 'api_retry', attempt: 2, max_retries: 10, retry_delay_ms: 500, error_status: 529, uuid: 'r1', session_id: 's' })
  assert.deepEqual(f.transcript.retry, { attempt: 2, max: 10 })
  f = foldSdkMessage(f, ev({ type: 'message_start', message: { id: 'msg_5' } }))
  assert.equal(f.transcript.retry, null, 'the call went through')
  f = foldSdkMessage(f, ev({ type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } }))
  f = foldSdkMessage(f, { type: 'system', subtype: 'thinking_tokens', estimated_tokens: 1234, estimated_tokens_delta: 34, uuid: 'tt', session_id: 's' })
  assert.equal(f.transcript.items[0].tokens, 1234)
  f = foldSdkMessage(f, { type: 'system', subtype: 'local_command_output', content: '\x1b[1mTotal cost:\x1b[22m $0.12\nTotal duration: 3m', uuid: 'lc', session_id: 's' })
  assert.deepEqual([f.transcript.items.at(-1).variant, f.transcript.items.at(-1).text], ['command', 'Total cost: $0.12'])
  f = foldSdkMessage(f, { type: 'prompt_suggestion', suggestion: ' run the tests ', uuid: 'ps', session_id: 's' })
  assert.equal(f.transcript.suggestion, 'run the tests')
  f = foldSdkMessage(f, { type: 'rate_limit_event', rate_limit_info: { status: 'allowed_warning', utilization: 0.9 }, uuid: 'rl', session_id: 's' })
  const before = f.transcript.items.length
  f = foldSdkMessage(f, { type: 'rate_limit_event', rate_limit_info: { status: 'rejected', rateLimitType: 'five_hour' }, uuid: 'rl2', session_id: 's' })
  assert.equal(f.transcript.items.length, before + 1, 'only a refusal gets a line')
  assert.deepEqual([f.transcript.items.at(-1).level, f.transcript.items.at(-1).variant], ['warning', 'limit'])
})

test('background tasks: the task id on its row, the live set, and a line when one finishes', () => {
  let f = fresh()
  f = foldSdkMessage(f, { type: 'assistant', uuid: 'a', session_id: 's', parent_tool_use_id: null, message: { id: 'm', content: [{ type: 'tool_use', id: 'toolu_b', name: 'Bash', input: { command: 'npm run dev', description: 'Start the dev server' } }] } })
  f = foldSdkMessage(f, { type: 'system', subtype: 'task_started', task_id: 'b1', tool_use_id: 'toolu_b', description: 'npm run dev', task_type: 'local_bash', uuid: 't', session_id: 's' })
  f = foldSdkMessage(f, { type: 'system', subtype: 'task_updated', task_id: 'b1', patch: { is_backgrounded: true }, uuid: 'u', session_id: 's' })
  assert.deepEqual([f.transcript.items[0].taskId, f.transcript.items[0].background], ['b1', true])
  f = foldSdkMessage(f, { type: 'system', subtype: 'background_tasks_changed', tasks: [{ task_id: 'b1', task_type: 'local_bash', description: 'npm run dev' }, { task_id: 'w', task_type: 'watch', description: 'x', ambient: true }], uuid: 'c', session_id: 's' })
  assert.deepEqual(f.transcript.background, [{ id: 'b1', description: 'npm run dev', type: 'local_bash' }])
  f = foldSdkMessage(f, { type: 'system', subtype: 'task_notification', task_id: 'b1', status: 'completed', output_file: 'x', summary: 'Server stopped', uuid: 'n', session_id: 's' })
  assert.deepEqual([f.transcript.items.at(-1).text, f.transcript.items.at(-1).detail], ['Bash · Start the dev server finished', 'Server stopped'])
})

test('a refused tool call is declined, keeping only the reason the user gave', () => {
  const said = "The user doesn't want to proceed with this tool use. The tool use was rejected (eg. if it was a file edit, the new_string was NOT written to the file). The user provided the following reason for the rejection: use npm ci"
  const bare = "The user doesn't want to proceed with this tool use. The tool use was rejected (eg. if it was a file edit, the new_string was NOT written to the file). STOP what you are doing and wait for the user to tell you how to proceed."
  assert.deepEqual(toolOutcome(said, true), { status: 'declined', output: 'use npm ci' })
  assert.deepEqual(toolOutcome(bare, true), { status: 'declined', output: '' })
  assert.deepEqual(toolOutcome('Exit code 1', true), { status: 'failed', output: 'Exit code 1' })
  assert.deepEqual(toolOutcome('ok', false), { status: 'done', output: 'ok' })
})

test('TodoWrite is a checklist; an Agent row carries its prompt', () => {
  const todo = toolView('TodoWrite', { todos: [{ content: 'Read', status: 'completed', activeForm: 'Reading' }, { content: 'Fix', status: 'in_progress' }, { content: 'Test', status: 'weird' }] })
  assert.deepEqual([todo.label, todo.detail, todo.view, todo.todos.map((x) => x.status)], ['Update Todos', '1 of 3 done', 'todo', ['completed', 'in_progress', 'pending']])
  const agent = toolView('Agent', { description: 'Find the bug', prompt: 'Look through src for the crash' })
  assert.deepEqual([agent.label, agent.detail, agent.view, agent.prompt], ['Agent', 'Find the bug', 'agent', 'Look through src for the crash'])
})

test('sessionSummary feeds the picker from listSessions rows', () => {
  const s = sessionSummary({ sessionId: 'x', summary: 'sum', lastModified: 5, firstPrompt: 'hello\nworld', gitBranch: 'main', cwd: 'C:\\p' })
  assert.equal(s.title, 'hello')
  assert.equal(s.updatedAt, 5)
  assert.equal(sessionSummary({ sessionId: 'y', customTitle: 'Named', lastModified: 1 }).title, 'Named')
})
