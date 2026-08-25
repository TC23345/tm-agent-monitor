import test from 'node:test'
import assert from 'node:assert/strict'
import { nextWaiting, paneForAgent, waitingAgents, waitingFirst } from './attention.mjs'

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
