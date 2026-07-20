import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
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
copyFileSync('src/shared/pricing.mjs', join(fixtureRoot, 'shared', 'pricing.mjs'))

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
