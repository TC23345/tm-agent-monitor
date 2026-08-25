import test from 'node:test'
import assert from 'node:assert/strict'
import { describeDigest, digestSnapshots } from './digest.mjs'

const agent = (id, state, extra = {}) => ({ id, project: id, provider: 'claude', state, ...extra })
const snap = (agents, accounts = []) => ({ agents, usage: { accounts } })

test('finished, newly waiting, started, and ended sessions are each counted once', () => {
  const before = snap([agent('a', 'running'), agent('b', 'running'), agent('c', 'waiting'), agent('gone', 'running'), agent('kid', 'running', { parentId: 'a' })])
  const after = snap([agent('a', 'complete'), agent('b', 'waiting', { question: 'Deploy?' }), agent('c', 'waiting'), agent('new', 'running')])
  const d = digestSnapshots(before, after, 90_000)
  assert.deepEqual(d.finished.map((a) => a.id), ['a'])
  assert.deepEqual(d.waiting.map((a) => a.id), ['b'])
  assert.equal(d.waiting[0].question, 'Deploy?')
  assert.deepEqual(d.started.map((a) => a.id), ['new'])
  assert.deepEqual(d.ended.map((a) => a.id), ['gone'])
  assert.equal(d.empty, false)
})

test('estimated spend delta ignores actual API accounts and never goes negative', () => {
  const before = snap([], [{ id: 'l', todayCostUsd: 10 }, { id: 'api', actualSpend: true, todayCostUsd: 5 }])
  const after = snap([], [{ id: 'l', todayCostUsd: 13.5 }, { id: 'api', actualSpend: true, todayCostUsd: 50 }])
  assert.equal(digestSnapshots(before, after).spendDelta, 3.5)
  assert.equal(digestSnapshots(after, before).spendDelta, 0)
})

test('nothing changed is empty, and null snapshots are tolerated', () => {
  const s = snap([agent('a', 'running')], [{ id: 'l', todayCostUsd: 1 }])
  assert.equal(digestSnapshots(s, s, 5000).empty, true)
  assert.equal(digestSnapshots(null, undefined).empty, true)
})

test('the description reads as one line', () => {
  const before = snap([agent('a', 'running')], [{ id: 'l', todayCostUsd: 1 }])
  const after = snap([agent('a', 'waiting'), agent('b', 'complete')], [{ id: 'l', todayCostUsd: 4.1 }])
  const d = digestSnapshots(before, after, 42 * 60_000)
  assert.equal(describeDigest(d), 'away 42m · 1 session waiting on you · 1 started · +$3.10 estimated')
  assert.equal(describeDigest({ ...d, awayMs: 3 * 3_600_000, waiting: [], started: [], spendDelta: 0 }), 'away 3h')
})
