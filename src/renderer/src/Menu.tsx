import { useEffect, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react'
import { Check } from 'lucide-react'
import { tid } from './testid'

/**
 * Dropdown panel with the gliding hover highlight: one absolutely-positioned
 * pill slides between rows instead of each row painting its own hover, so
 * moving down a menu feels continuous. Rows sit above it on their own layer.
 * Positioned by its parent (`.menu-wrap` / any `position: relative` anchor).
 */
export function MenuPop({ children, onAway, ignoreSelector }: {
  children: ReactNode
  /** Close on pointerdown outside. `ignoreSelector` exempts the trigger, whose
   * own click handles the toggle — without it every toggle closes then reopens. */
  onAway?: () => void
  ignoreSelector?: string
}) {
  const [box, setBox] = useState<{ top: number; height: number } | null>(null)
  const [hovered, setHovered] = useState(false)

  useEffect(() => {
    if (!onAway) return
    const onDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement
      if (ignoreSelector && target?.closest?.(ignoreSelector)) return
      onAway()
    }
    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
  }, [onAway, ignoreSelector])

  const onOver = (event: ReactMouseEvent) => {
    const row = (event.target as HTMLElement).closest?.('.menu-item') as HTMLButtonElement | null
    if (!row || row.disabled) {
      setHovered(false)
      return
    }
    setBox({ top: row.offsetTop, height: row.offsetHeight })
    setHovered(true)
  }

  return (
    <div className="menu-pop" onMouseOver={onOver} onMouseLeave={() => setHovered(false)}>
      <span
        aria-hidden
        className="menu-glide"
        style={{
          top: box?.top ?? 0,
          height: box?.height ?? 0,
          opacity: box && hovered ? 1 : 0
        }}
      />
      {children}
    </div>
  )
}

export function MenuItem({ icon, label, hint, disabled, onClick }: {
  icon?: ReactNode
  label: string
  hint?: string
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <button className="menu-item" disabled={disabled} onClick={onClick} title={hint} data-testid={tid('menu', label)}>
      <span className="menu-item-ic">{icon}</span>
      {label}
    </button>
  )
}

/** Toggleable row: a right-aligned check that stays in layout (invisible, not
 * removed) when unchecked, so rows never reflow as selection changes.
 *
 * `onClick` gets the event because some rows are launches, where Shift means
 * "in an external window"; `testId` overrides the label-derived default for a
 * row automation already knows by another name. */
export function MenuCheckItem({ icon, label, hint, checked, onClick, testId }: {
  icon?: ReactNode
  label: string
  hint?: string
  checked: boolean
  onClick: (event: ReactMouseEvent<HTMLButtonElement>) => void
  testId?: string
}) {
  return (
    <button className="menu-item" onClick={onClick} title={hint} aria-pressed={checked} data-testid={testId ?? tid('menu', label)}>
      <span className="menu-item-ic">{icon}</span>
      {label}
      <span className={`menu-check ${checked ? '' : 'menu-check--off'}`}>
        <Check strokeWidth={2.5} />
      </span>
    </button>
  )
}
