/**
 * Backup import (PRD §7): turn a JSON export into what the store takes —
 * text clips (title, star, groups, first-seen time) and text-expander
 * snippets — from either this app's own export (`clipStoreCore.exportData`)
 * or the old Chrome extension's (Clipboard History Pro, Options → Export).
 * Pure and bounded; the store skips content already in history, and main
 * turns snippets into notes in Notes\Snippets.
 */
import { MAX_CLIP_BYTES, MAX_TITLE, groupNameOk } from './clips.mjs'
import { noteNameFor } from './notes.mjs'

export const MAX_IMPORT_BYTES = 64 * 1024 * 1024
export const MAX_IMPORT_CLIPS = 20_000
export const MAX_IMPORT_SNIPPETS = 500

function isRecord(v) {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** A timestamp in ms from a number in ms or s, or an ISO string; undefined when unusable. */
function whenMs(v) {
  if (typeof v === 'number' && Number.isFinite(v) && v > 0) return v < 1e11 ? Math.floor(v * 1000) : Math.floor(v)
  if (typeof v === 'string' && v) {
    const t = Date.parse(v)
    if (Number.isFinite(t) && t > 0) return t
  }
  return undefined
}

function textOk(t) {
  return typeof t === 'string' && t.trim() !== '' && Buffer.byteLength(t, 'utf8') <= MAX_CLIP_BYTES
}

function cleanGroups(list) {
  return Array.isArray(list) ? [...new Set(list.filter((g) => typeof g === 'string').map((g) => g.trim()).filter((g) => groupNameOk(g)))].slice(0, 20) : []
}

function cleanTitle(t) {
  return typeof t === 'string' && t.trim() ? t.trim().slice(0, MAX_TITLE) : undefined
}

/** This app's own export. */
function parseOurs(raw) {
  const clips = []
  const byId = new Map()
  for (const c of raw.clips.slice(0, MAX_IMPORT_CLIPS)) {
    if (!isRecord(c)) continue
    const text = c.kind === 'files' && Array.isArray(c.files) ? c.files.filter((f) => typeof f === 'string').join('\n') : c.text
    if (c.kind === 'image' || !textOk(text)) continue
    const clip = { text, title: cleanTitle(c.title), favorite: c.favorite === true, groups: cleanGroups(c.groups), createdAt: whenMs(c.createdAt), copiedAt: whenMs(c.copiedAt) ?? whenMs(c.createdAt) }
    if (isRecord(c.source) && typeof c.source.url === 'string' && /^https?:\/\//i.test(c.source.url)) clip.sourceUrl = c.source.url.slice(0, 2048)
    if (c.merged === true) clip.merged = true
    if (c.edited === true) clip.edited = true
    clips.push(clip)
    if (typeof c.id === 'string') byId.set(c.id, clip)
  }
  // Favorites keep the exported order: their position in `favoritesOrder`.
  if (Array.isArray(raw.favoritesOrder)) {
    raw.favoritesOrder.forEach((id, at) => {
      const clip = byId.get(id)
      if (clip?.favorite) clip.order = at
    })
  }
  return { source: 'agent-monitor', clips, snippets: [] }
}

/**
 * Clipboard History Pro's backup (Options → Backup → "Save backup file"), as
 * its own exporter writes it (options.js, `js`, read 2026-09-24): a bare
 * JSON array of records, newest first, each the stored record minus `hash`
 * and `shortText` with falsy fields dropped —
 *   text, dateAdded (epoch ms), dateLastCopied? (ms; omitted when equal),
 *   length, tags (string[], always), sourceUrl?, isFavorite (boolean,
 *   always), order? (position among favorites), isMerged?, isEdited?,
 *   isFromCloudPro?, title?, textShortcut? (the expander trigger; the
 *   expansion is the clip's text).
 * Its importer (`Cl`) also accepts the v1 keys `full`, `date`, `favorite`,
 * `sourceURL`, `merged`, and tags as `{text}` objects, so those are read
 * too. Tags become groups; `textShortcut` becomes a snippet.
 */
function parseClipboardHistoryPro(raw) {
  const items = Array.isArray(raw) ? raw : isRecord(raw) && Array.isArray(raw.items) ? raw.items : null
  if (!items) return null
  const clips = []
  const snippets = []
  const seenShortcuts = new Set()
  let recognised = 0
  for (const c of items.slice(0, MAX_IMPORT_CLIPS)) {
    if (!isRecord(c)) continue
    const rawText = c.text ?? c.full
    const text = typeof rawText === 'string' ? rawText : typeof rawText === 'number' ? String(rawText) : undefined
    if (text === undefined) continue
    recognised++
    if (!textOk(text)) continue
    const tags = Array.isArray(c.tags) ? c.tags.map((t) => (isRecord(t) ? t.text : t)) : []
    const favorite = c.isFavorite === true || c.favorite === true
    const createdAt = whenMs(c.dateAdded ?? c.date)
    const clip = {
      text,
      title: cleanTitle(c.title),
      favorite,
      groups: cleanGroups(tags),
      createdAt,
      copiedAt: whenMs(c.dateLastCopied) ?? createdAt
    }
    const url = typeof c.sourceUrl === 'string' ? c.sourceUrl : typeof c.sourceURL === 'string' ? c.sourceURL : undefined
    if (url && /^https?:\/\//i.test(url)) clip.sourceUrl = url.slice(0, 2048)
    if (favorite && typeof c.order === 'number' && Number.isFinite(c.order)) clip.order = c.order
    if (c.isMerged === true || c.merged === true) clip.merged = true
    if (c.isEdited === true) clip.edited = true
    clips.push(clip)
    const shortcut = typeof c.textShortcut === 'string' ? c.textShortcut.trim() : ''
    if (shortcut && !seenShortcuts.has(shortcut) && snippets.length < MAX_IMPORT_SNIPPETS) {
      seenShortcuts.add(shortcut)
      snippets.push({ shortcut, text })
    }
  }
  if (!recognised) return null
  return { source: 'clipboard-history-pro', clips, snippets }
}

/**
 * The import plan for a parsed JSON value: `{ source, clips, snippets }`, or
 * null when it is not a backup this app knows. Nothing here touches disk.
 */
export function parseClipImport(raw) {
  if (isRecord(raw) && raw.app === 'taylormade-agent-monitor' && Array.isArray(raw.clips)) return parseOurs(raw)
  return parseClipboardHistoryPro(raw)
}

/**
 * A snippet as a note in Notes\Snippets (PRD §4.2): the file is named after
 * the shortcut, the first line declares it, the rest is the expansion. Null
 * when the shortcut yields no usable file name.
 */
export function snippetNote({ shortcut, text }) {
  if (typeof shortcut !== 'string' || typeof text !== 'string') return null
  const trimmed = shortcut.trim()
  const stem = noteNameFor(trimmed.replace(/^[^A-Za-z0-9]+/, '') || 'snippet')
  if (!stem) return null
  const body = `shortcut: ${trimmed}\n\n${text.replace(/\r\n/g, '\n').replace(/\n*$/, '')}\n`
  return { file: stem.endsWith('.md') ? stem : `${stem}.md`, body }
}
