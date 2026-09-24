import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  chordFromKeydown, modifierLabel, normalizeAccelerator, normalizeFavoriteHotkeys, sameChord,
  isPickerFavoriteModifier, SHORTCUT_DEFAULTS
} from './hotkeys.mjs'

test('an accelerator is stored in one spelling: known modifiers in a fixed order, then one key', () => {
  assert.equal(normalizeAccelerator('Control+Alt+V'), 'Control+Alt+V')
  assert.equal(normalizeAccelerator('Shift+Alt+1'), 'Alt+Shift+1')
  assert.equal(normalizeAccelerator('ctrl+shift+space'), 'Control+Shift+Space')
  assert.equal(normalizeAccelerator('CmdOrCtrl+Alt+k'), 'Control+Alt+K')
  assert.equal(normalizeAccelerator('Super+pageup'), 'Super+PageUp')
  assert.equal(normalizeAccelerator('Alt+Plus'), 'Alt+Plus')
  assert.equal(normalizeAccelerator('Alt+`'), 'Alt+`')
  assert.equal(normalizeAccelerator('Control+Alt+num5'), 'Control+Alt+num5')
  assert.equal(normalizeAccelerator(' Control+Alt+V '), 'Control+Alt+V')
  assert.equal(normalizeAccelerator('F9'), 'F9', 'an F-key may stand alone')
  assert.equal(normalizeAccelerator('Shift+F24'), 'Shift+F24')
})

test('anything Electron would refuse, or a chord that would swallow typing, is null', () => {
  for (const bad of [
    '', 'V', 'Shift+A', 'AltGr+E', 'Control+Alt', 'Control+Control+V', 'Control+V+Alt', 'Alt++', 'Alt+',
    'Alt+Q W', 'Control + V', 'Alt+F25', 'Alt+Nope', 'Alt+Q\nx', 'Alt+\0', `Alt+${'x'.repeat(80)}`, 7, null, undefined, ['Alt+Q']
  ]) assert.equal(normalizeAccelerator(bad), null, JSON.stringify(bad))
})

test('the same chord in two spellings is one chord', () => {
  assert.ok(sameChord('Shift+Alt+1', 'alt+shift+1'))
  assert.ok(sameChord('Ctrl+Alt+V', 'Control+Alt+V'))
  assert.ok(!sameChord('Alt+1', 'Alt+2'))
  assert.ok(!sameChord('nope', 'nope'), 'an invalid chord matches nothing')
})

test('the recorder spells a keydown from its code, so Shift+digit is still the digit', () => {
  const key = (over) => ({ key: '', code: '', ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...over })
  assert.deepEqual(chordFromKeydown(key({ key: '!', code: 'Digit1', altKey: true, shiftKey: true })), { accelerator: 'Alt+Shift+1' })
  assert.deepEqual(chordFromKeydown(key({ key: 'v', code: 'KeyV', ctrlKey: true, altKey: true })), { accelerator: 'Control+Alt+V' })
  assert.deepEqual(chordFromKeydown(key({ key: ' ', code: 'Space', ctrlKey: true, shiftKey: true })), { accelerator: 'Control+Shift+Space' })
  assert.deepEqual(chordFromKeydown(key({ key: 'ArrowUp', code: 'ArrowUp', altKey: true })), { accelerator: 'Alt+Up' })
  assert.deepEqual(chordFromKeydown(key({ key: '5', code: 'Numpad5', ctrlKey: true, altKey: true })), { accelerator: 'Control+Alt+num5' })
  assert.deepEqual(chordFromKeydown(key({ key: 'F7', code: 'F7' })), { accelerator: 'F7' })
  assert.deepEqual(chordFromKeydown(key({ key: 'Escape', code: 'Escape' })), { cancel: true }, 'Escape cancels')
  assert.deepEqual(chordFromKeydown(key({ key: 'Alt', code: 'AltLeft', altKey: true })), { pending: true }, 'still choosing')
  assert.ok(chordFromKeydown(key({ key: 'A', code: 'KeyA', shiftKey: true })).invalid, 'Shift+A is typing, not a shortcut')
  assert.ok(chordFromKeydown(key({ key: 'Dead', code: 'IntlRo', altKey: true })).invalid)
})

test('favorite chords are always three valid ones; the picker modifier is Alt or Control', () => {
  assert.deepEqual(normalizeFavoriteHotkeys(SHORTCUT_DEFAULTS.favoriteHotkeys), ['Alt+Shift+1', 'Alt+Shift+2', 'Alt+Shift+3'])
  assert.deepEqual(normalizeFavoriteHotkeys(['Shift+Alt+1', 'Control+Alt+2', 'F8']), ['Alt+Shift+1', 'Control+Alt+2', 'F8'])
  assert.equal(normalizeFavoriteHotkeys(['Alt+1', 'Alt+2']), null)
  assert.equal(normalizeFavoriteHotkeys(['Alt+1', 'Alt+2', 'Shift+3']), null)
  assert.equal(normalizeFavoriteHotkeys('Alt+1'), null)
  assert.ok(isPickerFavoriteModifier('Alt') && isPickerFavoriteModifier('Control'))
  assert.ok(!isPickerFavoriteModifier('Shift') && !isPickerFavoriteModifier('Ctrl'))
  assert.equal(modifierLabel('Control'), 'Ctrl')
  assert.equal(modifierLabel('Alt'), 'Alt')
})
