import test from 'node:test'
import assert from 'node:assert/strict'
import { agentForTerminal, nextWaiting, paneForAgent, waitingAgents, waitingFirst } from './attention.mjs'

const agent = (id, extra = {}) => ({ id, provider: 'claude', project: id, state: 'running', since: 0, updatedAt: 0, ...extra })
const pane = (id, launch, cwd) => ({ id, kind: 'terminal', term: { launch, cwd } })

test('a session maps to the pane launched as its CLI in its folder, else a shell there', () => {
  const panes = [pane('sh', 'shell', 'C:\\Projects\\api\\'), pane('cl', 'claude', 'c:/projects/api'), pane('other', 'claude', 'C:\\Projects\\web')]
  const a = agent('a', { cwd: 'C:\\Projects\\api' })
  assert.equal(paneForAgent(panes, a).id, 'cl')
  assert.equal(paneForAgent(panes.filter((p) => p.id !== 'cl'), a).id, 'sh')
  assert.equal(paneForAgent(panes, agent('b', { cwd: 'C:\\Elsewhere' })), null)
  // Codex sessions match codex panes, not Claude ones; Cursor has no CLI pane.
  assert.equal(paneForAgent([pane('cx', 'codex', 'C:\\Projects\\api')], agent('c', { provider: 'codex', cwd: 'C:\\Projects\\api' })).id, 'cx')
  assert.equal(paneForAgent(panes, agent('c', { provider: 'codex', cwd: 'C:\\Projects\\api' })).id, 'sh')
  assert.equal(paneForAgent(panes, agent('d', { provider: 'cursor', cwd: 'C:\\Projects\\api' })), null)
  assert.equal(paneForAgent(panes, agent('e')), null)
  assert.equal(paneForAgent(undefined, a), null)
})

test('a session maps to its chat pane by the hooks’ pane id, else by provider and folder', () => {
  const chat = (id, provider, cwd, chatId) => ({ id, kind: 'chat', chat: { provider, cwd, chatId } })
  const panes = [pane('cl', 'claude', 'C:\\Projects\\api'), chat('ch', 'claude', 'C:\\Projects\\api', 'h1'), chat('cx', 'codex', 'C:\\Projects\\api', 'h2')]
  assert.equal(paneForAgent(panes, agent('a', { cwd: 'C:\\Projects\\api', terminalId: 'h1' })).id, 'ch', 'the exact handle wins over the terminal pane')
  assert.equal(paneForAgent(panes, agent('b', { cwd: 'C:\\Projects\\api', terminalId: 'h2' })).id, 'cx')
  assert.equal(paneForAgent(panes, agent('c', { cwd: 'C:\\Projects\\api' })).id, 'cl', 'without a handle the terminal pane listed first wins')
  assert.equal(paneForAgent([chat('only', 'codex', 'c:/projects/api')], agent('d', { provider: 'codex', cwd: 'C:\\Projects\\api' })).id, 'only')
  assert.equal(paneForAgent(panes, agent('e', { terminalId: 'nope' })), null, 'a stale handle and no folder matches nothing')
})

test('a Codex chat, which carries no pane id, maps by the session it holds', () => {
  const chat = (id, cwd, resumeId) => ({ id, kind: 'chat', chat: { provider: 'codex', cwd, resumeId } })
  const panes = [chat('one', 'C:\\Projects\\api', 't-1'), chat('two', 'C:\\Projects\\api', 't-2'), chat('new', 'c:/projects/api')]
  const codex = (rawSessionId) => agent(`codex:${rawSessionId}`, { provider: 'codex', rawSessionId, cwd: 'C:\\Projects\\api' })
  assert.equal(paneForAgent(panes, codex('t-2')).id, 'two', 'the second chat in a folder, not the first')
  assert.equal(paneForAgent(panes, codex('t-3')).id, 'new', 'a chat holding another session is skipped')
  assert.equal(paneForAgent(panes.slice(0, 2), codex('t-3')), null)
  assert.equal(paneForAgent([chat('far', 'C:\\Elsewhere', 't-1')], codex('t-1')).id, 'far', 'the session id wins over the folder')
  assert.equal(paneForAgent([{ id: 'cl', kind: 'chat', chat: { provider: 'claude', cwd: 'C:\\Projects\\api', resumeId: 't-1' } }], codex('t-1')), null, 'never across providers')
})

