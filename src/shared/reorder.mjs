// Pointer-drag reordering, the arithmetic only: where a pointer would drop
// among a list's items and what the list looks like after the move. The
// picker's Favorites rows and the group chips (a wrapped row of pills) use
// it; they measure rects and pass pixels in, nothing here reads the DOM.

/**
 * The slot a pointer at `y` would drop into among stacked rows: the number of
 * rows whose vertical middle is above it (0 = before the first, n = after
 * the last).
 */
export function rowSlot(rects, y) {
  let slot = 0
  for (const r of rects) if ((r.top + r.bottom) / 2 < y) slot++
  return slot
}

/**
 * The slot among chips laid out in wrapping rows: every chip on a row above
 * the pointer counts, and on the pointer's own row those whose horizontal
 * middle is left of it; chips on rows below never do. Above every row is 0,
 * below every row is n.
 */
export function dropSlot(rects, x, y) {
  let slot = 0
  for (const r of rects) {
    if (r.bottom < y) slot++
    else if (y >= r.top && y <= r.bottom && (r.left + r.right) / 2 < x) slot++
  }
  return slot
}

/**
 * `list` with the item at `from` moved into slot `to` (a slot is counted in
 * the list as it is, the moving item included). Answers the *same* array
 * when the order would not change, so a caller can skip the write.
 */
export function moveTo(list, from, to) {
  if (!Array.isArray(list) || from < 0 || from >= list.length) return list
  const slot = Math.max(0, Math.min(list.length, to))
  if (slot === from || slot === from + 1) return list
  const out = list.slice()
  const [item] = out.splice(from, 1)
  out.splice(slot > from ? slot - 1 : slot, 0, item)
  return out
}
