import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  APP_KEYS, RESERVED, canonicalChord, eventChord, keyLabel, matchAppKey, ownersOf, terminalCollisions
} from './keymap.mjs'

const down = (code, mods = {}, key = '') => ({ code, key, ...mods })

test('no key that fires inside a terminal pane belongs to Claude Code, Codex, prompt editing or PowerShell', () => {
  assert.deepEqual(terminalCollisions(), [])
})

test('a chord compares alike whatever the modifier order or case', () => {
  assert.equal(canonicalChord('Shift+Control+p'), canonicalChord('Control+Shift+P'))
  assert.equal(canonicalChord('ctrl+k'), 'Control+k')
  assert.equal(canonicalChord('Control+Control+K'), null)
  assert.equal(canonicalChord('Hyper+K'), null)
  assert.equal(canonicalChord(''), null)
})

test('a keydown is named by its physical key, so Shift never renames it', () => {
  assert.equal(eventChord(down('KeyK', { ctrlKey: true }, 'k')), 'Control+K')
  assert.equal(eventChord(down('Backquote', { ctrlKey: true, shiftKey: true }, '~')), 'Control+Shift+`')
  assert.equal(eventChord(down('Tab', { ctrlKey: true, shiftKey: true }, 'Tab')), 'Control+Shift+Tab')
  assert.equal(eventChord(down('ArrowRight', { ctrlKey: true, shiftKey: true }, 'ArrowRight')), 'Control+Shift+Right')
  assert.equal(eventChord(down('Escape', {}, 'Escape')), 'Escape')
  assert.equal(eventChord(down('AltLeft', { altKey: true }, 'Alt')), null, 'a bare modifier is no chord yet')
})

test('the common keys run their actions outside a terminal', () => {
  assert.deepEqual(matchAppKey('Control+K', false), { action: 'palette' })
  assert.deepEqual(matchAppKey('Control+B', false), { action: 'sidebar' })
  assert.deepEqual(matchAppKey('Control+Tab', false), { action: 'nextPane' })
  assert.deepEqual(matchAppKey('F1', false), { action: 'legend' })
  assert.deepEqual(matchAppKey('Control+3', false), { action: 'focusPane', arg: 3 })
  assert.equal(matchAppKey('Control+W', false), null, 'Ctrl+W is never taken')
  assert.equal(matchAppKey('Alt+W', false), null, "Alt+W stays Claude Code's")
  assert.equal(matchAppKey('Alt+E', false), null)
})

test('inside a terminal the CLI keeps its keys and the Alt layer still reaches the app', () => {
  assert.equal(matchAppKey('Control+K', true), null, "Ctrl+K is the prompt's delete-to-end")
  assert.equal(matchAppKey('Control+B', true), null, 'Ctrl+B backgrounds a Claude Code task')
  assert.equal(matchAppKey('F1', true), null, "F1 is PowerShell's command help")
  assert.deepEqual(matchAppKey('Alt+K', true), { action: 'palette' })
  assert.deepEqual(matchAppKey('Alt+S', true), { action: 'sidebar' })
  assert.deepEqual(matchAppKey('Alt+J', true), { action: 'waiting' })
  assert.deepEqual(matchAppKey('Alt+Z', true), { action: 'zoom' })
  assert.deepEqual(matchAppKey('Control+Shift+P', true), { action: 'palette' })
})

test('no chord is claimed by two app actions', () => {
  const seen = new Map()
  for (const entry of APP_KEYS) {
    for (const key of entry.keys) {
      const c = canonicalChord(key.chord)
      assert.ok(c, `${key.chord} parses`)
      assert.ok(!seen.has(c), `${key.chord} is both ${seen.get(c)} and ${entry.action}`)
      seen.set(c, entry.action)
    }
  }
  for (const res of RESERVED) assert.ok(canonicalChord(res.chord), `${res.chord} parses`)
})

test('checking a key names everyone who answers to it', () => {
  const alt = ownersOf('Alt+W')
  assert.deepEqual(alt.map((o) => o.owner), ['Claude Code'])
  const ck = ownersOf('Control+K').map((o) => o.owner)
  assert.deepEqual(ck, ['Workspace', 'Prompt editing'])
  assert.equal(ownersOf('Alt+G').length, 0, 'a free key has no owner')
  assert.equal(ownersOf('nonsense+').length, 0)
})

test('a chord reads as its chip', () => {
  assert.equal(keyLabel('Control+Shift+Left'), 'Ctrl+Shift+←')
  assert.equal(keyLabel('Super+K'), 'Win+K')
})
