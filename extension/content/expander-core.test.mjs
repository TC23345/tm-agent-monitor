import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

// The content script is a classic script; load it into a bare VM so the
// privacy rules (what is never listened to) are tested without a browser.
const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'expander-core.js'), 'utf8')
const ctx = vm.createContext({})
vm.runInContext(source, ctx)
const X = ctx.TMExpand
/** Objects born in the VM have that context's prototypes; compare plain copies. */
const plain = (v) => (v === null ? null : JSON.parse(JSON.stringify(v)))

const el = (tagName, extra = {}) => ({ tagName, closest: () => null, getAttribute: () => null, ...extra })

test('password fields, password autocompletes and opted-out ancestors are never listened to', () => {
  assert.equal(X.isProtectedField(el('INPUT', { type: 'password' })), true)
  assert.equal(X.isProtectedField(el('INPUT', { type: 'PASSWORD' })), true)
  assert.equal(X.isProtectedField(el('INPUT', { type: 'text', autocomplete: 'current-password' })), true)
  assert.equal(X.isProtectedField(el('INPUT', { type: 'text', autocomplete: 'new-password' })), true)
  assert.equal(X.isProtectedField(el('INPUT', { type: 'text', autocomplete: 'one-time-code' })), true)
  assert.equal(X.isProtectedField(el('TEXTAREA', { closest: (s) => (s === '[data-tm-noexpand]' ? {} : null) })), true)
  assert.equal(X.isProtectedField(el('INPUT', { type: 'text' })), false)
  assert.equal(X.isProtectedField(null), true)
  assert.equal(X.isEditable(el('INPUT', { type: 'password' })), false)
  assert.equal(X.isEditable(el('INPUT', { type: 'email' })), true)
  assert.equal(X.isEditable(el('INPUT', { type: 'checkbox' })), false)
  assert.equal(X.isEditable(el('TEXTAREA')), true)
  assert.equal(X.isEditable(el('DIV', { isContentEditable: true })), true)
  assert.equal(X.isEditable(el('DIV')), false)
})

test('a shortcut matches at the end of the buffer on a word boundary, longest first, case transferred', () => {
  const map = { ';sig': 'Best,\nTaylor', ';sigl': 'Long signature', 'brb': 'be right back' }
  assert.deepEqual(plain(X.matchShortcut('hello ;sig', map)), { shortcut: ';sig', typed: ';sig', text: 'Best,\nTaylor' })
  assert.deepEqual(plain(X.matchShortcut('x;sigl', map)), { shortcut: ';sigl', typed: ';sigl', text: 'Long signature' })
  assert.equal(X.matchShortcut('xbrb', map), null, 'a word shortcut needs a boundary before it')
  assert.deepEqual(X.matchShortcut('ok brb', map).shortcut, 'brb')
  assert.deepEqual(X.matchShortcut(';SIG', map).typed, ';SIG')
  assert.equal(X.matchShortcut('', map), null)
  assert.equal(X.matchShortcut(';sig', null), null)
  assert.equal(X.applyCase(';sig', 'be right back'), 'be right back')
  assert.equal(X.applyCase('Brb', 'be right back'), 'Be right back')
  assert.equal(X.applyCase('BRB', 'be right back'), 'BE RIGHT BACK')
  assert.equal(X.applyCase(';Sig', 'best regards'), 'Best regards')
})

test('variables fill in and {cursor} places the caret once', () => {
  const now = new Date(2026, 8, 24, 9, 5)
  assert.deepEqual(plain(X.expandText('On {date} at {time}: {clipboard}', { now, clipboard: 'X' })), { text: 'On 2026-09-24 at 09:05: X', cursor: 25 })
  assert.deepEqual(plain(X.expandText('Hi {cursor},\n\nThanks', { now })), { text: 'Hi ,\n\nThanks', cursor: 3 })
  assert.deepEqual(plain(X.expandText('plain', { now })), { text: 'plain', cursor: 5 })
})

test('replaceBeforeCaret rewrites a textarea in place and puts the caret where the expansion says', () => {
  const events = []
  const ta = {
    tagName: 'TEXTAREA', value: 'hello ;sig', selectionEnd: 10, selectionStart: 10,
    setRangeText(text, start, end) { this.value = this.value.slice(0, start) + text + this.value.slice(end) },
    setSelectionRange(a, b) { this.selectionStart = a; this.selectionEnd = b },
    dispatchEvent(e) { events.push(e.type) }
  }
  const doc = { defaultView: { Event: class { constructor(type) { this.type = type } } } }
  assert.equal(X.replaceBeforeCaret(ta, 4, 'Best,\nTaylor', 5, doc), true)
  assert.equal(ta.value, 'hello Best,\nTaylor')
  assert.equal(ta.selectionEnd, 6 + 5)
  assert.deepEqual(events, ['input'])
  assert.equal(X.replaceBeforeCaret(el('DIV'), 1, 'x', 1, doc), false, 'a plain element takes nothing')
})
