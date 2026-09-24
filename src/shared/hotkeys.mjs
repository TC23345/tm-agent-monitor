/**
 * Keyboard shortcuts (Settings → Keyboard shortcuts): the one place that
 * decides what an Electron accelerator may be, how a pressed chord is spelled,
 * and what each chord defaults to. Pure, so main's patch validator, the
 * Settings recorder and the tests cannot disagree about a chord.
 */

/** Modifier spellings Electron accepts → the one this app stores. */
const MODIFIERS = Object.freeze({
  control: 'Control', ctrl: 'Control', commandorcontrol: 'Control', cmdorctrl: 'Control',
  alt: 'Alt', option: 'Alt', altgr: 'AltGr', shift: 'Shift',
  super: 'Super', meta: 'Super', cmd: 'Super', command: 'Super'
})
/** Stored order, so `Shift+Alt+1` and `Alt+Shift+1` are the same chord. */
const MODIFIER_ORDER = ['Control', 'Alt', 'AltGr', 'Shift', 'Super']

const NAMED_KEYS = [
  'Plus', 'Space', 'Tab', 'Capslock', 'Numlock', 'Scrolllock', 'Backspace', 'Delete', 'Insert', 'Return', 'Enter',
  'Up', 'Down', 'Left', 'Right', 'Home', 'End', 'PageUp', 'PageDown', 'Escape', 'Esc', 'PrintScreen',
  'VolumeUp', 'VolumeDown', 'VolumeMute', 'MediaNextTrack', 'MediaPreviousTrack', 'MediaStop', 'MediaPlayPause',
  'num0', 'num1', 'num2', 'num3', 'num4', 'num5', 'num6', 'num7', 'num8', 'num9', 'numdec', 'numadd', 'numsub', 'nummult', 'numdiv'
]
const NAMED = new Map(NAMED_KEYS.map((k) => [k.toLowerCase(), k]))
const PUNCTUATION = new Set([...')!@#$%^&*(:;<=>,_-.?/~`{}[]|\\\'"'])

/** The key part of a chord, spelled the way it is stored; null when Electron has no such key. */
function normalizeKey(part) {
  if (/^[a-z0-9]$/i.test(part)) return part.toUpperCase()
  if (/^f([1-9]|1[0-9]|2[0-4])$/i.test(part)) return part.toUpperCase()
  if (PUNCTUATION.has(part)) return part
  return NAMED.get(part.toLowerCase()) ?? null
}

/**
 * An Electron accelerator in this app's spelling (`Control+Alt+V`), or null.
 * One key, known modifiers each at most once, and — because these are
 * *global* chords — at least one of Control/Alt/Super unless the key is an
 * F-key: `Shift+A` would swallow every capital A typed anywhere.
 */
export function normalizeAccelerator(value) {
  if (typeof value !== 'string' || value.length < 1 || value.length > 80 || /[\s\0]/.test(value.trim()) || /[\r\n\0]/.test(value)) return null
  const parts = value.trim().split('+')
  if (parts.some((p) => p === '')) return null
  const mods = new Set()
  let key = null
  for (const [index, part] of parts.entries()) {
    const mod = MODIFIERS[part.toLowerCase()]
    if (mod && index < parts.length - 1) {
      if (mods.has(mod)) return null
      mods.add(mod)
      continue
    }
    if (index !== parts.length - 1) return null // a key before the end
    key = normalizeKey(part)
  }
  if (!key) return null
  const fkey = /^F\d+$/.test(key)
  if (!fkey && !['Control', 'Alt', 'Super'].some((m) => mods.has(m))) return null
  return [...MODIFIER_ORDER.filter((m) => mods.has(m)), key].join('+')
}

/** Two chords are the same when they normalize alike (`Shift+Alt+1` = `Alt+Shift+1`). */
export function sameChord(a, b) {
  const x = normalizeAccelerator(a)
  return x !== null && x === normalizeAccelerator(b)
}

/** `KeyboardEvent.code` → accelerator key. Codes, not `key`: Shift+Alt+1 reports key '!'. */
const CODE_KEYS = Object.freeze({
  Space: 'Space', Tab: 'Tab', Enter: 'Enter', NumpadEnter: 'Enter', Backspace: 'Backspace', Delete: 'Delete', Insert: 'Insert',
  Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right',
  PrintScreen: 'PrintScreen', Backquote: '`', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Backslash: '\\',
  Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/',
  NumpadDecimal: 'numdec', NumpadAdd: 'numadd', NumpadSubtract: 'numsub', NumpadMultiply: 'nummult', NumpadDivide: 'numdiv'
})

/**
 * What the Settings recorder makes of one keydown: `{cancel: true}` for
 * Escape, `{accelerator}` for a usable chord, `{pending: true}` while only
 * modifiers are held, `{invalid: '<why>'}` for a key a global chord cannot use.
 */
export function chordFromKeydown(e) {
  if (!e || typeof e !== 'object') return { invalid: 'no key' }
  if (e.key === 'Escape' && !e.ctrlKey && !e.altKey && !e.shiftKey && !e.metaKey) return { cancel: true }
  if (['Control', 'Alt', 'Shift', 'Meta', 'OS', 'AltGraph'].includes(e.key)) return { pending: true }
  const code = typeof e.code === 'string' ? e.code : ''
  let key = null
  if (/^Key[A-Z]$/.test(code)) key = code.slice(3)
  else if (/^Digit[0-9]$/.test(code)) key = code.slice(5)
  else if (/^Numpad[0-9]$/.test(code)) key = `num${code.slice(6)}`
  else if (/^F([1-9]|1[0-9]|2[0-4])$/.test(code)) key = code
  else if (CODE_KEYS[code]) key = CODE_KEYS[code]
  else if (typeof e.key === 'string' && e.key.length === 1) key = e.key.toUpperCase()
  if (!key) return { invalid: `${e.key || code || 'that key'} cannot be a shortcut` }
  const mods = [e.ctrlKey && 'Control', e.altKey && 'Alt', e.shiftKey && 'Shift', e.metaKey && 'Super'].filter(Boolean)
  const accelerator = normalizeAccelerator([...mods, key].join('+'))
  return accelerator ? { accelerator } : { invalid: 'add Ctrl, Alt or Win — a global shortcut needs one' }
}

/** The modifier the picker's own favorite keys use (Alt+1–3 or Ctrl+1–3). */
export const PICKER_FAVORITE_MODIFIERS = Object.freeze(['Alt', 'Control'])

export function isPickerFavoriteModifier(value) {
  return PICKER_FAVORITE_MODIFIERS.includes(value)
}

/** Defaults for every chord but the summon hotkey, whose default is config (`CLAUDE_WATCH_HOTKEY`). */
export const SHORTCUT_DEFAULTS = Object.freeze({
  halfHotkey: 'Alt+Q',
  pickerHotkey: 'Control+Alt+V',
  favoriteHotkeys: Object.freeze(['Alt+Shift+1', 'Alt+Shift+2', 'Alt+Shift+3']),
  pickerFavoriteModifier: 'Alt'
})

/** Exactly three chords, each valid, in favorite order — or null. */
export function normalizeFavoriteHotkeys(value) {
  if (!Array.isArray(value) || value.length !== 3) return null
  const out = value.map(normalizeAccelerator)
  return out.every(Boolean) ? out : null
}

/** How a modifier reads in a kbd hint: `Ctrl`, `Alt`. */
export function modifierLabel(mod) {
  return mod === 'Control' ? 'Ctrl' : mod
}
