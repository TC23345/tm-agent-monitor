import test from 'node:test'
import assert from 'node:assert/strict'
import { groupNotes, isNoteName, nextNoteName, noteGroup, noteNameFor, notePreview, noteTitle, planNewNote, sortNotes, NOTE_TEMPLATES, NOTES_GROUP } from './notes.mjs'

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

test('a note joins a template group by its name prefix, else the plain Notes group', () => {
  assert.equal(noteGroup('Meeting 2026-09-21.md'), 'meeting')
  assert.equal(noteGroup('daily 2026-09-21.md'), 'daily')
  assert.equal(noteGroup('Meetings recap.md'), NOTES_GROUP)
  assert.equal(noteGroup('2026-09-21.md'), NOTES_GROUP)
  const groups = groupNotes([{ name: 'Plan x.md' }, { name: 'todo.md' }])
  assert.deepEqual(groups.map((g) => g.id), [NOTES_GROUP, ...NOTE_TEMPLATES.map((t) => t.id)])
  assert.deepEqual(groups.find((g) => g.id === 'plan').notes.map((n) => n.name), ['Plan x.md'])
  assert.equal(groups.find((g) => g.id === 'meeting').notes.length, 0)
})

test('a template note is named for today under its prefix and starts from the template', () => {
  const now = new Date(2026, 8, 21, 10).getTime()
  const m = planNewNote(['Meeting 2026-09-21.md'], 'meeting', now)
  assert.equal(m.name, 'Meeting 2026-09-21-2.md')
  assert.equal(m.exists, false)
  assert.match(m.body, /^# Meeting — 2026-09-21/)
  for (const t of NOTE_TEMPLATES) assert.ok(isNoteName(planNewNote([], t.id, now).name), t.id)
})

test('a once-a-day template opens today\'s note instead of making another', () => {
  const now = new Date(2026, 8, 21, 10).getTime()
  assert.deepEqual(planNewNote(['daily 2026-09-21.md'], 'daily', now), { name: 'daily 2026-09-21.md', body: '', exists: true })
  assert.equal(planNewNote(['Daily 2026-09-20.md'], 'daily', now).name, 'Daily 2026-09-21.md')
})

test('an unknown template is a blank dated note', () => {
  const now = new Date(2026, 8, 21, 10).getTime()
  assert.deepEqual(planNewNote([], 'nope', now), { name: '2026-09-21.md', body: '', exists: false })
  assert.deepEqual(planNewNote([], undefined, now), { name: '2026-09-21.md', body: '', exists: false })
})
