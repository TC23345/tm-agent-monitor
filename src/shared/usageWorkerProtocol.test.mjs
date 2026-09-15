import assert from 'node:assert/strict'
import test from 'node:test'
import { PendingCalls, errorResponse, okResponse, parseRequest, parseResponse, WORKER_KINDS } from './usageWorkerProtocol.mjs'

test('parseRequest accepts every kind with an optional args bag', () => {
  for (const kind of WORKER_KINDS) {
    assert.deepEqual(parseRequest({ id: 'a1', kind }), { id: 'a1', kind, args: {} })
  }
  assert.deepEqual(parseRequest({ id: 'a1', kind: 'insights', args: { claudeRoot: 'x' } }), { id: 'a1', kind: 'insights', args: { claudeRoot: 'x' } })
})

test('parseRequest drops anything malformed instead of throwing', () => {
  assert.equal(parseRequest(undefined), undefined)
  assert.equal(parseRequest('claude-refresh'), undefined)
  assert.equal(parseRequest({ id: 1, kind: 'claude-refresh' }), undefined)
  assert.equal(parseRequest({ id: 'bad id', kind: 'claude-refresh' }), undefined)
  assert.equal(parseRequest({ id: 'a', kind: 'format-disk' }), undefined)
  assert.equal(parseRequest({ id: 'a', kind: 'insights', args: [1] }), undefined)
  assert.equal(parseRequest({ id: 'a'.repeat(65), kind: 'insights' }), undefined)
})

test('responses round-trip and an empty error still names itself', () => {
  assert.deepEqual(parseResponse(okResponse('r1', { days: [] })), { id: 'r1', ok: true, result: { days: [] } })
  assert.deepEqual(parseResponse(errorResponse('r2', new Error('boom'))), { id: 'r2', ok: false, error: 'boom' })
  assert.deepEqual(parseResponse(errorResponse('r3', '')), { id: 'r3', ok: false, error: 'unknown worker error' })
  assert.equal(parseResponse({ id: 'r4' }), undefined)
  assert.equal(parseResponse({ id: 'r4', ok: 'yes' }), undefined)
  assert.equal(parseResponse(null), undefined)
})

test('PendingCalls settles by id, ignores strangers, and fails everything on death', () => {
  const calls = new PendingCalls()
  const log = []
  const waiter = (name) => ({ resolve: (v) => log.push([name, 'ok', v]), reject: (e) => log.push([name, 'err', e.message]) })
  calls.add('a', waiter('a'))
  calls.add('b', waiter('b'))
  assert.equal(calls.size, 2)

  assert.equal(calls.settle({ id: 'zzz', ok: true, result: 1 }), false)
  assert.equal(calls.settle('garbage'), false)
  assert.equal(calls.settle(okResponse('a', 42)), true)
  assert.equal(calls.settle(okResponse('a', 43)), false, 'a second answer for the same id has nobody waiting')
  assert.equal(calls.size, 1)

  assert.equal(calls.failAll('usage worker exited (1)'), 1)
  assert.equal(calls.size, 0)
  assert.deepEqual(log, [['a', 'ok', 42], ['b', 'err', 'usage worker exited (1)']])
})

test('take() lets a timeout reclaim a call so a late answer is dropped', () => {
  const calls = new PendingCalls()
  let settled
  calls.add('slow', { resolve: (v) => (settled = v), reject: () => (settled = 'rejected') })
  assert.ok(calls.take('slow'))
  assert.equal(calls.take('slow'), undefined)
  assert.equal(calls.settle(okResponse('slow', 'late')), false)
  assert.equal(settled, undefined)
})
