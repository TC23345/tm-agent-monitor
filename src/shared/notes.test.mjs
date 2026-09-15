import test from 'node:test'
import assert from 'node:assert/strict'
import { isNoteName, nextNoteName, noteNameFor, notePreview, noteTitle, sortNotes } from './notes.mjs'

test('a note name is one Markdown file name, never a path', () => {
  assert.ok(isNoteName('2026-09-15.md'))
  assert.ok(isNoteName("Taylor's ideas (draft).md"))
  assert.ok(!isNoteName('../secrets.md'))
  assert.ok(!isNoteName('sub/dir.md'))
  assert.ok(!isNoteName('sub\\dir.md'))
  assert.ok(!isNoteName('.hidden.md'))
  assert.ok(!isNoteName('notes.txt'))
  assert.ok(!isNoteName('a'.repeat(81) + '.md'))
  assert.ok(!isNoteName(''))
  assert.ok(!isNoteName(42))
})

test('titles round-trip through file names, with the unsafe bits scrubbed', () => {
  assert.equal(noteTitle('Ideas.md'), 'Ideas')
  assert.equal(noteNameFor('Ideas'), 'Ideas.md')
  assert.equal(noteNameFor('  Ideas.md  '), 'Ideas.md')
  assert.equal(noteNameFor('what: next? / plan'), 'what next plan.md')
  assert.equal(noteNameFor('   '), undefined)
  assert.equal(noteNameFor('...'), undefined)
  assert.equal(noteNameFor('x'.repeat(200)).length, 76 + 3)
})

test('the default name is today, suffixed until free, case-insensitively', () => {
  const now = new Date(2026, 8, 15, 10).getTime()
  assert.equal(nextNoteName([], now), '2026-09-15.md')
  assert.equal(nextNoteName(['2026-09-15.md'], now), '2026-09-15-2.md')
  assert.equal(nextNoteName(['2026-09-15.MD', '2026-09-15-2.md'], now), '2026-09-15-3.md')
})

test('sortNotes is newest first and stable by name', () => {
  const sorted = sortNotes([{ name: 'b.md', mtime: 1 }, { name: 'a.md', mtime: 1 }, { name: 'c.md', mtime: 5 }])
  assert.deepEqual(sorted.map((n) => n.name), ['c.md', 'a.md', 'b.md'])
})

test('the preview is the first real line, without heading marks, clipped', () => {
  assert.equal(notePreview('\n\n## Plan for today\nmore'), 'Plan for today')
  assert.equal(notePreview(''), '')
  assert.equal(notePreview('x'.repeat(100), 20), 'x'.repeat(19) + '…')
})
