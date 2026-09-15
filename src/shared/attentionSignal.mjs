/**
 * What the OS-level attention surfaces do when the waiting count changes:
 * the tray icon's badge (always, silent); the taskbar button, which exists
 * whenever the workspace is visible so Alt+Tab and the taskbar bring it back
 * like any other window; the count overlay on that button; and one flash on
 * the 0→N edge, never while the workspace already has focus and never when
 * notifications are muted. Pure and tested; main turns the result into
 * tray.setImage / setOverlayIcon / flashFrame calls.
 */

/**
 * `visible` matters: a hidden window has no taskbar button, so while the
 * workspace is dismissed only the tray badge (and the existing toast) can
 * speak. The overlay and flash are for the visible-but-buried case.
 *
 * @param {{ prev: number, next: number, muted: boolean, focused: boolean, visible?: boolean }} s
 * @returns {{ badge: number, taskbar: boolean, overlay: boolean, flash: boolean }}
 */
export function attentionTransition({ prev, next, muted, focused, visible = true }) {
  const p = Number.isFinite(prev) && prev > 0 ? Math.floor(prev) : 0
  const n = Number.isFinite(next) && next > 0 ? Math.floor(next) : 0
  const taskbar = visible === true
  const overlay = taskbar && n > 0
  return { badge: n, taskbar, overlay, flash: overlay && !muted && p === 0 && !focused }
}

/** The text a badge shows for a count: 1–9 as is, anything more as 9+. */
export function badgeLabel(count) {
  const n = Number.isFinite(count) && count > 0 ? Math.floor(count) : 0
  return n === 0 ? '' : n > 9 ? '9+' : String(n)
}
