import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { ChevronRight } from 'lucide-react'

/**
 * One entry of a right-click menu. Items run and close the menu; a submenu
 * opens a flyout of its own entries on hover (one level deep); a label
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
  | {
      kind: 'submenu'
      id: string
      label: string
      icon?: ReactNode
      hint?: string
      disabled?: boolean
      entries: ContextEntry[]
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

const OPEN_DELAY_MS = 110
const CLOSE_DELAY_MS = 220

/**
 * The app's right-click menu. Portalled onto the `.app` card so a narrow pane
 * never clips it, positioned inside the card (the window has a transparent
 * shadow margin it must not spill into), flipped up when there is no room
 * below. Choices of one kind (templates, launches, folder actions) live in
 * hover flyouts so the menu itself stays short; a flyout opens on hover
 * after a beat, on click, or with → / Enter, flips to the left near the
 * edge, and ← returns to its row. Escape reaches the menu through App's
 * capture-phase handler: the overlay carries `data-escape-close`, and App
 * dispatches `tm-escape` on it instead of hiding the workspace.
 */
export function ContextMenu({ x, y, entries, onClose, header, children, testId }: ContextMenuProps) {
  const overlayRef = useRef<HTMLDivElement>(null)
  const cardRef = useRef<HTMLDivElement>(null)
  const subRef = useRef<HTMLDivElement>(null)
  const rowRefs = useRef(new Map<string, HTMLButtonElement>())
  const [pos, setPos] = useState<{ x: number; y: number; up: boolean } | null>(null)
  const [openSub, setOpenSub] = useState<string | null>(null)
  const [subPos, setSubPos] = useState<{ x: number; y: number; left: boolean } | null>(null)
  const timer = useRef(0)
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

  // Place the open flyout beside its row: right of the card, or left of it
  // when the right edge has no room; aligned to the row, clamped vertically.
  useLayoutEffect(() => {
    if (!openSub) { setSubPos(null); return }
    const row = rowRefs.current.get(openSub)
    const sub = subRef.current
    const overlay = overlayRef.current
    const card = cardRef.current
    if (!row || !sub || !overlay || !card) return
    const or = overlay.getBoundingClientRect()
    const cr = card.getBoundingClientRect()
    const rr = row.getBoundingClientRect()
    const { width, height } = sub.getBoundingClientRect()
    const pad = 6
    const left = cr.right - or.left + width + pad > or.width
    const sx = left ? cr.left - or.left - width + 2 : cr.right - or.left - 2
    let sy = rr.top - or.top - 5
    sy = Math.max(pad, Math.min(sy, or.height - height - pad))
    setSubPos({ x: Math.max(pad, sx), y: sy, left })
  }, [openSub, pos])

  useEffect(() => {
    const overlay = overlayRef.current
    if (!overlay) return
    const esc = () => onCloseRef.current()
    overlay.addEventListener('tm-escape', esc)
    // Start keyboard navigation from the menu itself, not the row underneath —
    // unless something inside already took focus (the reply box autofocuses).
    if (!cardRef.current?.contains(document.activeElement)) cardRef.current?.focus({ preventScroll: true })
    return () => {
      overlay.removeEventListener('tm-escape', esc)
      window.clearTimeout(timer.current)
    }
  }, [])

  const schedule = (next: string | null, delay: number) => {
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setOpenSub(next), delay)
  }

  const move = (container: HTMLElement | null, dir: 1 | -1) => {
    const items = [...(container?.querySelectorAll<HTMLButtonElement>(':scope > .ctxmenu-item:not(:disabled)') ?? [])]
    if (!items.length) return
    const i = items.indexOf(document.activeElement as HTMLButtonElement)
    items[(i + dir + items.length) % items.length].focus()
  }

  const openFlyout = (id: string, focusFirst: boolean) => {
    window.clearTimeout(timer.current)
    setOpenSub(id)
    if (focusFirst) requestAnimationFrame(() => requestAnimationFrame(() => move(subRef.current, 1)))
  }

  const renderEntries = (list: ContextEntry[], inFlyout: boolean) => list.map((entry, i) => {
    if (entry.kind === 'sep') return <div key={`sep-${i}`} className="ctxmenu-sep" />
    if (entry.kind === 'label') return <div key={`label-${i}`} className="ctxmenu-label">{entry.label}</div>
    if (entry.kind === 'submenu') {
      const isOpen = openSub === entry.id
      return (
        <button
          key={entry.id}
          ref={(el) => { if (el) rowRefs.current.set(entry.id, el); else rowRefs.current.delete(entry.id) }}
          className={`ctxmenu-item ctxmenu-item--sub ${isOpen ? 'is-open' : ''}`}
          role="menuitem"
          aria-haspopup="menu"
          aria-expanded={isOpen}
          disabled={entry.disabled}
          title={entry.hint}
          data-testid={`ctx:${entry.id}`}
          onMouseEnter={() => schedule(entry.id, OPEN_DELAY_MS)}
          onClick={() => openFlyout(entry.id, false)}
          onKeyDown={(e) => { if (e.key === 'ArrowRight' || e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); openFlyout(entry.id, true) } }}
        >
          {entry.icon && <span className="ctxmenu-ic">{entry.icon}</span>}
          <span className="ctxmenu-text">{entry.label}</span>
          <ChevronRight className="ctxmenu-subchev" strokeWidth={2} />
        </button>
      )
    }
    return (
      <button
        key={entry.id}
        className="ctxmenu-item"
        role="menuitem"
        disabled={entry.disabled}
        title={entry.hint}
        data-testid={`ctx:${entry.id}`}
        onMouseEnter={inFlyout ? undefined : () => schedule(null, CLOSE_DELAY_MS)}
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
  })

  const flyout = entries.find((e): e is Extract<ContextEntry, { kind: 'submenu' }> => e.kind === 'submenu' && e.id === openSub)
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
          if (e.key === 'ArrowDown') { e.preventDefault(); move(cardRef.current, 1) }
          else if (e.key === 'ArrowUp') { e.preventDefault(); move(cardRef.current, -1) }
        }}
      >
        {header && <div className="ctxmenu-head">{header}</div>}
        {children}
        {renderEntries(entries, false)}
      </div>
      {flyout && (
        <div
          ref={subRef}
          className={`ctxmenu ctxmenu--flyout ${subPos?.left ? 'is-left' : ''}`}
          style={{ left: subPos?.x ?? -9999, top: subPos?.y ?? -9999 }}
          role="menu"
          data-testid={`ctx-flyout:${flyout.id}`}
          onMouseEnter={() => window.clearTimeout(timer.current)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); e.stopPropagation(); move(subRef.current, 1) }
            else if (e.key === 'ArrowUp') { e.preventDefault(); e.stopPropagation(); move(subRef.current, -1) }
            else if (e.key === 'ArrowLeft') { e.preventDefault(); e.stopPropagation(); setOpenSub(null); rowRefs.current.get(flyout.id)?.focus() }
          }}
        >
          {renderEntries(flyout.entries, true)}
        </div>
      )}
    </div>,
    host
  )
}

/** Drop labels and separators that no item follows, and doubled separators. */
export function tidyEntries(entries: (ContextEntry | false | null | undefined)[]): ContextEntry[] {
  const list = entries.filter((e): e is ContextEntry => !!e)
  const out: ContextEntry[] = []
  const isAction = (e: ContextEntry | undefined) => e?.kind === 'item' || e?.kind === 'submenu'
  list.forEach((e, i) => {
    const actionAhead = list.slice(i + 1).some(isAction)
    if (e.kind === 'label' && !isAction(list[i + 1])) return
    if (e.kind === 'sep' && (!actionAhead || !isAction(out.at(-1)))) return
    if (e.kind === 'submenu' && !e.entries.some(isAction)) return
    out.push(e)
  })
  return out
}
