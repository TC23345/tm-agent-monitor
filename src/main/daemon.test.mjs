import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'

const fixtureRoot = mkdtempSync(join(tmpdir(), 'agent-monitor-daemon-test-'))
mkdirSync(join(fixtureRoot, 'main'), { recursive: true })
mkdirSync(join(fixtureRoot, 'shared'), { recursive: true })
writeFileSync(join(fixtureRoot, 'package.json'), '{"type":"module"}')
for (const [source, target] of [
  ['src/main/daemon.ts', join(fixtureRoot, 'main', 'daemon.js')],
  ['src/main/store.ts', join(fixtureRoot, 'main', 'store.js')],
  ['src/shared/types.ts', join(fixtureRoot, 'shared', 'types.js')]
]) {
  const output = ts.transpileModule(readFileSync(source, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }
  }).outputText
  writeFileSync(target, output)
}
copyFileSync('src/main/daemonCore.mjs', join(fixtureRoot, 'main', 'daemonCore.mjs'))
for (const name of ['pricing', 'workspaceCommand', 'attention', 'terminalText']) {
  copyFileSync(`src/shared/${name}.mjs`, join(fixtureRoot, 'shared', `${name}.mjs`))
}

const { Daemon } = await import(pathToFileURL(join(fixtureRoot, 'main', 'daemon.js')).href)
const daemon = new Daemon(0, { token: 'test-token', maxBodyBytes: 10_000 })
let base
before(async () => {
  assert.equal(await daemon.start(), true)
  base = `http://127.0.0.1:${daemon.getPort()}`
})
after(() => {
  daemon.stop()
  rmSync(fixtureRoot, { recursive: true, force: true })
})

const auth = { authorization: 'Bearer test-token' }

test('diagnostics require the exact bearer and routes do not prefix-match', async () => {
  assert.equal((await fetch(`${base}/health`)).status, 401)
  assert.equal((await fetch(`${base}/health`, { headers: { authorization: 'Bearer wrong' } })).status, 401)
  assert.equal((await fetch(`${base}/health`, { headers: auth })).status, 200)
  assert.equal((await fetch(`${base}/healthcheck`, { headers: auth })).status, 404)
  assert.equal((await fetch(`${base}/health?probe=1`, { headers: auth })).status, 404)
  const wrongMethod = await fetch(`${base}/status`, { method: 'POST', headers: auth })
  assert.equal(wrongMethod.status, 405)
  assert.equal(wrongMethod.headers.get('allow'), 'GET')
})

test('ingestion requires JSON and rejects malformed or invalid schema', async () => {
  assert.equal((await fetch(`${base}/report`, { method: 'POST', headers: auth, body: '{}' })).status, 415)
  assert.equal((await fetch(`${base}/report`, {
    method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: '{'
  })).status, 400)
  assert.equal((await fetch(`${base}/v1/events`, {
    method: 'POST', headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify({ schemaVersion: 2 })
  })).status, 400)
})

test('authenticated v1 event is accepted and appears in authenticated status', async () => {
  const event = {
    schemaVersion: 1,
    provider: 'codex',
    eventId: 'event-1',
    sessionId: 'session-1',
    actor: { kind: 'root' },
    kind: 'session_started',
    timestamp: Date.now()
  }
  const response = await fetch(`${base}/v1/events`, {
    method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify(event)
  })
  assert.equal(response.status, 202)
  assert.deepEqual(await response.json(), { ok: true, accepted: true })
  const status = await (await fetch(`${base}/status`, { headers: auth })).json()
  assert.equal(status.agents[0].id, 'codex:session-1')
})

test('future timestamps, oversized strings and request bodies are rejected', async () => {
  const baseEvent = {
    schemaVersion: 1, provider: 'claude', eventId: 'event-2', sessionId: 'session-2',
    actor: { kind: 'root' }, kind: 'turn_completed'
  }
  const post = (body) => fetch(`${base}/v1/events`, {
    method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify(body)
  })
  assert.equal((await post({ ...baseEvent, timestamp: Date.now() + 301_000 })).status, 400)
  assert.equal((await post({ ...baseEvent, timestamp: Date.now(), activity: 'x'.repeat(4_097) })).status, 400)
  assert.equal((await fetch(`${base}/report`, {
    method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify({ padding: 'x'.repeat(20_000) })
  })).status, 413)
})

