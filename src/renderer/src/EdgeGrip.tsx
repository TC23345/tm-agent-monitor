import { useRef } from 'react'
import { EDGE_COMMIT_PX } from '@shared/edgeDrag.mjs'

/**
 * The handle for the edge-pull gesture: an invisible strip down each side of
 * the card. A transparent frameless window has no OS resize border, so this
 * is where "grab the right edge and pull it out" lands. It reports one thing
 * to main — the edge and how far the pointer travelled once it has gone
 * EDGE_COMMIT_PX — and main decides whether that flips the workspace size
 * (edgeDrag.mjs). The window never stretches under the pointer.
 */
export function EdgeGrip({ edge }: { edge: 'left' | 'right' }) {
  const drag = useRef<{ x: number; sent: boolean } | null>(null)
  return (
    <div
      className={`edge-grip edge-grip--${edge}`}
      data-testid={`edge-grip-${edge}`}
      title="Pull to change the workspace size"
      onPointerDown={(e) => {
        if (e.button !== 0) return
        e.preventDefault()
        drag.current = { x: e.screenX, sent: false }
        try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* a synthetic pointer has no capture; the move still tracks */ }
      }}
      onPointerMove={(e) => {
        const d = drag.current
        if (!d || d.sent) return
        const delta = e.screenX - d.x
        if (Math.abs(delta) < EDGE_COMMIT_PX) return
        d.sent = true
        window.watch.edgeDrag(edge, delta)
      }}
      onPointerUp={(e) => {
        drag.current = null
        if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
      }}
      onPointerCancel={() => { drag.current = null }}
    />
  )
}
