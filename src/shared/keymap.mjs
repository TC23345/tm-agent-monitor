/**
 * The workspace's in-app keys and the keys that belong to what runs inside a
 * terminal pane — one table, so App's key handler, the Legend tab in
 * Settings → Keyboard shortcuts and the tests cannot disagree.
 *
 * A key marked `terminal: true` fires even while a terminal pane has focus:
 * App's capture-phase listener takes it before xterm, so the CLI never sees
 * it. Those must never collide with a key in `RESERVED` — the test enforces
 * it. A key with `terminal: false` fires everywhere else and goes to the CLI
 * inside a pane (Ctrl+K is kill-to-end-of-line in Claude Code's prompt).
 *
 * Chords use the accelerator spelling of `hotkeys.mjs` (`Control+Shift+P`),
 * keys from the physical `code`, so Shift never changes the key's name.
 */
import { keyFromEvent } from './hotkeys.mjs'

const MOD_ORDER = ['Control', 'Alt', 'Shift', 'Super']
const MOD_NAMES = { control: 'Control', ctrl: 'Control', alt: 'Alt', shift: 'Shift', super: 'Super', win: 'Super', meta: 'Super' }

/** One comparable spelling: modifiers in a fixed order, key lower-cased. Null for nonsense. */
export function canonicalChord(chord) {
  if (typeof chord !== 'string' || !chord) return null
  const parts = chord.split('+')
  // `Control++` would be the plus key; the table spells it `Plus`.
  if (parts.some((p) => p === '')) return null
  const key = parts.pop()
  const mods = new Set()
  for (const p of parts) {
    const m = MOD_NAMES[p.toLowerCase()]
    if (!m || mods.has(m)) return null
    mods.add(m)
  }
  return [...MOD_ORDER.filter((m) => mods.has(m)), key.toLowerCase()].join('+')
}

/** A keydown as a chord (`Alt+K`), or null while only modifiers are held. */
export function eventChord(e) {
  if (!e || typeof e !== 'object') return null
  const key = e.key === 'Escape' ? 'Escape' : keyFromEvent(e)
  if (!key) return null
  const mods = [e.ctrlKey && 'Control', e.altKey && 'Alt', e.shiftKey && 'Shift', e.metaKey && 'Super'].filter(Boolean)
  return [...mods, key].join('+')
}

/** How a chord reads in a kbd chip: `Ctrl+Shift+P`, `Win+K`. */
export function keyLabel(chord) {
  return String(chord).split('+').map((p) => (p === 'Control' ? 'Ctrl' : p === 'Super' ? 'Win' : p === 'Left' ? '←' : p === 'Right' ? '→' : p)).join('+')
}

const k = (chord, terminal, arg) => (arg === undefined ? { chord, terminal } : { chord, terminal, arg })

/**
 * Every in-app action App's handler runs from a key. `display` shortens a run
 * of keys (Ctrl+1 … Ctrl+6) in the legend; matching still uses `keys`.
 */
export const APP_KEYS = Object.freeze([
  { action: 'palette', label: 'Command palette', keys: [k('Control+K', false), k('Control+P', false), k('Control+Shift+P', true), k('Alt+K', true)] },
  { action: 'legend', label: 'Keys pane on / off (this legend)', keys: [k('F1', false), k('Control+/', false)] },
  { action: 'settings', label: 'Settings', keys: [k('Control+,', false)] },
  { action: 'sidebar', label: 'Hide / show the sidebar', keys: [k('Control+B', false), k('Alt+S', true)] },
  { action: 'waiting', label: 'Jump to the next waiting session', keys: [k('Alt+J', true), k('Control+Shift+W', true)] },
  { action: 'newTerminal', label: 'New terminal pane', keys: [k('Control+Shift+`', true)] },
  { action: 'nextPane', label: 'Next pane', keys: [k('Control+Tab', true), k('Control+Shift+Right', true)] },
  { action: 'prevPane', label: 'Previous pane', keys: [k('Control+Shift+Tab', true), k('Control+Shift+Left', true)] },
  {
    action: 'focusPane', label: 'Focus pane 1–6', display: ['Ctrl+1 … Ctrl+6'],
    keys: [1, 2, 3, 4, 5, 6].map((n) => k(`Control+${n}`, true, n))
  },
  { action: 'zoom', label: 'Zoom the focused pane / restore the grid', keys: [k('Alt+Z', true)] }
])

