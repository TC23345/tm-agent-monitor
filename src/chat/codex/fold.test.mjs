import test from 'node:test'
import assert from 'node:assert/strict'
import { emptyTranscript } from '../shared/chatModel.mjs'
import { approvalResponse, foldNotification, foldServerRequest, itemToChat, questionResponse, threadSummary, threadToTranscript } from './fold.mjs'

// Item shapes as thread/read returned them on 2026-10-17 (docs/rea/codex-samples), with synthetic content.
const USER = { type: 'userMessage', id: 'u1', clientId: 'c', content: [{ type: 'text', text: 'find the parser\n', text_elements: [] }] }
const AGENT = { type: 'agentMessage', id: 'msg_1', text: 'I’ll look for it.', phase: 'commentary', memoryCitation: null, delivery: null, questions: null }
const CMD = {
  type: 'commandExecution', id: 'exec-1', pluginId: null, scriptPath: null, command: 'pwsh -Command "rg -n parser"', cwd: 'C:\\p', processId: null,
  source: 'agent', status: 'completed', commandActions: [{ type: 'search', command: 'rg -n parser', query: 'parser', path: null }], aggregatedOutput: 'a.ts:1: parser', exitCode: 0, durationMs: 12
}
const MCP = { type: 'mcpToolCall', id: 'exec-2', server: 'codex_app', tool: 'list_threads', status: 'completed', arguments: { limit: 40 }, appContext: null, mcpAppUi: null, pluginId: 'p', readOnlyHint: null, result: { content: [{ type: 'text', text: '{"threads":[]}' }] }, error: null, durationMs: 5 }
const REASONING = { type: 'reasoning', id: 'rs_1', summary: ['Planning the search'], content: [] }
const THREAD = {
  id: '01a00000-0000-7000-8000-000000000001', sessionId: '01a00000-0000-7000-8000-000000000001', preview: 'find the parser', model: 'gpt-6.1-sol', createdAt: 1792212803,
  updatedAt: 1792212856, recencyAt: 1792213207, cwd: 'C:\\p\\demo', name: 'Find the parser', gitInfo: { sha: 'x', branch: 'main', originUrl: 'u' },
  turns: [{ id: 't1', rootTurnId: 't1', items: [USER, AGENT, CMD, MCP, REASONING], itemsView: 'complete', status: 'completed', error: null, startedAt: 1792212857, completedAt: 1792212900, durationMs: 43000 }]
}

test('itemToChat maps every observed item type', () => {
  assert.deepEqual(itemToChat(USER, 1), { kind: 'user', id: 'u1', text: 'find the parser\n', at: 1 })
  assert.equal(itemToChat(AGENT, 1).kind, 'assistant')
  const cmd = itemToChat(CMD, 1)
  assert.equal(cmd.kind, 'tool')
  assert.equal(cmd.title, 'Search parser')
  assert.equal(cmd.status, 'done')
  assert.equal(cmd.output, 'a.ts:1: parser')
  const mcp = itemToChat(MCP, 1)
  assert.equal(mcp.name, 'codex_app.list_threads')
  assert.equal(mcp.output, '{"threads":[]}')
  assert.equal(itemToChat(REASONING, 1).text, 'Planning the search')
  assert.equal(itemToChat({ type: 'reasoning', id: 'rs_2', summary: [], content: [] }, 1), null, 'empty reasoning is not a row')
  assert.equal(itemToChat({ type: 'somethingNew', id: 'z' }, 1), null)
  assert.equal(itemToChat({ ...CMD, status: 'completed', exitCode: 2 }, 1).status, 'failed')
  assert.equal(itemToChat({ ...CMD, status: 'declined' }, 1).status, 'declined')
})

test('threadToTranscript carries identity, title and history', () => {
  const t = threadToTranscript(THREAD)
  assert.equal(t.provider, 'codex')
  assert.equal(t.sessionId, THREAD.id)
  assert.equal(t.title, 'Find the parser')
  assert.equal(t.model, 'gpt-6.1-sol')
  assert.deepEqual(t.items.map((x) => x.kind), ['user', 'assistant', 'tool', 'tool', 'thinking'])
  assert.equal(t.items[0].at, 1792212857000)
})

