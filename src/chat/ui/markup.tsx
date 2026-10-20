// The image viewer with markup, for an image in the composer (the user's call,
// 2026-10-20: "similar to Windows' snipping tool"): the image as large as the
// workspace allows, with a toolbar under it — pen, highlighter, box, arrow,
// text, eraser, six colours, undo, redo and clear. The marks are drawn on a
// canvas over the image in the image's own pixels (shared/markup.mjs) and only
// flattened into a PNG when the viewer closes, so reopening the image brings
// them back as marks to undo or erase. Closing keeps the marks (the X, Done,
// Escape or a click outside); undo or clear takes them off.
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { Check, Eraser, Highlighter, MoveUpRight, Pen, Redo2, Square, Trash, Type, Undo2, X, type LucideIcon } from 'lucide-react'
import {
  HIGHLIGHT_ALPHA, MARK_COLORS, TEXT_LINE, addPoint, arrowHead, commitMarks, fitSize, historyOf, keepMark, markAt, markWidth, normRect, redoMarks, sameMarks, undoMarks,
  type Mark, type MarkHistory, type MarkupTool
} from '../shared/markup.mjs'
import { useEscape } from './extras'

/** What the composer hands the viewer for one of its images: the image without marks, the marks, and where the result goes. */
export interface ImageEdit {
  /** The image as attached, before any marks (a data URL). */
  base: string
  marks: Mark[]
  /** The marked-up PNG and its marks, or null when nothing changed. No marks left means the image as attached. */
  onDone: (result: { src: string; marks: Mark[] } | null) => void
}

const TOOLS: { id: MarkupTool; label: string; key: string; icon: LucideIcon }[] = [
  { id: 'pen', label: 'Pen', key: 'p', icon: Pen },
  { id: 'highlight', label: 'Highlighter', key: 'h', icon: Highlighter },
  { id: 'box', label: 'Box', key: 'b', icon: Square },
  { id: 'arrow', label: 'Arrow', key: 'a', icon: MoveUpRight },
  { id: 'text', label: 'Text', key: 't', icon: Type },
  { id: 'eraser', label: 'Eraser', key: 'e', icon: Eraser }
]
const COLOR_NAMES = ['Red', 'Yellow', 'Green', 'Blue', 'White', 'Black']
const TEXT_FONT = '"Segoe UI", system-ui, sans-serif'

// The last tool and colour picked, for the next image this session.
let lastTool: MarkupTool = 'pen'
let lastColor = MARK_COLORS[0]!

type Draft = { mark: Mark } | { erasing: Mark[] } | null
interface TextDraft { x: number; y: number; size: number; value: string }

