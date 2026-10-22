// The user's own names and defaults for the composer's menus (the user's call, 2026-10-20): a right-click on a
// model or a permission mode renames it (title and description) where it is shown, or makes it the one a new
// chat starts on. Per provider, kept in the renderer's localStorage (`CHAT_PREFS_KEY`), never sent to the CLI.
// Pure and tested; ui/prefs.ts reads and writes the store. Since 0.4.72 the composer's own switches live here
// too (the user's ask, 2026-10-21): auto-correct and auto-complete, on unless switched off, and the words the
// user took an auto-correction back from, which are never corrected again.
import { sanitizeKeep } from './autocorrect.mjs'

/** @typedef {'model' | 'mode'} PrefKind */
/** @typedef {'autoCorrect' | 'autoComplete'} ComposerSwitch */
/** @typedef {{ label?: string, description?: string }} LabelOverride */
/**
 * @typedef {{
 *   labels: Record<string, Record<PrefKind, Record<string, LabelOverride>>>,
 *   defaults: Record<string, { model?: string, mode?: string }>,
 *   composer: { autoCorrect?: boolean, autoComplete?: boolean, keep?: string[] }
 * }} ChatPrefs
 */

export const CHAT_PREFS_KEY = 'tm.chat.prefs.v1'
export const MAX_LABEL = 60
export const MAX_DESCRIPTION = 160
const MAX_ENTRIES = 64
const KINDS = ['model', 'mode']
const SWITCHES = ['autoCorrect', 'autoComplete']
const ID = /^[\w.:\[\]-]{1,128}$/

/** @returns {ChatPrefs} */
export function emptyPrefs() {
  return { labels: {}, defaults: {}, composer: {} }
}

function cleanText(value, max) {
  if (typeof value !== 'string') return undefined
  const t = value.replace(/\s+/g, ' ').trim().slice(0, max)
  return t || undefined
}

/** Prefs read back from storage, with anything malformed dropped. @returns {ChatPrefs} */
export function sanitizePrefs(raw) {
  const out = emptyPrefs()
  if (!raw || typeof raw !== 'object') return out
  const providers = (v) => (v && typeof v === 'object' ? Object.entries(v).filter(([p]) => /^[a-z]{1,16}$/.test(p)).slice(0, 8) : [])
  for (const [provider, kinds] of providers(raw.labels)) {
    if (!kinds || typeof kinds !== 'object') continue
    const byKind = { model: {}, mode: {} }
    for (const kind of KINDS) {
      const entries = kinds[kind] && typeof kinds[kind] === 'object' ? Object.entries(kinds[kind]) : []
      for (const [id, o] of entries.slice(0, MAX_ENTRIES)) {
        if (!ID.test(id) || !o || typeof o !== 'object') continue
        const label = cleanText(o.label, MAX_LABEL)
        const description = cleanText(o.description, MAX_DESCRIPTION)
        if (label || description) byKind[kind][id] = { ...(label ? { label } : {}), ...(description ? { description } : {}) }
      }
    }
    out.labels[provider] = byKind
  }
  for (const [provider, d] of providers(raw.defaults)) {
    if (!d || typeof d !== 'object') continue
    const entry = {}
    for (const kind of KINDS) if (typeof d[kind] === 'string' && ID.test(d[kind])) entry[kind] = d[kind]
    if (Object.keys(entry).length) out.defaults[provider] = entry
  }
  const c = raw.composer && typeof raw.composer === 'object' ? raw.composer : {}
  for (const key of SWITCHES) if (typeof c[key] === 'boolean') out.composer[key] = c[key]
  const keep = sanitizeKeep(c.keep)
  if (keep.length) out.composer.keep = keep
  return out
}

/** Prefs from a stored string (bad JSON reads as none). @returns {ChatPrefs} */
export function parsePrefs(text) {
  if (typeof text !== 'string' || !text) return emptyPrefs()
  try {
    return sanitizePrefs(JSON.parse(text))
  } catch {
    return emptyPrefs()
  }
}

/**
 * A row's title and description with the user's names over the CLI's.
 * @param {ChatPrefs} prefs
 * @param {{ label: string, description?: string }} row
 */
export function labelFor(prefs, provider, kind, id, row) {
  const o = prefs.labels[provider]?.[kind]?.[id]
  if (!o) return { label: row.label, description: row.description, renamed: false }
  return { label: o.label ?? row.label, description: o.description ?? row.description, renamed: true }
}

/**
 * Prefs with a row renamed. A field left empty, or the same as the CLI's, goes back to the CLI's; a row with
 * neither renamed has no entry.
 * @param {ChatPrefs} prefs
 * @param {{ label?: string, description?: string }} next
 * @param {{ label: string, description?: string }} original
 * @returns {ChatPrefs}
 */
export function withLabel(prefs, provider, kind, id, next, original) {
  const label = cleanText(next.label, MAX_LABEL)
  const description = cleanText(next.description, MAX_DESCRIPTION)
  const entry = {
    ...(label && label !== original.label ? { label } : {}),
    ...(description && description !== (original.description ?? '') ? { description } : {})
  }
  const byKind = { model: { ...prefs.labels[provider]?.model }, mode: { ...prefs.labels[provider]?.mode } }
  if (Object.keys(entry).length) byKind[kind][id] = entry
  else delete byKind[kind][id]
  return { ...prefs, labels: { ...prefs.labels, [provider]: byKind } }
}

/** Prefs with a row made the default a new chat starts on, or (null) none. @returns {ChatPrefs} */
export function withDefault(prefs, provider, kind, id) {
  const entry = { ...prefs.defaults[provider] }
  if (id && ID.test(id)) entry[kind] = id
  else delete entry[kind]
  const defaults = { ...prefs.defaults }
  if (Object.keys(entry).length) defaults[provider] = entry
  else delete defaults[provider]
  return { ...prefs, defaults }
}

/** The default a new chat of this provider starts on, if any. @param {ChatPrefs} prefs */
export function defaultFor(prefs, provider, kind) {
  return prefs.defaults[provider]?.[kind] ?? null
}

/** Whether a composer switch is on: on unless the user switched it off. @param {ChatPrefs} prefs @param {ComposerSwitch} key */
export function composerOn(prefs, key) {
  return prefs.composer?.[key] !== false
}

/** Prefs with a composer switch set. @param {ChatPrefs} prefs @param {ComposerSwitch} key @returns {ChatPrefs} */
export function withComposer(prefs, key, on) {
  if (!SWITCHES.includes(key)) return prefs
  return { ...prefs, composer: { ...prefs.composer, [key]: on === true } }
}

/** The words the user took an auto-correction back from (lowercase). @param {ChatPrefs} prefs */
export function keptWords(prefs) {
  return prefs.composer?.keep ?? []
}

/** Prefs with a word the user took an auto-correction back from: never corrected again (the newest MAX_KEEP kept). @param {ChatPrefs} prefs @returns {ChatPrefs} */
export function withKept(prefs, word) {
  const keep = sanitizeKeep([...keptWords(prefs).filter((w) => w !== String(word).toLowerCase()), word])
  return { ...prefs, composer: { ...prefs.composer, keep } }
}
