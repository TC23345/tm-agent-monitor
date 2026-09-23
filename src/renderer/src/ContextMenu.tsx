import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

/**
 * One entry of a right-click menu. Items run and close the menu; a label
 * starts a titled section; a separator splits sections without a title.
 */
export type ContextEntry =
  | { kind: 'label'; label: string }
  | { kind: 'sep' }
  | {
      kind: 'item'
      id: string
      label: string
      icon?: ReactNode
      /** Tooltip: what it does, or why it is unavailable. */
      hint?: string
      /** Shortcut chips at the right, e.g. ['F2'] or ['Ctrl', 'B']. */
      keys?: string[]
      disabled?: boolean
      /** Run without closing (e.g. a copy that flashes "Copied"). */
      keepOpen?: boolean
      onSelect: () => void
    }

export interface ContextMenuProps {
  /** Where the right-click happened (client coordinates). */
  x: number
  y: number
  entries: ContextEntry[]
  onClose: () => void
  /** Optional title block above the entries: what the menu is about. */
  header?: ReactNode
  /** Extra content under the header (e.g. an inline reply box). */
  children?: ReactNode
  testId?: string
}

/**
 * The app's right-click menu. Portalled onto the `.app` card so a narrow pane
 * never clips it, positioned inside the card (the window has a transparent
 * shadow margin it must not spill into), flipped up when there is no room
 * below. Escape reaches it through App's capture-phase handler: the overlay
 * carries `data-escape-close`, App dispatches `tm-escape` on it instead of
 * hiding the workspace. Arrow keys move between enabled items.
 */
export function ContextMenu({ x, y, entries, onClose, header, children, testId }: ContextMenuProps) {
  const overlayRef = useRef<HTMLDivElement>(null)
  const cardRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ x: number; y: number; up: boolean } | null>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useLayoutEffect(() => {
    const el = cardRef.current
    const overlay = overlayRef.current
    if (!el || !overlay) return
    const or = overlay.getBoundingClientRect()
    const { width, height } = el.getBoundingClientRect()
    const pad = 6
    let px = x - or.left
    let py = y - or.top
    const up = py + height + pad > or.height
    if (up) py = py - height
    px = Math.max(pad, Math.min(px, or.width - width - pad))
    py = Math.max(pad, Math.min(py, or.height - height - pad))
    setPos({ x: px, y: py, up })
  }, [x, y, entries.length])

  useEffect(() => {
    const overlay = overlayRef.current
    if (!overlay) return
    const esc = () => onCloseRef.current()
    overlay.addEventListener('tm-escape', esc)
    // Start keyboard navigation from the menu itself, not the row underneath —
    // unless something inside already took focus (the reply box autofocuses).
    if (!cardRef.current?.contains(document.activeElement)) cardRef.current?.focus({ preventScroll: true })
    return () => overlay.removeEventListener('tm-escape', esc)
  }, [])

  const move = (dir: 1 | -1) => {
    const items = [...(cardRef.current?.querySelectorAll<HTMLButtonElement>('.ctxmenu-item:not(:disabled)') ?? [])]
    if (!items.length) return
    const i = items.indexOf(document.activeElement as HTMLButtonElement)
    items[(i + dir + items.length) % items.length].focus()
  }

  const host = document.querySelector('.app') ?? document.body
  return createPortal(
    <div
      ref={overlayRef}
      className="ctxmenu-overlay"
      data-escape-close=""
      onMouseDown={(e) => { if (e.target === overlayRef.current) onClose() }}
      onContextMenu={(e) => { e.preventDefault(); onClose() }}
    >
      <div
        ref={cardRef}
        className={`ctxmenu ${pos?.up ? 'is-up' : ''}`}
        style={{ left: pos?.x ?? -9999, top: pos?.y ?? -9999 }}
        role="menu"
        tabIndex={-1}
        data-testid={testId}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); move(1) }
          else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1) }
        }}
      >
        {header && <div className="ctxmenu-head">{header}</div>}
        {children}
        {entries.map((entry, i) => {
          if (entry.kind === 'sep') return <div key={`sep-${i}`} className="ctxmenu-sep" />
          if (entry.kind === 'label') return <div key={`label-${i}`} className="ctxmenu-label">{entry.label}</div>
          return (
            <button
              key={entry.id}
              className="ctxmenu-item"
              role="menuitem"
              disabled={entry.disabled}
              title={entry.hint}
              data-testid={`ctx:${entry.id}`}
              onClick={() => {
                entry.onSelect()
                if (!entry.keepOpen) onClose()
              }}
            >
              {entry.icon && <span className="ctxmenu-ic">{entry.icon}</span>}
              <span className="ctxmenu-text">{entry.label}</span>
              {entry.keys && (
                <span className="ctxmenu-keys">
                  {entry.keys.map((k) => <kbd key={k}>{k}</kbd>)}
                </span>
              )}
            </button>
          )
        })}
      </div>
    </div>,
    host
  )
}

/** Drop labels and separators that no item follows, and doubled separators. */
export function tidyEntries(entries: (ContextEntry | false | null | undefined)[]): ContextEntry[] {
  const list = entries.filter((e): e is ContextEntry => !!e)
  const out: ContextEntry[] = []
  list.forEach((e, i) => {
    const itemAhead = list.slice(i + 1).some((n) => n.kind === 'item')
    if (e.kind === 'label' && list[i + 1]?.kind !== 'item') return
    if (e.kind === 'sep' && (!itemAhead || out.at(-1)?.kind !== 'item')) return
    out.push(e)
  })
  return out
}
