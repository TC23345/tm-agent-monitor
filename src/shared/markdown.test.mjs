import test from 'node:test'
import assert from 'node:assert/strict'
import { parseInline, parseMarkdown } from './markdown.mjs'

const t = (text) => ({ type: 'text', text })

test('blocks: headings, paragraphs joined across lines, rules, quotes, fences', () => {
  const tree = parseMarkdown('# Title\n\nfirst line\nsecond line\n\n---\n\n> quoted\n> more\n\n```js\nconst x = 1\n```\n')
  assert.deepEqual(tree, [
    { type: 'heading', level: 1, children: [t('Title')] },
    { type: 'paragraph', children: [t('first line second line')] },
    { type: 'hr' },
    { type: 'quote', children: [{ type: 'paragraph', children: [t('quoted more')] }] },
    { type: 'code', lang: 'js', text: 'const x = 1' }
  ])
})

test('an unterminated fence runs to the end instead of swallowing nothing', () => {
  assert.deepEqual(parseMarkdown('```\nraw *stars* stay\n'), [{ type: 'code', lang: '', text: 'raw *stars* stay' }])
})

test('lists: bullets, numbers with a start, task boxes, and nesting by indent', () => {
  const tree = parseMarkdown('- one\n- [ ] todo\n- [x] done\n  - nested\n  - deeper\n\n3. three\n4. four')
  assert.equal(tree.length, 2)
  const [bullets, numbers] = tree
  assert.equal(bullets.ordered, false)
  assert.deepEqual(bullets.items.map((i) => i.checked), [null, false, true])
  assert.equal(bullets.items[2].children.length, 2, 'the checked item carries the nested list')
  assert.equal(bullets.items[2].children[1].type, 'list')
  assert.deepEqual(bullets.items[2].children[1].items.map((i) => i.children[0].children[0].text), ['nested', 'deeper'])
  assert.equal(numbers.ordered, true)
  assert.equal(numbers.start, 3)
  assert.equal(numbers.items.length, 2)
})

test('inline: code hides everything, emphasis nests, strikethrough, escapes', () => {
  assert.deepEqual(parseInline('a `*b*` c'), [t('a '), { type: 'code', text: '*b*' }, t(' c')])
  assert.deepEqual(parseInline('**bold _in_ side**'), [{ type: 'strong', children: [t('bold '), { type: 'em', children: [t('in')] }, t(' side')] }])
  assert.deepEqual(parseInline('~~gone~~'), [{ type: 'del', children: [t('gone')] }])
  assert.deepEqual(parseInline('\\*not em\\*'), [t('*not em*')])
  assert.deepEqual(parseInline('snake_case_name stays'), [t('snake_case_name stays')])
})

test('links: only http, https, and mailto survive; bare URLs autolink', () => {
  assert.deepEqual(parseInline('[docs](https://x.test/a)'), [{ type: 'link', href: 'https://x.test/a', children: [t('docs')] }])
  assert.deepEqual(parseInline('[bad](javascript:alert(1))'), [t('bad')])
  assert.deepEqual(parseInline('[bad](data:text/html,x)'), [t('bad')])
  assert.deepEqual(parseInline('see https://x.test/p?q=1.'), [t('see '), { type: 'link', href: 'https://x.test/p?q=1', children: [t('https://x.test/p?q=1')] }, t('.')])
  assert.deepEqual(parseInline('<https://x.test>'), [{ type: 'link', href: 'https://x.test', children: [t('https://x.test')] }])
})

test('tables: a header, a delimiter row with alignments, inline Markdown in cells (a Claude Code reply)', () => {
  const reply = '**The 6 open tasks:**\n\n| Task | What to do |\n| --- | --- |\n| Set up data collection | **Nothing.** Data is flowing. |\n| Turn on Google signals | **Skip.** It links visitors. |\n\n**The gap:**'
  const tree = parseMarkdown(reply)
  assert.equal(tree.length, 3)
  assert.deepEqual(tree[1], {
    type: 'table',
    align: [null, null],
    head: [[t('Task')], [t('What to do')]],
    rows: [
      [[t('Set up data collection')], [{ type: 'strong', children: [t('Nothing.')] }, t(' Data is flowing.')]],
      [[t('Turn on Google signals')], [{ type: 'strong', children: [t('Skip.')] }, t(' It links visitors.')]]
    ]
  })
  assert.equal(tree[2].type, 'paragraph')
  assert.deepEqual(parseMarkdown('a | b | c\n:-- | :-: | --:\n1 | 2 | 3')[0].align, ['left', 'center', 'right'], 'outer pipes are optional')
})

test('tables: interrupt a paragraph, keep escaped pipes, pad and cut ragged rows, end at a blank line or a block', () => {
  const tree = parseMarkdown('Intro line\n| a | b |\n|---|---|\n| x \\| y |\n| 1 | 2 | 3 |\nlazy row\n\nafter')
  assert.deepEqual(tree.map((n) => n.type), ['paragraph', 'table', 'paragraph'])
  const table = tree[1]
  assert.deepEqual(table.rows, [
    [[t('x | y')], []],
    [[t('1')], [t('2')]],
    [[t('lazy row')], []]
  ])
  assert.equal(parseMarkdown('| a | b |\n| --- | --- |\n# Heading')[1].type, 'heading', 'a heading ends the table')
  assert.equal(parseMarkdown('| a | b |\n| --- |')[0].type, 'paragraph', 'the delimiter row must have as many cells as the header')
  assert.equal(parseMarkdown('a | b\nno delimiter here')[0].type, 'paragraph')
  assert.deepEqual(parseMarkdown('| only | head |\n|:--|--|')[0].rows, [], 'a header alone is a table with no body')
})