// ---- terminal and wait routes: what an agent drives the workspace with ----

const { lastLines } = await import(pathToFileURL(join(fixtureRoot, 'shared', 'terminalText.mjs')).href)

/** A TerminalApi stand-in: records input, serves canned output. */
function fakeTerminals() {
  const sessions = new Map()
  return {
    sessions,
    create: ({ launch, cwd, command }) => {
      if (cwd === 'C:\\missing') return { error: 'cwd is not an existing directory' }
      const id = randomUUID()
      sessions.set(id, { id, launch, cwd: cwd ?? 'C:\\home', createdAt: 1, attached: false, input: [], output: 'PS C:\\home> \x1b[32mready\x1b[0m\r\n', command })
      return { id, cwd: cwd ?? 'C:\\home' }
    },
    input: (id, data) => {
      const s = sessions.get(id)
      if (!s) return 'missing'
      if (s.exitCode !== undefined) return 'exited'
      s.input.push(data)
      return 'ok'
    },
    read: (id, lines) => {
      const s = sessions.get(id)
      return s ? { lines: lastLines(s.output, lines), exitCode: s.exitCode } : null
    },
    list: () => [...sessions.values()].map(({ input: _i, output: _o, command: _c, ...t }) => t)
  }
}

const terminals = fakeTerminals()
const agentDaemon = new Daemon(0, { token: 'agent-token', terminals })
let agentBase
before(async () => {
  assert.equal(await agentDaemon.start(), true)
  agentBase = `http://127.0.0.1:${agentDaemon.getPort()}`
})
after(() => agentDaemon.stop())
const agentAuth = { authorization: 'Bearer agent-token' }
const post = (path, body) => fetch(`${agentBase}${path}`, { method: 'POST', headers: { ...agentAuth, 'content-type': 'application/json' }, body: JSON.stringify(body) })
const get = (path) => fetch(`${agentBase}${path}`, { headers: agentAuth })
const MISSING = '0f3b1c2d-1111-4222-8333-444455556666'

test('terminal routes are absent without a terminal adapter', async () => {
  assert.equal((await fetch(`${base}/v1/terminals`, { headers: auth })).status, 404)
  assert.equal((await fetch(`${base}/v1/terminals/${MISSING}/output`, { headers: auth })).status, 404)
  assert.equal((await fetch(`${base}/v1/terminals`, { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: '{}' })).status, 404)
})

test('an agent can spawn a terminal, type into it, and read it back as plain text', async () => {
  assert.deepEqual(await (await get('/v1/terminals')).json(), { terminals: [], schemaVersion: 1 })
  assert.equal((await post('/v1/terminals', { launch: 'bash' })).status, 400)
  assert.equal((await post('/v1/terminals', { launch: 'shell', cwd: 'C:\\missing' })).status, 400)
  assert.equal((await post('/v1/terminals', { launch: 'shell', extra: 1 })).status, 400)
  assert.equal((await post('/v1/terminals', { cwd: 'a\nb' })).status, 400)
  assert.equal((await post('/v1/terminals', [])).status, 400)
  const created = await post('/v1/terminals', { launch: 'claude', cwd: 'C:\\proj', command: 'npm test' })
  assert.equal(created.status, 201)
  const { id, launch, cwd } = await created.json()
  assert.match(id, /^[0-9a-f-]{36}$/)
  assert.equal(launch, 'claude')
  assert.equal(cwd, 'C:\\proj')
  assert.equal(terminals.sessions.get(id).command, 'npm test')

  assert.equal((await post(`/v1/terminals/${id}/input`, { text: '' })).status, 400)
  assert.equal((await post(`/v1/terminals/${id}/input`, { text: 'a\0b' })).status, 400)
  assert.equal((await post(`/v1/terminals/${id}/input`, { text: 'x', enter: 'yes' })).status, 400)
  assert.equal((await post(`/v1/terminals/${id}/input`, { text: 'x', paste: true })).status, 400)
  assert.equal((await post(`/v1/terminals/${id}/input`, { text: 'git status', enter: true })).status, 202)
  assert.equal((await post(`/v1/terminals/${id}/input`, { text: 'q' })).status, 202)
  assert.deepEqual(terminals.sessions.get(id).input, ['git status\r', 'q'])
  assert.equal((await post(`/v1/terminals/${MISSING}/input`, { text: 'x' })).status, 404)

  const out = await get(`/v1/terminals/${id}/output?lines=1`)
  assert.equal(out.status, 200)
  assert.deepEqual(await out.json(), { id, lines: ['PS C:\\home> ready'] })
  assert.equal((await get(`/v1/terminals/${id}/output`)).status, 200)
  assert.equal((await get(`/v1/terminals/${id}/output?lines=0`)).status, 400)
  assert.equal((await get(`/v1/terminals/${id}/output?lines=abc`)).status, 400)
  assert.equal((await get(`/v1/terminals/${id}/output?tail=1`)).status, 400)
  assert.equal((await get(`/v1/terminals/${MISSING}/output`)).status, 404)
  assert.equal((await get('/v1/terminals/not-a-uuid/output')).status, 404)
  assert.equal((await get(`/v1/terminals/${id}/input`)).status, 405)

  terminals.sessions.get(id).exitCode = 0
  assert.equal((await post(`/v1/terminals/${id}/input`, { text: 'x' })).status, 409)
  const exited = await (await get(`/v1/terminals/${id}/output?lines=1`)).json()
  assert.equal(exited.exitCode, 0)
})

