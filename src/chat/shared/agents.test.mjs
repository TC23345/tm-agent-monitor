import test from 'node:test'
import assert from 'node:assert/strict'
import { emptyTranscript } from './chatModel.mjs'
import { agentCards, runningLabel } from './agents.mjs'
import { foldSdkMessage, startFold } from '../claude/fold.mjs'
import { itemToChat } from '../codex/fold.mjs'

const claude = (items, background = []) => ({ ...emptyTranscript('claude', { cwd: 'C:\\p' }), items, background })
const agent = (id, extra = {}) => ({ kind: 'tool', id, name: 'Agent', title: 'Agent', status: 'done', at: 10, label: 'Agent', detail: `do ${id}`, view: 'agent', ...extra })
const step = (id, parent, at, extra = {}) => ({ kind: 'tool', id, name: 'Read', title: 'Read a.md', status: 'done', at, parent, label: 'Read', detail: 'a.md', view: 'read', ...extra })

test('a foreground agent: its steps, its latest step and its result', () => {
  const t = claude([agent('a1', { status: 'running', agentType: 'Explore', prompt: 'Look around' }), step('s1', 'a1', 11), step('s2', 'a1', 12, { label: 'Grep', detail: 'pattern: "x"' }), { kind: 'thinking', id: 'th', text: 'hm', streaming: false, at: 12, parent: 'a1' }])
  const [card] = agentCards(t)
  assert.deepEqual([card.id, card.kind, card.name, card.type, card.state, card.steps, card.latest, card.rowId, card.prompt], ['a1', 'agent', 'do a1', 'Explore', 'running', 2, 'Grep pattern: "x"', 'a1', 'Look around'])
  assert.equal(card.items.length, 3, 'its thinking shows in the detail view with its tools')
  assert.equal(card.stopId, undefined, 'a foreground agent stops with the turn')
  const done = agentCards(claude([agent('a1', { output: 'Found it.' })]))[0]
  assert.deepEqual([done.state, done.result], ['done', 'Found it.'])
})

test('a background agent runs while its task is listed or a step runs, and ends as the notification says', () => {
  const row = agent('a1', { background: true, taskId: 'k1', output: 'Async agent launched' })
  let [card] = agentCards(claude([row], [{ id: 'k1', description: 'do a1', type: 'local_agent', toolUseId: 'a1' }]))
  assert.deepEqual([card.state, card.stopId, card.result], ['running', 'k1', undefined], 'the launch message is not its result')
  assert.equal(agentCards(claude([row, step('s1', 'a1', 11, { status: 'running' })]))[0].state, 'running')
  ;[card] = agentCards(claude([{ ...row, outcome: 'completed', endedAt: 40, summary: 'All checks pass' }]))
  assert.deepEqual([card.state, card.endedAt, card.result, card.stopId], ['done', 40, 'All checks pass', undefined])
  assert.equal(agentCards(claude([{ ...row, outcome: 'failed' }]))[0].state, 'failed')
  const reply = { kind: 'assistant', id: 'r', text: 'All checks pass\n', streaming: false, at: 30, parent: 'a1' }
  assert.equal(agentCards(claude([{ ...row, outcome: 'completed', summary: 'All checks pass' }, reply]))[0].result, undefined, 'its last reply is already among its steps')
  assert.equal(agentCards(claude([agent('a2', { status: 'declined' })]))[0].state, 'stopped')
})

test('order: running cards first as they started, then finished ones newest first; a nested agent is a step', () => {
  const t = claude([
    agent('old', { at: 1 }),
    agent('r2', { at: 5, status: 'running' }),
    agent('new', { at: 3, background: true, outcome: 'completed', endedAt: 50 }),
    agent('r1', { at: 2, status: 'running' }),
    agent('inner', { at: 6, parent: 'r1' })
  ])
  assert.deepEqual(agentCards(t).map((c) => c.id), ['r1', 'r2', 'new', 'old'])
})

test('background tasks: a command sent to the background, and one the CLI lists without a row', () => {
  const bash = { kind: 'tool', id: 'b1', name: 'Bash', title: 'npm run dev', status: 'done', at: 7, label: 'Bash', detail: 'Start the dev server', view: 'command', background: true, taskId: 'k2', output: 'ready on 3000\n' }
  const t = claude([bash], [{ id: 'k2', description: 'npm run dev', type: 'local_bash', toolUseId: 'b1' }, { id: 'k3', description: 'watch', type: 'monitor' }])
  const cards = agentCards(t)
  assert.deepEqual(cards.map((c) => [c.id, c.kind, c.name, c.type, c.state, c.stopId, c.latest]), [
    ['task:k2', 'task', 'Start the dev server', 'Bash', 'running', 'k2', 'ready on 3000'],
    ['task:k3', 'task', 'watch', undefined, 'running', 'k3', undefined]
  ])
  assert.equal(agentCards(claude([{ ...bash, outcome: 'completed' }]))[0].state, 'done')
  assert.equal(runningLabel(cards), '2 in background')
})

test('runningLabel counts what runs now', () => {
  assert.equal(runningLabel([]), null)
  const t = claude([agent('a', { status: 'running' }), agent('b', { status: 'running' }), agent('c')], [{ id: 'k', description: 'x', type: 'local_bash' }])
  assert.equal(runningLabel(agentCards(t)), '2 agents · 1 in background')
  assert.equal(runningLabel(agentCards(claude([agent('a', { status: 'running' })]))), '1 agent')
})

