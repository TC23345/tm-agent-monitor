import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_TERMINAL_THEME, TERMINAL_THEMES, readTerminalTheme, terminalContrast, terminalTheme } from './terminalThemes.mjs'

const ANSI = ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white',
  'brightBlack', 'brightRed', 'brightGreen', 'brightYellow', 'brightBlue', 'brightMagenta', 'brightCyan', 'brightWhite']

test('the default is first and keeps the shipped look', () => {
  assert.equal(TERMINAL_THEMES[0].id, DEFAULT_TERMINAL_THEME)
  assert.equal(terminalTheme('default').background, '#17161b')
  // Default leaves the ANSI colours to xterm, exactly as before the picker existed.
  for (const k of ANSI) assert.equal(terminalTheme('default')[k], undefined)
})

test('every other theme defines all sixteen ANSI colours', () => {
  const ids = new Set()
  for (const t of TERMINAL_THEMES) {
    assert.ok(!ids.has(t.id), `duplicate id ${t.id}`)
    ids.add(t.id)
    assert.ok(t.label && t.hint)
    for (const k of ['background', 'foreground', 'cursor', 'cursorAccent', 'selectionBackground']) assert.ok(t.theme[k], `${t.id}.${k}`)
    if (t.id === DEFAULT_TERMINAL_THEME) continue
    for (const k of ANSI) assert.match(t.theme[k], /^#[0-9a-f]{6}$/, `${t.id}.${k}`)
  }
})

test('a persisted pick falls back to the default when unknown', () => {
  assert.equal(readTerminalTheme('dracula'), 'dracula')
  assert.equal(readTerminalTheme('retired-theme'), 'default')
  assert.equal(readTerminalTheme(null), 'default')
  assert.equal(readTerminalTheme(42), 'default')
  assert.equal(terminalTheme('nope'), terminalTheme('default'))
})

test('only the curated themes enforce contrast; Default is untouched', () => {
  assert.equal(terminalContrast('default'), 1)
  assert.equal(terminalContrast('unknown'), 1)
  assert.equal(terminalContrast('tokyo-night'), 4.5)
})
