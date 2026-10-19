// The edit row's diff, after the Claude Code extension's (docs/rea-findings.md,
// webview pass): side by side when the pane is wider than 900 px (back to
// inline under 876, so a drag across the line does not flicker), no line
// numbers, words wrapped, the height capped at 200 px with the rest one click
// away. The extension embeds Monaco's diff editor; this is plain markup over
// `src/shared/diff.mjs`. A removed line and the added line that replaced it
// mark the words that changed (`wordDiff`), as Monaco marks characters.
import { Fragment, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { changeLines, splitRows, wordDiff, type DiffLine, type WordSegment } from '../shared/diff.mjs'
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

/**
 * The changed words of each removed line and the added line paired with it —
 * the same pairing `splitRows` uses: a run of removals against the run of
 * additions that follows it, line for line.
 */
function pairWords(lines: DiffLine[]): Map<number, WordSegment[]> {
  const out = new Map<number, WordSegment[]>()
  let i = 0
  while (i < lines.length) {
    if (lines[i]?.type !== 'del') {
      i++
      continue
    }
    const dels: number[] = []
    const adds: number[] = []
    while (i < lines.length && lines[i]?.type === 'del') dels.push(i++)
    while (i < lines.length && lines[i]?.type === 'add') adds.push(i++)
    for (let k = 0; k < Math.min(dels.length, adds.length); k++) {
      const d = dels[k]!
      const a = adds[k]!
      const { left, right } = wordDiff(lines[d]!.text, lines[a]!.text)
      out.set(d, left)
      out.set(a, right)
    }
  }
  return out
}

function Words({ text, segments }: { text: string; segments?: WordSegment[] }): ReactNode {
  if (!segments || segments.every((s) => s.changed)) return text || ' '
  return segments.map((s, i) => (s.changed ? <mark key={i} className="chat-dw">{s.text}</mark> : s.text))
}

function InlineLines({ lines }: { lines: DiffLine[] }) {
  const words = useMemo(() => pairWords(lines), [lines])
  return (
    <>
      {lines.map((l, i) => l.type === 'hunk'
        ? <div key={i} className="chat-dl is-hunk">⋯</div>
        : (
          <div key={i} className={`chat-dl is-${l.type}`}>
            <span className="chat-dl-mark" aria-hidden>{MARK[l.type]}</span>
            <span className="chat-dl-text"><Words text={l.text} segments={words.get(i)} /></span>
          </div>
        ))}
    </>
  )
}

function SplitLines({ lines }: { lines: DiffLine[] }) {
  const rows = useMemo(() => splitRows(lines).map((r) => ({ ...r, words: r.left?.type === 'del' && r.right?.type === 'add' ? wordDiff(r.left.text, r.right.text) : null })), [lines])
  return (
    <div className="chat-dsplit">
      {rows.map((r, i) => r.hunk !== undefined
        ? <div key={i} className="chat-dl is-hunk is-span">⋯</div>
        : (
          <Fragment key={i}>
            <Cell line={r.left} side="left" segments={r.words?.left} />
            <Cell line={r.right} side="right" segments={r.words?.right} />
          </Fragment>
        ))}
    </div>
  )
}

function Cell({ line, side, segments }: { line: DiffLine | null; side: 'left' | 'right'; segments?: WordSegment[] }) {
  if (!line) return <div className={`chat-dl is-empty is-${side}`} />
  return (
    <div className={`chat-dl is-${line.type} is-${side}`}>
      <span className="chat-dl-mark" aria-hidden>{MARK[line.type]}</span>
      <span className="chat-dl-text"><Words text={line.text} segments={segments} /></span>
    </div>
  )
}
