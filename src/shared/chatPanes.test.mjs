import test from 'node:test'
import assert from 'node:assert/strict'
import { sanitizeChatConfig, sanitizePanes } from './panes.mjs'

const opts = { kinds: ['terminal', 'chat', 'notes'], isUnique: (k) => k !== 'terminal' && k !== 'chat', maxPanes: 6 }

test('sanitizeChatConfig keeps provider, cwd, a UUID handle, a safe resume id and a short model', () => {
  assert.deepEqual(sanitizeChatConfig({ provider: 'claude', cwd: 'C:\\p', chatId: '0f9a1c2e-1111-4222-8333-444455556666', resumeId: 'abc-123_X', model: 'haiku' }),
    { provider: 'claude', cwd: 'C:\\p', chatId: '0f9a1c2e-1111-4222-8333-444455556666', resumeId: 'abc-123_X', model: 'haiku' })
  assert.deepEqual(sanitizeChatConfig({ provider: 'codex', cwd: 'C:\\p', chatId: 'not-a-uuid', resumeId: 'bad id;rm', model: '' }), { provider: 'codex', cwd: 'C:\\p' })
  assert.equal(sanitizeChatConfig({ provider: 'cursor', cwd: 'C:\\p' }), null)
  assert.equal(sanitizeChatConfig({ provider: 'claude' }), null)
  assert.equal(sanitizeChatConfig('nope'), null)
})

test('sanitizePanes keeps chat panes with a usable config and repeats them', () => {
  const out = sanitizePanes([
    { id: 'a', kind: 'chat', chat: { provider: 'claude', cwd: 'C:\\p', resumeId: 's1' } },
    { id: 'b', kind: 'chat', chat: { provider: 'codex', cwd: 'C:\\q' } },
    { id: 'c', kind: 'chat', chat: { provider: 'x', cwd: 'C:\\q' } },
    { id: 'd', kind: 'notes' }
  ], opts)
  assert.deepEqual(out.map((p) => p.id), ['a', 'b', 'd'])
  assert.deepEqual(out[0].chat, { provider: 'claude', cwd: 'C:\\p', resumeId: 's1' })
})
