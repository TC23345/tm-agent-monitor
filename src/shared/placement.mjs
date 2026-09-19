// Where outside windows go. The workspace launches Cursor, Chrome, and external
// terminals as real windows (it cannot host them — see CLAUDE.md); this keeps
// them in one place instead of wherever and whatever size each app picks: the
// display's work area to the right of the sidebar, so the agent list stays in
// view beside them. Pure — main supplies the geometry and the native rows.

/** Sidebar right edge used before the renderer has reported one (DIP). */
export const DEFAULT_DOCK_INSET = 380

/** Below this width a docked window is useless; dock over the whole area instead. */
const MIN_DOCK_WIDTH = 480

/** How long a launch is watched for its window before giving up. */
export const LAUNCH_WATCH_MS = 12_000

/** A reused window (Cursor raising an already-open folder) is only trusted after this. */
export const REUSE_AFTER_MS = 1_500

/** Apps whose windows a launch of each kind produces. */
export const LAUNCH_EXES = {
  cursor: ['cursor.exe'],
  chrome: ['chrome.exe'],
  terminal: ['windowsterminal.exe', 'openconsole.exe', 'conhost.exe', 'pwsh.exe', 'powershell.exe', 'cmd.exe']
}

/** Window kinds "Tidy windows" gathers (from `buildWindowList`). Explorer stays put. */
export const TIDY_KINDS = new Set(['terminal', 'editor', 'browser', 'assistant'])

const finite = (n) => typeof n === 'number' && Number.isFinite(n)
const isRect = (r) => !!r && finite(r.x) && finite(r.y) && finite(r.width) && finite(r.height) && r.width > 0 && r.height > 0

/**
 * The dock rectangle on a display: its work area minus the sidebar strip on the
 * left. `inset` is the sidebar's right edge relative to the work area's left edge.
 * An inset that would leave less than MIN_DOCK_WIDTH docks over the whole area.
 */
export function dockRect(workArea, inset = DEFAULT_DOCK_INSET) {
  if (!isRect(workArea)) return null
  const left = finite(inset) && inset > 0 ? Math.round(inset) : 0
  if (workArea.width - left < MIN_DOCK_WIDTH) return { ...workArea }
  return { x: workArea.x + left, y: workArea.y, width: workArea.width - left, height: workArea.height }
}

/**
 * The outer rect to hand SetWindowPos so the *visible* frame lands on `target`.
 * Windows 10/11 give most windows invisible resize borders: GetWindowRect
 * (`windowRect`) is larger than what DWM draws (`frameRect`). Without this a
 * placed window shows a gap on the left, right, and bottom.
 */
export function outerRectFor(target, windowRect, frameRect) {
  if (!isRect(target)) return null
  if (!isRect(windowRect) || !isRect(frameRect)) return { ...target }
  const clamp = (n) => (n > 0 && n < 32 ? n : 0)
  const left = clamp(frameRect.x - windowRect.x)
  const top = clamp(frameRect.y - windowRect.y)
  const right = clamp(windowRect.x + windowRect.width - (frameRect.x + frameRect.width))
  const bottom = clamp(windowRect.y + windowRect.height - (frameRect.y + frameRect.height))
  return {
    x: target.x - left,
    y: target.y - top,
    width: target.width + left + right,
    height: target.height + top + bottom
  }
}

/**
 * Which window a launch produced, or null to keep watching.
 *
 * `rows` are native `{ hwnd, pid, exe }`, `before` the hwnds that existed when
 * the launch started, `exes` the apps the launch can produce. A new window of one
 * of those apps wins. Failing that — Cursor asked for a folder it already has
 * open raises that window instead of making one — the foreground window counts
 * once REUSE_AFTER_MS has passed, if it belongs to one of those apps.
 */
export function pickLaunchedWindow({ rows, before, exes, foreground = null, elapsedMs = 0 }) {
  const wanted = new Set((exes ?? []).map((e) => String(e).toLowerCase()))
  const seen = before instanceof Set ? before : new Set(before ?? [])
  for (const row of Array.isArray(rows) ? rows : []) {
    const hwnd = row?.hwnd === undefined || row?.hwnd === null ? '' : String(row.hwnd)
    if (!hwnd || hwnd === '0' || seen.has(hwnd)) continue
    if (wanted.has(String(row.exe ?? '').toLowerCase())) return { hwnd, pid: Number(row.pid) }
  }
  if (elapsedMs >= REUSE_AFTER_MS && foreground && wanted.has(String(foreground.exe ?? '').toLowerCase())) {
    const hwnd = String(foreground.hwnd ?? '')
    if (hwnd && hwnd !== '0') return { hwnd, pid: Number(foreground.pid) }
  }
  return null
}

/** Whether a window's centre lies inside `area` — tidy only gathers the workspace's display. */
export function centreInside(rect, area) {
  if (!isRect(rect) || !isRect(area)) return false
  const cx = rect.x + rect.width / 2
  const cy = rect.y + rect.height / 2
  return cx >= area.x && cx < area.x + area.width && cy >= area.y && cy < area.y + area.height
}
