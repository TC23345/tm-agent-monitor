import test from 'node:test'
import assert from 'node:assert/strict'
import { emptyTranscript } from '../shared/chatModel.mjs'
import { approvalResponse, codexModeId, commandOptions, foldNotification, foldServerRequest, innerCommand, itemToChat, mergeLimits, questionResponse, threadSummary, threadToTranscript } from './fold.mjs'

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
  assert.deepEqual(t.items.map((x) => x.kind), ['user', 'assistant', 'tool', 'tool', 'thinking', 'turn'])
  assert.equal(t.items[0].at, 1792212857000)
  assert.ok(t.items[0].turnId, 'a stored prompt keeps the turn a fork goes through')
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
  assert.equal(t.usage.contextTokens, 13, 'the window holds the last call, not the thread total')
  t = foldNotification(t, { method: 'thread/tokenUsage/updated', params: { threadId: 'th', turnId: 't1', tokenUsage: { last: { totalTokens: 64_000, inputTokens: 63_000, outputTokens: 1000 }, total: { totalTokens: 900_000 }, modelContextWindow: 272_000 } } })
  assert.deepEqual([t.usage.contextTokens, t.usage.contextWindow], [64_000, 272_000])
  t = foldNotification(t, { method: 'turn/completed', params: { threadId: 'th', turn: { id: 't1', status: 'completed', items: [], error: null } } })
  assert.equal(t.status, 'idle')
  assert.equal(foldNotification(t, { method: 'turn/started', params: { threadId: 'other', turn: {} } }), t, 'another thread’s traffic is ignored')
  assert.equal(foldNotification(t, { method: 'thread/realtime/sdp', params: { threadId: 'th' } }), t, 'unknown methods are no-ops')
})

test('rows read like the extension: a shell row, a diff, an MCP call, timed reasoning', () => {
  const cmd = itemToChat(CMD, 1)
  assert.deepEqual([cmd.label, cmd.detail, cmd.view, cmd.input, cmd.elapsedMs], ['Searched for', 'parser', 'search', 'rg -n parser', 12])
  const ran = itemToChat({ ...CMD, commandActions: [{ type: 'unknown', command: 'npm test' }] }, 1)
  assert.deepEqual([ran.label, ran.detail, ran.input], ['Ran', 'npm test', 'npm test'], 'the IN row drops the shell wrapper')
  assert.equal(itemToChat({ ...CMD, status: 'inProgress', commandActions: [{ type: 'unknown', command: 'npm test' }] }, 1).label, 'Running')
  const read = itemToChat({ ...CMD, commandActions: [{ type: 'read', command: 'cat a.ts', name: 'a.ts', path: 'C:\\p\\a.ts' }] }, 1)
  assert.deepEqual([read.label, read.detail, read.view, read.path], ['Read', 'a.ts', 'read', 'C:\\p\\a.ts'])
  assert.equal(itemToChat({ ...CMD, source: 'userShell', commandActions: [{ type: 'unknown', command: 'git status' }] }, 1).label, 'You ran')
  const mcp = itemToChat(MCP, 1)
  assert.deepEqual([mcp.label, mcp.view], ['list_threads (Codex App)', 'other'])
  const change = itemToChat({ type: 'fileChange', id: 'fc1', status: 'completed', changes: [{ path: 'C:\\p\\a.ts', kind: { type: 'update', move_path: null }, diff: '@@ -1 +1 @@\n-a\n+b\n' }] }, 1)
  assert.deepEqual([change.label, change.detail, change.view, change.edits], ['Edited', 'a.ts', 'edit', [{ path: 'C:\\p\\a.ts', kind: 'update', diff: '@@ -1 +1 @@\n-a\n+b\n' }]])
  assert.equal(itemToChat({ type: 'fileChange', id: 'fc2', status: 'inProgress', changes: [{ path: 'n.md', kind: { type: 'add' }, diff: 'new' }] }, 1).label, 'Editing')

  let t = emptyTranscript('codex', { cwd: 'C:\\p', sessionId: 'th' })
  t = foldNotification(t, { method: 'item/started', params: { threadId: 'th', item: { type: 'reasoning', id: 'rs_9', summary: [], content: [] }, startedAtMs: 1000 } })
  assert.deepEqual(t.items.map((x) => [x.kind, x.text, x.streaming]), [['thinking', '', true]], 'reasoning has a row from its start')
  t = foldNotification(t, { method: 'item/completed', params: { threadId: 'th', item: { type: 'reasoning', id: 'rs_9', summary: ['Checked the tests'], content: [] }, completedAtMs: 3400 } })
  assert.deepEqual([t.items[0].text, t.items[0].streaming, t.items[0].durationMs, t.items[0].at], ['Checked the tests', false, 2400, 1000])
})

