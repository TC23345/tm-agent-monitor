import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Search } from 'lucide-react'
import { parseQuery, rankItems, type PaletteSection } from '@shared/palette.mjs'

export interface PaletteItem {
  id: string
  section: PaletteSection
  label: string
  /** Muted text after the label: a cwd, an agent's activity, a window's app. */
  detail?: string
  /** Extra words the search should hit (e.g. 'shell' for New terminal). */
  keywords?: string[]
  icon?: ReactNode
  /** Shortcut chips shown at the right, e.g. ['Ctrl', 'Shift', '`']. */
  keys?: string[]
  run: () => void
}

const SECTION_LABEL: Record<PaletteSection, string> = {
  command: 'Commands',
  agent: 'Coding agents',
  window: 'Open windows'
}

interface Props {
  items: PaletteItem[]
  onClose: () => void
}

/**
 * VS Code-style quick open: one input, one ranked list, keyboard-first. Every
 * app action, live agent, and open window is an item; `>` `@` `#` narrow the
 * list. Ranking is `@shared/palette.mjs` so what Enter runs is testable.
 */
export function CommandPalette({ items, onClose }: Props) {
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const results = useMemo(() => rankItems(items, query, 60), [items, query])
  const { mode } = parseQuery(query)

  useEffect(() => { inputRef.current?.focus() }, [])
  // A new query restarts at the top; an unchanged list keeps its selection.
  useEffect(() => { setActive(0) }, [query])
  useEffect(() => {
    const row = listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)
    row?.scrollIntoView({ block: 'nearest' })
  }, [active, results])

  const run = (item: PaletteItem | undefined) => {
    if (!item) return
    onClose()
    item.run()
  }

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'ArrowDown') {
      setActive((i) => Math.min(i + 1, Math.max(0, results.length - 1)))
    } else if (event.key === 'ArrowUp') {
      setActive((i) => Math.max(i - 1, 0))
    } else if (event.key === 'Enter') {
      run(results[active])
    } else if (event.key === 'Escape') {
      onClose()
    } else if (event.key === 'Tab') {
      // Tab cycles the section prefixes so the mouse never has to leave the input.
      const next = mode === null ? '>' : mode === 'command' ? '@' : mode === 'agent' ? '#' : ''
      setQuery(next + parseQuery(query).text)
    } else {
      return
    }
    event.preventDefault()
    event.stopPropagation()
  }

  // Group headers appear where the section changes, in ranked order.
  let lastSection: PaletteSection | null = null

  return (
    <div className="palette-backdrop" onPointerDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="palette" role="dialog" aria-label="Command palette" onKeyDown={onKeyDown}>
        <div className="palette-inputrow">
          <Search className="palette-ic" strokeWidth={2} />
          <input
            ref={inputRef}
            className="palette-input"
            data-testid="palette-input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search commands, agents, and windows  (> commands · @ agents · # windows)"
            spellCheck={false}
            autoComplete="off"
            aria-activedescendant={results[active] ? `palette-${results[active].id}` : undefined}
            aria-controls="palette-list"
          />
          <span className="palette-hint">
            <kbd>Tab</kbd> section · <kbd>Esc</kbd> close
          </span>
        </div>
        <div className="palette-list" id="palette-list" role="listbox" ref={listRef}>
          {results.length === 0 && <div className="palette-empty">No matches</div>}
          {results.map((item, index) => {
            const header = item.section !== lastSection ? SECTION_LABEL[item.section] : null
            lastSection = item.section
            return (
              <div key={item.id}>
                {header && <div className="palette-section">{header}</div>}
                <button
                  id={`palette-${item.id}`}
                  data-index={index}
                  role="option"
                  data-testid={`palette:${item.id}`}
                  aria-selected={index === active}
                  className={`palette-row ${index === active ? 'is-active' : ''}`}
                  onMouseMove={() => { if (index !== active) setActive(index) }}
                  onClick={() => run(item)}
                >
                  <span className="palette-row-ic">{item.icon}</span>
                  <span className="palette-row-label">{item.label}</span>
                  {item.detail && <span className="palette-row-detail">{item.detail}</span>}
                  {item.keys && (
                    <span className="palette-keys">
                      {item.keys.map((k, i) => (
                        <span key={i}>
                          {i > 0 && <span className="palette-plus">+</span>}
                          <kbd>{k}</kbd>
                        </span>
                      ))}
                    </span>
                  )}
                </button>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