test('Codex: a card per agent thread, its state the latest call or activity', () => {
  const spawn = itemToChat({ type: 'collabAgentToolCall', id: 'c1', tool: 'spawnAgent', status: 'completed', senderThreadId: 'th', receiverThreadIds: ['a1'], prompt: 'Explore the repo\nthen report', model: 'gpt-6-luna', reasoningEffort: null, agentsStates: { a1: { status: 'running', message: null } } }, 1)
  const started = itemToChat({ type: 'subAgentActivity', id: 's1', kind: 'started', agentThreadId: 'a1', agentPath: 'root/explorer', model: null, reasoningEffort: null }, 2)
  const wait = itemToChat({ type: 'collabAgentToolCall', id: 'c2', tool: 'wait', status: 'completed', senderThreadId: 'th', receiverThreadIds: ['a1'], prompt: null, model: null, reasoningEffort: null, agentsStates: { a1: { status: 'completed', message: 'Three packages, one app.' } } }, 9)
  const t = { ...emptyTranscript('codex', { cwd: 'C:\\p' }), items: [spawn, started], background: [{ id: '42', description: 'npm run dev', type: 'terminal', toolUseId: 'cmd1' }] }
  let cards = agentCards(t)
  assert.deepEqual(cards.map((c) => [c.id, c.kind, c.name, c.type, c.state, c.steps, c.rowId, c.prompt]), [
    ['agent:a1', 'agent', 'explorer', 'gpt-6-luna', 'running', 2, 'c1', 'Explore the repo\nthen report'],
    ['task:42', 'task', 'npm run dev', 'Terminal', 'running', 0, undefined, undefined]
  ])
  cards = agentCards({ ...t, items: [spawn, started, wait], background: [] })
  assert.deepEqual([cards[0].state, cards[0].endedAt, cards[0].result, cards[0].latest], ['done', 9, 'Three packages, one app.', 'Three packages, one app.'])
})

test('Claude fold: a background agent streaming beside the session keeps both cursors, and nests its text', () => {
  let f = startFold(emptyTranscript('claude', { cwd: 'C:\\p' }))
  const ev = (event, parent = null) => ({ type: 'stream_event', event, parent_tool_use_id: parent, uuid: 'x', session_id: 's' })
  f = foldSdkMessage(f, ev({ type: 'message_start', message: { id: 'm1' } }))
  f = foldSdkMessage(f, ev({ type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } }))
  // The agent's message starts while the session's thinking block is open.
  f = foldSdkMessage(f, ev({ type: 'message_start', message: { id: 'sub1' } }, 'a1'))
  f = foldSdkMessage(f, ev({ type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } }, 'a1'))
  f = foldSdkMessage(f, ev({ type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'agent thought' } }, 'a1'))
  f = foldSdkMessage(f, ev({ type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'session thought' } }))
  f = foldSdkMessage(f, ev({ type: 'content_block_stop', index: 0 }))
  f = foldSdkMessage(f, ev({ type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } }, 'a1'))
  f = foldSdkMessage(f, ev({ type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'Found it.' } }, 'a1'))
  const by = Object.fromEntries(f.transcript.items.map((x) => [x.id, x]))
  assert.equal(by['m1:0'].text, 'session thought')
  assert.equal(typeof by['m1:0'].durationMs, 'number', "the session's block learnt when it ended")
  assert.equal(by['m1:0'].parent, undefined)
  assert.deepEqual([by['sub1:0'].text, by['sub1:0'].parent, by['sub1:0'].durationMs], ['agent thought', 'a1', undefined])
  assert.deepEqual([by['sub1:1'].text, by['sub1:1'].parent], ['Found it.', 'a1'])
  // The session's turn ends; the agent's cursor survives it.
  f = foldSdkMessage(f, { type: 'result', subtype: 'success', is_error: false, usage: {}, uuid: 'r', session_id: 's' })
  f = foldSdkMessage(f, ev({ type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: ' Done.' } }, 'a1'))
  assert.equal(f.transcript.items.find((x) => x.id === 'sub1:1').text, 'Found it. Done.')
  // The complete message from the agent nests its blocks too.
  f = foldSdkMessage(f, { type: 'assistant', uuid: 'a', session_id: 's', parent_tool_use_id: 'a1', message: { id: 'sub2', role: 'assistant', content: [{ type: 'text', text: 'Report.' }] } })
  assert.equal(f.transcript.items.at(-1).parent, 'a1')
})

test('Claude fold: a background task notification leaves its end on the row', () => {
  let f = startFold(emptyTranscript('claude', { cwd: 'C:\\p' }))
  f = foldSdkMessage(f, { type: 'assistant', uuid: 'a', session_id: 's', parent_tool_use_id: null, message: { id: 'm', role: 'assistant', content: [{ type: 'tool_use', id: 'a1', name: 'Agent', input: { description: 'Check the site', prompt: 'Check it', subagent_type: 'Explore', run_in_background: true } }] } })
  assert.equal(f.transcript.items[0].agentType, 'Explore')
  f = foldSdkMessage(f, { type: 'system', subtype: 'task_started', task_id: 'k1', tool_use_id: 'a1', is_backgrounded: true, uuid: 'u', session_id: 's' })
  f = foldSdkMessage(f, { type: 'system', subtype: 'task_notification', task_id: 'k1', status: 'completed', summary: 'Site is fine', uuid: 'n', session_id: 's' })
  const row = f.transcript.items[0]
  assert.deepEqual([row.outcome, typeof row.endedAt, row.summary], ['completed', 'number', 'Site is fine'])
  assert.equal(f.transcript.items.at(-1).text, 'Agent · Check the site finished', 'the transcript still gets its line')
})
