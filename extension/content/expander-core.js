// TaylorMade Clipboard — pure decisions of the in-page text expander and the
// caret insertion helpers. A classic script (content scripts are not
// modules) that puts one object on the global; `page.js` uses it in the
// page and `expander-core.test.mjs` loads it into a bare VM with duck-typed
// elements, so the rules that matter for privacy (what is never listened
// to) are tested without a browser.
;(function (root) {
  'use strict'

  /** Never expand — or even buffer keystrokes — in these fields (PRD §5.4). */
  function isProtectedField(el) {
    if (!el) return true
    const tag = String(el.tagName ?? '').toLowerCase()
    if (tag === 'input') {
      const type = String(el.type ?? 'text').toLowerCase()
      if (type === 'password') return true
      const ac = String(el.autocomplete ?? el.getAttribute?.('autocomplete') ?? '').toLowerCase()
      if (/\b(current-password|new-password|one-time-code)\b/.test(ac)) return true
    }
    if (typeof el.closest === 'function' && el.closest('[data-tm-noexpand]')) return true
    return false
  }

  /** Whether typing lands in something we can insert into. */
  function isEditable(el) {
    if (!el || isProtectedField(el)) return false
    const tag = String(el.tagName ?? '').toLowerCase()
    if (tag === 'textarea') return true
    if (tag === 'input') return /^(text|search|url|email|tel|)$/.test(String(el.type ?? 'text').toLowerCase())
    return el.isContentEditable === true
  }

  /** `Sig` → capitalised, `SIG` → upper, else as written. */
  function applyCase(typed, expansion) {
    if (!typed) return expansion
    const letters = typed.replace(/[^A-Za-z]/g, '')
    if (letters.length >= 2 && letters === letters.toUpperCase()) return expansion.toUpperCase()
    if (letters.length >= 1 && letters[0] === letters[0].toUpperCase() && letters.slice(1) === letters.slice(1).toLowerCase()) {
      return expansion.charAt(0).toUpperCase() + expansion.slice(1)
    }
    return expansion
  }

  /**
   * The shortcut at the end of `buffer` (what was typed since the last idle
   * reset), matched case-insensitively against the map's keys. Answers
   * { shortcut, typed, text } or null. The longest key wins.
   */
  function matchShortcut(buffer, map) {
    if (!buffer || !map) return null
    let best = null
    for (const key of Object.keys(map)) {
      if (!key || buffer.length < key.length) continue
      const tail = buffer.slice(-key.length)
      if (tail.toLowerCase() !== key.toLowerCase()) continue
      // A word boundary before the shortcut, so `;sig` in `x;sig` still fires but `abc` in `xabc` does not.
      const before = buffer.charAt(buffer.length - key.length - 1)
      if (before && /[A-Za-z0-9]/.test(before) && /^[A-Za-z0-9]/.test(key)) continue
      if (!best || key.length > best.shortcut.length) best = { shortcut: key, typed: tail, text: map[key] }
    }
    return best
  }

  /** Fill the §4.2 variables; `{cursor}` marks where the caret goes (once). */
  function expandText(text, vars) {
    const now = (vars && vars.now) || new Date()
    const pad = (n) => String(n).padStart(2, '0')
    const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
    const time = `${pad(now.getHours())}:${pad(now.getMinutes())}`
    let out = String(text ?? '').replace(/\{date\}/g, date).replace(/\{time\}/g, time)
    if (vars && typeof vars.clipboard === 'string') out = out.replace(/\{clipboard\}/g, vars.clipboard)
    if (vars && typeof vars.project === 'string') out = out.replace(/\{project\}/g, vars.project)
    const at = out.indexOf('{cursor}')
    if (at === -1) return { text: out, cursor: out.length }
    return { text: out.slice(0, at) + out.slice(at + '{cursor}'.length), cursor: at }
  }

  /**
   * Replace the last `eraseChars` characters before the caret with `text` in
   * an input, textarea, or contentEditable host, leaving the caret at
   * `cursor` within the inserted text. Answers true when something was
   * written. `doc` is injectable for tests.
   */
  function replaceBeforeCaret(el, eraseChars, text, cursor, doc) {
    const d = doc || (el && el.ownerDocument) || (typeof document !== 'undefined' ? document : null)
    if (!el || !d) return false
    const tag = String(el.tagName ?? '').toLowerCase()
    if (tag === 'textarea' || tag === 'input') {
      const end = typeof el.selectionEnd === 'number' ? el.selectionEnd : String(el.value ?? '').length
      const start = Math.max(0, end - eraseChars)
      if (typeof el.setRangeText === 'function') {
        el.setRangeText(text, start, end, 'end')
      } else {
        const v = String(el.value ?? '')
        el.value = v.slice(0, start) + text + v.slice(end)
      }
      const caret = start + cursor
      try { el.setSelectionRange(caret, caret) } catch { /* some inputs refuse */ }
      try { el.dispatchEvent(new (d.defaultView || root).Event('input', { bubbles: true })) } catch { /* a bare VM */ }
      return true
    }
    if (el.isContentEditable) {
      const sel = (d.defaultView || root).getSelection?.() || d.getSelection?.()
      if (!sel || !sel.rangeCount) return false
      const range = sel.getRangeAt(0)
      // Extend backwards over the typed shortcut, then let the editor do the write.
      for (let i = 0; i < eraseChars; i++) {
        try { sel.modify('extend', 'backward', 'character') } catch { break }
      }
      const ok = d.execCommand && d.execCommand('insertText', false, text)
      if (!ok) {
        const r = sel.rangeCount ? sel.getRangeAt(0) : range
        r.deleteContents()
        r.insertNode(d.createTextNode(text))
        r.collapse(false)
      }
      if (cursor < text.length) {
        for (let i = 0; i < text.length - cursor; i++) {
          try { sel.modify('move', 'backward', 'character') } catch { break }
        }
      }
      return true
    }
    return false
  }

  root.TMExpand = { isProtectedField, isEditable, applyCase, matchShortcut, expandText, replaceBeforeCaret }
})(typeof globalThis !== 'undefined' ? globalThis : this)
