// Markup on a composer image (the user's call, 2026-10-20: "similar to
// Windows' snipping tool"): pen, highlighter, box, arrow and text marks drawn
// over the image, an eraser that takes a whole mark, undo and redo. Every
// coordinate and width is in the image's own pixels, so a mark lands in the
// same place however large the viewer shows it, and the marks stay separate
// from the image until it is sent: reopening the image keeps them editable.
// Pure and tested; the canvas drawing is ui/markup.tsx.

/**
 * A mark, in image pixels. `pen` and `highlight` are polylines (`points` is
 * x, y, x, y …); `box` is an outline; `arrow` runs from (x1, y1) to its head
 * at (x2, y2); `text` has its top-left at (x, y) and its measured width `w`.
 * @typedef {{ kind: 'pen' | 'highlight', color: string, width: number, points: number[] }
 *   | { kind: 'box', color: string, width: number, x: number, y: number, w: number, h: number }
 *   | { kind: 'arrow', color: string, width: number, x1: number, y1: number, x2: number, y2: number }
 *   | { kind: 'text', color: string, size: number, x: number, y: number, w: number, text: string }
 *   | { kind: 'crop', x: number, y: number, w: number, h: number }} Mark
 *
 * A `crop` is not drawn: the newest one is the part of the image the PNG keeps (0.4.68), and a new one
 * replaces the old (`withCrop`), so undo takes it back like any mark.
 */

/** @typedef {'pen' | 'highlight' | 'box' | 'arrow' | 'text' | 'eraser' | 'crop'} MarkupTool */

/** The swatches, Snipping Tool's set: red first, the default. */
export const MARK_COLORS = ['#ef4444', '#facc15', '#22c55e', '#3b82f6', '#ffffff', '#111111']

/** Widths as they look on screen, in CSS pixels; `markWidth` turns them into image pixels. */
export const TOOL_WIDTH = { pen: 3, highlight: 18, box: 3, arrow: 3, text: 18, eraser: 10, crop: 1 }

/** A highlighter stroke's opacity. */
export const HIGHLIGHT_ALPHA = 0.4

/** A text mark's line height, against its size. */
export const TEXT_LINE = 1.25

/**
 * A tool's width in image pixels when the image is shown at `scale` screen
 * pixels per image pixel (a 2000 px screenshot shown 1000 px wide is 0.5).
 * @param {Exclude<MarkupTool, 'eraser'> | 'eraser'} tool
 * @param {number} scale
 */
export function markWidth(tool, scale) {
  const s = Number.isFinite(scale) && scale > 0 ? scale : 1
  return Math.max(1, Math.round((TOOL_WIDTH[tool] / s) * 10) / 10)
}

/** How large an image shows in a box (contain), never past its own size. */
export function fitSize(width, height, boxWidth, boxHeight) {
  if (!(width > 0 && height > 0)) return { width: 0, height: 0, scale: 1 }
  const scale = Math.min(1, Math.max(0, boxWidth) / width, Math.max(0, boxHeight) / height)
  return { width: Math.round(width * scale), height: Math.round(height * scale), scale }
}

/**
 * A pen or highlighter point, unless it sits within `minGap` of the last one
 * (a slow drag would otherwise store hundreds of points per stroke).
 * @param {number[]} points
 */
export function addPoint(points, x, y, minGap = 1) {
  const n = points.length
  if (n >= 2 && Math.hypot(x - points[n - 2], y - points[n - 1]) < minGap) return points
  return [...points, x, y]
}

/** A box from two corners, whichever way it was dragged. */
export function normRect(x1, y1, x2, y2) {
  return { x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1) }
}

/**
 * An arrow's head: the two back corners of the triangle whose tip is (x2, y2),
 * sized to the line's width. Null for an arrow with no length.
 */
export function arrowHead(x1, y1, x2, y2, width) {
  const len = Math.hypot(x2 - x1, y2 - y1)
  if (len === 0) return null
  const size = Math.min(len * 0.6, Math.max(10, width * 4.5))
  const ux = (x2 - x1) / len
  const uy = (y2 - y1) / len
  const bx = x2 - ux * size
  const by = y2 - uy * size
  const half = size * 0.55
  return { left: [bx - uy * half, by + ux * half], right: [bx + uy * half, by - ux * half], base: [bx, by] }
}

/** Distance from a point to the segment (x1, y1)–(x2, y2). */
export function segmentDistance(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1
  const dy = y2 - y1
  const len2 = dx * dx + dy * dy
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / len2))
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy))
}

/**
 * Whether a point within `tolerance` image pixels touches a mark: a line's
 * stroke, a box's outline, a text's box.
 * @param {Mark} mark
 */
