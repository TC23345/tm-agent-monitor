import test from 'node:test'
import assert from 'node:assert/strict'
import { acceptable, applyCase, correctable, editDistance, fixFor, inCode, lexicon, sanitizeKeep, wordBefore, MAX_KEEP } from './autocorrect.mjs'

test('wordBefore finds the word a typed boundary ends', () => {
  assert.deepEqual(wordBefore('fix the mispell ', 16), { start: 8, end: 15, word: 'mispell' })
  assert.deepEqual(wordBefore('Teh.', 4), { start: 0, end: 3, word: 'Teh' })
  assert.deepEqual(wordBefore("doesnt, work", 7), { start: 0, end: 6, word: 'doesnt' })
  assert.equal(wordBefore('fix the mispell', 15), null, 'no boundary typed')
  assert.equal(wordBefore('a  ', 3), null, 'the boundary ends nothing')
  assert.deepEqual(wordBefore('(word) ', 6), { start: 1, end: 5, word: 'word' })
})

test('wordBefore leaves paths, handles, commands, flags and hyphenated pairs alone', () => {
  for (const t of ['/electron ', '@src/App ', '--force ', 'foo-bar ', 'a.mispell ', 'C:\\Users\\mispell ', 'snake_mispell ', '#mispell ', "'quoted' "]) {
    assert.equal(wordBefore(t, t.length), null, t)
  }
})

test('wordBefore skips code spans and fenced blocks', () => {
  assert.equal(wordBefore('run `npm instal ', 16), null)
  assert.equal(wordBefore('run `npm instal` then ', 22)?.word, 'then')
  assert.equal(wordBefore('```\nconst teh ', 14), null)
  assert.equal(wordBefore('```\nx\n```\nteh ', 14)?.word, 'teh')
  assert.equal(inCode('a `b` c', 6), false)
})

test('correctable takes plain words only', () => {
  assert.equal(correctable('mispell'), true)
  assert.equal(correctable('Mispell'), true)
  assert.equal(correctable('API'), false, 'all caps')
  assert.equal(correctable('iPhone'), false, 'internal capital')
  assert.equal(correctable('mp3'), false, 'digits')
  assert.equal(correctable('ok'), false, 'too short')
  assert.equal(correctable('im'), true, 'short, but a known contraction')
  assert.equal(correctable('config'), false, 'jargon')
  assert.equal(correctable('zorblax', new Set(['zorblax'])), false, 'in the conversation')
  assert.equal(correctable('zorblax', ['zorblax']), false)
})

test('editDistance counts a swap as one edit', () => {
  assert.equal(editDistance('teh', 'the'), 1)
  assert.equal(editDistance('mispell', 'misspell'), 1)
  assert.equal(editDistance('definately', 'definitely'), 1)
  assert.equal(editDistance('abc', 'xyz'), 3)
})

test('acceptable keeps the first letter and stays within reach', () => {
  assert.equal(acceptable('thats', 'ghats'), false)
  assert.equal(acceptable('dont', 'cont'), false)
  assert.equal(acceptable('json', 'son'), false)
  assert.equal(acceptable('wierd', 'weird'), true)
  assert.equal(acceptable('heigh', 'height'), true)
  assert.equal(acceptable('english', 'English'), true)
  assert.equal(acceptable('abcd', 'abxy'), false, 'two edits in a short word')
  assert.equal(acceptable('naturaly', 'naturally'), true)
  assert.equal(acceptable('alot', 'a lot'), true)
  assert.equal(acceptable('word', 'wo rd!'), false)
})

test('applyCase follows the word, never lowercases a fix', () => {
  assert.equal(applyCase('Teh', 'the'), 'The')
  assert.equal(applyCase('teh', 'the'), 'the')
  assert.equal(applyCase('im', "I'm"), "I'm")
  assert.equal(applyCase('english', 'English'), 'English')
})

test('fixFor answers contractions first, then the first acceptable suggestion', () => {
  assert.equal(fixFor('thats', { ok: false, suggestions: ['ghats', 'thaws'] }), "that's")
  assert.equal(fixFor('Dont', { ok: false, suggestions: [] }), "Don't")
  assert.equal(fixFor('im', { ok: false, suggestions: ['in'] }), "I'm")
  assert.equal(fixFor('heigh', { ok: false, suggestions: ['neigh', 'height', 'high'] }), 'height')
  assert.equal(fixFor('Mispell', { ok: false, suggestions: ['Misspell'] }), 'Misspell')
  assert.equal(fixFor('mispell', { ok: true, suggestions: [] }), null, 'a correct word')
  assert.equal(fixFor('repo', { ok: false, suggestions: ['redo'] }), 'redo', 'the guard is correctable’s job')
  assert.equal(fixFor('xq', { ok: false, suggestions: ['xx'] }), null, 'too short')
  // "claude" would go to "clause" here: correctable() is what keeps it, through TECH_WORDS.
  assert.equal(fixFor('claude', { ok: false, suggestions: ['clause', 'Claude'] }), 'clause')
  assert.equal(correctable('claude'), false)
})

test('lexicon collects the conversation’s words, lowercase and bounded', () => {
  const l = lexicon(['Open the ChatManager in src', "it's there"], 3)
  assert.deepEqual([...l], ['open', 'the', 'chatmanager'])
  assert.ok(lexicon(['ab a']).size === 0)
})

test('sanitizeKeep keeps plain lowercase words, unique, the newest MAX_KEEP', () => {
  assert.deepEqual(sanitizeKeep(['Zorblax', 'zorblax', ' ok ', 'bad word', 'x1', 7]), ['zorblax', 'ok'])
  const name = (i) => String.fromCharCode(97 + (i % 26)).repeat(1 + Math.floor(i / 26))
  const many = sanitizeKeep(Array.from({ length: MAX_KEEP + 5 }, (_, i) => name(i)))
  assert.equal(many.length, MAX_KEEP)
  assert.equal(many[MAX_KEEP - 1], name(MAX_KEEP + 4))
  assert.deepEqual(sanitizeKeep('nope'), [])
})