/** Keys the app handles that are not a lookup in `APP_KEYS` — shown in the legend, not dispatched from here. */
export const OTHER_KEYS = Object.freeze([
  {
    group: 'Workspace', rows: [
      { label: 'Close a menu, the palette or a dialog, then un-zoom, then hide the workspace', keys: ['Escape'], terminal: false }
    ]
  },
  {
    group: 'Terminal pane', rows: [
      { label: 'Copy the highlighted text (with nothing highlighted it is still the interrupt)', keys: ['Control+C'], terminal: true },
      { label: 'Copy the highlighted text', keys: ['Control+Shift+C'], terminal: true },
      { label: 'Paste (an image-only clipboard goes to the CLI as its image key)', keys: ['Control+V'], terminal: true },
      { label: 'Selecting text copies it, like Windows Terminal', keys: [], terminal: true }
    ]
  },
  {
    group: 'Clipboard picker', rows: [
      { label: 'Paste the clip back into the app you came from', keys: ['Enter'] },
      { label: 'Copy the clip and close', keys: ['Shift+Enter'] },
      { label: 'Favorites 1–3 (Alt or Ctrl — set in Settings → Keyboard shortcuts)', keys: ['Alt+1', 'Alt+2', 'Alt+3'] },
      { label: 'Rename the clip', keys: ['F2'] },
      { label: 'Next filter chip', keys: ['Tab'] },
      { label: 'Close', keys: ['Escape'] }
    ]
  }
])

const r = (owner, chord, action) => ({ owner, chord, action })
const CC = 'Claude Code'
const CX = 'Codex'
const RL = 'Prompt editing'
const PS = 'PowerShell'

/**
 * Keys the CLIs and the shell inside a pane use, from their shipped defaults
 * (Claude Code's keybindings schema; readline-style editing, which Claude
 * Code's prompt shares; PSReadLine's Windows mode). Shown in the legend and
 * checked against every key that fires inside a terminal.
 */
