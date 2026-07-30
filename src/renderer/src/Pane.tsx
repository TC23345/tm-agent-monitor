import type { ReactNode } from 'react'
import { ChevronDown, X } from 'lucide-react'
import { PANE_KINDS, type PaneKind } from './panes'

interface Props {
  kind: PaneKind
  /** Kinds already shown elsewhere, so the picker can't create a duplicate. */
  taken: PaneKind[]
  onKind: (kind: PaneKind) => void
  onClose: () => void
  /** Rendered by the pane header, right of the title (refresh, context chip…). */
  actions?: ReactNode
  children: ReactNode
}

/** One cell of the main frame: a titled, swappable, closable content pane. */
export function Pane({ kind, taken, onKind, onClose, actions, children }: Props) {
  const meta = PANE_KINDS.find((p) => p.id === kind)!
  const Icon = meta.icon
  return (
    <section className="gpane">
      <div className="gpane-head">
        <Icon className="gpane-ic" strokeWidth={2} />
        <select
          className="gpane-select"
          value={kind}
          onChange={(e) => onKind(e.target.value as PaneKind)}
          title={meta.hint}
          aria-label="Pane content"
        >
          {PANE_KINDS.map((p) => (
            <option key={p.id} value={p.id} disabled={p.id !== kind && taken.includes(p.id)}>
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
      <div className="gpane-body">{children}</div>
    </section>
  )
}
