import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from 'react'

/** What is being dragged: a stable key, its kind (a note, a folder, a clip) and a ghost label. */
export interface DragPress {
  key: string
  kind: string
  label: string
}

export interface DragState<T> {
  press: DragPress
  /** Pointer position, for the ghost. */
  x: number
  y: number
  /** Whatever `hitTest` said the pointer is over right now. */
  target: T | null
}

interface Options<T> {
  /** The scrolling list the rows live in: drops outside it are nothing, and its edges auto-scroll. */
  listRef: RefObject<HTMLElement | null>
  /** Work out what the pointer is over. Reads the latest tree each render (kept in a ref here). */
  hitTest: (x: number, y: number, press: DragPress) => T | null
  /** The pointer went up over `target` (null = nowhere). Refusals are the caller's to explain. */
  onDrop: (press: DragPress, target: T | null) => void
  /** The target changed mid-drag (a folder to auto-open); called with null when the drag ends. */
  onTarget?: (target: T | null) => void
  /** A press inside this selector is a button, not a drag handle. */
  ignoreSelector?: string
  /** No drags start while this is false (an inline rename is open). */
  enabled?: boolean
}

/** A drag starts once the pointer has moved this far, so a click stays a click. */
const DRAG_THRESHOLD_PX = 5
const EDGE_SCROLL_PX = 24
const EDGE_SCROLL_STEP = 10
const BODY_CLASS = 'notes-dragging'

/**
 * The pointer-based drag plumbing the Notes tree shipped in 0.4.17, as a
 * hook so the Clipboard pane's favorites move the same way: a 5 px threshold,
 * window-level move/up/cancel listeners, edge auto-scroll, a `justDragged`
 * flag so the click after a drop is ignored, a ghost that owns Escape
 * (`data-escape-close` + `tm-escape` from App), and `body.notes-dragging`
 * for the cursor. What a drop *means* stays with the caller: `hitTest`
 * decides the target and `onDrop` acts on it.
 */
export function useTreeDrag<T extends { problem?: string }>(opts: Options<T>) {
  const [drag, setDrag] = useState<DragState<T> | null>(null)
  const pressRef = useRef<(DragPress & { x: number; y: number; id: number }) | null>(null)
  const dragRef = useRef<DragState<T> | null>(null)
  dragRef.current = drag
  const justDragged = useRef(false)
  const ghostRef = useRef<HTMLDivElement>(null)
  // Callbacks read through refs so the window listeners register once and
  // still see the latest tree.
  const optsRef = useRef(opts)
  optsRef.current = opts

  const cancel = useCallback(() => {
    pressRef.current = null
    setDrag(null)
    document.body.classList.remove(BODY_CLASS)
    optsRef.current.onTarget?.(null)
  }, [])

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const press = pressRef.current
      if (!press || e.pointerId !== press.id) return
      if (!dragRef.current) {
        if (Math.hypot(e.clientX - press.x, e.clientY - press.y) < DRAG_THRESHOLD_PX) return
        document.body.classList.add(BODY_CLASS)
      }
      const o = optsRef.current
      const target = o.hitTest(e.clientX, e.clientY, press)
      o.onTarget?.(target)
      const list = o.listRef.current
      if (list) {
        const lr = list.getBoundingClientRect()
        if (e.clientY < lr.top + EDGE_SCROLL_PX) list.scrollTop -= EDGE_SCROLL_STEP
        else if (e.clientY > lr.bottom - EDGE_SCROLL_PX) list.scrollTop += EDGE_SCROLL_STEP
      }
      setDrag({ press: { key: press.key, kind: press.kind, label: press.label }, x: e.clientX, y: e.clientY, target })
    }
    const onUp = (e: PointerEvent) => {
      const press = pressRef.current
      if (!press || e.pointerId !== press.id) return
      const d = dragRef.current
      if (d) {
        justDragged.current = true
        window.setTimeout(() => { justDragged.current = false }, 0)
        optsRef.current.onDrop(d.press, d.target)
      }
      cancel()
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', cancel)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', cancel)
    }
  }, [cancel])

  // Escape cancels a drag (App hands it to whatever carries data-escape-close).
  useEffect(() => {
    const el = ghostRef.current
    if (!el) return
    el.addEventListener('tm-escape', cancel)
    return () => el.removeEventListener('tm-escape', cancel)
  }, [drag !== null, cancel])

  const pressRow = useCallback((e: ReactPointerEvent, press: DragPress) => {
    const o = optsRef.current
    if (e.button !== 0 || o.enabled === false) return
    if (o.ignoreSelector && (e.target as HTMLElement).closest(o.ignoreSelector)) return
    pressRef.current = { ...press, x: e.clientX, y: e.clientY, id: e.pointerId }
  }, [])

  return { drag, pressRow, ghostRef, justDragged, cancel }
}
