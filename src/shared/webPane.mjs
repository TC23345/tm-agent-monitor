// Web panes: a site in the grid, in an Electron <webview>. The rules both
// sides need — which URLs a pane may load, what it is called, and which keys
// pressed inside the page still belong to the workspace — live here, pure and
// tested. Main enforces them at `will-attach-webview` and `before-input-event`;
// the renderer uses them to build and persist panes.

import { eventChord, matchAppKey } from './keymap.mjs'

/** The one session every web pane shares: persistent, so a sign-in survives
 * restarts, and separate from the app's own renderer session. */
export const WEB_PARTITION = 'persist:web'

const MAX_URL = 2_048

/** An http(s) URL a pane may load, normalized — or null. No credentials in
 * the URL, nothing but http and https (no file:, javascript:, data:). */
export function sanitizeWebUrl(raw) {
  if (typeof raw !== 'string' || !raw.trim() || raw.length > MAX_URL) return null
  let url
  try { url = new URL(raw.trim()) } catch { return null }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
  if (url.username || url.password) return null
  return url.href.length <= MAX_URL ? url.href : null
}

/** A short name for a site: its host, without `www.`. */
export function webLabel(raw) {
  const url = sanitizeWebUrl(raw)
  if (!url) return 'Web'
  return new URL(url).hostname.replace(/^www\./, '')
}

/** Same site: popups to it stay in the pane, anything else goes to the browser. */
export function sameOrigin(a, b) {
  const x = sanitizeWebUrl(a)
  const y = sanitizeWebUrl(b)
  return !!x && !!y && new URL(x).origin === new URL(y).origin
}

/**
 * Electron's default user agent minus every `name/version` token Chrome does
 * not send (`Electron/42.1.0`, the app's own). Some sign-in pages — Google's —
 * refuse a browser that announces itself as embedded.
 */
export function plainUserAgent(ua) {
  if (typeof ua !== 'string') return ''
  return ua
    .replace(/\s(?!(?:AppleWebKit|Chrome|Safari|Mobile|Version)\/)[A-Za-z][\w.-]*\/[\w.-]+/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

/** A persisted web pane config (`{url, label}`), or null when the URL is not loadable. */
export function sanitizeWebConfig(raw) {
  if (!raw || typeof raw !== 'object') return null
  const url = sanitizeWebUrl(raw.url)
  if (!url) return null
  const label = typeof raw.label === 'string' && raw.label.trim() ? raw.label.trim().slice(0, 80) : webLabel(url)
  return { url, label }
}

/**
 * A key pressed inside a web page, as Electron's `before-input-event` reports
 * it: the workspace action it means, or null for the page. Only the keys that
 * work inside a terminal count (the Alt layer, Ctrl+Tab, Ctrl+1–6, the
 * Ctrl+Shift chords) — the plain Ctrl keys (Ctrl+K, Ctrl+B…) belong to the
 * page, the way they belong to the CLI in a terminal pane.
 */
export function webPaneKey(input) {
  // Electron reports a real press as `keyDown`; `rawKeyDown` (injected input) is a press too.
  if (!input || typeof input !== 'object' || (input.type !== 'keyDown' && input.type !== 'rawKeyDown')) return null
  return matchAppKey(eventChord({
    key: input.key,
    code: input.code,
    ctrlKey: !!input.control,
    altKey: !!input.alt,
    shiftKey: !!input.shift,
    metaKey: !!input.meta
  }), true)
}
