import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { Terminal } from 'lucide-react'
import { FileTree } from './FileTree'
import { Splitter } from './Splitter'
import { TREE_DEFAULT, clampTreeWidth, folderLabel, pillLines, streamDuration, streamedLines } from '@shared/startPage.mjs'

export type FolderStart = 'claude' | 'codex' | 'shell'

/**
 * A folder's files as a pane (0.4.77): the project tree the sidebar head
 * shows, for any folder — a path clicked in a chat reply, a recent, Open
 * folder…. Since 0.4.78 (the user's `|`) the tree is the left column and the
 * pane's first session takes the rest: a chat or a terminal started here runs
 * *inside* this pane, beside its files. With nothing running, that side is
 * the red pill or the blue pill. A file click opens a file pane; the header
 * strip (App's `paneTools`) starts more sessions in new panes once this one
 * holds its own.
 */
export function FolderPane({ path, tree, onTree, onOpen, session, onStart }: {
  path: string
  /** The tree's dragged width; undefined = TREE_DEFAULT. */
  tree?: number
  /** A drag's width, or null to go back to the default (double-click). */
  onTree: (width: number | null) => void
  onOpen: (file: string) => void
  /** The chat or terminal running beside the tree, if one is. */
  session: ReactNode | null
  onStart: (kind: FolderStart) => void
}) {
  const root = useRef<HTMLDivElement>(null)
  const drag = useRef({ width: TREE_DEFAULT, pane: 0 })
  const label = folderLabel(path)
  const width = tree ?? TREE_DEFAULT
  return (
    <div className="folderpane is-split" ref={root} style={{ '--tree-w': `${width}px` } as CSSProperties} data-testid="folder-pane">
      <div className="folderpane-tree">
        <FileTree root={path} label={label} onOpen={onOpen} fill />
      </div>
      <Splitter
        className="splitter--folder"
        testId="splitter-folder"
        label="File tree width"
        title="File tree width — drag to resize, double-click to reset"
        onStart={() => { drag.current = { width: root.current?.querySelector<HTMLElement>('.folderpane-tree')?.offsetWidth ?? width, pane: root.current?.clientWidth ?? 0 } }}
        onMove={(delta) => onTree(clampTreeWidth(drag.current.width + delta, drag.current.pane))}
        onReset={() => onTree(null)}
      />
      <div className="folderpane-work" data-testid="folder-work">
        {session ?? <PillChoice label={label} onStart={onStart} />}
      </div>
    </div>
  )
}

/** True when the OS asks for less motion: the lines are simply there. */
function reducedMotion(): boolean {
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches } catch { return false }
}

/**
 * The empty session side (the user's ask: "a text animation that slowly streams in with a reference to the Matrix
 * … taking the red or the blue pill — choosing between Claude Code and Codex"). Morpheus's lines type themselves out
 * once per mount; the pills work from the first frame, so the scene never stands between the user and a session.
 */
function PillChoice({ label, onStart }: { label: string; onStart: (kind: FolderStart) => void }) {
  const lines = pillLines(label)
  const total = streamDuration(lines)
  const [elapsed, setElapsed] = useState(() => (reducedMotion() ? total : 0))
  useEffect(() => {
    if (elapsed >= total) return
    const began = performance.now() - elapsed
    let raf = 0
    const tick = () => {
      const t = performance.now() - began
      setElapsed(Math.min(t, total))
      if (t < total) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one run per mount (and per folder)
  }, [label])
  const { shown, current, done } = streamedLines(lines, elapsed)
  // The caret rides the line being typed, waits at the start of the next one during the pause, and blinks at the end once done.
  const caretAt = done ? shown.length - 1 : current
  const caret = <span className={`pillchoice-caret ${done ? 'is-rest' : ''}`} />
  return (
    <div className="pillchoice" data-testid="pill-choice">
      <div className="pillchoice-text" role="img" aria-label={lines.join(' ')} data-done={done || undefined}>
        {/* Every line is laid out from the first frame, its untyped rest invisible, so nothing below moves as it types. */}
        {lines.map((line, i) => {
          const typed = shown[i] ?? ''
          return (
            <p key={i} className={`pillchoice-line ${i === 0 ? 'is-wake' : ''}`}>
              {typed}
              {i === caretAt && caret}
              <span className="pillchoice-rest">{line.slice(typed.length)}</span>
            </p>
          )
        })}
      </div>
      <div className="pillchoice-pills">
        <button className="pill-btn is-red" onClick={() => onStart('claude')} title={`Start a TaylorMade CC (Claude Code) chat in ${label}, here beside the files`} data-testid="pill:claude">
          <span className="pill-capsule" aria-hidden />
          <span className="pill-text"><span className="pill-name">Claude Code</span><span className="pill-sub">the red pill · TaylorMade CC</span></span>
        </button>
        <button className="pill-btn is-blue" onClick={() => onStart('codex')} title={`Start a TaylorMade Codex chat in ${label}, here beside the files`} data-testid="pill:codex">
          <span className="pill-capsule" aria-hidden />
          <span className="pill-text"><span className="pill-name">Codex</span><span className="pill-sub">the blue pill · TaylorMade Codex</span></span>
        </button>
      </div>
      <button className="pillchoice-door" onClick={() => onStart('shell')} title={`A PowerShell terminal in ${label}, here beside the files`} data-testid="pill:shell">
        <Terminal strokeWidth={2} />Or no pill: a terminal here
      </button>
    </div>
  )
}
