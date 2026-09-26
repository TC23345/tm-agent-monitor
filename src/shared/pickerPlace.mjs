/**
 * Where the quick picker opens (PRD §5.3): a card at the cursor, clamped to
 * that display's work area so it never opens under the taskbar. The window is
 * the card plus a shadow margin on every side (a transparent margin still
 * captures clicks, so it is kept to the shadow). The card's corner nearest
 * the cursor is the animation origin, so it pops out of the pointer.
 */

/**
 * The picker's menu bar (Clips · Keys), the workspace title bar's height: the
 * card grew by it (0.4.42) so the list keeps its room.
 */
export const PICKER_MENUBAR = 41
export const PICKER_CARD = Object.freeze({ width: 560, height: 420 + PICKER_MENUBAR })
/** Transparent margin around the card, for the drop shadow. */
export const PICKER_SHADOW = 28
/** The card's corner sits this far from the pointer, so the pointer is not over a row already. */
const NUDGE = 6

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v))
}

/**
 * `cursor` {x,y} in screen coordinates, `workArea` {x,y,width,height} of the
 * display the cursor is on. Answers the window bounds and the CSS
 * `transform-origin` for the pop-in.
 */
export function placePicker({ cursor, workArea, card = PICKER_CARD, shadow = PICKER_SHADOW }) {
  const width = card.width + 2 * shadow
  const height = card.height + 2 * shadow
  const right = workArea.x + workArea.width
  const bottom = workArea.y + workArea.height
  let ox = 'left'
  let oy = 'top'
  // Card top-left at the pointer; flip when the card would leave the work area.
  let cardX = cursor.x + NUDGE
  let cardY = cursor.y + NUDGE
  if (cardX + card.width > right) { cardX = cursor.x - NUDGE - card.width; ox = 'right' }
  if (cardY + card.height > bottom) { cardY = cursor.y - NUDGE - card.height; oy = 'bottom' }
  cardX = clamp(cardX, workArea.x, Math.max(workArea.x, right - card.width))
  cardY = clamp(cardY, workArea.y, Math.max(workArea.y, bottom - card.height))
  return { x: Math.round(cardX - shadow), y: Math.round(cardY - shadow), width, height, origin: `${oy} ${ox}` }
}

/** The smallest card a resize may leave (the table and the menu bar still fit). */
export const PICKER_MIN = Object.freeze({ width: 420, height: 300 })
const PICKER_MAX = 4000

/**
 * A remembered card size (the `pickerSize` setting) as loaded or patched:
 * whole pixels within [PICKER_MIN, 4000], or null — null is also "the
 * default" (PICKER_CARD).
 */
export function sanitizePickerSize(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const { width, height } = raw
  if (typeof width !== 'number' || typeof height !== 'number' || !Number.isFinite(width) || !Number.isFinite(height)) return null
  return {
    width: Math.round(clamp(width, PICKER_MIN.width, PICKER_MAX)),
    height: Math.round(clamp(height, PICKER_MIN.height, PICKER_MAX))
  }
}

/**
 * A resize drag (the card's right/bottom/corner grips; a transparent
 * frameless window has no OS border): the card at drag start plus the
 * pointer's travel, clamped to PICKER_MIN and to what is left of `workArea`
 * right of and below the card's top-left corner (`cardX`, `cardY`, screen
 * coordinates) — the top-left never moves. Answers the card size and the
 * window bounds (card plus the shadow margin on every side).
 */
export function resizePicker({ start, dw, dh, cardX, cardY, workArea, shadow = PICKER_SHADOW }) {
  const maxW = Math.max(PICKER_MIN.width, workArea.x + workArea.width - cardX)
  const maxH = Math.max(PICKER_MIN.height, workArea.y + workArea.height - cardY)
  const width = Math.round(clamp(start.width + (Number.isFinite(dw) ? dw : 0), PICKER_MIN.width, maxW))
  const height = Math.round(clamp(start.height + (Number.isFinite(dh) ? dh : 0), PICKER_MIN.height, maxH))
  return { card: { width, height }, bounds: { x: Math.round(cardX - shadow), y: Math.round(cardY - shadow), width: width + 2 * shadow, height: height + 2 * shadow } }
}
