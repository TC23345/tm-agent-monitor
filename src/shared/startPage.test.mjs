import test from 'node:test'
import assert from 'node:assert/strict'
import { MAX_FOLDERS, TREE_DEFAULT, TREE_MAX, TREE_MIN, WORK_MIN, clampTreeWidth, folderLabel, forgetFolder, pillLines, rememberFolder, sanitizeFolderConfig, sanitizeFolders, streamDuration, streamedLines, whenLabel } from './startPage.mjs'

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

test('sanitizeFolderConfig keeps a dragged tree width, clamped, and drops a bad one', () => {
  const p = 'C:\\p'
  assert.deepEqual(sanitizeFolderConfig({ path: p, tree: 300.4 }), { path: p, tree: 300 })
  assert.deepEqual(sanitizeFolderConfig({ path: p, tree: 5 }), { path: p, tree: TREE_MIN })
  assert.deepEqual(sanitizeFolderConfig({ path: p, tree: 99999 }), { path: p, tree: TREE_MAX })
  assert.deepEqual(sanitizeFolderConfig({ path: p, tree: 'wide' }), { path: p })
})

test('clampTreeWidth leaves the session its least width, then the tree its own', () => {
  assert.equal(clampTreeWidth(Number.NaN), TREE_DEFAULT)
  assert.equal(clampTreeWidth(600, 800), 800 - WORK_MIN)
  assert.equal(clampTreeWidth(600, 300), TREE_MIN, 'a pane too narrow for both keeps the tree at its least')
  assert.equal(clampTreeWidth(250, 2000), 250)
})

test('pillLines names the folder and offers both pills', () => {
  const lines = pillLines('claude-watch')
  assert.match(lines[0], /claude-watch has you/)
  assert.ok(lines.some((l) => /red pill — Claude Code/.test(l)))
  assert.ok(lines.some((l) => /blue pill — Codex/.test(l)))
  assert.match(pillLines('  ')[0], /this folder/)
})

test('streamedLines types a line at a time with a pause between, and ends done', () => {
  const lines = ['abc', 'de']
  assert.deepEqual(streamedLines(lines, 0, 10, 100), { shown: [''], current: 0, done: false })
  assert.deepEqual(streamedLines(lines, 25, 10, 100), { shown: ['ab'], current: 0, done: false })
  assert.deepEqual(streamedLines(lines, 30, 10, 100), { shown: ['abc'], current: 1, done: false }, 'the pause before the next line')
  assert.deepEqual(streamedLines(lines, 140, 10, 100), { shown: ['abc', 'd'], current: 1, done: false })
  assert.equal(streamDuration(lines, 10, 100), 150)
  assert.deepEqual(streamedLines(lines, 150, 10, 100), { shown: ['abc', 'de'], current: -1, done: true })
  assert.deepEqual(streamedLines(lines, -5, 10, 100).shown, [''])
})
