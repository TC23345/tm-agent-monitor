import test from 'node:test'
import assert from 'node:assert/strict'
import { fuzzyScore, parseQuery, rankItems } from './palette.mjs'

test('prefixes narrow the section and are stripped from the text', () => {
  assert.deepEqual(parseQuery('>zoom'), { mode: 'command', text: 'zoom' })
  assert.deepEqual(parseQuery('@ api'), { mode: 'agent', text: 'api' })
  assert.deepEqual(parseQuery('#chrome'), { mode: 'window', text: 'chrome' })
  assert.deepEqual(parseQuery('  new term '), { mode: null, text: 'new term' })
  assert.deepEqual(parseQuery(undefined), { mode: null, text: '' })
})

test('substring hits outrank scattered subsequences, and word starts outrank mid-word', () => {
  const sub = fuzzyScore('term', 'New terminal')
  const scattered = fuzzyScore('tml', 'New terminal')
  assert.ok(sub > scattered)
  assert.ok(fuzzyScore('new', 'New terminal') > fuzzyScore('new', 'Renew terminal'))
  assert.equal(fuzzyScore('xyz', 'New terminal'), null)
  assert.equal(fuzzyScore('', 'anything'), 0)
  assert.equal(fuzzyScore('a', undefined), null)
})

test('matching is case-insensitive and accepts initials', () => {
  assert.ok(fuzzyScore('NT', 'new terminal') > 0)
  assert.ok(fuzzyScore('ncc', 'New Claude Code') > 0)
})

const ITEMS = [
  { section: 'command', label: 'New terminal', keywords: ['shell', 'powershell'] },
  { section: 'command', label: 'New Claude Code' },
  { section: 'command', label: 'Zoom pane: Terminal' },
  { section: 'agent', label: 'api-gateway', detail: 'Should I switch auth to JWT?' },
  { section: 'window', label: 'Anthropic Console — Chrome' }
]

test('an empty query keeps the curated order and honours the limit', () => {
  assert.deepEqual(rankItems(ITEMS, '').map((i) => i.label), ITEMS.map((i) => i.label))
  assert.equal(rankItems(ITEMS, '', 2).length, 2)
})

test('a prefix restricts to one section', () => {
  assert.deepEqual(rankItems(ITEMS, '@').map((i) => i.label), ['api-gateway'])
  assert.deepEqual(rankItems(ITEMS, '#').map((i) => i.label), ['Anthropic Console — Chrome'])
  assert.equal(rankItems(ITEMS, '>api').length, 0)
})

test('label hits rank above detail and keyword hits, which still match', () => {
  const byShell = rankItems(ITEMS, 'shell')
  assert.deepEqual(byShell.map((i) => i.label), ['New terminal'])
  const byJwt = rankItems(ITEMS, 'jwt')
  assert.deepEqual(byJwt.map((i) => i.label), ['api-gateway'])
  const ranked = rankItems(ITEMS, 'term')
  assert.equal(ranked[0].label, 'New terminal')
  assert.ok(ranked.some((i) => i.label === 'Zoom pane: Terminal'))
})

test('junk items and non-array input are tolerated', () => {
  assert.deepEqual(rankItems([null, { section: 'command' }, ITEMS[0]], 'new').map((i) => i.label), ['New terminal'])
  assert.deepEqual(rankItems(undefined, 'x'), [])
})
