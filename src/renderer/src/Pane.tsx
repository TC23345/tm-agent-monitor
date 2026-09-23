import { useEffect, useRef, useState, type DragEvent, type ReactNode } from 'react'
import { BellRing, Check, Maximize2, Minimize2, X } from 'lucide-react'
import { PANE_KINDS, type PaneKind } from './panes'

interface Props {
  kind: PaneKind
  /** Overrides the kind's label — a terminal pane says what it runs
   * (Claude Code / Codex / Terminal) instead of wearing a chip. */
  title?: string
  /** The title stands alone: no kind icon, and written as given rather than
   * uppercased (the notepad's "TC's NOTES" keeps its lowercase s). */
  plainTitle?: boolean
  onClose: () => void
  /** Rendered right after the title — the launch-context chip, a cwd label. */
  context?: ReactNode
  /** The pane's full folder, printed after the chip so it never needs a hover;
   * the tail (the part that changes) stays visible, the head ellipsises. A
   * terminal pane passes its *live* cwd. */
  path?: string
  /** Clicking the path (or the chip, which App wraps with the same handler)
   * copies it; the header flashes "Copied" for a second. */
  onCopyPath?: () => void
  /** Icon buttons in the header's action strip, before zoom and close. Each
   * pane kind brings its own tools (restart, clear, split…) — the header is
   * the editor-title bar, not a content picker. */
  tools?: ReactNode
  /** The waiting session that runs in this pane is asking this — a pulsing
   * badge in the header says so before the terminal's own output does. */
  attention?: string
  /** Zoom: this pane alone fills the grid. The others stay mounted and hidden,
   * so a zoom never disturbs a running shell. */
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
 * pane's life — swapping one kind for another would kill a running shell, so
 * a different kind is a new pane (View → Add pane, or the palette). */
export function Pane({ kind, title, plainTitle, onClose, context, path, onCopyPath, tools, attention, zoomed, onZoom, dragHandle, children }: Props) {
  const meta = PANE_KINDS.find((p) => p.id === kind)!
  const Icon = meta.icon
  const [copied, setCopied] = useState(false)
  const copiedTimer = useRef<number | null>(null)
  useEffect(() => () => { if (copiedTimer.current) window.clearTimeout(copiedTimer.current) }, [])
  const copy = () => {
    onCopyPath?.()
    setCopied(true)
    if (copiedTimer.current) window.clearTimeout(copiedTimer.current)
    copiedTimer.current = window.setTimeout(() => setCopied(false), 1200)
  }
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
        {!plainTitle && <Icon className="gpane-ic" strokeWidth={2} />}
        <span className={`gpane-title ${plainTitle ? 'gpane-title--plain' : ''}`} title={meta.hint}>{title ?? meta.label}</span>
        {/* The chip shares the path's click: both copy, both flash. */}
        {context && onCopyPath ? <span className="gpane-ctxwrap" onClick={copy}>{context}</span> : context}
        {path && (
          <button
            className={`gpane-path ${copied ? 'is-copied' : ''}`}
            onClick={copy}
            title={copied ? 'Copied' : `${path}\nClick to copy`}
            data-testid="pane-path"
          >
            {copied ? <><Check className="gpane-path-ic" strokeWidth={2.5} />Copied</> : <span className="gpane-path-text">{path}</span>}
          </button>
        )}
        {path && <span className="gpane-sep" aria-hidden="true" />}
        {attention && (
          <span className="gpane-attn" title={`Waiting for your input: ${attention}`} data-testid="pane-attention">
            <BellRing strokeWidth={2} />
          </span>
        )}
        <span className="gpane-actions">
          {tools && <span className="gpane-tools">{tools}</span>}
          {onZoom && (
            <button
              className="iconbtn iconbtn--sm"
              onClick={onZoom}
              title={zoomed ? 'Restore the grid (Esc, or double-click the header)' : 'Zoom this pane to fill the grid (double-click the header)'}
              aria-label={zoomed ? 'Restore the grid' : 'Zoom this pane'}
              aria-pressed={zoomed}
              data-testid="pane-zoom"
            >
              {zoomed ? <Minimize2 className="gear gear--sm" strokeWidth={2} /> : <Maximize2 className="gear gear--sm" strokeWidth={2} />}
            </button>
          )}
          <button className="iconbtn iconbtn--sm" onClick={onClose} title="Close this pane" aria-label="Close this pane" data-testid="pane-close">
            <X className="gear gear--sm" strokeWidth={2} />
          </button>
        </span>
      </div>
      <div className={`gpane-body ${kind === 'terminal' ? 'gpane-body--term' : ''}`}>{children}</div>
    </section>
  )
}
