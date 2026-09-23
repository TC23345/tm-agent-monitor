import test from 'node:test'
import assert from 'node:assert/strict'
import {
  applyOrder, buildTree, displayTitle, folderNameFor, isFolderName, isFolderPath, isNoteName, isNotePath, migrationPlan,
  moveProblem, nextFolderName, nextNoteName, noteHeading, noteNameFor, notePreview, noteTitle, orderAfterMove,
  orderAfterRemove, parentOf, planNewNote, sanitizeOrder, sortNotes, subtreeDepth, templateForFolder, NOTE_TEMPLATES
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
  assert.ok(!isNotePath('.tm-order.json'))
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

test('a saved order rearranges a folder; anything it does not name comes first', () => {
  const tree = buildTree(
    [{ name: 'a.md', mtime: 3 }, { name: 'b.md', mtime: 2 }, { name: 'c.md', mtime: 1 }, { name: 'new.md', mtime: 0 }],
    ['Alpha', 'Beta', 'Gamma'],
    { '': ['c.md', 'a.md', 'b.md', 'Gamma', 'Alpha', 'Beta'] },
  )
  assert.deepEqual(tree.folders.map((f) => f.name), ['Gamma', 'Alpha', 'Beta'])
  assert.deepEqual(tree.notes.map((n) => n.name), ['new.md', 'c.md', 'a.md', 'b.md'])
  assert.deepEqual(applyOrder(['x', 'y'], undefined), ['x', 'y'])
  assert.deepEqual(applyOrder(['x', 'Y', 'z'], ['y', 'x']), ['z', 'Y', 'x'], 'names match case-insensitively')
})

test('template folders: the top-level Daily/Meetings/Plans/Prompts and everything inside them', () => {
  assert.equal(templateForFolder('Plans')?.id, 'plan')
  assert.equal(templateForFolder('plans/Q3/drafts')?.id, 'plan')
  assert.equal(templateForFolder('Work/Plans'), undefined, 'only a top-level folder is a template folder')
  assert.equal(templateForFolder(''), undefined)
  assert.deepEqual(NOTE_TEMPLATES.map((t) => t.label), ['Daily', 'Meetings', 'Plans', 'Prompts'])
})

test('a new note: dated, in its template folder, from the folder template when none is given', () => {
  const now = new Date(2026, 8, 23, 10).getTime()
  // A template with no folder goes to its template folder.
  const plan = planNewNote([], 'plan', now)
  assert.equal(plan.name, 'Plans/2026-09-23.md')
  assert.equal(plan.folder, 'Plans')
  assert.match(plan.body, /^# Plan — 2026-09-23/)
  // A plain "New note" inside a template folder (or below it) uses that template.
  assert.match(planNewNote([], undefined, now, 'Prompts/Agents').body, /^# Prompt — /)
  assert.equal(planNewNote(['2026-09-23.md'], undefined, now, 'Prompts/Agents').name, 'Prompts/Agents/2026-09-23-2.md')
  // A plain note anywhere else is blank.
  assert.deepEqual(planNewNote([], undefined, now, 'Work'), { name: 'Work/2026-09-23.md', body: '', exists: false, folder: 'Work' })
  assert.deepEqual(planNewNote([], undefined, now), { name: '2026-09-23.md', body: '', exists: false, folder: '' })
  // An explicit folder wins over the template's own folder.
  assert.equal(planNewNote([], 'meeting', now, 'Work').name, 'Work/2026-09-23.md')
  assert.equal(planNewNote([], 'nope', now).name, '2026-09-23.md')
  for (const t of NOTE_TEMPLATES) assert.ok(isNotePath(planNewNote([], t.id, now).name), t.id)
})

test('a once-a-day template opens today\'s note instead of making another', () => {
  const now = new Date(2026, 8, 23, 10).getTime()
  assert.deepEqual(planNewNote(['2026-09-23.md'], 'daily', now), { name: 'Daily/2026-09-23.md', body: '', exists: true, folder: 'Daily' })
  assert.equal(planNewNote(['2026-09-22.md'], 'daily', now).name, 'Daily/2026-09-23.md')
})

test('the row title is the H1 without the template lead-in, else the file name', () => {
  assert.equal(noteHeading('# Plan — Clipboard\n\n## Goal'), 'Plan — Clipboard')
  assert.equal(noteHeading('intro\n\n# Title #'), 'Title')
  assert.equal(noteHeading('## only h2'), '')
  assert.equal(displayTitle('Plans/2026-09-23.md', 'Plan — Clipboard manager'), 'Clipboard manager')
  assert.equal(displayTitle('Plans/2026-09-23.md', 'Plan — 2026-09-23'), '2026-09-23')
  assert.equal(displayTitle('Prompts/2026-09-22-3.md', 'Prompt — 2026-09-22'), '2026-09-22-3', 'same-day notes stay distinct')
  assert.equal(displayTitle('Prompts/idea.md', 'Prompt — 2026-09-22'), '2026-09-22')
  assert.equal(displayTitle('Work/ideas.md', 'Ideas for Q4'), 'Ideas for Q4')
  assert.equal(displayTitle('Work/ideas.md', ''), 'ideas')
  assert.equal(displayTitle('Work/ideas.md', 'Plan —  '), 'ideas')
})

test('the preview skips headings and a template\'s empty bullets, so a fresh note is one line', () => {
  const fresh = NOTE_TEMPLATES.find((t) => t.id === 'meeting').body('2026-09-23')
  assert.equal(notePreview(fresh), '')
  for (const t of NOTE_TEMPLATES) assert.equal(notePreview(t.body('2026-09-23')), '', t.id)
  assert.equal(notePreview('# Plan\n\n## Goal\n\nShip the clipboard pane\n'), 'Ship the clipboard pane')
  assert.equal(notePreview('# M\n\n**With:** \n\n- [ ] call **Taegan**'), 'call Taegan')
  assert.equal(notePreview('# x\n\n1. first step'), 'first step')
  assert.equal(notePreview('x'.repeat(100), 20), 'x'.repeat(19) + '…')
  assert.equal(notePreview(''), '')
})

test('migration moves prefixed top-level notes into template folders, never over a name', () => {
  const plan = migrationPlan(
    ['Plan Clipboard design.md', 'plan fix eval set.md', 'Prompt 2026-09-22.md', 'Daily 2026-09-22.md', 'todo.md', 'Planning.md', 'Meeting .md'],
    { Plans: ['Clipboard design.md'] },
  )
  // `Planning.md` has no "Plan " prefix; `Meeting .md` is not a valid note name at all.
  assert.deepEqual(plan, [
    { from: 'Plan Clipboard design.md', to: 'Plans/Clipboard design (2).md' },
    { from: 'plan fix eval set.md', to: 'Plans/fix eval set.md' },
    { from: 'Prompt 2026-09-22.md', to: 'Prompts/2026-09-22.md' },
    { from: 'Daily 2026-09-22.md', to: 'Daily/2026-09-22.md' },
  ])
  assert.deepEqual(migrationPlan([]), [])
})

test('a saved order is sanitized: bad keys, bad names, and duplicates dropped', () => {
  assert.deepEqual(sanitizeOrder({ '': ['a.md', 'a.md', 'Work', '../x.md', 7], Work: ['b.md'], '../up': ['c.md'], Empty: [] }), { '': ['a.md', 'Work'], Work: ['b.md'] })
  assert.deepEqual(sanitizeOrder(null), {})
  assert.deepEqual(sanitizeOrder([1, 2]), {})
})

test('reordering within a folder puts the entry at the drop index', () => {
  const visible = ['a.md', 'b.md', 'c.md']
  assert.deepEqual(orderAfterMove({}, 'c.md', 'c.md', 0, visible), { '': ['c.md', 'a.md', 'b.md'] })
  assert.deepEqual(orderAfterMove({}, 'a.md', 'a.md', 2, visible), { '': ['b.md', 'c.md', 'a.md'] })
})

test('a rename in place keeps its slot; a folder rename carries its own order along', () => {
  const order = { '': ['Work', 'x.md'], Work: ['b.md', 'a.md'], 'Work/Q3': ['z.md'] }
  assert.deepEqual(orderAfterMove(order, 'x.md', 'y.md'), { '': ['Work', 'y.md'], Work: ['b.md', 'a.md'], 'Work/Q3': ['z.md'] })
  assert.deepEqual(orderAfterMove(order, 'Work', 'Jobs'), { '': ['Jobs', 'x.md'], Jobs: ['b.md', 'a.md'], 'Jobs/Q3': ['z.md'] })
})

test('moving into another folder removes it from the old one and places it at the index', () => {
  const order = { '': ['x.md', 'y.md'], Work: ['b.md', 'a.md'] }
  assert.deepEqual(orderAfterMove(order, 'x.md', 'Work/x.md', 1, ['b.md', 'a.md']), { '': ['y.md'], Work: ['b.md', 'x.md', 'a.md'] })
  // Without an index it lands unplaced, which the tree shows first.
  assert.deepEqual(orderAfterMove(order, 'x.md', 'Work/x.md'), { '': ['y.md'], Work: ['b.md', 'a.md'] })
})

test('deleting drops the entry from its folder and a folder\'s own keys', () => {
  const order = { '': ['Work', 'x.md'], Work: ['a.md'], 'Work/Q3': ['z.md'] }
  assert.deepEqual(orderAfterRemove(order, 'x.md'), { '': ['Work'], Work: ['a.md'], 'Work/Q3': ['z.md'] })
  assert.deepEqual(orderAfterRemove(order, 'Work'), { '': ['x.md'] })
})

test('moves that cannot happen say why; a same-folder move is a reorder, not an error', () => {
  assert.equal(moveProblem('Work', 'Work', true), 'A folder cannot go inside itself')
  assert.equal(moveProblem('Work', 'Work/Q3', true), 'A folder cannot go inside itself')
  assert.equal(moveProblem('Work', 'Workshop', true), null, 'a sibling that shares a prefix is fine')
  assert.equal(moveProblem('A', 'B/C/D', true, 0), null)
  assert.equal(moveProblem('A', 'B/C/D', true, 1), 'Folders nest 4 deep at most')
  assert.equal(moveProblem('Work/a.md', 'Work', false), null)
  assert.equal(moveProblem('a.md', '../x', false), 'Not a folder')
  assert.equal(moveProblem('../a.md', '', false), 'Not a note or folder')
  assert.equal(subtreeDepth('Work', ['Work', 'Work/Q3', 'Work/Q3/Drafts', 'Workshop/x']), 2)
  assert.equal(subtreeDepth('Empty', ['Empty']), 0)
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
  assert.equal(noteTitle('Work/Plans/Meeting 2026-09-22.md'), 'Meeting 2026-09-22')
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
