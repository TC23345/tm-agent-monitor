import test from 'node:test'
import assert from 'node:assert/strict'
import { BUILTIN_STYLES, PREVIEW_LINES, duplicateStyle, parseStyleFile, previewLines, styleCatalog, styleKey } from './outputStyles.mjs'

test('styleKey: one spelling for a name, a file name or a slug', () => {
  assert.equal(styleKey('Bullet Points'), 'bulletpoints')
  assert.equal(styleKey('bullet-points.md'), 'bulletpoints')
  assert.equal(styleKey('bullet_points'), 'bulletpoints')
  assert.equal(styleKey(undefined), '')
})

test('parseStyleFile: frontmatter name and description, the file name when there is no name', () => {
  const p = parseStyleFile('---\nname: Bullet Points\ndescription: "Hierarchical bullets"\nkeep-coding-instructions: true\n---\n\nStructure all responses…\n', 'C:\\u\\.claude\\output-styles\\bullet-points.md')
  assert.deepEqual(p, { name: 'Bullet Points', description: 'Hierarchical bullets', keepCoding: true, body: 'Structure all responses…\n' })
  const q = parseStyleFile('---\r\ndescription: Report\r\n---\r\n# Technical Report\r\n', '/home/u/.claude/output-styles/technical-report.md')
  assert.equal(q.name, 'technical-report')
  assert.equal(q.description, 'Report')
  assert.equal(q.keepCoding, false)
  assert.equal(q.body, '# Technical Report\n')
  assert.deepEqual(parseStyleFile('just text', 'plain.md'), { name: 'plain', description: '', keepCoding: false, body: 'just text' })
})

test('previewLines: the first lines with text, cut to a width', () => {
  assert.deepEqual(previewLines('\n\n# A\n\nb  \n\nc'), ['# A', 'b', 'c'])
  assert.equal(previewLines('x'.repeat(200))[0].length, 120)
  assert.equal(previewLines(Array.from({ length: 20 }, (_, i) => `l${i}`).join('\n')).length, PREVIEW_LINES)
  assert.deepEqual(previewLines(undefined), [])
})

test('styleCatalog: built-ins by name, files by frontmatter name then file name, in the listed order', () => {
  const files = [
    { path: 'C:\\p\\.claude\\output-styles\\table-based.md', text: '---\nname: Table Based\ndescription: project copy\n---\nproject body' },
    { path: 'C:\\u\\.claude\\output-styles\\table-based.md', text: '---\nname: Table Based\ndescription: user copy\n---\nuser body' },
    { path: 'C:\\u\\.claude\\output-styles\\technical-report.md', text: '---\ndescription: Report format\n---\n# Technical Report\n\nStructure…' }
  ]
  const rows = styleCatalog(['default', 'Explanatory', 'Table Based', 'technical-report', 'Learning', 'plugin-style'], files)
  assert.deepEqual(rows.map((r) => r.name), ['default', 'Explanatory', 'Table Based', 'technical-report', 'Learning', 'plugin-style'])
  assert.deepEqual(rows[0], { name: 'default', description: BUILTIN_STYLES[0].description, builtin: true })
  assert.equal(rows[1].builtin, true)
  assert.deepEqual(rows[2], { name: 'Table Based', description: 'project copy', path: files[0].path, builtin: false, preview: ['project body'] }, 'the project file shadows the user file')
  assert.deepEqual(rows[3], { name: 'technical-report', description: 'Report format', path: files[2].path, builtin: false, preview: ['# Technical Report', 'Structure…'] })
  assert.deepEqual(rows[5], { name: 'plugin-style', builtin: false }, 'a listed style with no file is still a row')
  assert.deepEqual(styleCatalog([], files), [])
  assert.deepEqual(styleCatalog(undefined, undefined), [])
})

test('duplicateStyle: a built-in becomes a file carrying its description and what it does; nothing else does', () => {
  const d = duplicateStyle('Explanatory')
  assert.equal(d.fileName, 'explanatory-copy.md')
  const p = parseStyleFile(d.text, d.fileName)
  assert.equal(p.name, 'Explanatory (copy)')
  assert.equal(p.description, BUILTIN_STYLES[1].description)
  assert.equal(p.keepCoding, true)
  assert.match(p.body, /^# Explanatory \(copy\)\n/)
  assert.match(p.body, /★ Insight/)
  assert.equal(duplicateStyle('default').fileName, 'default-copy.md')
  assert.equal(parseStyleFile(duplicateStyle('default').text, 'x').name, 'Default (copy)')
  assert.match(duplicateStyle('learning').text, /TODO\(human\)/)
  assert.equal(duplicateStyle('Bullet Points'), null)
  assert.equal(duplicateStyle(''), null)
})
