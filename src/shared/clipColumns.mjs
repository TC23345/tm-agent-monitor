/**
 * The clip tables' resizable columns (the Clipboard pane and the quick
 * picker): which columns there are, which are fixed, how a dragged header
 * boundary changes them, the `grid-template-columns` they make, and what
 * localStorage may hold (`tm.clipcols.v1`, one bucket per window). Pure, so
 * nothing about a legal drag is decided in a component — the grip reports a
 * pixel delta (Splitter.tsx) and this module answers the widths.
 *
 * The flexible clip column absorbs every change and never goes under its
 * minimum. A column the user never dragged keeps its default track, so an
 * untouched table is exactly the stylesheet's `--picker-cols` /
 * `--picker-row-cols`.
 */

/** The grid gap between columns (`gap: 0 10px` on the header and rows). */
export const CLIP_COL_GAP = 10
/** No dragged column grows past this. */
export const CLIP_COL_MAX = 1600
export const CLIP_COLS_KEY = 'tm.clipcols.v1'

const col = (id, track, extra = {}) => Object.freeze({ id, track, min: 0, ...extra })

/**
 * Each table's columns, in order. `fixed` never resizes; `flex` is the one
 * column that absorbs the rest (`1fr`); everything else can be dragged and
 * has a minimum.
 */
export const CLIP_COLUMNS = Object.freeze({
  // icon · clip · source · when · key · star
  pane: Object.freeze([
    col('icon', '20px', { fixed: true, min: 20 }),
    col('clip', 'minmax(0, 1fr)', { flex: true, min: 120 }),
    col('source', 'minmax(0, 34%)', { min: 80 }),
    col('when', '48px', { min: 36 }),
    col('key', '46px', { min: 30 }),
    col('star', '24px', { fixed: true, min: 24 })
  ]),
  // star · icon · clip · source · when · key (the picker's star comes first)
  picker: Object.freeze([
    col('star', '24px', { fixed: true, min: 24 }),
    col('icon', '20px', { fixed: true, min: 20 }),
    col('clip', 'minmax(0, 1fr)', { flex: true, min: 120 }),
    col('source', 'minmax(0, 34%)', { min: 80 }),
    col('when', '48px', { min: 36 }),
    col('key', '46px', { min: 30 })
  ])
})

export const CLIP_COL_BUCKETS = Object.freeze(['pane', 'picker'])

