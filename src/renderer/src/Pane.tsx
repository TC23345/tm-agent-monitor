import type { DragEvent, ReactNode } from 'react'
import { Maximize2, Minimize2, X } from 'lucide-react'
import { PANE_KINDS, type PaneKind } from './panes'

interface Props {
  kind: PaneKind
  onClose: () => void
  /** Rendered right after the title — the launch-context chip, a cwd label. */
  context?: ReactNode
  /** Icon buttons in the header's action strip, before zoom and close. Each
   * pane kind brings its own tools (restart, clear, split…) — the header is
   * the editor-title bar, not a content picker. */
  tools?: ReactNode
  /** Zoom: this pane alone fills the grid. The others stay mounted and hidden,
   * so a zoom never disturbes a running shell. */
  zoomed?: boolean
  onZoom?: () => void
  /** Grid drag-and-drop: the header is the handle; the slot around it drops. */
  dragHandle?: {
    draggable: boolean
    onDragStart: (event: DragEvent) => void
    onDragEnd: (event: DragEvent) => void
  }
  children: ReactNode
}

/** One cell of the main frame: a titled, closable, draggable, zoomable pane
 * whose header carries its kind's tools. The kind itself is fixed for the
 * pane's life — swapping a terminal into a launcher would kill its shell, so
 * a different kind is a new pane (View → Add pane, or the palette). */
export function Pane({ kind, onClose, context, tools, zoomed, onZoom, dragHandle, children }: Props) {
  const meta = PANE_KINDS.find((p) => p.id === kind)!
  const Icon = meta.icon
  return (
    <section className="gpane">
      <div
        className={`gpane-head ${dragHandle ? 'gpane-head--drag' : ''}`}
        draggable={dragHandle?.draggable}
        onDragStart={(event) => {
          // Only the header background drags — a drag that starts on a button
          // is a misfire, not a move.
          if ((event.target as HTMLElement).closest('button')) {
            event.preventDefault()
            return
          }
          dragHandle?.onDragStart(event)
        }}
        onDragEnd={(event) => dragHandle?.onDragEnd(event)}
        onDoubleClick={(event) => {
          if ((event.target as HTMLElement).closest('button')) return
          onZoom?.()
        }}
      >
        <Icon className="gpane-ic" strokeWidth={2} />
        <span className="gpane-title" title={meta.hint}>{meta.label}</span>
        {context}
        <span className="gpane-actions">
          {tools && <span className="gpane-tools">{tools}</span>}
          {onZoom && (
            <button
              className="iconbtn iconbtn--sm"
              onClick={onZoom}
              title={zoomed ? 'Restore the grid (Esc, or double-click the header)' : 'Zoom this pane to fill the grid (double-click the header)'}
              aria-label={zoomed ? 'Restore the grid' : 'Zoom this pane'}
              aria-pressed={zoomed}
            >
              {zoomed ? <Minimize2 className="gear gear--sm" strokeWidth={2} /> : <Maximize2 className="gear gear--sm" strokeWidth={2} />}
            </button>
          )}
          <button className="iconbtn iconbtn--sm" onClick={onClose} title="Close this pane" aria-label="Close this pane">
            <X className="gear gear--sm" strokeWidth={2} />
          </button>
        </span>
      </div>
      <div className={`gpane-body ${kind === 'terminal' ? 'gpane-body--term' : ''}`}>{children}</div>
    </section>
  )
}