test('live turn: started, deltas, item completion, completion', () => {
  let t = emptyTranscript('codex', { cwd: 'C:\\p', sessionId: 'th' })
  t = { ...t, items: [{ kind: 'user', id: 'local:1', text: 'hi there', at: 1 }] }
  t = foldNotification(t, { method: 'turn/started', params: { threadId: 'th', turn: { id: 't1', status: 'inProgress', items: [] } } })
  assert.equal(t.status, 'running')
  t = foldNotification(t, { method: 'item/completed', params: { threadId: 'th', turnId: 't1', item: { type: 'userMessage', id: 'um1', clientId: null, content: [{ type: 'text', text: 'hi there\n', text_elements: [] }] }, completedAtMs: 2 } })
  assert.equal(t.items.length, 1, 'the echoed user message lands on the local row')
  assert.equal(t.items[0].id, 'um1')
  t = { ...t, items: [] }
  t = foldNotification(t, { method: 'item/started', params: { threadId: 'th', turnId: 't1', item: { type: 'agentMessage', id: 'm1', text: '' }, startedAtMs: 5 } })
  t = foldNotification(t, { method: 'item/agentMessage/delta', params: { threadId: 'th', turnId: 't1', itemId: 'm1', delta: 'Hel' } })
  t = foldNotification(t, { method: 'item/agentMessage/delta', params: { threadId: 'th', turnId: 't1', itemId: 'm1', delta: 'lo' } })
  assert.equal(t.items[0].text, 'Hello')
  assert.equal(t.items[0].streaming, true)
  t = foldNotification(t, { method: 'item/completed', params: { threadId: 'th', turnId: 't1', item: { type: 'agentMessage', id: 'm1', text: 'Hello!' }, completedAtMs: 9 } })
  assert.equal(t.items[0].text, 'Hello!')
  assert.equal(t.items[0].streaming, false)
  t = foldNotification(t, { method: 'item/started', params: { threadId: 'th', turnId: 't1', item: { ...CMD, status: 'inProgress', aggregatedOutput: null, exitCode: null } } })
  t = foldNotification(t, { method: 'item/commandExecution/outputDelta', params: { threadId: 'th', turnId: 't1', itemId: 'exec-1', delta: 'line 1\n' } })
  assert.equal(t.items[1].status, 'running')
  assert.equal(t.items[1].output, 'line 1\n')
  t = foldNotification(t, { method: 'thread/tokenUsage/updated', params: { threadId: 'th', turnId: 't1', tokenUsage: { last: { inputTokens: 10, outputTokens: 3 }, total: { totalTokens: 500 }, modelContextWindow: 200000 } } })
  assert.equal(t.usage.inputTokens, 10)
  assert.equal(t.usage.contextTokens, 500)
  t = foldNotification(t, { method: 'turn/completed', params: { threadId: 'th', turn: { id: 't1', status: 'completed', items: [], error: null } } })
  assert.equal(t.status, 'idle')
  assert.equal(foldNotification(t, { method: 'turn/started', params: { threadId: 'other', turn: {} } }), t, 'another thread’s traffic is ignored')
  assert.equal(foldNotification(t, { method: 'thread/realtime/sdp', params: { threadId: 'th' } }), t, 'unknown methods are no-ops')
})

test('a failed turn and an error notification surface in the banner', () => {
  let t = emptyTranscript('codex', { cwd: 'C:\\p', sessionId: 'th' })
  t = foldNotification(t, { method: 'error', params: { threadId: 'th', turnId: 't', error: { message: 'retrying' }, willRetry: true } })
  assert.equal(t.status, 'idle', 'a retrying error is not fatal')
  t = foldNotification(t, { method: 'turn/completed', params: { threadId: 'th', turn: { id: 't1', status: 'failed', error: { message: 'quota' } } } })
  assert.equal(t.status, 'error')
  assert.equal(t.error, 'quota')
  assert.equal(t.items.at(-1).level, 'error')
  const stopped = foldNotification(t, { method: 'turn/completed', params: { threadId: 'th', turn: { id: 't2', status: 'interrupted', error: null } } })
  assert.equal(stopped.status, 'idle')
  assert.equal(stopped.items.at(-1).text, 'Interrupted')
})

test('approval requests become waiting items answered in Codex vocabulary', () => {
  let t = emptyTranscript('codex', { cwd: 'C:\\p', sessionId: 'th' })
  const req = { kind: 'server-request', id: 'r1', method: 'item/commandExecution/requestApproval', params: { kind: 'command', threadId: 'th', turnId: 't', itemId: 'i', startedAtMs: 1, command: 'npm test', cwd: 'C:\\p', reason: 'needs network' } }
  const { transcript, approval } = foldServerRequest(t, req, 7)
  t = transcript
  assert.equal(t.status, 'waiting')
  assert.equal(approval.title, 'Run npm test')
  assert.match(approval.detail, /needs network/)
  assert.deepEqual(approvalResponse(req.method, 'allow'), { decision: 'accept' })
  assert.deepEqual(approvalResponse(req.method, 'allow-session'), { decision: 'acceptForSession' })
  assert.deepEqual(approvalResponse('execCommandApproval', 'deny'), { decision: 'denied' })
  assert.deepEqual(approvalResponse('applyPatchApproval', 'allow'), { decision: 'approved' })
  const patch = foldServerRequest(t, { id: 'r2', method: 'applyPatchApproval', params: { conversationId: 'th', callId: 'c', fileChanges: { 'C:\\p\\src\\App.tsx': {} }, reason: null, grantRoot: null } }, 8)
  assert.equal(patch.approval.title, 'Edit App.tsx')
  const other = foldServerRequest(t, { id: 'r3', method: 'item/tool/requestUserInput', params: {} })
  assert.equal(other.approval, null)
  assert.equal(other.transcript, t)
  // The server resolving it elsewhere (another client answered) closes the item.
  const resolved = foldNotification(t, { method: 'serverRequest/resolved', params: { requestId: 'r1' } })
  assert.equal(resolved.items.find((x) => x.id === 'r1').decided, 'cancel')
  assert.equal(resolved.status, 'running')
})

