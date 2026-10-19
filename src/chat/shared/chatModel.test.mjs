import test from 'node:test'
import assert from 'node:assert/strict'
import {
  MAX_ITEMS, addUsage, answerQuestion, appendDelta, appendItem, clip, decideApproval, emptyTranscript, firstLine, pendingApprovals,
  beginTurn, pendingQuestions, pendingRequests, setStatus, settleStreams, sortSessions, summarizeAttachments, transcriptSummary, updateItem,
  closeTurn, removeItem, turnFiles, enqueue, dequeue, unqueue
} from './chatModel.mjs'

test('a queued prompt waits outside the transcript, joins it when read, or is taken back', () => {
  const running = setStatus(appendItem(t0, { kind: 'user', id: 'u1', text: 'first', at: 1 }), 'running')
  let t = enqueue(running, { kind: 'user', id: 'q1', text: 'then this', at: 2 })
  t = enqueue(t, { kind: 'user', id: 'q2', text: 'and this', at: 3 })
  assert.deepEqual([t.items.length, t.queue.map((x) => x.id)], [1, ['q1', 'q2']])
  t = dequeue(t, 'q1', 4)
  assert.deepEqual([t.items.map((x) => x.id), t.queue.map((x) => x.id), t.status], [['u1', 'q1'], ['q2'], 'running'])
  t = unqueue(t, 'q2')
  assert.deepEqual(t.queue, [])
  const idle = dequeue(enqueue(setStatus(t0, 'idle'), { kind: 'user', id: 'q3', text: 'x', at: 5 }), 'q3', 6)
  assert.deepEqual([idle.status, idle.turnStartedAt], ['running', 6], 'read after the turn ended, it starts the next')
  assert.equal(dequeue(t0, 'nope', 1), t0)
})

const t0 = emptyTranscript('claude', { cwd: 'C:\\p' })

test('removeItem drops one item by id and keeps identity for unknown ids', () => {
  const t = appendItem(appendItem(t0, { kind: 'user', id: 'u1', text: 'a', at: 1 }), { kind: 'user', id: 'u2', text: 'b', at: 2, queued: true })
  assert.deepEqual(removeItem(t, 'u2').items.map((x) => x.id), ['u1'])
  assert.equal(removeItem(t, 'nope'), t)
})

test('turnFiles adds up a turn’s edits and writes per file, skipping failed steps', () => {
  const items = [
    { kind: 'tool', id: 'e1', name: 'Edit', title: '', status: 'done', at: 1, view: 'edit', path: 'C:\\p\\a.ts', edits: [{ path: 'C:\\p\\a.ts', before: 'x\ny', after: 'x\nz\nw' }] },
    { kind: 'tool', id: 'w1', name: 'Write', title: '', status: 'done', at: 2, view: 'write', path: 'C:\\p\\b.md', content: 'one\ntwo\n' },
    { kind: 'tool', id: 'e2', name: 'Edit', title: '', status: 'failed', at: 3, view: 'edit', path: 'C:\\p\\c.ts', edits: [{ path: 'C:\\p\\c.ts', before: 'q', after: 'r' }] },
    { kind: 'tool', id: 'e3', name: 'Edit', title: '', status: 'done', at: 4, view: 'edit', path: 'C:\\p\\a.ts', edits: [{ path: 'C:\\p\\a.ts', before: 'w', after: '' }] }
  ]
  assert.deepEqual(turnFiles(items), [{ path: 'C:\\p\\a.ts', added: 2, removed: 2 }, { path: 'C:\\p\\b.md', added: 2, removed: 0 }])
})

test('closeTurn appends one footer after the turn’s steps, once', () => {
  let t = appendItem(t0, { kind: 'user', id: 'u1', text: 'go', at: 1 })
  t = appendItem(t, { kind: 'assistant', id: 'a1', text: 'done', streaming: false, at: 2 })
  const closed = closeTurn(t, { at: 9, durationMs: 8000, outputTokens: 120 })
  assert.deepEqual(closed.items.at(-1), { kind: 'turn', id: 'turn:9', at: 9, files: [], durationMs: 8000, outputTokens: 120 })
  assert.equal(closeTurn(closed, { at: 10 }), closed, 'a turn closes once')
  const onlyCommand = appendItem(appendItem(t0, { kind: 'user', id: 'u', text: '/compact', at: 1 }), { kind: 'system', id: 's', text: 'Context compacted', level: 'info', at: 2 })
  assert.equal(closeTurn(onlyCommand, { at: 3 }), onlyCommand, 'a turn of only system lines gets no footer')
})

