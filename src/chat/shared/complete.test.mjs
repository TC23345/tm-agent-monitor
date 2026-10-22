import test from 'node:test'
import assert from 'node:assert/strict'
import { MAX_COMPLETION, MAX_CONTEXT, cleanCompletion, completionPrompt } from './complete.mjs'

test('completionPrompt fences the reply and the draft, and leaves the reply out when there is none', () => {
  const p = completionPrompt('add a toggle for', 'I added the switch row.')
  assert.ok(p.system.includes('continuation only'))
  assert.ok(p.prompt.includes('<reply>\nI added the switch row.\n</reply>'))
  assert.ok(p.prompt.endsWith('<message>add a toggle for</message>'))
  assert.ok(!completionPrompt('x').prompt.includes('<reply>'))
  const long = completionPrompt('x', 'a'.repeat(MAX_CONTEXT + 50)).prompt
  assert.ok(long.includes('a'.repeat(MAX_CONTEXT)) && !long.includes('a'.repeat(MAX_CONTEXT + 1)))
})

test('cleanCompletion strips wrapping, drops an echo and keeps the join right', () => {
  assert.equal(cleanCompletion('" the auto-correct switch"', 'add a toggle for'), ' the auto-correct switch')
  assert.equal(cleanCompletion('```\n the switch\n```', 'add'), ' the switch')
  assert.equal(cleanCompletion('add a toggle for the switch', 'add a toggle for'), ' the switch')
  assert.equal(cleanCompletion('the switch', 'add a toggle for '), 'the switch', 'the draft already ends in a space')
  assert.equal(cleanCompletion('the switch', 'add a toggle for'), ' the switch', 'a forgotten space before a common word')
  assert.equal(cleanCompletion('ect', 'add a toggle for auto-corr'), 'ect', 'a word being finished')
  assert.equal(cleanCompletion('Then save.', 'add a toggle for it.'), ' Then save.', 'after punctuation')
  assert.equal(cleanCompletion('  \n', 'x'), '')
  assert.equal(cleanCompletion('add', 'add'), '', 'nothing but an echo')
  assert.equal(cleanCompletion(' say "hi" to them', 'then'), ' say "hi" to them', 'quotes inside stay')
})

test('cleanCompletion bounds the length at a sentence end', () => {
  const words = Array.from({ length: 80 }, (_, i) => (i === 40 ? 'end.' : 'word')).join(' ')
  const out = cleanCompletion(words, 'go')
  assert.ok(out.length <= MAX_COMPLETION)
  assert.ok(out.endsWith('end.'))
  const noStop = cleanCompletion(Array.from({ length: 80 }, () => 'word').join(' '), 'go')
  assert.ok(noStop.length <= MAX_COMPLETION && noStop.endsWith('word'))
})
