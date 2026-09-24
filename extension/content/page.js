// TaylorMade Clipboard — the page side (every frame, document_idle).
//   • a `copy` anywhere reports the page's URL and title to the worker —
//     never the selection; the app already has the text from the clipboard;
//   • `insert` from the worker (right-click → Paste from clipboard ▸) writes
//     a clip at the caret;
//   • the text expander: keystrokes are buffered per field, a 1 s idle wipes
//     the buffer, a word boundary checks the tail against the shortcut map
//     cached from chrome.storage.local (no message per keystroke), and a hit
//     replaces the shortcut with its expansion, case transferred.
// Password fields and `[data-tm-noexpand]` are never listened to (PRD §5.4).
;(function () {
  'use strict'
  const X = globalThis.TMExpand
  if (!X || !globalThis.chrome?.runtime?.id) return

  const IDLE_MS = 1000
  // Keys that end a word. Shortcut prefixes (`;sig`, `/date`, `:addr`) are
  // deliberately not here, or the first character of the shortcut would wipe
  // the buffer that has to hold it.
  const BOUNDARY_KEYS = new Set([' ', 'Enter', 'Tab', '.', ',', '!', '?', ')', ']', '}'])
  let shortcuts = {}
  let buffer = ''
  let bufferField = null
  let idleTimer = 0

  chrome.storage.local.get('shortcuts', (v) => { shortcuts = (v && v.shortcuts) || {} })
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.shortcuts) shortcuts = changes.shortcuts.newValue || {}
  })

  document.addEventListener('copy', () => {
    try { chrome.runtime.sendMessage({ type: 'copied', url: location.href, title: document.title }) } catch { /* worker asleep */ }
  }, true)

  chrome.runtime.onMessage.addListener((message) => {
    if (!message || message.type !== 'insert' || typeof message.text !== 'string') return
    const el = deepActiveElement()
    if (!X.isEditable(el)) return
    if (isCkEditor(el)) { window.dispatchEvent(new CustomEvent('tm-clip-insert', { detail: { text: message.text } })); return }
    X.replaceBeforeCaret(el, 0, message.text, message.text.length)
  })

  function deepActiveElement() {
    let el = document.activeElement
    while (el && el.shadowRoot && el.shadowRoot.activeElement) el = el.shadowRoot.activeElement
    return el
  }

  function isCkEditor(el) {
    return !!(el && typeof el.closest === 'function' && el.closest('.ck-editor__editable'))
  }

  function reset() {
    buffer = ''
    bufferField = null
    if (idleTimer) { clearTimeout(idleTimer); idleTimer = 0 }
  }

  function touch() {
    if (idleTimer) clearTimeout(idleTimer)
    idleTimer = setTimeout(reset, IDLE_MS)
  }

  document.addEventListener('keydown', (e) => {
    if (e.isComposing || e.ctrlKey || e.metaKey || e.altKey) return
    const el = deepActiveElement()
    if (!X.isEditable(el)) { reset(); return }
    if (el !== bufferField) { buffer = ''; bufferField = el }
    if (e.key === 'Backspace') { buffer = buffer.slice(0, -1); touch(); return }
    if (BOUNDARY_KEYS.has(e.key)) {
      const hit = X.matchShortcut(buffer, shortcuts)
      buffer = ''
      touch()
      if (!hit) return
      const expanded = X.expandText(X.applyCase(hit.typed, hit.text))
      // The browser drops the key's own character once the field changed
      // inside keydown, so the boundary is written with the expansion: a
      // printable key as itself, Enter as a newline in a textarea. Enter in an
      // input or a rich editor keeps its default (submit, new paragraph).
      const tag = String(el.tagName ?? '').toLowerCase()
      const boundary = e.key === 'Enter' ? (tag === 'textarea' ? '\n' : '') : e.key === 'Tab' ? '' : e.key
      const takeDefault = boundary !== ''
      const text = expanded.text + boundary
      // A {cursor} mark keeps the caret inside the expansion; otherwise it goes after the boundary too.
      const cursor = expanded.cursor === expanded.text.length ? text.length : expanded.cursor
      if (isCkEditor(el)) {
        window.dispatchEvent(new CustomEvent('tm-clip-insert', { detail: { text: expanded.text, erase: hit.typed.length } }))
        return
      }
      const ok = X.replaceBeforeCaret(el, hit.typed.length, text, cursor)
      if (ok && takeDefault) e.preventDefault()
      return
    }
    if (e.key.length === 1) { buffer = (buffer + e.key).slice(-64); touch() }
  }, true)
})()
