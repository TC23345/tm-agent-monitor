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

test('nothing in a note becomes markup: tags are text', () => {
  const tree = parseMarkdown('<script>alert(1)</script> and <b>bold</b>')
  assert.deepEqual(tree, [{ type: 'paragraph', children: [t('<script>alert(1)</script> and <b>bold</b>')] }])
})