test('beginTurn spends the suggestion and clears a retry', () => {
  const t = beginTurn({ ...t0, suggestion: 'run the tests', retry: { attempt: 2, max: 10 } }, 5)
  assert.equal(t.suggestion, null)
  assert.equal(t.retry, null)
  assert.equal(t.turnStartedAt, 5)
})

test('decideApproval keeps what the user told the agent', () => {
  const t = appendItem(t0, { kind: 'approval', id: 'p1', title: 'Allow Bash', choices: ['allow', 'deny'], at: 1 })
  const decided = decideApproval(t, 'p1', 'deny', 'use npm ci instead')
  assert.equal(decided.items[0].decided, 'deny')
  assert.equal(decided.items[0].message, 'use npm ci instead')
})

test('emptyTranscript starts idle with no items', () => {
  assert.equal(t0.status, 'idle')
  assert.deepEqual(t0.items, [])
  assert.equal(t0.sessionId, null)
})

test('appendItem never mutates and bounds the ring', () => {
  let t = t0
  for (let i = 0; i < MAX_ITEMS + 5; i++) t = appendItem(t, { kind: 'system', id: `s${i}`, text: 'x', level: 'info', at: i })
  assert.equal(t.items.length, MAX_ITEMS)
  assert.equal(t.items[0].id, 's5')
  assert.equal(t0.items.length, 0)
})

test('appendDelta creates then extends a streaming assistant item', () => {
  let t = appendDelta(t0, 'a1', 'assistant', 'Hel', 1)
  t = appendDelta(t, 'a1', 'assistant', 'lo', 2)
  assert.deepEqual(t.items, [{ kind: 'assistant', id: 'a1', text: 'Hello', streaming: true, at: 1 }])
  assert.equal(appendDelta(t, 'a1', 'assistant', '', 3), t, 'an empty delta is a no-op')
  assert.equal(appendDelta(t, 'a1', 'thinking', 'x', 3), t, 'a delta of another kind for the same id is ignored')
})

test('settleStreams closes every streaming item once', () => {
  let t = appendDelta(t0, 'a1', 'assistant', 'x', 1)
  t = appendDelta(t, 'th', 'thinking', 'y', 1)
  const settled = settleStreams(t)
  assert.ok(settled.items.every((x) => x.streaming === false))
  assert.equal(settleStreams(settled), settled, 'idempotent by identity')
})

test('updateItem patches by id and ignores unknown ids', () => {
  const t = appendItem(t0, { kind: 'tool', id: 'c1', name: 'Bash', title: 'ls', status: 'running', at: 1 })
  assert.equal(updateItem(t, 'nope', { status: 'done' }), t)
  const done = updateItem(t, 'c1', { status: 'done', output: 'a\nb' })
  assert.equal(done.items[0].status, 'done')
  assert.equal(done.items[0].output, 'a\nb')
  assert.equal(t.items[0].status, 'running')
})

test('approvals: pending, decided, and status returns to running', () => {
  let t = setStatus(t0, 'running')
  t = appendItem(t, { kind: 'approval', id: 'r1', title: 'Run ls', choices: ['allow', 'deny'], at: 1 })
  t = appendItem(t, { kind: 'approval', id: 'r2', title: 'Edit x', choices: ['allow', 'deny'], at: 2 })
  t = setStatus(t, 'waiting')
  assert.equal(pendingApprovals(t).length, 2)
  t = decideApproval(t, 'r1', 'allow')
  assert.equal(t.status, 'waiting', 'one still waits')
  t = decideApproval(t, 'r2', 'deny')
  assert.equal(t.status, 'running')
  assert.equal(decideApproval(t, 'r2', 'allow'), t, 'a decided approval is final')
})

