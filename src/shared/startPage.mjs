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
  // The file tree's dragged width beside the pane's own session (0.4.78); absent = TREE_DEFAULT.
  const tree = Number.isFinite(raw.tree) ? clampTreeWidth(raw.tree) : undefined
  return tree === undefined ? { path } : { path, tree }
}

/** The folder pane's file tree beside its session (0.4.78, the user's `|`): its default, least and most width in px. */
export const TREE_DEFAULT = 260
export const TREE_MIN = 160
export const TREE_MAX = 720
/** The session side never gets narrower than this; a narrow pane squeezes the tree first. */
export const WORK_MIN = 300

/** A dragged tree width, whole pixels within [TREE_MIN, TREE_MAX]; with `paneWidth`, also leaving WORK_MIN for the session. */
export function clampTreeWidth(width, paneWidth) {
  let w = Math.round(Number.isFinite(width) ? width : TREE_DEFAULT)
  if (Number.isFinite(paneWidth) && paneWidth > 0) w = Math.min(w, paneWidth - WORK_MIN)
  return Math.max(TREE_MIN, Math.min(TREE_MAX, w))
}

/**
 * The empty session side's lines (0.4.78, the user's ask: "a reference to the Matrix … taking the red or the blue
 * pill — choosing between Claude Code and Codex"). Morpheus's offer, cast for a folder.
 */
export function pillLines(label) {
  const name = String(label ?? '').trim() || 'this folder'
  return [
    `Wake up… ${name} has you.`,
    'This is your last chance. After this, there is no turning back.',
    'Take the red pill — Claude Code — and I show you how deep the rabbit hole goes.',
    'Take the blue pill — Codex — and the thread begins. You believe whatever you want to believe.'
  ]
}

/** Typing speed and the beat between lines for the streamed text. */
export const TYPE_MS = 32
export const LINE_PAUSE_MS = 520

/**
 * How much of each line has streamed in after `elapsed` ms: a line types one character per TYPE_MS, the next starts
 * LINE_PAUSE_MS after it ends. Returns the visible text per line (lines not reached yet are absent), the line being
 * typed (-1 once all are done) and whether everything is out.
 */
export function streamedLines(lines, elapsed, typeMs = TYPE_MS, pauseMs = LINE_PAUSE_MS) {
  const shown = []
  let t = Math.max(0, Number.isFinite(elapsed) ? elapsed : 0)
  for (let i = 0; i < lines.length; i++) {
    const line = String(lines[i])
    const chars = [...line]
    const typing = chars.length * typeMs
    if (t < typing) {
      shown.push(chars.slice(0, Math.floor(t / typeMs)).join(''))
      return { shown, current: i, done: false }
    }
    shown.push(line)
    t -= typing
    if (i < lines.length - 1) {
      if (t < pauseMs) return { shown, current: i + 1, done: false }
      t -= pauseMs
    }
  }
  return { shown, current: -1, done: true }
}

/** The whole stream's length in ms (reduced motion skips straight to it). */
export function streamDuration(lines, typeMs = TYPE_MS, pauseMs = LINE_PAUSE_MS) {
  return lines.reduce((sum, line) => sum + [...String(line)].length * typeMs, 0) + Math.max(0, lines.length - 1) * pauseMs
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
