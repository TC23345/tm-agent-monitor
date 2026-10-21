import test from 'node:test'
import assert from 'node:assert/strict'
import { DRAFT_TTL_MS, MAX_DRAFTS, MAX_DRAFT_IMAGE_CHARS, cleanDraft, isEmptyDraft, parseDrafts, withDraft, withoutImages } from './drafts.mjs'

const NOW = 1_800_000_000_000
const img = (n, chars) => ({ kind: 'image', name: `p${n}.png`, mime: 'image/png', data: 'A'.repeat(chars), width: 10, height: 10 })

test('a draft keeps text, cards and attachments, and an empty one is nothing', () => {
  const d = cleanDraft({ text: 'half a thought', cards: [{ kind: 'quote', text: 'q' }, { kind: 'nope', text: 'x' }], attachments: [{ kind: 'file', path: 'C:\\a.ts' }, img(1, 40)] }, NOW)
  assert.equal(d.text, 'half a thought')
  assert.deepEqual(d.cards, [{ kind: 'quote', text: 'q' }])
  assert.equal(d.attachments.length, 2)
  assert.equal(cleanDraft({ text: '   ', cards: [], attachments: [] }, NOW), null)
  assert.ok(isEmptyDraft(null))
})

test('images past the budget are left out, first ones kept', () => {
  const half = Math.floor(MAX_DRAFT_IMAGE_CHARS / 2) + 10
  const d = cleanDraft({ text: 'x', attachments: [img(1, half), img(2, half), { kind: 'file', path: 'b.ts' }] }, NOW)
  assert.deepEqual(d.attachments.map((a) => a.name ?? a.path), ['p1.png', 'b.ts'])
})

test('a malformed image never survives', () => {
  const d = cleanDraft({ text: 'x', attachments: [{ kind: 'image', mime: 'text/html', data: 'AAAA' }, { kind: 'image', mime: 'image/png', data: '<script>' }] }, NOW)
  assert.deepEqual(d.attachments, [])
})

test('withDraft sets one pane, and an empty draft removes it', () => {
  let all = withDraft({}, 'pane-1', { text: 'hello', cards: [], attachments: [] }, NOW)
  assert.equal(all['pane-1'].text, 'hello')
  assert.equal(all['pane-1'].at, NOW)
  all = withDraft(all, 'pane-1', { text: '', cards: [], attachments: [] }, NOW + 1)
  assert.deepEqual(all, {})
  assert.deepEqual(withDraft({}, 'bad key!', { text: 'x', cards: [], attachments: [] }, NOW), {})
})

test('old drafts expire and only the newest MAX_DRAFTS stay', () => {
  let all = {}
  for (let i = 0; i < MAX_DRAFTS + 3; i++) all = withDraft(all, `p${i}`, { text: `t${i}`, cards: [], attachments: [] }, NOW + i)
  assert.equal(Object.keys(all).length, MAX_DRAFTS)
  assert.ok(!('p0' in all) && `p${MAX_DRAFTS + 2}` in all)
  assert.deepEqual(parseDrafts(JSON.stringify(all), NOW + DRAFT_TTL_MS + MAX_DRAFTS + 10), {})
})

test('parseDrafts reads what was stored and survives bad JSON', () => {
  const all = withDraft({}, 'p', { text: 'x', cards: [{ kind: 'paste', text: 'log' }], attachments: [img(1, 8)] }, NOW)
  assert.deepEqual(parseDrafts(JSON.stringify(all), NOW), all)
  assert.deepEqual(parseDrafts('{oops', NOW), {})
  assert.deepEqual(withoutImages(all).p.attachments, [])
})