test('the terminal list names the session running in each terminal', async () => {
  const started = await post('/v1/events', {
    schemaVersion: 1, provider: 'claude', eventId: 'ta-1', sessionId: 'in-proj', actor: { kind: 'root' },
    kind: 'session_started', timestamp: Date.now(), cwd: 'c:/PROJ'
  })
  assert.equal(started.status, 202)
  const claude = await (await post('/v1/terminals', { launch: 'claude', cwd: 'C:\\proj\\' })).json()
  const shell = await (await post('/v1/terminals', { launch: 'shell', cwd: 'C:\\proj' })).json()
  const elsewhere = await (await post('/v1/terminals', { launch: 'claude', cwd: 'C:\\other' })).json()
  const { terminals: list } = await (await get('/v1/terminals')).json()
  assert.equal(list.find((t) => t.id === claude.id).agentId, 'claude:in-proj')
  assert.equal(list.find((t) => t.id === shell.id).agentId, undefined)
  assert.equal(list.find((t) => t.id === elsewhere.id).agentId, undefined)
})

test('wait long-polls until a session reaches the state, and times out honestly', async () => {
  assert.equal((await get('/v1/agents/claude:x/wait?until=dancing')).status, 400)
  assert.equal((await get('/v1/agents/claude:x/wait?until=waiting&timeout=999999')).status, 400)
  assert.equal((await get('/v1/agents/claude:x/wait?until=waiting&foo=1')).status, 400)
  assert.equal((await get('/v1/agents/bad%2Fid/wait')).status, 404)
  // Unknown session and until=ended: already true.
  assert.deepEqual(await (await get('/v1/agents/claude:never/wait?until=ended')).json(), { id: 'claude:never', until: 'ended', state: null, satisfied: true })
  // timeout=0 answers at once with the current truth.
  const now = await (await get('/v1/agents/claude:in-proj/wait?until=waiting&timeout=0')).json()
  assert.equal(now.satisfied, false)
  assert.notEqual(now.state, 'waiting')

  const pending = get('/v1/agents/claude:in-proj/wait?until=waiting&timeout=5000')
  await new Promise((resolve) => setTimeout(resolve, 100))
  const asked = await post('/v1/events', {
    schemaVersion: 1, provider: 'claude', eventId: 'ta-2', sessionId: 'in-proj', actor: { kind: 'root' },
    kind: 'attention_required', timestamp: Date.now(), attention: { reason: 'question', message: 'Ship it?' }
  })
  assert.equal(asked.status, 202)
  assert.deepEqual(await (await pending).json(), { id: 'claude:in-proj', until: 'waiting', state: 'waiting', satisfied: true })

  const short = await (await get('/v1/agents/claude:in-proj/wait?until=complete&timeout=600')).json()
  assert.deepEqual(short, { id: 'claude:in-proj', until: 'complete', state: 'waiting', satisfied: false })
})
