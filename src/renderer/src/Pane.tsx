import type { DragEvent, ReactNode } from 'react'
import { ChevronDown, X } from 'lucide-react'
import { PANE_KINDS, isUniqueKind, type PaneKind } from './panes'

interface Props {
  kind: PaneKind
  /** Unique kinds shown by OTHER panes, so the picker can't create a duplicate. */
  taken: PaneKind[]
  onKind: (kind: PaneKind) => void
  onClose: () => void
  /** Rendered by the pane header, right of the title (refresh, context chip…). */
  actions?: ReactNode
  /** Grid drag-and-drop: the header is the handle; the slot around it drops. */
  dragHandle?: {
    draggable: boolean
    onDragStart: (event: DragEvent) => void
    onDragEnd: (event: DragEvent) => void
  }
  children: ReactNode
}

/** One cell of the main frame: a titled, swappable, closable, draggable pane. */
export function Pane({ kind, taken, onKind, onClose, actions, dragHandle, children }: Props) {
  const meta = PANE_KINDS.find((p) => p.id === kind)!
  const Icon = meta.icon
  return (
    <section className="gpane">
      <div
        className={`gpane-head ${dragHandle ? 'gpane-head--drag' : ''}`}
        draggable={dragHandle?.draggable}
        onDragStart={(event) => {
          // Only the header background drags — a drag that starts on the picker
          // or a button is a misfire, not a move.
          if ((event.target as HTMLElement).closest('select, button')) {
            event.preventDefault()
            return
          }
          dragHandle?.onDragStart(event)
        }}
        onDragEnd={(event) => dragHandle?.onDragEnd(event)}
      >
        <Icon className="gpane-ic" strokeWidth={2} />
        <select
          className="gpane-select"
          value={kind}
          onChange={(e) => onKind(e.target.value as PaneKind)}
          title={meta.hint}
          aria-label="Pane content"
        >
          {PANE_KINDS.map((p) => (
            <option key={p.id} value={p.id} disabled={p.id !== kind && isUniqueKind(p.id) && taken.includes(p.id)}>
              {p.label}
            </option>
          ))}
        </select>
        <ChevronDown className="gpane-caret" strokeWidth={2} aria-hidden />
        <span className="gpane-actions">
          {actions}
          <button className="iconbtn iconbtn--sm" onClick={onClose} title="Close this pane" aria-label="Close this pane">
            <X className="gear gear--sm" strokeWidth={2} />
          </button>
        </span>
      </div>
      <div className={`gpane-body ${kind === 'terminal' ? 'gpane-body--term' : ''}`}>{children}</div>
    </section>
  )
}
