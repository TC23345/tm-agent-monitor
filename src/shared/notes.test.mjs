import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildTree, folderNameFor, groupNotes, isFolderName, isFolderPath, isNoteName, isNotePath, nextFolderName, nextNoteName,
  noteGroup, noteNameFor, notePreview, noteTitle, parentOf, planNewNote, sortNotes, NOTE_TEMPLATES, NOTES_GROUP
} from './notes.mjs'

test('a note path is folders then a note name, every segment checked', () => {
  assert.ok(isNotePath('todo.md'))
  assert.ok(isNotePath('Work/todo.md'))
  assert.ok(isNotePath('A/B/C/D/todo.md'))
  assert.ok(!isNotePath('A/B/C/D/E/todo.md'), 'deeper than MAX_FOLDER_DEPTH')
  assert.ok(!isNotePath('../todo.md'))
  assert.ok(!isNotePath('Work/../todo.md'))
  assert.ok(!isNotePath('Work\\todo.md'))
  assert.ok(!isNotePath('/todo.md'))
  assert.ok(!isNotePath('Work//todo.md'))
  assert.ok(!isNotePath('.git/todo.md'))
  assert.ok(!isNotePath('Work/'))
  assert.ok(!isNotePath('C:/todo.md'))
  assert.ok(!isNotePath(null))
})

test('folder names follow Windows rules: no trailing dot or space, no device names', () => {
  assert.ok(isFolderName('Work'))
  assert.ok(isFolderName('Q3 (draft), v2'))
  for (const bad of ['', '.hidden', ' lead', 'trail ', 'trail.', 'a..b', 'CON', 'nul', 'com1', 'LPT9.txt', 'a/b', 'a\\b', 'x'.repeat(61)]) {
    assert.ok(!isFolderName(bad), bad)
  }
  assert.ok(!isNoteName('CON.md'), 'device names are reserved for files too')
  assert.ok(isFolderPath('Work/Plans'))
  assert.ok(!isFolderPath('Work/Plans/'))
  assert.equal(parentOf('Work/Plans/todo.md'), 'Work/Plans')
  assert.equal(parentOf('todo.md'), '')
})

test('a typed folder name is cleaned the way a note name is', () => {
  assert.equal(folderNameFor('  Client: GS / Q3  '), 'Client GS Q3')
  assert.equal(folderNameFor('ends with dots...'), 'ends with dots')
  assert.equal(folderNameFor('   '), undefined)
  assert.equal(folderNameFor('con'), undefined)
})

test('new folders are "New folder", then numbered, case-insensitively', () => {
  assert.equal(nextFolderName([]), 'New folder')
  assert.equal(nextFolderName(['new folder']), 'New folder 2')
  assert.equal(nextFolderName(['New folder', 'New folder 2']), 'New folder 3')
})

test('the tree nests folders (listed or implied), sorts them by name, and counts notes', () => {
  const tree = buildTree(
    [
      { name: 'root.md', mtime: 1 },
      { name: 'Work/b.md', mtime: 1 },
      { name: 'Work/a.md', mtime: 5 },
      { name: 'Work/Plans/p.md', mtime: 1 },
      { name: 'Ideas/x.md', mtime: 1 },
      { name: '../bad.md', mtime: 1 },
    ],
    ['Empty', 'Folder 10', 'Folder 2'],
  )
  assert.deepEqual(tree.notes.map((n) => n.name), ['root.md'])
  assert.deepEqual(tree.folders.map((f) => f.name), ['Empty', 'Folder 2', 'Folder 10', 'Ideas', 'Work'])
  const work = tree.folders.find((f) => f.name === 'Work')
  assert.deepEqual(work.notes.map((n) => n.name), ['Work/a.md', 'Work/b.md'])
  assert.deepEqual(work.folders.map((f) => f.path), ['Work/Plans'])
  assert.equal(work.count, 3)
  assert.equal(tree.count, 5)
  assert.equal(tree.folders[0].count, 0)
})

test('titles and template groups read the file name, not the folders', () => {
  assert.equal(noteTitle('Work/Plans/Meeting 2026-09-22.md'), 'Meeting 2026-09-22')
  assert.equal(noteGroup('Work/Meeting 2026-09-22.md'), 'meeting')
})

test('a new note in a folder is named for that folder', () => {
  const now = new Date(2026, 8, 22, 10).getTime()
  assert.deepEqual(planNewNote([], undefined, now, 'Work'), { name: 'Work/2026-09-22.md', body: '', exists: false })
  assert.equal(planNewNote(['Meeting 2026-09-22.md'], 'meeting', now, 'Work/Q3').name, 'Work/Q3/Meeting 2026-09-22-2.md')
  assert.deepEqual(planNewNote(['Daily 2026-09-22.md'], 'daily', now, 'Log'), { name: 'Log/Daily 2026-09-22.md', body: '', exists: true })
})

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