export function MarkupViewer({ src, name, marks: initial, onDone }: { src: string; name: string; marks: Mark[]; onDone: ImageEdit['onDone'] }) {
  const root = useRef<HTMLDivElement | null>(null)
  const stage = useRef<HTMLDivElement | null>(null)
  const canvas = useRef<HTMLCanvasElement | null>(null)
  const img = useRef<HTMLImageElement | null>(null)
  const textField = useRef<HTMLInputElement | null>(null)
  const [natural, setNatural] = useState<{ width: number; height: number } | null>(null)
  const [room, setRoom] = useState({ width: 0, height: 0 })
  const [tool, setTool] = useState<MarkupTool>(lastTool)
  const [color, setColor] = useState(lastColor)
  const [history, setHistory] = useState<MarkHistory>(() => historyOf(initial))
  const [draft, setDraft] = useState<Draft>(null)
  const [text, setText] = useState<TextDraft | null>(null)
  const done = useRef(false)

  useEffect(() => { lastTool = tool }, [tool])
  useEffect(() => { lastColor = color }, [color])
  useEffect(() => root.current?.focus(), [])

  // The room under the toolbar the image may fill (never past its own size).
  useLayoutEffect(() => {
    const el = stage.current
    if (!el) return
    const measure = () => setRoom({ width: el.clientWidth, height: el.clientHeight })
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const fit = natural ? fitSize(natural.width, natural.height, room.width, room.height) : null
  const scale = fit?.scale || 1

  const shown = draft && 'erasing' in draft ? draft.erasing : draft ? [...history.present, draft.mark] : history.present
  // Painted before the browser paints, so the canvas is always the state on screen, never a move behind it.
  useLayoutEffect(() => {
    const el = canvas.current
    const ctx = el?.getContext('2d')
    if (!el || !ctx || !natural) return
    ctx.clearRect(0, 0, el.width, el.height)
    for (const m of shown) paintMark(ctx, m)
  }, [shown, natural])

  // The text being typed is read from a ref too: Enter, a click elsewhere and the field's blur may all commit it
  // in one go, and only the first may.
  const typing = useRef<TextDraft | null>(null)
  typing.current = text
  const cancelText = () => { typing.current = null; setText(null) }
  // Keys (Ctrl+Z, the tool letters) are the viewer's only while focus is inside it: a text field that closes, or a
  // press on the canvas (which takes no focus), would leave it on the page, where Ctrl+Z is the page's own undo.
  const keepFocus = () => { if (!root.current?.contains(document.activeElement) || document.activeElement === textField.current) root.current?.focus({ preventScroll: true }) }
  const commitText = useCallback((): Mark[] => {
    const t = typing.current
    if (!t) return history.present
    typing.current = null
    setText(null)
    const ctx = canvas.current?.getContext('2d')
    let w = t.value.length * t.size * 0.6
    if (ctx) {
      ctx.font = textFont(t.size)
      w = ctx.measureText(t.value).width
    }
    const mark: Mark = { kind: 'text', color, size: t.size, x: t.x, y: t.y, w, text: t.value }
    if (!keepMark(mark, 0)) return history.present
    const next = [...history.present, mark]
    setHistory((h) => commitMarks(h, next))
    return next
  }, [color, history.present])

  /** Close, keeping the marks: the PNG goes back to the composer unless nothing changed. */
  const finish = () => {
    if (done.current) return
    done.current = true
    const marks = commitText()
    if (sameMarks(marks, initial)) return onDone(null)
    if (!marks.length || !natural || !img.current) return onDone({ src, marks: [] })
    const out = document.createElement('canvas')
    out.width = natural.width
    out.height = natural.height
    const ctx = out.getContext('2d')
    if (!ctx) return onDone(null)
    ctx.drawImage(img.current, 0, 0)
    for (const m of marks) paintMark(ctx, m)
    onDone({ src: out.toDataURL('image/png'), marks })
  }

  // Escape drops a text being typed first; otherwise it closes, keeping the marks.
  useEscape(root, () => (typing.current ? cancelText() : finish()))

  const undo = () => { cancelText(); setHistory(undoMarks) }
  const redo = () => { cancelText(); setHistory(redoMarks) }
  const clear = () => { cancelText(); if (history.present.length) setHistory((h) => commitMarks(h, [])) }

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.target instanceof HTMLInputElement) return
    const k = e.key.toLowerCase()
    if ((e.ctrlKey || e.metaKey) && !e.altKey) {
      if (k === 'z' && !e.shiftKey) { e.preventDefault(); undo() }
      else if (k === 'y' || (k === 'z' && e.shiftKey)) { e.preventDefault(); redo() }
      return
    }
    if (e.altKey || e.shiftKey) return
    const pick = TOOLS.find((t) => t.key === k)
    if (pick) { e.preventDefault(); setTool(pick.id) }
  }

  const toImage = (e: { clientX: number; clientY: number }) => {
    const r = canvas.current!.getBoundingClientRect()
    const nw = natural?.width ?? 1
    const nh = natural?.height ?? 1
    return { x: ((e.clientX - r.left) * nw) / r.width, y: ((e.clientY - r.top) * nh) / r.height }
  }

  const onPointerDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (e.button !== 0 || !natural) return
    e.preventDefault()
    const { x, y } = toImage(e)
    if (text) commitText()
    if (tool === 'text') {
      setText({ x, y, size: markWidth('text', scale), value: '' })
      return
    }
    keepFocus()
    e.currentTarget.setPointerCapture(e.pointerId)
    const width = markWidth(tool, scale)
    if (tool === 'eraser') {
      const list = history.present
      const hit = markAt(list, x, y, width / 2)
      putDraft({ erasing: hit < 0 ? list : list.filter((_, i) => i !== hit) })
    } else if (tool === 'pen' || tool === 'highlight') putDraft({ mark: { kind: tool, color, width, points: [x, y] } })
    else if (tool === 'box') putDraft({ mark: { kind: 'box', color, width, x, y, w: 0, h: 0 } })
    else if (tool === 'arrow') putDraft({ mark: { kind: 'arrow', color, width, x1: x, y1: y, x2: x, y2: y } })
    anchor.current = { x, y }
  }
  const anchor = useRef({ x: 0, y: 0 })
  // The mark being drawn, read by every pointer event from this ref: events can come faster than renders, and a
  // handler reading the last render's draft would drop the points in between.
  const drafting = useRef<Draft>(null)
  const putDraft = (d: Draft) => { drafting.current = d; setDraft(d) }

  const onPointerMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const draft = drafting.current
    if (!draft || !e.currentTarget.hasPointerCapture(e.pointerId)) return
    const { x, y } = toImage(e)
    if ('erasing' in draft) {
      const hit = markAt(draft.erasing, x, y, markWidth('eraser', scale) / 2)
      if (hit >= 0) putDraft({ erasing: draft.erasing.filter((_, i) => i !== hit) })
      return
    }
    const m = draft.mark
    if (m.kind === 'pen' || m.kind === 'highlight') putDraft({ mark: { ...m, points: addPoint(m.points, x, y, 1 / scale) } })
    else if (m.kind === 'box') putDraft({ mark: { ...m, ...normRect(anchor.current.x, anchor.current.y, x, y) } })
    else if (m.kind === 'arrow') putDraft({ mark: { ...m, x2: x, y2: y } })
  }

  const onPointerUp = () => {
    const draft = drafting.current
    if (!draft) return
    if ('erasing' in draft) {
      if (draft.erasing.length !== history.present.length) setHistory((h) => commitMarks(h, draft.erasing))
    } else if (keepMark(draft.mark, 4 / scale)) setHistory((h) => commitMarks(h, [...h.present, draft.mark]))
    putDraft(null)
  }

  const size = natural ? `${natural.width}×${natural.height}` : null
  const cursor = tool === 'text' ? 'text' : 'crosshair'
  return (
    <div ref={root} className="chat-preview is-markup" tabIndex={-1} data-escape-close="" onClick={finish} onKeyDown={onKeyDown} role="dialog" aria-label={name} data-testid="chat-image-preview">
      <div ref={stage} className="chat-markup-stage">
        <div className="chat-markup-image" style={fit ? { width: fit.width, height: fit.height } : undefined} onClick={(e) => e.stopPropagation()}>
          <img
            ref={img} src={src} alt={name} draggable={false}
            onLoad={(e) => setNatural({ width: e.currentTarget.naturalWidth, height: e.currentTarget.naturalHeight })}
          />
          {natural ? (
            <canvas
              ref={canvas} width={natural.width} height={natural.height} style={{ cursor }}
              onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
              data-testid="chat-markup-canvas"
            />
          ) : null}
          {text ? (
            <input
              ref={textField} autoFocus className="chat-markup-text" value={text.value} spellCheck={false}
              style={{ left: text.x * scale, top: text.y * scale, fontSize: text.size * scale, color, width: `${Math.max(3, text.value.length + 2)}ch` }}
              onChange={(e) => setText({ ...text, value: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); commitText(); keepFocus() }
                else if (e.key === 'Escape' && !e.defaultPrevented) { e.preventDefault(); e.stopPropagation(); cancelText(); keepFocus() }
              }}
              onBlur={() => commitText()}
              data-testid="chat-markup-text"
            />
          ) : null}
        </div>
      </div>
      <span className="chat-preview-cap" onClick={(e) => e.stopPropagation()}>{size ? `${name} · ${size}` : name}</span>
      <div className="chat-markup-bar" role="toolbar" aria-label="Markup" onClick={(e) => e.stopPropagation()} data-testid="chat-markup-bar">
        {TOOLS.map((t) => (
          <button
            key={t.id} className={`chat-markup-btn ${tool === t.id ? 'is-on' : ''}`} onClick={() => { if (text) commitText(); setTool(t.id) }}
            title={`${t.label} (${t.key.toUpperCase()})`} aria-label={t.label} aria-pressed={tool === t.id} data-testid={`chat-markup-tool:${t.id}`}
          >
            <t.icon className="chat-ic" aria-hidden />
          </button>
        ))}
        <span className="chat-markup-sep" aria-hidden />
        {MARK_COLORS.map((c, i) => (
          <button
            key={c} className={`chat-markup-swatch ${color === c ? 'is-on' : ''}`} onClick={() => setColor(c)}
            title={COLOR_NAMES[i]} aria-label={COLOR_NAMES[i]} aria-pressed={color === c} data-testid={`chat-markup-color:${i}`}
          >
            <span style={{ background: c }} />
          </button>
        ))}
        <span className="chat-markup-sep" aria-hidden />
        <button className="chat-markup-btn" onClick={undo} disabled={!history.past.length} title="Undo (Ctrl+Z)" aria-label="Undo" data-testid="chat-markup-undo"><Undo2 className="chat-ic" aria-hidden /></button>
        <button className="chat-markup-btn" onClick={redo} disabled={!history.future.length} title="Redo (Ctrl+Y)" aria-label="Redo" data-testid="chat-markup-redo"><Redo2 className="chat-ic" aria-hidden /></button>
        <button className="chat-markup-btn" onClick={clear} disabled={!history.present.length} title="Clear all marks" aria-label="Clear all marks" data-testid="chat-markup-clear"><Trash className="chat-ic" aria-hidden /></button>
        <span className="chat-markup-sep" aria-hidden />
        <button className="chat-markup-btn is-done" onClick={finish} title="Done" aria-label="Done" data-testid="chat-markup-done"><Check className="chat-ic" aria-hidden /></button>
      </div>
      <button className="chat-iconbtn chat-preview-x" aria-label="Close (Esc)" title="Close (Esc)" onClick={(e) => { e.stopPropagation(); finish() }}><X className="chat-ic" /></button>
    </div>
  )
}