test('user-input requests become questions answered by id, and elicitations map through their schema', () => {
  let t = emptyTranscript('codex', { cwd: 'C:\\p', sessionId: 'th' })
  const req = { id: 'q1', method: 'item/tool/requestUserInput', params: { threadId: 'th', turnId: 't', itemId: 'i', isBlocking: true, autoResolutionMs: null, questions: [{ id: 'approach', header: 'Approach', question: 'Which approach?', isOther: true, isSecret: false, options: [{ label: 'Fast', description: 'quick' }, { label: 'Safe', description: '' }] }, { id: 'name', header: 'Name', question: 'Branch name?', isOther: false, isSecret: false, options: null }] } }
  const r = foldServerRequest(t, req, 5)
  assert.equal(r.approval, null)
  assert.equal(r.question.title, 'Codex needs input')
  assert.equal(r.question.questions[0].options.length, 2)
  assert.equal(r.question.questions[0].allowOther, true)
  assert.equal(r.question.questions[1].options, null)
  assert.equal(r.transcript.status, 'waiting')
  assert.deepEqual(questionResponse(req, { approach: ['Safe'], name: ['feat/x'] }), { answers: { approach: { answers: ['Safe'] }, name: { answers: ['feat/x'] } } })
  assert.deepEqual(questionResponse(req, null), { answers: { approach: { answers: [] }, name: { answers: [] } } })
  const url = { id: 'e1', method: 'mcpServer/elicitation/request', params: { threadId: 'th', turnId: null, serverName: 'linear', mode: 'url', message: 'Sign in', url: 'https://x/auth', elicitationId: 'el', _meta: null } }
  const u = foldServerRequest(t, url, 6).question
  assert.match(u.title, /linear/)
  assert.deepEqual(questionResponse(url, { url: ['Open in browser'] }), { action: 'accept', content: null, _meta: null })
  assert.deepEqual(questionResponse(url, { url: ['Decline'] }), { action: 'decline', content: null, _meta: null })
  const form = { id: 'e2', method: 'mcpServer/elicitation/request', params: { threadId: 'th', turnId: null, serverName: 'db', mode: 'form', message: 'Connect', _meta: null, requestedSchema: { type: 'object', required: ['host'], properties: { host: { type: 'string', title: 'Host' }, ssl: { type: 'boolean' }, region: { type: 'string', enum: ['us', 'eu'], enumNames: ['US', 'Europe'] }, tags: { type: 'array', items: { enum: ['a', 'b'] } }, port: { type: 'number' } } } } }
  const f = foldServerRequest(t, form, 7).question
  assert.deepEqual(f.questions.map((q) => [q.id, q.options ? q.options.length : null, q.multiSelect, q.header]), [['host', null, false, undefined], ['ssl', 2, false, 'optional'], ['region', 2, false, 'optional'], ['tags', 2, true, 'optional'], ['port', null, false, 'optional']])
  assert.equal(f.questions[2].options[1].description, 'Europe')
  assert.deepEqual(questionResponse(form, { host: ['db.local'], ssl: ['Yes'], region: ['eu'], tags: ['a', 'b'], port: ['5432'] }), { action: 'accept', content: { host: 'db.local', ssl: true, region: 'eu', tags: ['a', 'b'], port: 5432 }, _meta: null })
  assert.equal(foldServerRequest(t, { id: 'e3', method: 'mcpServer/elicitation/request', params: { mode: 'form', requestedSchema: {} } }).question, null, 'an empty schema is not a question')
  const resolved = foldNotification(r.transcript, { method: 'serverRequest/resolved', params: { requestId: 'q1' } })
  assert.equal(resolved.items.at(-1).cancelled, true)
  assert.equal(resolved.status, 'running')
})

test('a permissions request is an approval whose answer echoes the ask', () => {
  const req = { id: 'p1', method: 'item/permissions/requestApproval', params: { threadId: 'th', turnId: 't', itemId: 'i', environmentId: null, startedAtMs: 1, cwd: 'C:\\p', reason: 'needs the network', permissions: { network: { enabled: true }, fileSystem: null } } }
  const r = foldServerRequest(emptyTranscript('codex', { cwd: 'C:\\p', sessionId: 'th' }), req, 1)
  assert.equal(r.approval.title, 'Grant extra permissions')
  assert.match(r.approval.detail, /needs the network/)
  assert.deepEqual(approvalResponse(req.method, 'allow', req.params), { permissions: { network: { enabled: true } }, scope: 'turn' })
  assert.deepEqual(approvalResponse(req.method, 'allow-session', req.params), { permissions: { network: { enabled: true } }, scope: 'session' })
  assert.deepEqual(approvalResponse(req.method, 'deny', req.params), { permissions: {}, scope: 'turn' })
})

test('threadSummary feeds the picker from thread/list rows', () => {
  const s = threadSummary(THREAD)
  assert.equal(s.title, 'Find the parser')
  assert.equal(s.updatedAt, 1792213207000)
  assert.equal(s.branch, 'main')
  assert.equal(threadSummary({ ...THREAD, name: null }).title, 'find the parser')
})
