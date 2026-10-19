import test from 'node:test'
import assert from 'node:assert/strict'
import { changeLines, changeSummary, countChanges, lineDiff, looksLikeUnifiedDiff, parseUnifiedDiff, splitLines, splitRows, wordDiff, filePatch, relTo } from './diff.mjs'

test('wordDiff marks only the words that changed inside a replaced line', () => {
  const { left, right } = wordDiff('const size = 12;', 'const size = 14;')
  assert.deepEqual(left, [{ text: 'const size = ', changed: false }, { text: '12', changed: true }, { text: ';', changed: false }])
  assert.deepEqual(right, [{ text: 'const size = ', changed: false }, { text: '14', changed: true }, { text: ';', changed: false }])
})

test('wordDiff treats a rewrite as one changed segment', () => {
  assert.deepEqual(wordDiff('alpha beta gamma', 'one two three four'), { left: [{ text: 'alpha beta gamma', changed: true }], right: [{ text: 'one two three four', changed: true }] })
  assert.deepEqual(wordDiff('', 'new'), { left: [], right: [{ text: 'new', changed: true }] })
})

const types = (lines) => lines.map((l) => `${l.type === 'eq' ? ' ' : l.type === 'del' ? '-' : l.type === 'add' ? '+' : '@'}${l.text}`)

test('splitLines drops one trailing newline and handles CRLF', () => {
  assert.deepEqual(splitLines('a\nb\n'), ['a', 'b'])
  assert.deepEqual(splitLines('a\r\nb'), ['a', 'b'])
  assert.deepEqual(splitLines(''), [])
  assert.deepEqual(splitLines('\n'), [''])
})

test('lineDiff keeps the shared head and tail and diffs the middle', () => {
  assert.deepEqual(types(lineDiff('a\nb\nc\nd', 'a\nB\nc\nd\ne')), [' a', '-b', '+B', ' c', ' d', '+e'])
  assert.deepEqual(types(lineDiff('', 'x\ny')), ['+x', '+y'])
  assert.deepEqual(types(lineDiff('x', '')), ['-x'])
  assert.deepEqual(types(lineDiff('same', 'same')), [' same'])
})

test('lineDiff finds a longest common subsequence in the middle', () => {
  assert.deepEqual(types(lineDiff('1\nx\n2\ny\n3', '1\n2\nz\n3')), [' 1', '-x', ' 2', '-y', '+z', ' 3'])
})

test('a diff too big for the table is everything removed then everything added', () => {
  assert.deepEqual(types(lineDiff('a\nb', 'c\nd', 1)), ['-a', '-b', '+c', '+d'])
})

test('parseUnifiedDiff drops file headers and keeps hunks as separators', () => {
  const d = 'diff --git a/x b/x\nindex 1..2\n--- a/x\n+++ b/x\n@@ -1,3 +1,3 @@\n keep\n-old\n+new\n\\ No newline at end of file\n'
  assert.ok(looksLikeUnifiedDiff(d))
  assert.ok(!looksLikeUnifiedDiff('plain file content\nline two'))
  assert.deepEqual(types(parseUnifiedDiff(d)), ['@@@ -1,3 +1,3 @@', ' keep', '-old', '+new'])
})

test('changeLines reads a pair, a unified diff, or a whole added or deleted file', () => {
  assert.deepEqual(types(changeLines({ before: 'a', after: 'b' })), ['-a', '+b'])
  assert.deepEqual(types(changeLines({ diff: '@@ -1 +1 @@\n-a\n+b' })), ['@@@ -1 +1 @@', '-a', '+b'])
  assert.deepEqual(types(changeLines({ kind: 'add', diff: 'one\ntwo\n' })), ['+one', '+two'])
  assert.deepEqual(types(changeLines({ kind: 'delete', diff: 'gone' })), ['-gone'])
})

test('splitRows pairs a removed run with the added run after it', () => {
  const rows = splitRows(lineDiff('a\nb\nc\nz', 'a\nB\nC\nD\nz'))
  assert.deepEqual(rows.map((r) => [r.left?.text ?? null, r.right?.text ?? null]), [['a', 'a'], ['b', 'B'], ['c', 'C'], [null, 'D'], ['z', 'z']])
  assert.deepEqual(splitRows([{ type: 'hunk', text: '@@ -1 +1 @@' }]), [{ left: null, right: null, hunk: '@@ -1 +1 @@' }])
})

test('the summary counts real changes in the extension words', () => {
  assert.equal(changeSummary(countChanges(lineDiff('a\nb', 'a\nB\nc'))), 'Added 2 lines, removed 1 line')
  assert.equal(changeSummary(countChanges(lineDiff('a', 'a\nb'))), 'Added 1 line')
  assert.equal(changeSummary(countChanges(lineDiff('a\nb', 'a'))), 'Removed 1 line')
  assert.equal(changeSummary({ added: 0, removed: 0 }), 'Modified')
})

test('filePatch builds what git apply reads for a Codex turn’s Undo', () => {
  assert.equal(relTo('C:\\p\\src\\a.ts', 'c:\\P\\'), 'src/a.ts')
  assert.equal(relTo('D:\\x\\a.ts', 'C:\\p'), 'D:/x/a.ts')
  assert.equal(filePatch('src/a.ts', 'update', '@@ -1 +1 @@\n-a\n+b'), 'diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1 +1 @@\n-a\n+b\n')
  assert.equal(filePatch('n.md', 'add', 'one\ntwo\n'), 'diff --git a/n.md b/n.md\nnew file mode 100644\n--- /dev/null\n+++ b/n.md\n@@ -0,0 +1,2 @@\n+one\n+two\n')
  assert.match(filePatch('old.md', 'delete', 'x'), /deleted file mode 100644\n--- a\/old.md\n\+\+\+ \/dev\/null\n@@ -1,1 \+0,0 @@\n-x\n/)
  assert.equal(filePatch('a', 'update', 'not a diff'), null)
  assert.equal(filePatch('', 'update', '@@ -1 +1 @@'), null)
})
