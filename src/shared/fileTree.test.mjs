import test from 'node:test'
import assert from 'node:assert/strict'
import { MAX_DIR_ENTRIES, baseName, extOf, fileKind, hasNul, imageMime, isAbsolutePath, parentDir, parseFileList, sanitizeFileConfig, sortEntries } from './fileTree.mjs'

test('the chat @ picker reads git’s file list: relative, forward slashes, nothing ignored, bounded', () => {
  const out = parseFileList('src/a.ts\r\nsrc\\ui\\b.tsx\n\nnode_modules/x/index.js\n"odd\\tname.txt"\nREADME.md\n')
  assert.deepEqual(out, ['src/a.ts', 'src/ui/b.tsx', 'README.md'])
  assert.deepEqual(parseFileList('a\nb\nc\n', 2), ['a', 'b'])
})

test('entries sort folders first in a natural, case-insensitive order and drop the ignored folders', () => {
  const sorted = sortEntries([
    { name: 'zeta.ts', kind: 'file' }, { name: 'src', kind: 'dir' }, { name: 'node_modules', kind: 'dir' }, { name: 'Alpha.md', kind: 'file' },
    { name: '.git', kind: 'dir' }, { name: 'file10.txt', kind: 'file' }, { name: 'file2.txt', kind: 'file' }, { name: 'Docs', kind: 'dir' },
    { name: '.github', kind: 'dir' }, { name: 'node_modules', kind: 'file' }, { name: 7, kind: 'file' }, null, { name: 'x', kind: 'link' }
  ])
  assert.deepEqual(sorted.map((e) => e.name), ['.github', 'Docs', 'src', 'Alpha.md', 'file2.txt', 'file10.txt', 'node_modules', 'zeta.ts'])
  assert.equal(sortEntries(null).length, 0)
  assert.ok(MAX_DIR_ENTRIES >= 100)
})

test('names: extension, base name and parent on either separator', () => {
  assert.equal(extOf('C:\\p\\README.MD'), 'md')
  assert.equal(extOf('/p/.env'), '', 'a leading dot is not an extension')
  assert.equal(extOf('Makefile'), '')
  assert.equal(baseName('C:\\Users\\me\\Projects\\app\\'), 'app')
  assert.equal(baseName('/a/b/c.txt'), 'c.txt')
  assert.equal(parentDir('C:\\Users\\me\\Projects\\app\\src\\index.ts'), 'C:\\Users\\me\\Projects\\app\\src')
  assert.equal(parentDir('/a/b/c.txt'), '/a/b')
  assert.equal(parentDir('C:\\file.txt'), 'C:\\', 'the drive root keeps its slash')
  assert.equal(parentDir('/c.txt'), '/c.txt', 'no parent to speak of')
})

test('kinds: images by extension, Markdown by the notes rule, everything else text until its bytes say binary', () => {
  assert.equal(imageMime('shot.PNG'), 'image/png')
  assert.equal(imageMime('a.svg'), 'image/svg+xml')
  assert.equal(imageMime('a.ts'), null)
  assert.equal(fileKind('logo.webp'), 'image')
  assert.equal(fileKind('C:\\p\\README.md'), 'markdown')
  assert.equal(fileKind('index.ts'), 'text')
  assert.equal(fileKind('app.exe'), 'text', 'the name does not decide binary')
  assert.equal(hasNul(new Uint8Array([104, 105, 0, 1])), true)
  assert.equal(hasNul(new Uint8Array([104, 105])), false)
  assert.equal(hasNul(null), false)
})

test('a file pane config is an absolute path to a file; anything else drops', () => {
  assert.deepEqual(sanitizeFileConfig({ path: ' C:\\p\\a.ts ' }), { path: 'C:\\p\\a.ts' })
  assert.deepEqual(sanitizeFileConfig({ path: '/home/me/a.ts' }), { path: '/home/me/a.ts' })
  assert.deepEqual(sanitizeFileConfig({ path: '\\\\server\\share\\a.ts' }), { path: '\\\\server\\share\\a.ts' })
  for (const bad of [{ path: 'a.ts' }, { path: 'C:\\p\\' }, { path: 'C:\\p\\a\nb' }, { path: '' }, { path: 12 }, null, 'C:\\p\\a.ts']) assert.equal(sanitizeFileConfig(bad), null, JSON.stringify(bad))
  assert.ok(isAbsolutePath('D:/x'))
  assert.ok(!isAbsolutePath('x/y'))
  assert.ok(!isAbsolutePath('C:' + '\\x'.repeat(3000)), 'bounded')
})
