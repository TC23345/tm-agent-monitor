/**
 * Pure geometry for the resizable workspace: sidebar width clamping and pane
 * column fractions. Kept out of the renderer so the arithmetic that decides
 * whether a drag is legal is testable without a DOM.
 *
 * Nothing here reads the DOM. Callers measure (a frame's client width, two
 * used track widths) and pass pixels in.
 */

/** Narrower and agent rows truncate before their meta chips are reached. */
export const SIDEBAR_MIN = 260
export const SIDEBAR_MAX = 720
/** A pane below this is useless — a terminal loses its prompt width. */
export const PANE_MIN = 200
/** Rows are cheaper than columns: a pane this tall still shows a header and a
 * few lines of shell. */
export const PANE_MIN_ROW = 120

/**
 * The sidebar width for a user who has never dragged the splitter. Half-screen
 * and narrow displays start tighter, which is what the old `max-width: 1040px`
 * media query did before the width became draggable.
 */
export function defaultSidebarWidth(frameWidth) {
  return Number.isFinite(frameWidth) && frameWidth > 0 && frameWidth < 1040 ? 280 : 400
}

/**
 * Clamp a preferred sidebar width against its own bounds and the frame it has
 * to share with the panes. The ceiling moves with the frame instead of living
 * in a media query — a `!important` breakpoint would silently beat the inline
 * width a drag writes.
 */
export function clampSidebarWidth(width, frameWidth) {
  const pref = Number.isFinite(width) ? width : defaultSidebarWidth(frameWidth)
  const room = Number.isFinite(frameWidth) && frameWidth > 0 ? frameWidth - PANE_MIN : SIDEBAR_MAX
  const ceiling = Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, room))
  return Math.round(Math.min(Math.max(pref, SIDEBAR_MIN), ceiling))
}

/** Even tracks for `count` columns. Fractions always sum to their count. */
export function equalFractions(count) {
  return Array.from({ length: Math.max(0, count | 0) }, () => 1)
}

/**
 * Coerce a stored fraction list into exactly `count` positive tracks summing to
 * `count`. A list saved for a different column count is not rescaled — the user
 * sized *that* layout, so this one starts even.
 */
export function normalizeFractions(raw, count) {
  const n = Math.max(0, count | 0)
  if (n === 0) return []
  if (!Array.isArray(raw) || raw.length !== n) return equalFractions(n)
  const list = raw.map((value) => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0))
  const total = list.reduce((sum, value) => sum + value, 0)
  if (!(total > 0) || list.some((value) => value === 0)) return equalFractions(n)
  return list.map((value) => (value / total) * n)
}

/**
 * Re-split the two tracks either side of gutter `index` after a drag of
 * `deltaPx`, given those tracks' measured pixel sizes. The pair keeps its
 * combined share, so the other tracks never move; neither side goes below
 * `minPx` — the drag just stops there. Rows pass `PANE_MIN_ROW`.
 */
export function resizeFractions(fractions, index, deltaPx, leftPx, rightPx, minPx = PANE_MIN) {
  const left = fractions[index]
  const right = fractions[index + 1]
  const span = leftPx + rightPx
  if (left === undefined || right === undefined) return fractions
  if (!Number.isFinite(deltaPx) || !Number.isFinite(span) || !(span > 0)) return fractions
  // A pair too narrow to honour the minimum twice splits evenly instead of locking.
  const min = Math.min(Number.isFinite(minPx) ? minPx : PANE_MIN, span / 2)
  const nextLeft = Math.min(Math.max(leftPx + deltaPx, min), span - min)
  const pair = left + right
  const share = nextLeft / span
  const out = fractions.slice()
  out[index] = pair * share
  out[index + 1] = pair * (1 - share)
  return out
}

/**
 * The half view is a different workspace, not a narrower one: a split tuned for
 * a full screen is wrong at half the width, so sizes are stored per bucket.
 * Derived from the live viewport rather than the persisted `sizeMode` setting,
 * because the transient Alt+Q half view never touches that setting.
 */
export function viewportBucket(innerWidth, availWidth) {
  if (!Number.isFinite(innerWidth) || !Number.isFinite(availWidth) || availWidth <= 0) return 'full'
  return innerWidth < availWidth * 0.7 ? 'half' : 'full'
}

/**
 * `grid-template-columns` (or `-rows`) for `fractions`, with a fixed gutter
 * track between every pair for the splitter to live in. The panes are placed
 * explicitly, so the gutter replaces the grid gap rather than adding to it.
 */
export function columnTemplate(fractions, gutterPx) {
  return fractions
    .flatMap((fraction, i) => (i ? [`${gutterPx}px`, `${fraction}fr`] : [`${fraction}fr`]))
    .join(' ')
}

/** Used pixel sizes from a computed `grid-template-columns`/`-rows` string. */
export function trackWidths(computed) {
  if (typeof computed !== 'string') return []
  return computed
    .trim()
    .split(/\s+/)
    .map((part) => parseFloat(part))
    .filter((value) => Number.isFinite(value))
}
