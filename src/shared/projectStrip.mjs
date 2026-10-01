// The sidebar head: which project folders were active lately (the badges),
// how those badges pack into two rows, and how tall the activity stream under
// them may be. Pure so the rules are tested; ProjectStrip.tsx and App.tsx only
// measure and render.

import { launchKey } from './panes.mjs'

/** A folder counts as recent for this long after its last activity. */
export const RECENT_WINDOW_MS = 4 * 60 * 60_000
/** Most folders remembered at once; the oldest fall out first. */
export const MAX_RECENT = 60

const MAX_PATH = 1_000
const MAX_LABEL = 200

function baseName(cwd) {
  return cwd.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || cwd
}

/**
 * Parse the persisted map (`tm.projects.v1`): `{ [launchKey]: { cwd, label, at } }`.
 * Anything malformed drops, and entries older than the window are pruned.
 */
export function sanitizeRecent(raw, now = Date.now()) {
  const out = {}
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out
  for (const value of Object.values(raw)) {
    if (!value || typeof value !== 'object') continue
    const { cwd, label, at } = value
    if (typeof cwd !== 'string' || !cwd.trim() || cwd.length > MAX_PATH) continue
    if (typeof at !== 'number' || !Number.isFinite(at) || now - at > RECENT_WINDOW_MS) continue
    const key = launchKey(cwd)
    if (out[key] && out[key].at >= at) continue
    out[key] = {
      cwd,
      label: typeof label === 'string' && label.trim() ? label.slice(0, MAX_LABEL) : baseName(cwd),
      at: Math.min(at, now)
    }
  }
  return capRecent(out)
}

function capRecent(map) {
  const keys = Object.keys(map)
  if (keys.length <= MAX_RECENT) return map
  const keep = keys.sort((a, b) => map[b].at - map[a].at).slice(0, MAX_RECENT)
  const out = {}
  for (const key of keep) out[key] = map[key]
  return out
}

/**
 * Fold activity into the map: each touch is `{ cwd, label?, at }` — a session
 * event, a live agent's last update, a terminal opened in the folder. A folder
 * keeps its newest time. Returns the *same* object when nothing changed, so a
 * caller can skip a re-render and a localStorage write.
 */
export function touchRecent(map, touches, now = Date.now()) {
  let next = null
  const write = () => (next ??= { ...map })
  for (const key of Object.keys(map)) {
    if (now - map[key].at > RECENT_WINDOW_MS) delete write()[key]
  }
  for (const t of touches) {
    if (!t || typeof t.cwd !== 'string' || !t.cwd.trim()) continue
    if (typeof t.at !== 'number' || !Number.isFinite(t.at) || now - t.at > RECENT_WINDOW_MS) continue
    const key = launchKey(t.cwd)
    const current = (next ?? map)[key]
    const at = Math.min(t.at, now)
    if (current && current.at >= at) continue
    write()[key] = { cwd: t.cwd, label: (typeof t.label === 'string' && t.label.trim()) ? t.label.slice(0, MAX_LABEL) : current?.label ?? baseName(t.cwd), at }
  }
  return next ? capRecent(next) : map
}

/** Newest first; ties keep name order so the badges never shuffle on a draw. */
export function recentList(map, now = Date.now()) {
  return Object.values(map)
    .filter((p) => now - p.at <= RECENT_WINDOW_MS)
    .sort((a, b) => b.at - a.at || a.label.localeCompare(b.label))
}

/**
 * Pack badge widths into (at most) two rows for a strip `width` wide.
 *
 * When everything fits, the rows fill in reading order: newest at the top
 * left, wrapping once. When it does not, the strip scrolls sideways and each
 * badge goes to whichever row is shorter so far — the two rows stay about
 * equally long, and the newest badges sit at the left of *both* rows instead
 * of the second row starting where a very long first row ends.
 *
 * Returns the index lists per row and whether the strip overflows.
 */
export function packRows(widths, width, gap = 6) {
  const rows = [[], []]
  const used = [0, 0]
  const add = (row, i) => {
    used[row] += (rows[row].length ? gap : 0) + widths[i]
    rows[row].push(i)
  }
  let row = 0
  let fits = true
  for (let i = 0; i < widths.length; i++) {
    const need = used[row] + (rows[row].length ? gap : 0) + widths[i]
    if (need > width && rows[row].length) {
      if (row === 1) { fits = false; break }
      row = 1
    }
    add(row, i)
  }
  // A lone badge wider than the strip still "fits" one row; it just scrolls.
  if (fits) return { rows: rows[1].length ? rows : [rows[0]], overflow: Math.max(used[0], used[1]) > width }

  rows[0] = []; rows[1] = []
  used[0] = 0; used[1] = 0
  for (let i = 0; i < widths.length; i++) add(used[1] < used[0] ? 1 : 0, i)
  return { rows, overflow: true }
}

/** Default height of the activity stream under the badges. */
export const STREAM_DEFAULT = 168
/** Below this the stream collapses to nothing — the badges alone. */
export const STREAM_SNAP = 40
/** What the sidebar keeps for everything under the stream. */
export const STREAM_RESERVE = 200

/** The stream height a drag asks for, against the sidebar it lives in. */
export function clampStreamHeight(height, sidebarHeight) {
  if (!Number.isFinite(height)) return STREAM_DEFAULT
  if (height < STREAM_SNAP) return 0
  const max = Math.max(STREAM_SNAP, (Number.isFinite(sidebarHeight) ? sidebarHeight : 800) - STREAM_RESERVE)
  return Math.round(Math.min(height, max))
}

/** The persisted height (`tm.stream.v1`), or the default. */
export function readStreamHeight(raw) {
  const n = typeof raw === 'string' ? Number(raw) : raw
  return typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 4_000 ? Math.round(n) : STREAM_DEFAULT
}
