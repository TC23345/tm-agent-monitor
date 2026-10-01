import test from 'node:test'
import assert from 'node:assert/strict'
import { MAX_EDIT_FILES, editedFile, editedText, foldEdit } from './activityFeed.mjs'

const edit = (at, activity, agentId = 'claude:s') => ({ at, agentId, provider: 'claude', project: 'api', cwd: 'C:\\p\\api', activity })

test('editedFile reads the bridge activity, nothing else', () => {
  assert.equal(editedFile('editing App.tsx'), 'App.tsx')
  assert.equal(editedFile('  editing my file.md '), 'my file.md')
  assert.equal(editedFile('reading App.tsx'), undefined)
  assert.equal(editedFile('editing '), undefined)
  assert.equal(editedFile(undefined), undefined)
})

test('editedText names the newest two files and counts the rest', () => {
  assert.equal(editedText(['a.ts'], 1), 'edited a.ts')
  assert.equal(editedText(['a.ts', 'b.ts'], 4), 'edited a.ts, b.ts')
  assert.equal(editedText(['a.ts', 'b.ts', 'c.ts', 'd.ts'], 4), 'edited a.ts, b.ts +2 more')
  assert.equal(editedText([], 1), 'made an edit')
  assert.equal(editedText([], 3), 'made 3 edits')
})

test('foldEdit extends the session’s open row and moves it to the end', () => {
  const ring = [{ at: 1, kind: 'started', agentId: 'claude:s', provider: 'claude', project: 'api' }]
  foldEdit(ring, edit(2, 'editing a.ts'))
  ring.push({ at: 3, kind: 'waiting', agentId: 'codex:x', provider: 'codex', project: 'web' })
  foldEdit(ring, edit(4, 'editing b.ts'))
  foldEdit(ring, edit(5, 'editing a.ts'))  // a re-edit moves to the front, not a duplicate
  foldEdit(ring, edit(6, undefined))       // an edit with no file still counts
  assert.deepEqual(ring.map((e) => `${e.kind}@${e.at}`), ['started@1', 'waiting@3', 'edited@6'])
  const row = ring[2]
  assert.deepEqual(row.files, ['a.ts', 'b.ts'])
  assert.equal(row.count, 4)
  assert.equal(row.text, 'edited a.ts, b.ts')
})

test('foldEdit starts a new row once the session did something else, and per session', () => {
  const ring = []
  foldEdit(ring, edit(1, 'editing a.ts'))
  ring.push({ at: 2, kind: 'finished', agentId: 'claude:s', provider: 'claude', project: 'api' })
  foldEdit(ring, edit(3, 'editing b.ts'))
  foldEdit(ring, edit(4, 'editing c.ts', 'claude:other'))
  assert.deepEqual(ring.map((e) => `${e.kind}:${e.agentId}@${e.at}`), [
    'edited:claude:s@1', 'finished:claude:s@2', 'edited:claude:s@3', 'edited:claude:other@4'
  ])
})

test('foldEdit keeps at most the newest file names', () => {
  const ring = []
  for (let i = 0; i < MAX_EDIT_FILES + 5; i++) foldEdit(ring, edit(i, `editing f${i}.ts`))
  assert.equal(ring.length, 1)
  assert.equal(ring[0].files.length, MAX_EDIT_FILES)
  assert.equal(ring[0].files[0], `f${MAX_EDIT_FILES + 4}.ts`)
  assert.equal(ring[0].count, MAX_EDIT_FILES + 5)
})