test('turn/started stamps the clock unless the pane already did', () => {
  let t = emptyTranscript('codex', { cwd: 'C:\\p', sessionId: 'th' })
  t = foldNotification(t, { method: 'turn/started', params: { threadId: 'th', turn: { id: 't1' } }, emittedAtMs: 500 })
  assert.deepEqual([t.status, t.turnStartedAt], ['running', 500])
  assert.equal(foldNotification(t, { method: 'turn/started', params: { threadId: 'th', turn: { id: 't1' } }, emittedAtMs: 900 }), t)
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
  assert.equal(stopped.items.find((x) => x.id === 't2:interrupted').text, 'You stopped', 'the extension’s words; the time is added when the turn reports it')
  const timed = foldNotification(t, { method: 'turn/completed', params: { threadId: 'th', turn: { id: 't3', status: 'interrupted', error: null, durationMs: 12_000 } } })
  assert.equal(timed.items.find((x) => x.id === 't3:interrupted').text, 'You stopped after 12s')
})

test('approval requests become waiting items answered in Codex vocabulary', () => {
  let t = emptyTranscript('codex', { cwd: 'C:\\p', sessionId: 'th' })
  const req = { kind: 'server-request', id: 'r1', method: 'item/commandExecution/requestApproval', params: { kind: 'command', threadId: 'th', turnId: 't', itemId: 'i', startedAtMs: 1, command: 'npm test', cwd: 'C:\\p', reason: 'needs network' } }
  const { transcript, approval } = foldServerRequest(t, req, 7)
  t = transcript
  assert.equal(t.status, 'waiting')
  assert.equal(approval.title, 'Run npm test')
  assert.equal(approval.question, 'Do you want Codex to run this command?')
  assert.equal(approval.reason, 'needs network')
  assert.deepEqual(approval.options.map((o) => o.label), ['Allow once', 'Allow this conversation', 'Deny'], 'the classic three without availableDecisions')
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
  assert.equal(r.question.title, 'Codex has 2 questions')
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
  assert.equal(r.approval.reason, 'needs the network')
  assert.match(r.approval.detail, /Network/)
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

test('the command prompt lists the decisions Codex offers, in its order and words', () => {
  // As the live server sent them on 2026-10-18 (scripts/probe-codex-features.mjs --approval).
  const params = {
    kind: 'command', threadId: 'th', turnId: 't', itemId: 'exec-1', startedAtMs: 1, environmentId: 'local',
    command: '"C:\\\\Program Files\\\\PowerShell\\\\7\\\\pwsh.exe" -Command \'node -e "console.log(6*7)"\'', commandActions: [{ type: 'unknown', command: 'node -e "console.log(6*7)"' }],
    proposedExecpolicyAmendment: ['node', '-e', 'console.log(6*7)'],
    availableDecisions: ['accept', { acceptWithExecpolicyAmendment: { execpolicy_amendment: ['node', '-e', 'console.log(6*7)'] } }, 'decline', 'cancel']
  }
  const opts = commandOptions(params)
  assert.deepEqual(opts.map((o) => [o.choice, o.label]), [['allow', 'Allow once'], ['allow-rule', 'Allow similar commands'], ['deny', 'Deny']])
  assert.equal(opts[1].rule, 'node -e console.log(6*7)')
  const r = foldServerRequest(emptyTranscript('codex', { cwd: 'C:\\p', sessionId: 'th' }), { id: 0, method: 'item/commandExecution/requestApproval', params }, 1)
  assert.equal(r.approval.command, 'node -e "console.log(6*7)"')
  assert.deepEqual(r.approval.choices, ['allow', 'allow-rule', 'deny', 'cancel'])
  assert.deepEqual(approvalResponse('item/commandExecution/requestApproval', 'allow-rule', params), { decision: { acceptWithExecpolicyAmendment: { execpolicy_amendment: ['node', '-e', 'console.log(6*7)'] } } })
  const net = { ...params, networkApprovalContext: { host: 'registry.npmjs.org', protocol: 'https' }, availableDecisions: ['accept', { applyNetworkPolicyAmendment: { network_policy_amendment: { host: 'registry.npmjs.org', action: 'allow' } } }, 'decline'] }
  const n = foldServerRequest(emptyTranscript('codex', { cwd: 'C:\\p', sessionId: 'th' }), { id: 1, method: 'item/commandExecution/requestApproval', params: net }, 1).approval
  assert.equal(n.question, 'Allow Codex to connect to registry.npmjs.org?')
  assert.match(n.detail, /isn't on the current network allowlist/)
  assert.deepEqual(approvalResponse('item/commandExecution/requestApproval', 'allow-host', net), { decision: { applyNetworkPolicyAmendment: { network_policy_amendment: { host: 'registry.npmjs.org', action: 'allow' } } } })
})

test('a file-edit prompt shows the diff of the item it points at', () => {
  let t = emptyTranscript('codex', { cwd: 'C:\\p', sessionId: 'th' })
  t = foldNotification(t, { method: 'item/started', params: { threadId: 'th', item: { type: 'fileChange', id: 'fc1', status: 'inProgress', changes: [{ path: 'C:\\p\\a.ts', kind: { type: 'update' }, diff: '@@ -1 +1 @@\n-a\n+b\n' }] } } })
  const r = foldServerRequest(t, { id: 2, method: 'item/fileChange/requestApproval', params: { threadId: 'th', turnId: 't', itemId: 'fc1', startedAtMs: 1 } }, 2).approval
  assert.equal(r.question, 'Allow Codex to edit the following file?')
  assert.equal(r.edits.length, 1)
  assert.deepEqual(r.options.map((o) => o.label), ['Allow once', 'Allow all edits', 'Deny'])
})

test('a steered message joins the running turn, and the turn footer still counts its files', () => {
  let t = emptyTranscript('codex', { cwd: 'C:\\p', sessionId: 'th' })
  t = foldNotification(t, { method: 'turn/started', params: { threadId: 'th', turn: { id: 't1' } } })
  t = foldNotification(t, { method: 'item/completed', params: { threadId: 'th', turnId: 't1', item: USER } })
  t = foldNotification(t, { method: 'item/completed', params: { threadId: 'th', turnId: 't1', item: { type: 'fileChange', id: 'fc1', status: 'completed', changes: [{ path: 'a.ts', kind: { type: 'update' }, diff: '@@ -1 +1 @@\n-a\n+b\n' }] } } })
  t = foldNotification(t, { method: 'item/completed', params: { threadId: 'th', turnId: 't1', item: { ...USER, id: 'u2', content: [{ type: 'text', text: 'also this', text_elements: [] }] } } })
  assert.equal(t.items.at(-1).steered, true)
  t = foldNotification(t, { method: 'turn/completed', params: { threadId: 'th', turn: { id: 't1', status: 'completed', durationMs: 4000 } } })
  const turn = t.items.at(-1)
  assert.deepEqual([turn.kind, turn.turnId, turn.files.map((f) => f.path)], ['turn', 't1', ['a.ts']])
  const stored = threadToTranscript({ ...THREAD, turns: [{ ...THREAD.turns[0], items: [USER, AGENT, { ...USER, id: 'u2' }] }] })
  assert.equal(stored.items.filter((x) => x.kind === 'user' && x.steered).length, 1)
})

test('settings, plan, limits, reroutes, warnings and retries fold into the pane state', () => {
  let t = emptyTranscript('codex', { cwd: 'C:\\p', sessionId: 'th' })
  t = foldNotification(t, { method: 'thread/settings/updated', params: { threadId: 'th', threadSettings: { model: 'gpt-6.1-sol', effort: 'low', approvalPolicy: 'never', approvalsReviewer: 'user', sandboxPolicy: { type: 'dangerFullAccess' }, serviceTier: 'priority', collaborationMode: { mode: 'plan', settings: {} } } } })
  assert.deepEqual([t.model, t.effort, t.permissionMode, t.fastMode, t.planMode], ['gpt-6.1-sol', 'low', 'full-access', 'on', true])
  assert.equal(codexModeId({ approvalPolicy: 'on-request', sandboxPolicy: { type: 'workspaceWrite' }, approvalsReviewer: 'auto_review' }), 'auto-review')
  assert.equal(codexModeId({ approvalPolicy: 'untrusted', sandboxPolicy: { type: 'readOnly' } }), 'custom')
  t = foldNotification(t, { method: 'turn/plan/updated', params: { threadId: 'th', turnId: 't1', explanation: null, plan: [{ step: 'Read README', status: 'completed' }, { step: 'Count files', status: 'inProgress' }] } })
  t = foldNotification(t, { method: 'turn/plan/updated', params: { threadId: 'th', turnId: 't1', explanation: null, plan: [{ step: 'Read README', status: 'completed' }, { step: 'Count files', status: 'completed' }] } })
  const plan = t.items.filter((x) => x.name === 'update_plan')
  assert.equal(plan.length, 1, 'one plan row per turn, updated in place')
  assert.deepEqual([plan[0].detail, plan[0].status, plan[0].todos[1].status], ['2 of 2 done', 'done', 'completed'])
  t = foldNotification(t, { method: 'account/rateLimits/updated', params: { rateLimits: { primary: { usedPercent: 12, windowDurationMins: 10080, resetsAt: 1792894691 }, secondary: null } } })
  t = foldNotification(t, { method: 'account/rateLimits/updated', params: { rateLimits: { primary: null, secondary: null } } })
  assert.deepEqual(t.limits.primary, { usedPercent: 12, windowMins: 10080, resetsAt: 1792894691 }, 'a sparse update keeps the known window')
  assert.equal(mergeLimits(null, null), null)
  t = foldNotification(t, { method: 'model/rerouted', params: { threadId: 'th', turnId: 't1', fromModel: 'a', toModel: 'gpt-6-luna', reason: 'cyber' } })
  assert.equal(t.items.at(-1).text, 'Your request was routed to gpt-6-luna.')
  t = foldNotification(t, { method: 'warning', params: { threadId: 'th', message: 'Heads up' } })
  t = foldNotification(t, { method: 'warning', params: { threadId: 'th', message: 'Heads up' } })
  assert.equal(t.items.filter((x) => x.text === 'Heads up').length, 1, 'a warning shows once')
  t = foldNotification(t, { method: 'error', params: { threadId: 'th', turnId: 't1', error: { message: 'stream disconnected' }, willRetry: true } })
  t = foldNotification(t, { method: 'error', params: { threadId: 'th', turnId: 't1', error: { message: 'stream disconnected' }, willRetry: true } })
  assert.deepEqual(t.retry, { attempt: 2, max: 0 })
  t = foldNotification(t, { method: 'item/started', params: { threadId: 'th', item: { type: 'agentMessage', id: 'm9', text: '', phase: 'final_answer' } } })
  assert.equal(t.retry, null, 'output clears the retry count')
  assert.equal(t.items.at(-1).phase, 'final')
})

test('a planning turn ends on *Implement this plan?*, and new item kinds have rows', () => {
  let t = { ...emptyTranscript('codex', { cwd: 'C:\\p', sessionId: 'th' }), planMode: true }
  t = foldNotification(t, { method: 'turn/started', params: { threadId: 'th', turn: { id: 't1' } } })
  t = foldNotification(t, { method: 'item/completed', params: { threadId: 'th', turnId: 't1', item: USER } })
  t = foldNotification(t, { method: 'item/plan/delta', params: { threadId: 'th', turnId: 't1', itemId: 'p1', delta: '1. Do it' } })
  assert.equal(t.items.at(-1).plan, true)
  t = foldNotification(t, { method: 'item/completed', params: { threadId: 'th', turnId: 't1', item: { type: 'plan', id: 'p1', text: '1. Do it\n2. Test it' } } })
  t = foldNotification(t, { method: 'turn/completed', params: { threadId: 'th', turn: { id: 't1', status: 'completed' } } })
  assert.equal(t.pendingPlan, 'p1')
  const search = itemToChat({ type: 'webSearch', id: 'w', query: 'codex docs', action: { type: 'search', query: 'codex docs' }, results: null }, 1)
  assert.deepEqual([search.label, search.detail], ['Searched the web', 'codex docs'])
  assert.equal(itemToChat({ type: 'webSearch', id: 'w2', query: '', action: { type: 'openPage', url: 'https://openai.com/x' } }, 1, true).label, 'Opening')
  assert.deepEqual([itemToChat({ type: 'imageView', id: 'iv', path: 'C:\\p\\a.png' }, 1).label, itemToChat({ type: 'imageView', id: 'iv', path: 'C:\\p\\a.png' }, 1).path], ['Viewed image', 'C:\\p\\a.png'])
  const spawn = itemToChat({ type: 'collabAgentToolCall', id: 'c1', tool: 'spawnAgent', status: 'completed', senderThreadId: 'th', receiverThreadIds: ['a1'], prompt: 'Explore the repo', model: 'gpt-6-luna', reasoningEffort: null, agentsStates: { a1: { status: 'running', message: null } } }, 1)
  assert.deepEqual([spawn.label, spawn.view, spawn.prompt, spawn.output], ['Created agent', 'agent', 'Explore the repo', 'a1: running'])
  assert.equal(itemToChat({ type: 'subAgentActivity', id: 's1', kind: 'completed', agentThreadId: 'a1', agentPath: 'root/explorer', model: null, reasoningEffort: null }, 1).text, 'explorer finished')
  assert.equal(itemToChat({ type: 'exitedReviewMode', id: 'r', review: 'No issues found.' }, 1).text, 'No issues found.')
  assert.equal(itemToChat({ type: 'contextCompaction', id: 'cc' }, 1, true).text, 'Compacting context')
})

test('innerCommand strips the shell a command was launched through', () => {
  assert.equal(innerCommand('"C:\\\\Program Files\\\\PowerShell\\\\7\\\\pwsh.exe" -Command \'Get-Content -LiteralPath README.md\'', []), 'Get-Content -LiteralPath README.md')
  assert.equal(innerCommand("bash -lc 'ls -la'", null), 'ls -la')
  assert.equal(innerCommand("pwsh -Command 'echo ''hi'''", []), "echo 'hi'")
  assert.equal(innerCommand('npm test', []), 'npm test')
  assert.equal(innerCommand('x', [{ type: 'read', command: 'cat a', name: 'a', path: 'a' }]), 'cat a')
})

test('a fork starts with *Continued from chat*', () => {
  const t = threadToTranscript({ ...THREAD, forkedFromId: 'src' })
  assert.equal(t.items[0].text, 'Continued from chat')
})

test('another thread starting on the shared server never takes over the pane', () => {
  const t = emptyTranscript('codex', { cwd: 'C:\p', sessionId: 'mine' })
  assert.equal(foldNotification(t, { method: 'thread/started', params: { thread: { id: 'side-fork', model: 'x', cwd: 'C:\q' } } }), t)
  assert.equal(foldNotification({ ...t, sessionId: null }, { method: 'thread/started', params: { thread: { id: 'other' } } }).sessionId, null, 'an unknown thread is not adopted')
  assert.equal(foldNotification(t, { method: 'thread/started', params: { thread: { id: 'mine', model: 'gpt-6-luna' } } }).model, 'gpt-6-luna')
})
