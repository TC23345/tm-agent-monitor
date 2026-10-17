import test from 'node:test'
import assert from 'node:assert/strict'
import {
  MAX_ITEMS, addUsage, answerQuestion, appendDelta, appendItem, clip, decideApproval, emptyTranscript, firstLine, pendingApprovals,
  pendingQuestions, pendingRequests, setStatus, settleStreams, sortSessions, summarizeAttachments, transcriptSummary, updateItem
} from './chatModel.mjs'

const t0 = emptyTranscript('claude', { cwd: 'C:\\p' })

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
  assert.deepEqual(summarizeAttachments([{ kind: 'image', name: 'shot.png', mime: 'image/png', data: 'AA==' }, { kind: 'file', path: 'C:\\p\\a.ts' }]), [{ kind: 'image', name: 'shot.png' }, { kind: 'file', name: 'C:\\p\\a.ts' }])
  assert.equal(summarizeAttachments([]), undefined)
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