test('questions: pending until answered or cancelled, and they hold the status with approvals', () => {
  let t = setStatus(t0, 'running')
  const q = { id: 'q1', text: 'Which?', options: [{ label: 'A' }, { label: 'B' }], multiSelect: false, allowOther: false }
  t = appendItem(t, { kind: 'question', id: 'r1', title: 'Claude needs a decision', questions: [q], at: 1 })
  t = appendItem(t, { kind: 'approval', id: 'r2', title: 'Run ls', choices: ['allow', 'deny'], at: 2 })
  t = setStatus(t, 'waiting')
  assert.equal(pendingQuestions(t).length, 1)
  assert.equal(pendingRequests(t).length, 2)
  t = answerQuestion(t, 'r1', { q1: ['A'] })
  assert.deepEqual(t.items[0].answers, { q1: ['A'] })
  assert.equal(t.status, 'waiting', 'the approval still waits')
  t = decideApproval(t, 'r2', 'allow')
  assert.equal(t.status, 'running')
  assert.equal(answerQuestion(t, 'r1', { q1: ['B'] }), t, 'an answered question is final')
  const c = answerQuestion(appendItem(t, { kind: 'question', id: 'r3', title: 'x', questions: [q], at: 3 }), 'r3', null)
  assert.equal(c.items.at(-1).cancelled, true)
  assert.deepEqual(summarizeAttachments([{ kind: 'image', name: 'shot.png', mime: 'image/png', data: 'AA==' }, { kind: 'file', path: 'C:\\p\\a.ts' }]), [{ kind: 'image', name: 'shot.png' }, { kind: 'file', name: 'C:\\p\\a.ts', path: 'C:\\p\\a.ts' }])
  assert.deepEqual(summarizeAttachments([{ kind: 'image', name: 's.png', mime: 'image/png', data: 'AA==', width: 702, height: 231 }]), [{ kind: 'image', name: 's.png', width: 702, height: 231 }], 'the size rides along, never the bytes')
  assert.equal(summarizeAttachments([]), undefined)
})

test('beginTurn starts the clock with the turn', () => {
  const t = beginTurn(emptyTranscript('claude', { cwd: 'C:\\p', effort: 'high', permissionMode: 'plan' }), 1234)
  assert.deepEqual([t.status, t.turnStartedAt, t.effort, t.permissionMode], ['running', 1234, 'high', 'plan'])
})

test('clip keeps head and tail with a marker', () => {
  const long = 'a'.repeat(100) + 'b'.repeat(100)
  const c = clip(long, 50)
  assert.ok(c.startsWith('a'.repeat(35)))
  assert.ok(c.endsWith('b'.repeat(15)))
  assert.match(c, /150 characters omitted/)
  assert.equal(clip('short', 50), 'short')
  assert.equal(clip(undefined, 5), '')
})

test('addUsage sums counters and keeps the last context size', () => {
  let t = addUsage(t0, { inputTokens: 10, outputTokens: 5, contextTokens: 100, contextWindow: 200000 })
  t = addUsage(t, { inputTokens: 1, contextTokens: 120, costUsd: 0.5 })
  assert.deepEqual(t.usage, { inputTokens: 11, outputTokens: 5, contextTokens: 120, contextWindow: 200000, costUsd: 0.5 })
})

test('transcriptSummary prefers the title, then the first prompt line', () => {
  assert.equal(transcriptSummary(t0), '(empty session)')
  const t = appendItem(t0, { kind: 'user', id: 'u', text: '\n\n  fix the build \nplease', at: 1 })
  assert.equal(transcriptSummary(t), 'fix the build')
  assert.equal(transcriptSummary({ ...t, title: 'Named' }), 'Named')
  assert.equal(firstLine('x'.repeat(200), 10), 'xxxxxxxxx…')
})

test('sortSessions is newest first and bounded', () => {
  const list = [{ id: 'a', updatedAt: 1 }, { id: 'b', updatedAt: 3 }, { id: 'c', updatedAt: 2 }]
  assert.deepEqual(sortSessions(list).map((s) => s.id), ['b', 'c', 'a'])
  assert.equal(sortSessions(list, 2).length, 2)
})
