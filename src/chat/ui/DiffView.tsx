// The edit row's diff, after the Claude Code extension's (docs/rea-findings.md,
// webview pass): side by side when the pane is wider than 900 px (back to
// inline under 876, so a drag across the line does not flicker), no line
// numbers, words wrapped, the height capped at 200 px with the rest one click
// away. The extension embeds Monaco's diff editor; this is plain markup over
// `src/shared/diff.mjs`.
import { Fragment, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { changeLines, splitRows, type DiffLine } from '../shared/diff.mjs'
import type { FileChange } from '../shared/chatModel.mjs'

const SPLIT_ON = 900
const SPLIT_OFF = 876
const CAP_PX = 200
/** Collapsed, only this many lines are rendered — more than 200 px holds. */
const COLLAPSED_LINES = 40
/** Open, a pathological diff stops here. */
const MAX_LINES = 3000

const MARK: Record<DiffLine['type'], string> = { add: '+', del: '−', eq: ' ', hunk: '' }

export function DiffView({ edits }: { edits: FileChange[] }) {
  const host = useRef<HTMLDivElement | null>(null)
  const body = useRef<HTMLDivElement | null>(null)
  const [split, setSplit] = useState(false)
  const [open, setOpen] = useState(false)
  const [overflow, setOverflow] = useState(false)
  const files = useMemo(() => edits.map((e) => ({ path: e.path, lines: changeLines(e) })), [edits])
  const total = files.reduce((n, f) => n + f.lines.length, 0)
  const headers = new Set(files.map((f) => f.path)).size > 1

  useLayoutEffect(() => {
    const el = host.current
    if (!el) return
    const fit = (w: number) => setSplit((was) => (was ? w > SPLIT_OFF : w > SPLIT_ON))
    fit(el.clientWidth)
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) fit(e.contentRect.width)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useLayoutEffect(() => {
    const el = body.current
    if (!el || open) return
    setOverflow(el.scrollHeight > CAP_PX + 1 || total > COLLAPSED_LINES)
  }, [open, split, total, files])

  let budget = open ? MAX_LINES : COLLAPSED_LINES
  return (
    <div className="chat-diff" ref={host} data-testid="chat-diff">
      <div className={`chat-diff-body ${open ? 'is-open' : ''}`} ref={body}>
        {files.map((f, i) => {
          const lines = f.lines.slice(0, Math.max(0, budget))
          budget -= lines.length
          return (
            <Fragment key={`${f.path}:${i}`}>
              {headers ? <div className="chat-diff-file" title={f.path}>{f.path}</div> : null}
              {split ? <SplitLines lines={lines} /> : <InlineLines lines={lines} />}
            </Fragment>
          )
        })}
        {open && total > MAX_LINES ? <div className="chat-diff-note">{total - MAX_LINES} more lines not shown</div> : null}
      </div>
      {overflow || open ? (
        <button className="chat-diff-more" onClick={() => setOpen((v) => !v)} data-testid="chat-diff-more">
          {open ? 'Show less' : `Show all ${total} lines`}
        </button>
      ) : null}
    </div>
  )
}

function InlineLines({ lines }: { lines: DiffLine[] }) {
  return (
    <>
      {lines.map((l, i) => l.type === 'hunk'
        ? <div key={i} className="chat-dl is-hunk">⋯</div>
        : (
          <div key={i} className={`chat-dl is-${l.type}`}>
            <span className="chat-dl-mark" aria-hidden>{MARK[l.type]}</span>
            <span className="chat-dl-text">{l.text || ' '}</span>
          </div>
        ))}
    </>
  )
}

function SplitLines({ lines }: { lines: DiffLine[] }) {
  return (
    <div className="chat-dsplit">
      {splitRows(lines).map((r, i) => r.hunk !== undefined
        ? <div key={i} className="chat-dl is-hunk is-span">⋯</div>
        : (
          <Fragment key={i}>
            <Cell line={r.left} side="left" />
            <Cell line={r.right} side="right" />
          </Fragment>
        ))}
    </div>
  )
}

function Cell({ line, side }: { line: DiffLine | null; side: 'left' | 'right' }) {
  if (!line) return <div className={`chat-dl is-empty is-${side}`} />
  return (
    <div className={`chat-dl is-${line.type} is-${side}`}>
      <span className="chat-dl-mark" aria-hidden>{MARK[line.type]}</span>
      <span className="chat-dl-text">{line.text || ' '}</span>
    </div>
  )
}
