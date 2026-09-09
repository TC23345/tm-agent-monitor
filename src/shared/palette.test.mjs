import test from 'node:test'
import assert from 'node:assert/strict'
import { browseItems, commandGroup, fuzzyScore, homeItems, parseQuery, rankItems } from './palette.mjs'

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

test('commandGroup files ids under the browse headings', () => {
  assert.equal(commandGroup('cmd:new-claude'), 'Start')
  assert.equal(commandGroup('cmd:run:npm run dev'), 'Run')
  assert.equal(commandGroup('cmd:snippet:/compact'), 'Snippets')
  assert.equal(commandGroup('cmd:cursor'), 'Project')
  assert.equal(commandGroup('cmd:zoom:pane-1'), 'Panes')
  assert.equal(commandGroup('cmd:view:limits'), 'Panes')
  assert.equal(commandGroup('cmd:cols-2'), 'Layout')
  assert.equal(commandGroup('cmd:layout-delete:Build'), 'Layout')
  assert.equal(commandGroup('cmd:quit'), 'App')
  assert.equal(commandGroup('cmd:something-new'), 'Other')
  assert.equal(commandGroup(undefined), 'Other')
})

test('homeItems shows pinned commands and agents only; falls back to the first six', () => {
  const items = [
    { id: 'cmd:new-terminal', section: 'command', label: 'New terminal', pinned: true },
    { id: 'cmd:cols-2', section: 'command', label: 'Columns: 2' },
    { id: 'cmd:new-claude', section: 'command', label: 'New Claude Code', pinned: true },
    { id: 'agent:1', section: 'agent', label: 'api-gateway', pinned: true },
    { id: 'agent:1:terminal', section: 'agent', label: 'api-gateway — terminal here' },
    { id: 'win:1', section: 'window', label: 'Cursor' }
  ]
  assert.deepEqual(homeItems(items).map((i) => i.id), ['cmd:new-terminal', 'cmd:new-claude', 'agent:1'])
  const unpinned = Array.from({ length: 8 }, (_, i) => ({ id: `cmd:c${i}`, section: 'command', label: `c${i}` }))
  assert.equal(homeItems(unpinned).length, 6)
  assert.deepEqual(homeItems(null), [])
})

test('browseItems orders commands by group, stable within a group, and drops other sections', () => {
  const items = [
    { id: 'cmd:quit', section: 'command', label: 'Quit' },
    { id: 'cmd:cols-1', section: 'command', label: 'Columns: 1' },
    { id: 'agent:1', section: 'agent', label: 'x' },
    { id: 'cmd:new-codex', section: 'command', label: 'New Codex' },
    { id: 'cmd:cols-2', section: 'command', label: 'Columns: 2' },
    { id: 'cmd:new-claude', section: 'command', label: 'New Claude Code' }
  ]
  assert.deepEqual(browseItems(items).map((i) => i.id), ['cmd:new-codex', 'cmd:new-claude', 'cmd:cols-1', 'cmd:cols-2', 'cmd:quit'])
})
