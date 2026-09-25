import type { ReactNode } from 'react'
import { Star } from 'lucide-react'
import { tid } from '../testid'

/** One filter chip: a view, a group (with its dot) or a source (with its icon). */
export interface FilterChip {
  id: string
  label: string
  count: number
  active: boolean
  /** A group's colour dot. */
  dot?: string
  /** The Favorites star. */
  star?: boolean
  icon?: ReactNode
}

/**
 * The Filter Table's tabs (beautifului.dev 13), shared by the quick picker and
 * the Clipboard pane: chips of one height with even gaps, the count as a
 * small badge inside each, a clear active chip. Clicking one is the caller's
 * business — the picker has one filter, the pane keeps its sidebar's two.
 */
export function FilterChips({ chips, onPick, testPrefix, className = '', leading }: {
  chips: FilterChip[]
  onPick: (chip: FilterChip) => void
  testPrefix: string
  className?: string
  /** Rendered before the first chip — the pane's search circle. */
  leading?: ReactNode
}) {
  return (
    <div className={`picker-chips ${className}`} role="tablist" aria-label="Filter" data-testid={`${testPrefix}s`}>
      {leading}
      {chips.map((chip) => (
        <button
          key={chip.id}
          role="tab"
          aria-selected={chip.active}
          className={`picker-chip ${chip.active ? 'is-active' : ''}`}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onPick(chip)}
          data-testid={tid(testPrefix, chip.id)}
        >
          {chip.dot && <span className="clip-dot" style={{ background: chip.dot }} />}
          {chip.star && <Star className="picker-chip-star" strokeWidth={2} />}
          {chip.icon && <span className="picker-chip-ic">{chip.icon}</span>}
          <span className="picker-chip-label">{chip.label}</span>
          <span className="picker-chip-n">{chip.count}</span>
        </button>
      ))}
    </div>
  )
}

/** Tab / Shift+Tab: the chip after (or before) the active one, wrapping. */
export function nextChip(chips: FilterChip[], back: boolean): FilterChip | undefined {
  if (!chips.length) return undefined
  const at = chips.findIndex((c) => c.active)
  return chips[(Math.max(0, at) + (back ? chips.length - 1 : 1)) % chips.length]
}