function textFont(size: number): string {
  return `600 ${size}px ${TEXT_FONT}`
}

/** One mark on a canvas the image's size. */
export function paintMark(ctx: CanvasRenderingContext2D, m: Mark): void {
  ctx.save()
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.strokeStyle = m.color
  ctx.fillStyle = m.color
  switch (m.kind) {
    case 'pen':
    case 'highlight': {
      if (m.kind === 'highlight') ctx.globalAlpha = HIGHLIGHT_ALPHA
      ctx.lineWidth = m.width
      const p = m.points
      if (p.length === 2) {
        ctx.beginPath()
        ctx.arc(p[0]!, p[1]!, m.width / 2, 0, Math.PI * 2)
        ctx.fill()
        break
      }
      ctx.beginPath()
      ctx.moveTo(p[0]!, p[1]!)
      for (let i = 2; i + 1 < p.length; i += 2) ctx.lineTo(p[i]!, p[i + 1]!)
      ctx.stroke()
      break
    }
    case 'box':
      ctx.lineWidth = m.width
      ctx.strokeRect(m.x, m.y, m.w, m.h)
      break
    case 'arrow': {
      const head = arrowHead(m.x1, m.y1, m.x2, m.y2, m.width)
      if (!head) break
      ctx.lineWidth = m.width
      ctx.beginPath()
      ctx.moveTo(m.x1, m.y1)
      ctx.lineTo(head.base[0], head.base[1])
      ctx.stroke()
      ctx.beginPath()
      ctx.moveTo(m.x2, m.y2)
      ctx.lineTo(head.left[0], head.left[1])
      ctx.lineTo(head.right[0], head.right[1])
      ctx.closePath()
      ctx.fill()
      break
    }
    case 'text':
      ctx.font = textFont(m.size)
      ctx.textBaseline = 'top'
      // A contrasting edge keeps the text readable on any screenshot.
      ctx.lineWidth = Math.max(2, m.size * 0.16)
      ctx.strokeStyle = m.color === '#111111' ? 'rgba(255, 255, 255, 0.85)' : 'rgba(0, 0, 0, 0.6)'
      ctx.strokeText(m.text, m.x, m.y + (m.size * (TEXT_LINE - 1)) / 2)
      ctx.fillText(m.text, m.x, m.y + (m.size * (TEXT_LINE - 1)) / 2)
      break
  }
  ctx.restore()
}
