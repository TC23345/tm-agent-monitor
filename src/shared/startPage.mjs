// The start page and the folder panes (0.4.77, the user's ask: a folder path
// clicked in a chat should open as a file tree with "start an agent chat
// here" at the top; a way to open a CC or Codex chat in *any* folder with
// recents, as Cursor has; and a new-pane page like Codex's — tools, suggested,
// recents — instead of a dead "Try again"). This module owns the folders
// store (`tm.folders.v1`: every folder the user opened a pane, chat or
// terminal in, newest first, long-lived — the project strip's own recents
// forget after four hours, which is right for a strip and wrong for an Open
// recent) and the folder pane's config; pure and tested.
import { launchKey } from './panes.mjs'
import { isAbsolutePath } from './fileTree.mjs'

export const FOLDERS_KEY = 'tm.folders.v1'
export const MAX_FOLDERS = 20

/** @typedef {{ cwd: string, label: string, at: number }} FolderEntry */

/** A folder's name: its last segment (a drive root keeps its letter). */
export function folderLabel(path) {
  const parts = String(path ?? '').replace(/[\\/]+$/, '').split(/[\\/]/).filter(Boolean)
  return parts[parts.length - 1] ?? String(path ?? '')
}

/** A folder pane's config: an absolute path with no trailing separator (a drive root keeps its backslash). */
export function sanitizeFolderConfig(raw) {
  if (!raw || typeof raw !== 'object') return null
  let path = typeof raw.path === 'string' ? raw.path.trim() : ''
  if (!isAbsolutePath(path) || /[\0\r\n]/.test(path)) return null
  if (!/^[A-Za-z]:[\\/]$/.test(path)) path = path.replace(/[\\/]+$/, '')
  if (!path) return null
  return { path }
}

/** The stored list, with anything malformed dropped, duplicates folded (slash- and case-insensitive), newest first, capped. @returns {FolderEntry[]} */
export function sanitizeFolders(raw) {
  if (!Array.isArray(raw)) return []
  /** @type {Map<string, FolderEntry>} */
  const seen = new Map()
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const cfg = sanitizeFolderConfig({ path: item.cwd })
    if (!cfg) continue
    const at = Number.isFinite(item.at) && item.at > 0 ? Math.round(item.at) : 0
    const label = typeof item.label === 'string' && item.label.trim() ? item.label.trim().slice(0, 80) : folderLabel(cfg.path)
    const key = launchKey(cfg.path)
    const prev = seen.get(key)
    if (!prev || prev.at < at) seen.set(key, { cwd: cfg.path, label, at })
  }
  return [...seen.values()].sort((a, b) => b.at - a.at || a.label.localeCompare(b.label)).slice(0, MAX_FOLDERS)
}

/** The list with a folder moved (or put) on top at `at`. The same list when the folder is not one. @param {FolderEntry[]} list */
export function rememberFolder(list, cwd, at = Date.now(), label) {
  const cfg = sanitizeFolderConfig({ path: cwd })
  if (!cfg) return list
  const key = launchKey(cfg.path)
  const rest = list.filter((f) => launchKey(f.cwd) !== key)
  const entry = { cwd: cfg.path, label: label?.trim() || list.find((f) => launchKey(f.cwd) === key)?.label || folderLabel(cfg.path), at }
  return [entry, ...rest].slice(0, MAX_FOLDERS)
}

/** The list without a folder. @param {FolderEntry[]} list */
export function forgetFolder(list, cwd) {
  const key = launchKey(cwd)
  const next = list.filter((f) => launchKey(f.cwd) !== key)
  return next.length === list.length ? list : next
}

/** When a folder was last used, as the recents list says it: *Just now*, *12m*, *3h*, *Oct 22*. */
export function whenLabel(at, now = Date.now()) {
  if (!Number.isFinite(at) || at <= 0) return ''
  const s = Math.max(0, Math.round((now - at) / 1000))
  if (s < 60) return 'Just now'
  if (s < 3600) return `${Math.floor(s / 60)}m`
  if (s < 86_400) return `${Math.floor(s / 3600)}h`
  const d = new Date(at)
  return `${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getMonth()]} ${d.getDate()}`
}
