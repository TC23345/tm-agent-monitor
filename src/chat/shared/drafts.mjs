// What a chat pane's composer holds and has not sent (the user's call, 2026-10-21: an Update, a crash or a
// reload used to wipe it): the text, the waiting cards (quotes and long pastes) and the attachments, kept per
// pane in the renderer's localStorage (`DRAFTS_KEY`) and put back when the pane mounts again. Sending clears it.
// Pure and tested; ui/drafts.ts reads and writes the store.

/**
 * @typedef {{ kind: 'quote' | 'paste', text: string }} DraftCard
 * @typedef {{ kind: 'image', name: string, mime: string, data: string, width?: number, height?: number }
 *   | { kind: 'file', path: string, name?: string }} DraftAttachment
 * @typedef {{ text: string, cards: DraftCard[], attachments: DraftAttachment[], at: number }} Draft
 */

export const DRAFTS_KEY = 'tm.chat.drafts.v1'
/** Drafts kept at most, newest first. */
export const MAX_DRAFTS = 24
/** A draft older than this is dropped. */
export const DRAFT_TTL_MS = 14 * 24 * 60 * 60 * 1000
/** Base64 characters of images one draft keeps; images past it are left out (the text and cards still are). */
export const MAX_DRAFT_IMAGE_CHARS = 3_000_000
const MAX_TEXT = 200_000
const KEY = /^[\w.:-]{1,128}$/

/** Whether a draft holds nothing worth keeping. @param {Draft | null | undefined} d */
export function isEmptyDraft(d) {
  return !d || (!d.text.trim() && !d.cards.length && !d.attachments.length)
}

function cleanCard(c) {
  if (!c || (c.kind !== 'quote' && c.kind !== 'paste') || typeof c.text !== 'string' || !c.text.trim()) return null
  return { kind: c.kind, text: c.text.slice(0, MAX_TEXT) }
}

function cleanAttachment(a) {
  if (!a || typeof a !== 'object') return null
  if (a.kind === 'file' && typeof a.path === 'string' && a.path && a.path.length <= 4096) {
    return { kind: 'file', path: a.path, ...(typeof a.name === 'string' && a.name ? { name: a.name.slice(0, 260) } : {}) }
  }
  if (a.kind === 'image' && typeof a.data === 'string' && /^[A-Za-z0-9+/=]+$/.test(a.data.slice(0, 256)) && typeof a.mime === 'string' && /^image\/[\w.+-]+$/.test(a.mime)) {
    const size = Number.isInteger(a.width) && Number.isInteger(a.height) && a.width > 0 && a.height > 0 ? { width: a.width, height: a.height } : {}
    return { kind: 'image', name: typeof a.name === 'string' && a.name ? a.name.slice(0, 260) : 'image.png', mime: a.mime, data: a.data, ...size }
  }
  return null
}

/**
 * One draft as it may be stored: text capped, cards and attachments checked, and images only up to
 * `MAX_DRAFT_IMAGE_CHARS` in all (the first ones kept). Null when nothing is left.
 * @returns {Draft | null}
 */
export function cleanDraft(raw, now = Date.now()) {
  if (!raw || typeof raw !== 'object') return null
  const text = typeof raw.text === 'string' ? raw.text.slice(0, MAX_TEXT) : ''
  const cards = Array.isArray(raw.cards) ? raw.cards.map(cleanCard).filter(Boolean).slice(0, 50) : []
  let budget = MAX_DRAFT_IMAGE_CHARS
  const attachments = []
  for (const a of Array.isArray(raw.attachments) ? raw.attachments.slice(0, 50) : []) {
    const c = cleanAttachment(a)
    if (!c) continue
    if (c.kind === 'image') {
      if (c.data.length > budget) continue
      budget -= c.data.length
    }
    attachments.push(c)
  }
  const at = Number.isFinite(raw.at) && raw.at > 0 ? raw.at : now
  const draft = { text, cards, attachments, at }
  return isEmptyDraft(draft) ? null : draft
}

/**
 * Every stored draft, keyed by pane, with the malformed, the expired and the oldest past `MAX_DRAFTS` dropped.
 * @returns {Record<string, Draft>}
 */
export function sanitizeDrafts(raw, now = Date.now()) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const kept = []
  for (const [key, value] of Object.entries(raw)) {
    if (!KEY.test(key)) continue
    const d = cleanDraft(value, now)
    if (d && now - d.at <= DRAFT_TTL_MS) kept.push([key, d])
  }
  kept.sort((a, b) => b[1].at - a[1].at)
  return Object.fromEntries(kept.slice(0, MAX_DRAFTS))
}

/** Drafts read from a stored string (bad JSON reads as none). */
export function parseDrafts(text, now = Date.now()) {
  if (typeof text !== 'string' || !text) return {}
  try {
    return sanitizeDrafts(JSON.parse(text), now)
  } catch {
    return {}
  }
}

/**
 * Drafts with one pane's set (or, when empty, removed).
 * @param {Record<string, Draft>} all
 * @returns {Record<string, Draft>}
 */
export function withDraft(all, key, draft, now = Date.now()) {
  if (!KEY.test(String(key))) return all
  const next = { ...all }
  const clean = cleanDraft({ ...draft, at: now }, now)
  if (clean) next[key] = clean
  else delete next[key]
  return sanitizeDrafts(next, now)
}

/** Drafts with every image left out: what is kept when storage is full. @param {Record<string, Draft>} all */
export function withoutImages(all) {
  return Object.fromEntries(Object.entries(all).map(([k, d]) => [k, { ...d, attachments: d.attachments.filter((a) => a.kind !== 'image') }]))
}