export const RESERVED = Object.freeze([
  r(CC, 'Control+C', 'interrupt'),
  r(CC, 'Control+D', 'exit'),
  r(CC, 'Escape', 'cancel; twice: rewind'),
  r(CC, 'Shift+Tab', 'cycle permission mode'),
  r(CC, 'Enter', 'submit'),
  r(CC, 'Control+Enter', 'send now'),
  r(CC, 'Control+J', 'newline'),
  r(CC, 'Control+B', 'background the running task'),
  r(CC, 'Control+Shift+B', 'toggle brief'),
  r(CC, 'Control+T', 'toggle todos'),
  r(CC, 'Control+O', 'toggle transcript'),
  r(CC, 'Control+R', 'search history'),
  r(CC, 'Control+G', 'open the prompt in an editor'),
  r(CC, 'Control+S', 'stash the prompt'),
  r(CC, 'Control+L', 'clear the input'),
  r(CC, 'Control+]', 'open artifact'),
  r(CC, 'Control+X', 'chord prefix (Ctrl+X Ctrl+K kills agents, Ctrl+X Ctrl+E editor…)'),
  r(CC, 'Control+-', 'undo'),
  r(CC, 'Control+/', 'undo (a terminal sends Ctrl+/ as Ctrl+_)'),
  r(CC, 'Control+Up', 'diff file list up'),
  r(CC, 'Control+Down', 'diff file list down'),
  r(CC, 'Alt+P', 'model picker'),
  r(CC, 'Alt+O', 'fast mode'),
  r(CC, 'Alt+T', 'thinking on/off'),
  r(CC, 'Alt+W', 'workflow keyword on/off'),
  r(CC, 'Alt+V', 'paste an image'),
  r(CX, 'Control+T', 'transcript'),
  r(CX, 'Control+J', 'newline'),
  r(CX, 'Control+V', 'attach an image'),
  r(CX, 'Escape', 'twice: edit the previous message'),
  r(RL, 'Control+A', 'start of line'),
  r(RL, 'Control+E', 'end of line'),
  r(RL, 'Control+W', 'delete the word before the cursor'),
  r(RL, 'Control+U', 'delete to the start of the line'),
  r(RL, 'Control+K', 'delete to the end of the line'),
  r(RL, 'Control+Y', 'paste what was deleted'),
  r(RL, 'Control+P', 'previous line in history'),
  r(RL, 'Control+N', 'next line in history'),
  r(RL, 'Control+F', 'forward one character'),
  r(RL, 'Control+H', 'backspace'),
  r(RL, 'Alt+B', 'back one word'),
  r(RL, 'Alt+F', 'forward one word'),
  r(RL, 'Alt+D', 'delete the next word'),
  r(RL, 'Alt+Backspace', 'delete the word before the cursor'),
  r(RL, 'Alt+Y', 'cycle what was deleted'),
  r(PS, 'F1', 'help for the command'),
  r(PS, 'F2', 'switch the prediction view'),
  r(PS, 'F8', 'search history'),
  r(PS, 'Alt+A', 'select the next argument'),
  r(PS, 'Alt+H', 'help for the parameter'),
  r(PS, 'Control+Space', 'completion menu'),
  r(PS, 'Control+Z', 'undo'),
  r(PS, 'Control+Backspace', 'delete the word before the cursor'),
  ...[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => r(PS, `Alt+${n}`, 'repeat count'))
])

/** The owners reading the legend groups by, in order. */
export const RESERVED_OWNERS = Object.freeze([CC, CX, RL, PS])

/**
 * The in-app action a keydown runs, or null. `inTerminal`: focus is inside a
 * terminal pane, where only the `terminal: true` keys are the app's.
 */
export function matchAppKey(chord, inTerminal) {
  const want = canonicalChord(chord)
  if (!want) return null
  for (const entry of APP_KEYS) {
    for (const key of entry.keys) {
      if (canonicalChord(key.chord) !== want) continue
      if (inTerminal && !key.terminal) return null
      return key.arg === undefined ? { action: entry.action } : { action: entry.action, arg: key.arg }
    }
  }
  return null
}

/**
 * Everything that answers to a chord: the app's actions (with whether they
 * fire inside a terminal) and the CLIs' and shell's keys. The legend's
 * *Check a key* reads this.
 */
export function ownersOf(chord) {
  const want = canonicalChord(chord)
  if (!want) return []
  const out = []
  for (const entry of APP_KEYS) {
    const key = entry.keys.find((x) => canonicalChord(x.chord) === want)
    if (key) out.push({ owner: 'Workspace', action: entry.label, terminal: key.terminal })
  }
  for (const group of OTHER_KEYS) {
    for (const row of group.rows) {
      if (row.keys.some((x) => canonicalChord(x) === want)) out.push({ owner: group.group, action: row.label, terminal: row.terminal })
    }
  }
  for (const res of RESERVED) {
    if (canonicalChord(res.chord) === want) out.push({ owner: res.owner, action: res.action })
  }
  return out
}

/** App keys that fire inside a terminal yet belong to a CLI or the shell. Must stay empty. */
export function terminalCollisions() {
  const reserved = new Map(RESERVED.map((x) => [canonicalChord(x.chord), x]))
  const out = []
  for (const entry of APP_KEYS) {
    for (const key of entry.keys) {
      const hit = key.terminal && reserved.get(canonicalChord(key.chord))
      if (hit) out.push({ action: entry.action, chord: key.chord, owner: hit.owner, what: hit.action })
    }
  }
  return out
}