function isRecord(v) {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function resizable(c) {
  return !!c && !c.fixed && !c.flex
}

/**
 * The column a drag on boundary `index` (between column `index` and the next)
 * sizes, and which way: the column left of the boundary grows as the boundary
 * moves right — unless that is the flexible clip column, in which case the
 * column right of it grows as the boundary moves left (that is how the source
 * column widens to show a whole URL). Null when the boundary sizes nothing.
 */
export function boundaryColumn(model, index) {
  if (!Array.isArray(model) || !Number.isInteger(index) || index < 0 || index >= model.length - 1) return null
  if (resizable(model[index])) return { index, sign: 1 }
  if (model[index].flex && resizable(model[index + 1])) return { index: index + 1, sign: -1 }
  return null
}

/** The header cells that carry a grip on their right edge. */
export function gripColumns(model) {
  const out = []
  for (let i = 0; i < (Array.isArray(model) ? model.length : 0); i++) if (boundaryColumn(model, i)) out.push(i)
  return out
}

/** Stored widths for one table: resizable ids only, whole pixels, each within [min, CLIP_COL_MAX]. */
export function sanitizeWidths(model, raw) {
  const out = {}
  if (!Array.isArray(model) || !isRecord(raw)) return out
  for (const c of model) {
    if (!resizable(c)) continue
    const v = raw[c.id]
    if (typeof v !== 'number' || !Number.isFinite(v)) continue
    out[c.id] = Math.round(Math.min(CLIP_COL_MAX, Math.max(c.min, v)))
  }
  return out
}

/** One window's widths out of the whole stored value (`JSON.parse`d `tm.clipcols.v1`). */
export function readClipCols(raw, bucket) {
  const model = CLIP_COLUMNS[bucket]
  if (!model || !isRecord(raw)) return {}
  return sanitizeWidths(model, raw[bucket])
}

/** The whole stored value with one window's widths replaced (the other bucket kept, sanitized). */
export function withClipCols(raw, bucket, widths) {
  const out = {}
  for (const b of CLIP_COL_BUCKETS) {
    const w = b === bucket ? sanitizeWidths(CLIP_COLUMNS[b], widths) : readClipCols(raw, b)
    if (Object.keys(w).length) out[b] = w
  }
  return out
}

/**
 * Drag boundary `index` by `deltaPx`. `widths` are the used pixel widths of
 * every column at drag start (the computed `grid-template-columns`),
 * `available` the header's content width; `stored` the widths already
 * saved. Answers the next stored widths: the sized column moves with the
 * pointer, clamped to its minimum and to what the clip column can give up
 * above its own minimum. Unchanged (a copy of `stored`) when the boundary
 * sizes nothing or the measurement is unusable.
 */
export function resizeColumns(model, widths, index, deltaPx, available, stored = {}) {
  const next = sanitizeWidths(model, stored)
  const target = boundaryColumn(model, index)
  if (!target || !Array.isArray(widths) || widths.length !== model.length || !Number.isFinite(deltaPx)) return next
  if (widths.some((w) => typeof w !== 'number' || !Number.isFinite(w) || w < 0)) return next
  const flex = model.findIndex((c) => c.flex)
  if (flex < 0) return next
  const gaps = CLIP_COL_GAP * (model.length - 1)
  const others = widths.reduce((sum, w, i) => (i === flex ? sum : sum + w), 0)
  const flexWidth = Number.isFinite(available) && available > 0 ? available - gaps - others : widths[flex]
  const c = model[target.index]
  const start = widths[target.index]
  const room = Math.max(0, flexWidth - model[flex].min)
  const max = Math.min(CLIP_COL_MAX, Math.max(start, start + room))
  const want = start + target.sign * deltaPx
  next[c.id] = Math.round(Math.max(c.min, Math.min(max, want)))
  return next
}

/** Double-click on a grip: that boundary's column goes back to its default track. */
export function resetColumn(model, stored, index) {
  const next = sanitizeWidths(model, stored)
  const target = boundaryColumn(model, index)
  if (target) delete next[model[target.index].id]
  return next
}

/**
 * `grid-template-columns` for a table. With nothing dragged it is the default
 * (the stylesheet's own variable, character for character). Once a column is
 * sized, the clip column keeps its minimum (`minmax(min, 1fr)`) and a sized
 * column is `minmax(min, <w>px)`, so a narrower window squeezes the sized
 * columns down to their minimums before the clip column vanishes.
 */
export function templateFor(model, widths, autoKey) {
  if (!Array.isArray(model)) return ''
  const w = sanitizeWidths(model, widths)
  const sized = Object.keys(w).length > 0
  // The adaptive key default (`autoKeyWidth`): only while the user has not dragged that column.
  const auto = Number.isFinite(autoKey) && autoKey > 0 ? Math.round(Math.min(AUTO_KEY_MAX, autoKey)) : 0
  return model.map((c) => {
    if (c.id === 'key' && w.key === undefined && auto > parseFloat(c.track)) return `${auto}px`
    if (!sized || c.fixed) return c.track
    if (c.flex) return `minmax(${c.min}px, 1fr)`
    return w[c.id] !== undefined ? `minmax(${c.min}px, ${w[c.id]}px)` : c.track
  }).join(' ')
}

/** The widest the key column's adaptive default grows. */
export const AUTO_KEY_MAX = 140
/** The chord chip's metrics (`.clip-chord`: 10px monospace ≈ 6.1 px a character, 5 px padding and a 1 px border each side). */
const CHORD_CHAR_PX = 6.1
const CHORD_CHROME_PX = 12

/**
 * The key column's default when rows carry clip keybinds: wide enough for the
 * longest chord chip in the list (its label, `chordLabel`), capped at
 * AUTO_KEY_MAX; 0 when there is none, so the stylesheet default stands.
 */
export function autoKeyWidth(labels) {
  let longest = 0
  for (const l of Array.isArray(labels) ? labels : []) if (typeof l === 'string' && l.length > longest) longest = l.length
  if (!longest) return 0
  return Math.min(AUTO_KEY_MAX, Math.ceil(longest * CHORD_CHAR_PX + CHORD_CHROME_PX))
}
