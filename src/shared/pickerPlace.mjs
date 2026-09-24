/**
 * Where the quick picker opens (PRD §5.3): a card at the cursor, clamped to
 * that display's work area so it never opens under the taskbar. The window is
 * the card plus a shadow margin on every side (a transparent margin still
 * captures clicks, so it is kept to the shadow). The card's corner nearest
 * the cursor is the animation origin, so it pops out of the pointer.
 */

export const PICKER_CARD = Object.freeze({ width: 560, height: 420 })
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
