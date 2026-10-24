import test from 'node:test'
import assert from 'node:assert/strict'
import { MAX_FOLDERS, folderLabel, forgetFolder, rememberFolder, sanitizeFolderConfig, sanitizeFolders, whenLabel } from './startPage.mjs'

test('sanitizeFolderConfig takes an absolute folder path and drops a trailing separator', () => {
  assert.deepEqual(sanitizeFolderConfig({ path: 'C:\\Users\\x\\proj\\' }), { path: 'C:\\Users\\x\\proj' })
  assert.deepEqual(sanitizeFolderConfig({ path: 'C:\\' }), { path: 'C:\\' }, 'a drive root keeps its backslash')
  assert.equal(sanitizeFolderConfig({ path: 'proj' }), null)
  assert.equal(sanitizeFolderConfig({ path: 'C:\\a\nb' }), null)
  assert.equal(sanitizeFolderConfig(null), null)
})

test('folderLabel is the last segment', () => {
  assert.equal(folderLabel('C:\\Users\\x\\site-tools\\'), 'site-tools')
  assert.equal(folderLabel('/home/x/app'), 'app')
  assert.equal(folderLabel('C:\\'), 'C:')
})

test('rememberFolder puts a folder on top once, keeps its label, and caps the list', () => {
  let list = rememberFolder([], 'C:\\p\\a', 10, 'A')
  list = rememberFolder(list, 'C:\\p\\b', 20)
  list = rememberFolder(list, 'c:/p/A/', 30)
  assert.deepEqual(list, [{ cwd: 'c:/p/A', label: 'A', at: 30 }, { cwd: 'C:\\p\\b', label: 'b', at: 20 }])
  assert.equal(rememberFolder(list, 'nope', 40), list, 'not a folder path: the same list')
  for (let i = 0; i < MAX_FOLDERS + 5; i++) list = rememberFolder(list, `C:\\p\\f${i}`, 100 + i)
  assert.equal(list.length, MAX_FOLDERS)
  assert.equal(list[0].cwd, `C:\\p\\f${MAX_FOLDERS + 4}`)
})

test('forgetFolder drops a folder and returns the same list when it is absent', () => {
  const list = rememberFolder([], 'C:\\p\\a', 10)
  assert.deepEqual(forgetFolder(list, 'c:/p/a'), [])
  assert.equal(forgetFolder(list, 'C:\\p\\z'), list)
})

test('sanitizeFolders folds duplicates to the newest, drops junk, sorts newest first', () => {
  const out = sanitizeFolders([
    { cwd: 'C:\\p\\a', label: 'A', at: 5 }, { cwd: 'c:/p/a/', at: 9 }, { cwd: 'relative', at: 3 }, 'x', { cwd: 'C:\\p\\b', at: 'soon' }
  ])
  assert.deepEqual(out, [{ cwd: 'c:/p/a', label: 'a', at: 9 }, { cwd: 'C:\\p\\b', label: 'b', at: 0 }])
  assert.deepEqual(sanitizeFolders('nope'), [])
})

test('whenLabel reads as the recents list does', () => {
  const now = Date.UTC(2026, 9, 22, 12, 0, 0)
  assert.equal(whenLabel(now - 10_000, now), 'Just now')
  assert.equal(whenLabel(now - 12 * 60_000, now), '12m')
  assert.equal(whenLabel(now - 3 * 3_600_000, now), '3h')
  assert.match(whenLabel(now - 3 * 86_400_000, now), /^Oct \d+$/)
  assert.equal(whenLabel(0, now), '')
})
