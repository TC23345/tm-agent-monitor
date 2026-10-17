import test from 'node:test'
import assert from 'node:assert/strict'
import { LineSplitter, PendingCalls, errorResponseLine, notificationLine, parseIncoming, requestLine, responseLine } from './rpc.mjs'

// Lines as the probe observed them from codex 0.162.1 (docs/rea/codex-samples).
const INIT_RESPONSE = '{"id":1,"result":{"userAgent":"chat-panes-probe/0.162.1 (Windows 10.0.26300; x86_64) xterm-256color (chat-panes-probe; 0.0.0)","codexHome":"C:\\\\Users\\\\me\\\\.codex","platformFamily":"windows","platformOs":"windows"}}'
const NOTIFICATION = '{"method":"account/updated","params":{"authMode":"chatgpt","planType":"self_serve_business_prolite"},"emittedAtMs":1792218788765}'
const SERVER_REQUEST = '{"id":"srv-7","method":"item/commandExecution/requestApproval","params":{"kind":"command","threadId":"t","turnId":"u","itemId":"i","startedAtMs":1,"environmentId":null,"command":"npm test","cwd":"C:\\\\p"}}'

test('parseIncoming classifies response, notification and server request', () => {
  const r = parseIncoming(INIT_RESPONSE)
  assert.equal(r.kind, 'response')
  assert.equal(r.id, 1)
  assert.equal(r.result.platformOs, 'windows')
  const n = parseIncoming(NOTIFICATION)
  assert.equal(n.kind, 'notification')
  assert.equal(n.method, 'account/updated')
  assert.equal(n.emittedAtMs, 1792218788765)
  const s = parseIncoming(SERVER_REQUEST)
  assert.equal(s.kind, 'server-request')
  assert.equal(s.id, 'srv-7')
  assert.equal(s.params.command, 'npm test')
})

test('parseIncoming returns null for junk and error responses carry the message', () => {
  assert.equal(parseIncoming(''), null)
  assert.equal(parseIncoming('   '), null)
  assert.equal(parseIncoming('not json'), null)
  assert.equal(parseIncoming('[1,2]'), null)
  assert.equal(parseIncoming('{"foo":1}'), null)
  const e = parseIncoming('{"id":3,"error":{"code":-32602,"message":"missing field `threadId`"}}')
  assert.equal(e.kind, 'response')
  assert.equal(e.error.message, 'missing field `threadId`')
  assert.equal(e.error.code, -32602)
})

test('outgoing lines are one JSON object per line with params always present', () => {
  assert.equal(requestLine(1, 'initialize', { clientInfo: { name: 'x', title: null, version: '0' }, capabilities: null }),
    '{"id":1,"method":"initialize","params":{"clientInfo":{"name":"x","title":null,"version":"0"},"capabilities":null}}\n')
  assert.equal(requestLine(2, 'model/list'), '{"id":2,"method":"model/list","params":{}}\n')
  assert.equal(notificationLine('initialized'), '{"method":"initialized","params":{}}\n')
  assert.equal(responseLine('srv-7', { decision: 'accept' }), '{"id":"srv-7","result":{"decision":"accept"}}\n')
  assert.equal(errorResponseLine('srv-8', 'pane closed'), '{"id":"srv-8","error":{"code":-32000,"message":"pane closed"}}\n')
})

test('PendingCalls settles by id, rejects on error, fails all on exit', async () => {
  const p = new PendingCalls()
  const id = p.nextId()
  const w = p.wait(id, 'thread/list')
  assert.equal(p.settle({ kind: 'response', id: 99, result: 1 }), false)
  assert.equal(p.settle({ kind: 'response', id, result: { data: [] } }), true)
  assert.deepEqual(await w, { data: [] })
  const id2 = p.nextId()
  const w2 = p.wait(id2, 'turn/start')
  p.settle({ kind: 'response', id: id2, error: { code: 1, message: 'nope' } })
  await assert.rejects(w2, /turn\/start: nope/)
  const w3 = p.wait(p.nextId(), 'thread/read')
  p.failAll('process exited')
  await assert.rejects(w3, /process exited/)
  assert.equal(p.size, 0)
})

test('PendingCalls times out and reports it', async () => {
  const p = new PendingCalls()
  let timedOut = false
  await assert.rejects(p.wait(p.nextId(), 'slow', { timeoutMs: 5, onTimeout: () => { timedOut = true } }), /timed out/)
  assert.equal(timedOut, true)
  assert.equal(p.size, 0)
})

test('LineSplitter joins across chunks and drops oversized lines', () => {
  const s = new LineSplitter(20)
  assert.deepEqual(s.push('{"a":1}\n{"b"'), ['{"a":1}'])
  assert.deepEqual(s.push(':2}\n'), ['{"b":2}'])
  assert.deepEqual(s.push('x'.repeat(30) + '\n{"c":3}\n'), ['{"c":3}'])
  assert.equal(s.dropped, 1)
  assert.deepEqual(s.push('y'.repeat(25)), [])
  assert.equal(s.dropped, 2)
  assert.equal(s.rest, '')
})
