/**
 * An edge drag on the workspace is a gesture, not a resize: the window only
 * ever has three shapes (full, left half, right half), so grabbing the right
 * edge of the left half and pulling it right means "make this full screen",
 * and pulling the right edge of a full workspace inward means "left half".
 * Main blocks the actual resize (bounds never track a drag) and asks this for
 * the mode the gesture commits to once the edge has moved far enough. Pure.
 */
export const EDGE_COMMIT_PX = 120

/** The horizontal side an Electron `will-resize` edge string belongs to. */
export function dragSide(edge) {
  const e = String(edge ?? '')
  if (e.endsWith('left')) return 'left'
  if (e.endsWith('right')) return 'right'
  return null
}

/**
 * @param {{ mode: 'full' | 'left' | 'right', edge: string, current: { x: number, width: number }, proposed: { x: number, width: number }, commitPx?: number }} s
 * @returns {'full' | 'left' | 'right' | null} the mode to switch to, or null to stay put
 */
export function edgeDragTarget({ mode, edge, current, proposed, commitPx = EDGE_COMMIT_PX }) {
  const side = dragSide(edge)
  if (!side || !current || !proposed) return null
  const rightDelta = (proposed.x + proposed.width) - (current.x + current.width)
  const leftDelta = proposed.x - current.x
  if (mode === 'left') return side === 'right' && rightDelta >= commitPx ? 'full' : null
  if (mode === 'right') return side === 'left' && leftDelta <= -commitPx ? 'full' : null
  if (mode === 'full') {
    if (side === 'right' && rightDelta <= -commitPx) return 'left'
    if (side === 'left' && leftDelta >= commitPx) return 'right'
  }
  return null
}