test('nothing in a note becomes markup: tags are text', () => {
  const tree = parseMarkdown('<script>alert(1)</script> and <b>bold</b>')
  assert.deepEqual(tree, [{ type: 'paragraph', children: [t('<script>alert(1)</script> and <b>bold</b>')] }])
})

// ---- a chat reply's options (0.4.68) ----
const CHAT = { breaks: true, math: true, paths: true }

test('breaks: a reply keeps its line breaks; a note still joins them', () => {
  assert.deepEqual(parseMarkdown('line one\nline two', CHAT), [{ type: 'paragraph', children: [t('line one\nline two')] }])
  assert.deepEqual(parseMarkdown('line one\nline two'), [{ type: 'paragraph', children: [t('line one line two')] }])
})

test('paths: a Windows path in text, and a path in inline code, open; commands and notes do not', () => {
  const nodes = parseInline('see C:\\Users\\TC\\app.ts and C:\\p\\x.ts:12, ok', CHAT)
  assert.deepEqual(nodes[1], { type: 'path', path: 'C:\\Users\\TC\\app.ts', text: 'C:\\Users\\TC\\app.ts', code: false, relative: false })
  assert.deepEqual(nodes[3], { type: 'path', path: 'C:\\p\\x.ts', text: 'C:\\p\\x.ts:12', code: false, relative: false })
  assert.deepEqual(nodes[4], t(', ok'))
  const code = parseInline('open `src/ui/App.tsx:42` and `npm test` and `C:/a/b.md`', CHAT)
  assert.deepEqual(code[1], { type: 'path', path: 'src/ui/App.tsx', text: 'src/ui/App.tsx:42', code: true, relative: true })
  assert.deepEqual(code[3], { type: 'code', text: 'npm test' })
  assert.equal(code[5].type, 'path')
  assert.deepEqual(parseInline('`App.tsx`', CHAT), [{ type: 'code', text: 'App.tsx' }])
  assert.ok(parseInline('C:\\x\\y.ts').every((n) => n.type !== 'path'))
  assert.ok(parseInline('ratio 3:4 or a:b', CHAT).every((n) => n.type !== 'path'))
  // A Markdown link to a file opens it, under its label.
  assert.deepEqual(parseInline('[the readme](C:\\p\\README.md)', CHAT), [{ type: 'path', path: 'C:\\p\\README.md', text: 'the readme', code: false, relative: false }])
  assert.deepEqual(parseInline('[the readme](C:\\p\\README.md)'), [t('the readme')])
})

test('math: \\(…\\), $$…$$ and display blocks are TeX; a single $…$ and money are not', () => {
  const nodes = parseInline('area $a^2$ and \\(x+1\\) and $$y$$ costs $5 and $10', CHAT)
  assert.deepEqual(nodes.filter((n) => n.type === 'math'), [{ type: 'math', tex: 'x+1', display: false }, { type: 'math', tex: 'y', display: false }])
  assert.ok(nodes.some((n) => n.type === 'text' && n.text.includes('area $a^2$ and ')))
  assert.ok(nodes.some((n) => n.type === 'text' && n.text.includes('$5 and $10')))
  assert.deepEqual(parseMarkdown('$$\nE=mc^2\n$$', CHAT), [{ type: 'math', tex: 'E=mc^2', display: true }])
  assert.deepEqual(parseMarkdown('$$a+b$$', CHAT), [{ type: 'math', tex: 'a+b', display: true }])
  assert.deepEqual(parseMarkdown('\\[\n\\int_0^1 x\\,dx\n\\]', CHAT), [{ type: 'math', tex: '\\int_0^1 x\\,dx', display: true }])
  assert.equal(parseMarkdown('$ never closed', CHAT)[0].type, 'paragraph')
  // A math block interrupts a paragraph, as a reply writes it with no blank line before it.
  assert.deepEqual(parseMarkdown('Einstein:\n$$\nE=mc^2\n$$\nThat is all.', CHAT).map((b) => b.type), ['paragraph', 'math', 'paragraph'])
  assert.ok(parseInline('$a$').every((n) => n.type !== 'math'))
  assert.deepEqual(parseInline('\\$5', CHAT), [t('$5')])
})

test('images are placeholders: web and local sources only, nothing else', () => {
  const nodes = parseInline('![shot](https://x.io/a.png) ![bad](javascript:alert(1)) ![l](C:\\a\\b.png)', CHAT)
  assert.deepEqual(nodes[0], { type: 'image', src: 'https://x.io/a.png', alt: 'shot' })
  assert.deepEqual(nodes[1], t(' bad '))
  assert.deepEqual(nodes[2], { type: 'image', src: 'C:\\a\\b.png', alt: 'l' })
  assert.deepEqual(parseInline('![l](C:\\a\\b.png)')[0], t('l'))
})
