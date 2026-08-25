import { useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react'

interface Props {
  /** 'x' splits side by side (a column edge), 'y' stacks (a row edge). */
  axis?: 'x' | 'y'
  /** Measure whatever the drag is relative to. Called once per drag, and again
   * before each keyboard nudge so arrow keys stay delta-from-start too. */
  onStart: () => void
  /** Pixels moved since `onStart`, along the splitter's drag axis. */
  onMove: (delta: number) => void
  /** Double-click / Home: back to the default split. */
  onReset?: () => void
  label: string
  title?: string
  className?: string
  style?: CSSProperties
  /** How far one arrow key moves the split. */
  step?: number
}

/**
 * A draggable divider. Pointer capture keeps the drag alive over panes that
 * would otherwise swallow the move (xterm's canvas, the launcher buttons), and
 * the handle stays a real `separator` so the split is keyboard-reachable.
 *
 * The splitter owns no geometry: it reports a delta and the caller decides what
 * that means (see `@shared/layout.mjs`).
 */
export function Splitter({ axis = 'x', onStart, onMove, onReset, label, title, className, style, step = 16 }: Props) {
  const along = (event: { clientX: number; clientY: number }) => (axis === 'x' ? event.clientX : event.clientY)
  const [less, more] = axis === 'x' ? ['ArrowLeft', 'ArrowRight'] : ['ArrowUp', 'ArrowDown']
  const origin = useRef(0)
  const [dragging, setDragging] = useState(false)

  const nudge = (delta: number) => {
    onStart()
    onMove(delta)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === less) nudge(-step)
    else if (event.key === more) nudge(step)
    else if (event.key === 'Home' && onReset) onReset()
    else return
    event.preventDefault()
  }

  return (
    <div
      role="separator"
      aria-orientation={axis === 'x' ? 'vertical' : 'horizontal'}
      aria-label={label}
      title={title ?? `${label} — drag to resize, double-click to reset`}
      tabIndex={0}
      className={`splitter splitter--${axis} ${dragging ? 'is-dragging' : ''} ${className ?? ''}`}
      style={style}
      onPointerDown={(event: PointerEvent<HTMLDivElement>) => {
        if (event.button !== 0) return
        // Stops the pane header's HTML5 drag from claiming the gesture.
        event.preventDefault()
        event.currentTarget.setPointerCapture(event.pointerId)
        origin.current = along(event)
        setDragging(true)
        onStart()
      }}
      onPointerMove={(event: PointerEvent<HTMLDivElement>) => {
        if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
        onMove(along(event) - origin.current)
      }}
      onPointerUp={(event: PointerEvent<HTMLDivElement>) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId)
        }
        setDragging(false)
      }}
      onLostPointerCapture={() => setDragging(false)}
      onDoubleClick={onReset}
      onKeyDown={onKeyDown}
    >
      <span className="splitter-grip" aria-hidden />
    </div>
  )
}