test('waiting sessions are served oldest first and children are ignored', () => {
  const agents = [
    agent('late', { state: 'waiting', since: 300 }),
    agent('run'),
    agent('early', { state: 'waiting', since: 100 }),
    agent('child', { state: 'waiting', since: 50, parentId: 'run' })
  ]
  assert.deepEqual(waitingAgents(agents).map((a) => a.id), ['early', 'late'])
  assert.equal(nextWaiting(agents, null).id, 'early')
  assert.equal(nextWaiting(agents, 'early').id, 'late')
  assert.equal(nextWaiting(agents, 'late').id, 'early')
  assert.equal(nextWaiting(agents, 'run').id, 'early')
  assert.equal(nextWaiting([agent('x')], null), null)
  assert.equal(nextWaiting(undefined, null), null)
})

test('waitingFirst promotes waiting sessions and keeps the rest in order', () => {
  const agents = [agent('a'), agent('b', { state: 'waiting', since: 2 }), agent('c'), agent('d', { state: 'waiting', since: 1 })]
  assert.deepEqual(waitingFirst(agents).map((a) => a.id), ['d', 'b', 'a', 'c'])
  assert.deepEqual(waitingFirst(undefined), [])
})

test('agentForTerminal prefers the session whose hooks named this pane, else the first in the folder', () => {
  const a = agent('a', { cwd: 'C:/proj', terminalId: 'pty-1' })
  const b = agent('b', { cwd: 'C:/proj', terminalId: 'pty-2' })
  const c = agent('c', { cwd: 'C:/other' })
  assert.equal(agentForTerminal([a, b, c], { launch: 'claude', cwd: 'C:/proj', sessionId: 'pty-2' }), b)
  assert.equal(agentForTerminal([a, b, c], { launch: 'claude', cwd: 'C:/proj', sessionId: 'pty-9' }), a)
  assert.equal(agentForTerminal([a, b, c], { launch: 'claude', cwd: 'C:/proj' }), a)
  // A CLI typed into a plain shell pane is still that pane's session.
  assert.equal(agentForTerminal([a, b, c], { launch: 'shell', cwd: 'C:/proj', sessionId: 'pty-1' }), a)
  assert.equal(agentForTerminal([a, b, c], { launch: 'shell', cwd: 'C:/proj', sessionId: 'pty-9' }), null)
  assert.equal(agentForTerminal([a, b, c], { launch: 'codex', cwd: 'C:/proj', sessionId: 'pty-1' }), a)
  assert.equal(agentForTerminal([a, b, c], { launch: 'codex', cwd: 'C:/proj', sessionId: 'pty-9' }), null)
  assert.equal(agentForTerminal([a], { launch: 'claude', sessionId: 'pty-1' }), a)
})

test('a session in a folder pane’s own chat or terminal maps to that folder pane (0.4.78)', () => {
  const path = 'C:\\Projects\\api'
  const folderChat = { id: 'fc', kind: 'folder', folder: { path }, chat: { provider: 'claude', cwd: path, chatId: 'h1' } }
  const folderTerm = { id: 'ft', kind: 'folder', folder: { path }, term: { launch: 'shell', cwd: path, sessionId: 'pty-1' } }
  const bare = { id: 'fb', kind: 'folder', folder: { path } }
  assert.equal(paneForAgent([bare, folderChat], agent('a', { cwd: path, terminalId: 'h1' })).id, 'fc')
  assert.equal(paneForAgent([bare, folderTerm], agent('b', { cwd: path, terminalId: 'pty-1' })).id, 'ft')
  assert.equal(paneForAgent([bare, folderTerm], agent('c', { cwd: path })).id, 'ft', 'a shell in the folder, by folder')
  assert.equal(paneForAgent([bare], agent('d', { cwd: path })), null, 'a folder pane with nothing running is no session’s')
})