export function hitMark(mark, x, y, tolerance) {
  switch (mark.kind) {
    case 'pen':
    case 'highlight': {
      const reach = tolerance + mark.width / 2
      const p = mark.points
      if (p.length === 2) return Math.hypot(x - p[0], y - p[1]) <= reach
      for (let i = 0; i + 3 < p.length; i += 2) if (segmentDistance(x, y, p[i], p[i + 1], p[i + 2], p[i + 3]) <= reach) return true
      return false
    }
    case 'box': {
      const reach = tolerance + mark.width / 2
      const { x: bx, y: by, w, h } = mark
      return segmentDistance(x, y, bx, by, bx + w, by) <= reach || segmentDistance(x, y, bx + w, by, bx + w, by + h) <= reach
        || segmentDistance(x, y, bx + w, by + h, bx, by + h) <= reach || segmentDistance(x, y, bx, by + h, bx, by) <= reach
    }
    case 'arrow':
      return segmentDistance(x, y, mark.x1, mark.y1, mark.x2, mark.y2) <= tolerance + mark.width / 2 + 2
    case 'text':
      return x >= mark.x - tolerance && x <= mark.x + mark.w + tolerance && y >= mark.y - tolerance && y <= mark.y + mark.size * TEXT_LINE + tolerance
    // The eraser takes marks, not the crop (undo or Clear does).
    default:
      return false
  }
}

/** The crop in force: the newest `crop` mark, or null. @param {Mark[]} marks */
export function cropOf(marks) {
  for (let i = marks.length - 1; i >= 0; i--) if (marks[i].kind === 'crop') return marks[i]
  return null
}

/** Marks with a new crop in place of any earlier one. @param {Mark[]} marks */
export function withCrop(marks, crop) {
  return [...marks.filter((m) => m.kind !== 'crop'), crop]
}

/**
 * The region a crop keeps, inside the image and in whole pixels; the whole image without one.
 * @param {Mark[]} marks
 */
export function cropRect(marks, width, height) {
  const c = cropOf(marks)
  if (!c) return { x: 0, y: 0, w: width, h: height }
  const x = Math.max(0, Math.min(width - 1, Math.round(c.x)))
  const y = Math.max(0, Math.min(height - 1, Math.round(c.y)))
  return { x, y, w: Math.max(1, Math.min(width - x, Math.round(c.w))), h: Math.max(1, Math.min(height - y, Math.round(c.h))) }
}

/** The topmost mark a point touches, or -1. @param {Mark[]} marks */
export function markAt(marks, x, y, tolerance) {
  for (let i = marks.length - 1; i >= 0; i--) if (hitMark(marks[i], x, y, tolerance)) return i
  return -1
}

/**
 * Whether a mark just drawn is worth keeping: a click with the box or arrow
 * tool, or an empty text, is not a mark. `minSize` is in image pixels.
 * @param {Mark} mark
 */
export function keepMark(mark, minSize) {
  switch (mark.kind) {
    case 'pen':
    case 'highlight': return mark.points.length >= 2
    case 'box': return mark.w >= minSize && mark.h >= minSize
    case 'arrow': return Math.hypot(mark.x2 - mark.x1, mark.y2 - mark.y1) >= minSize * 2
    case 'text': return mark.text.trim() !== ''
    case 'crop': return mark.w >= minSize * 3 && mark.h >= minSize * 3
    default: return false
  }
}

/**
 * Undo and redo over whole states of the marks. Reopening an image with marks
 * on it starts with each mark as its own step, so undo takes them off one by one.
 * @typedef {{ past: Mark[][], present: Mark[], future: Mark[][] }} MarkHistory
 */

/** @param {Mark[]} marks @returns {MarkHistory} */
export function historyOf(marks = []) {
  return { past: marks.map((_, i) => marks.slice(0, i)), present: marks, future: [] }
}

/** @param {MarkHistory} h @param {Mark[]} next @returns {MarkHistory} */
export function commitMarks(h, next) {
  if (next === h.present) return h
  return { past: [...h.past, h.present], present: next, future: [] }
}

/** @param {MarkHistory} h @returns {MarkHistory} */
export function undoMarks(h) {
  if (!h.past.length) return h
  return { past: h.past.slice(0, -1), present: h.past[h.past.length - 1], future: [h.present, ...h.future] }
}

/** @param {MarkHistory} h @returns {MarkHistory} */
export function redoMarks(h) {
  if (!h.future.length) return h
  return { past: [...h.past, h.present], present: h.future[0], future: h.future.slice(1) }
}

/** Whether two lists of marks are the same marks (by value). @param {Mark[]} a @param {Mark[]} b */
export function sameMarks(a, b) {
  return a === b || JSON.stringify(a) === JSON.stringify(b)
}

/** A marked-up image is a PNG: a name ending in another image type says so. */
export function pngName(name) {
  return /\.(jpe?g|gif|webp|bmp|avif|tiff?)$/i.test(name) ? name.replace(/\.[^.]+$/, '.png') : name
}
