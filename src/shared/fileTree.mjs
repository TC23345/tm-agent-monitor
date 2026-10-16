// The project tree (a badge's left-click in the sidebar head) and the file
// pane it opens into: which folders a listing skips, how entries sort, what
// a file is for display (an image, Markdown, text) and what a persisted
// file pane carries. Pure, so node --test covers it; main reads the disk and
// the renderer renders.
import { isMarkdownName } from './notes.mjs'

/** Folders a listing never shows: never a project's own files, always huge. */
export const IGNORED_DIRS = Object.freeze(['.git', 'node_modules'])
/** Most entries one folder shows; past it the tree says how many it left out. */
export const MAX_DIR_ENTRIES = 500
/** The biggest file the pane edits as text. */
export const MAX_TEXT_BYTES = 2 * 1024 * 1024
/** The biggest image the pane shows inline (as a data URL). */
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024
const MAX_PATH = 4_096

const IMAGE_MIME = Object.freeze({
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
  svg: 'image/svg+xml', bmp: 'image/bmp', ico: 'image/x-icon', avif: 'image/avif'
})

/** The extension, lowercase, without the dot; '' when there is none. */
export function extOf(name) {
  if (typeof name !== 'string') return ''
  const base = baseName(name)
  const dot = base.lastIndexOf('.')
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : ''
}

/** The last path segment (either separator), or the path itself. */
export function baseName(path) {
  if (typeof path !== 'string') return ''
  const trimmed = path.replace(/[\\/]+$/, '')
  return trimmed.split(/[\\/]/).pop() || trimmed || path
}

/** The folder a path sits in, with the path's own separators; the path itself when it has no parent. */
export function parentDir(path) {
  if (typeof path !== 'string') return ''
  const trimmed = path.replace(/[\\/]+$/, '')
  const at = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'))
  if (at <= 0) return trimmed || path
  const head = trimmed.slice(0, at)
  // `C:` alone is not a folder; the drive root is `C:\`.
  return /^[A-Za-z]:$/.test(head) ? head + trimmed[at] : head
}

/** An image's MIME type by extension, or null. */
export function imageMime(name) {
  return IMAGE_MIME[extOf(name)] ?? null
}

/** What a file is for the pane: `image`, `markdown` (rendered by default) or `text`. Bytes decide binary, not the name. */
export function fileKind(name) {
  if (imageMime(name)) return 'image'
  if (isMarkdownName(baseName(name))) return 'markdown'
  return 'text'
}

/** Any NUL in the sample: the file is binary, whatever its name. */
export function hasNul(bytes) {
  if (!bytes || typeof bytes.length !== 'number') return false
  for (let i = 0; i < bytes.length; i++) if (bytes[i] === 0) return true
  return false
}

/** Folders first, then files, each in a case-insensitive natural order; a folder in `IGNORED_DIRS` is dropped. */
export function sortEntries(entries) {
  const list = (Array.isArray(entries) ? entries : []).filter((e) => e && typeof e.name === 'string' && (e.kind === 'dir' || e.kind === 'file') && !(e.kind === 'dir' && IGNORED_DIRS.includes(e.name.toLowerCase())))
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })
  return list.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'dir' ? -1 : 1) || collator.compare(a.name, b.name))
}

/** A Windows drive path, a UNC path or a POSIX absolute path. */
export function isAbsolutePath(p) {
  return typeof p === 'string' && p.length > 0 && p.length <= MAX_PATH && (/^[A-Za-z]:[\\/]/.test(p) || p.startsWith('\\\\') || p.startsWith('/'))
}

/** A persisted file pane config (`{ path }`), or null when the path cannot be a file. */
export function sanitizeFileConfig(raw) {
  if (!raw || typeof raw !== 'object') return null
  const path = typeof raw.path === 'string' ? raw.path.trim() : ''
  if (!isAbsolutePath(path) || /[\0\r\n]/.test(path) || /[\\/]$/.test(path)) return null
  return { path }
}
