import test from 'node:test'
import assert from 'node:assert/strict'
import { parseClipImport, snippetNote, MAX_IMPORT_CLIPS } from './clipImport.mjs'

test('our own export round-trips text and file clips, skips images, keeps title, star, groups and first-seen time', () => {
  const raw = {
    app: 'taylormade-agent-monitor', schemaVersion: 1, exportedAt: '2026-09-24T00:00:00Z', groups: ['Prompts'], favoritesOrder: ['a'],
    clips: [
      { id: 'a', kind: 'text', text: 'alpha', title: ' Alpha ', favorite: true, groups: ['Prompts', 'All', 7], createdAt: 1700000000000, copiedAt: 1700000005000 },
      { id: 'b', kind: 'files', files: ['C:\\x.txt', 3, 'C:\\y.txt'], text: 'ignored', createdAt: 1700000001000 },
      { id: 'c', kind: 'image', image: { width: 1, height: 1, bytes: 10, hash: 'h' } },
      { id: 'd', kind: 'text', text: '   ' },
      'junk'
    ]
  }
  const plan = parseClipImport(raw)
  assert.equal(plan.source, 'agent-monitor')
  assert.deepEqual(plan.snippets, [])
  assert.deepEqual(plan.clips, [
    { text: 'alpha', title: 'Alpha', favorite: true, groups: ['Prompts'], createdAt: 1700000000000, copiedAt: 1700000005000, order: 0 },
    { text: 'C:\\x.txt\nC:\\y.txt', title: undefined, favorite: false, groups: [], createdAt: 1700000001000, copiedAt: 1700000001000 }
  ])
})

test("a Clipboard History Pro backup (a bare array, the extension's own exporter shape) becomes clips, groups from tags, and snippets from textShortcut", () => {
  // What options.js writes: every stored field but hash/shortText, falsy
  // fields dropped, tags always an array, isFavorite always a boolean,
  // dateLastCopied omitted when it equals dateAdded. Newest first.
  const raw = [
    { text: 'Best regards,\nTaylor', dateAdded: 1726000000000, length: 21, tags: ['Signatures'], isFavorite: true, order: 1, textShortcut: ';sig', title: 'Signature' },
    { text: 'https://github.com/TC23345/tm-agent-monitor', dateAdded: 1725000000000, dateLastCopied: 1725500000000, length: 43, tags: [], sourceUrl: 'https://github.com/TC23345', isFavorite: false },
    { text: 'merged one\nmerged two', dateAdded: 1724000000000, length: 21, tags: ['Work', 'Work'], isFavorite: true, order: 0, isMerged: true, isEdited: true },
    { text: 'not a url source', dateAdded: 1723000000000, length: 16, tags: [], sourceUrl: 'javascript:alert(1)', isFavorite: false },
    // The importer's v1 renames: full → text, date → dateAdded, favorite → isFavorite, sourceURL → sourceUrl, tags as {text}.
    { full: 'legacy record', date: '2024-01-02T03:04:05Z', favorite: true, sourceURL: 'https://example.com/x', tags: [{ text: 'Old' }, 4] },
    { text: '', dateAdded: 1, tags: [], isFavorite: false },
    { text: 12345, tags: [], isFavorite: false },
    'junk'
  ]
  const plan = parseClipImport(raw)
  assert.equal(plan.source, 'clipboard-history-pro')
  assert.deepEqual(plan.snippets, [{ shortcut: ';sig', text: 'Best regards,\nTaylor' }])
  assert.deepEqual(plan.clips, [
    { text: 'Best regards,\nTaylor', title: 'Signature', favorite: true, groups: ['Signatures'], createdAt: 1726000000000, copiedAt: 1726000000000, order: 1 },
    { text: 'https://github.com/TC23345/tm-agent-monitor', title: undefined, favorite: false, groups: [], createdAt: 1725000000000, copiedAt: 1725500000000, sourceUrl: 'https://github.com/TC23345' },
    { text: 'merged one\nmerged two', title: undefined, favorite: true, groups: ['Work'], createdAt: 1724000000000, copiedAt: 1724000000000, order: 0, merged: true, edited: true },
    { text: 'not a url source', title: undefined, favorite: false, groups: [], createdAt: 1723000000000, copiedAt: 1723000000000 },
    { text: 'legacy record', title: undefined, favorite: true, groups: ['Old'], createdAt: Date.parse('2024-01-02T03:04:05Z'), copiedAt: Date.parse('2024-01-02T03:04:05Z'), sourceUrl: 'https://example.com/x' },
    { text: '12345', title: undefined, favorite: false, groups: [], createdAt: undefined, copiedAt: undefined }
  ])
  assert.deepEqual(parseClipImport({ items: raw.slice(0, 1) }).clips.length, 1, "getAll's {items} wrapper is accepted too")
  assert.equal(parseClipImport([]), null, 'an empty array is not a backup')
  assert.equal(parseClipImport([{ foo: 1 }]), null, 'an array of the wrong records is not a backup')
})

test('anything that is not a backup is refused; bounds hold', () => {
  assert.equal(parseClipImport(null), null)
  assert.equal(parseClipImport('x'), null)
  assert.equal(parseClipImport({ hello: 'world' }), null)
  assert.equal(parseClipImport({ app: 'taylormade-agent-monitor' }), null, 'ours without clips falls through to nothing')
  const many = { app: 'taylormade-agent-monitor', clips: Array.from({ length: MAX_IMPORT_CLIPS + 5 }, (_, i) => ({ kind: 'text', text: `t${i}` })) }
  assert.equal(parseClipImport(many).clips.length, MAX_IMPORT_CLIPS)
})

test('snippetNote names the file after the shortcut and declares it on the first line', () => {
  assert.deepEqual(snippetNote({ shortcut: ';sig', text: 'Best,\r\nTaylor\n\n' }), { file: 'sig.md', body: 'shortcut: ;sig\n\nBest,\nTaylor\n' })
  assert.deepEqual(snippetNote({ shortcut: '  ;addr ', text: '1 Main St' }), { file: 'addr.md', body: 'shortcut: ;addr\n\n1 Main St\n' })
  assert.equal(snippetNote({ shortcut: ';;;', text: 'x' }).file, 'snippet.md', 'a shortcut with no word characters still gets a file')
  assert.equal(snippetNote({ shortcut: 5, text: 'x' }), null)
})
