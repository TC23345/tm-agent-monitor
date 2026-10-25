import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { Terminal } from 'lucide-react'
import { FileTree } from './FileTree'
import { Splitter } from './Splitter'
import {
  RAIN_INTRO_MS, TREE_DEFAULT, clampTreeWidth, folderLabel, pillLines, pillSegments, rainLevel, sceneDuration, streamDuration, streamedLines
} from '@shared/startPage.mjs'

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
        {session ?? <PillChoice key={path} label={label} onStart={onStart} />}
      </div>
    </div>
  )
}

/** True when the OS asks for less motion: no rain, and the lines are simply there. */
function reducedMotion(): boolean {
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches } catch { return false }
}

/** The rain's glyphs: half-width katakana and digits, as the film's. */
const RAIN_GLYPHS = 'ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜﾝ0123456789'
/** What the typing head flickers through before a letter settles — the font's own widths, so nothing shifts. */
const DECODE_GLYPHS = '0123456789$#%&*+=<>?/'
const DECODE_WIDTH = 2
const RAIN_CELL = 16
const pick = (set: string) => set[Math.floor(Math.random() * set.length)]

/**
 * The digital rain behind the scene (0.4.78, the user's ask: "a whole animation that does the matrix waterfall of
 * texts"). A 2D canvas under the text: columns of glyphs fall with fading trails, alone for the intro, dimmed while
 * the lines type, then gone — `rainLevel` reaches 0, the canvas clears and no frame is scheduled again. It is a
 * scene that ends, not an ambient effect (CLAUDE.md: no always-on surfaces). A hidden window gets no frames.
 */
function MatrixRain({ began, textMs }: { began: number; textMs: number }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = ref.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    type Drop = { y: number; speed: number; len: number; chars: string[] }
    let drops: Drop[] = []
    let w = 0
    let h = 0
    const newDrop = (initial: boolean): Drop => {
      const len = 8 + Math.floor(Math.random() * 18)
      return {
        // The first fall starts just above the top, staggered by a second or so, so the screen fills in the intro.
        y: initial ? -Math.random() * 14 : -Math.random() * 10,
        speed: 13 + Math.random() * 17,
        len,
        chars: Array.from({ length: len }, () => pick(RAIN_GLYPHS))
      }
    }
    const fit = () => {
      const dpr = window.devicePixelRatio || 1
      w = canvas.clientWidth
      h = canvas.clientHeight
      canvas.width = Math.max(1, Math.round(w * dpr))
      canvas.height = Math.max(1, Math.round(h * dpr))
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      const cols = Math.max(1, Math.floor(w / RAIN_CELL))
      drops = Array.from({ length: cols }, (_, i) => drops[i] ?? newDrop(true))
    }
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(canvas)
    let raf = 0
    let last = performance.now()
    const frame = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      const level = rainLevel(now - began, textMs)
      ctx.clearRect(0, 0, w, h)
      if (level <= 0) return // the scene is over: a clear canvas and no next frame
      ctx.font = `${RAIN_CELL - 2}px ui-monospace, 'Cascadia Mono', Consolas, monospace`
      ctx.textBaseline = 'top'
      drops.forEach((d, col) => {
        d.y += d.speed * dt
        if (Math.random() < 0.06) d.chars[Math.floor(Math.random() * d.len)] = pick(RAIN_GLYPHS)
        const head = Math.floor(d.y)
        for (let k = 0; k < d.len; k++) {
          const row = head - k
          if (row < 0 || row * RAIN_CELL > h) continue
          const fade = 1 - k / d.len
          ctx.fillStyle = k === 0 ? `rgba(214, 255, 224, ${0.95 * level})` : `rgba(64, 214, 110, ${0.75 * fade * level})`
          ctx.fillText(d.chars[(row + col) % d.len], col * RAIN_CELL, row * RAIN_CELL)
        }
        if ((head - d.len) * RAIN_CELL > h) drops[col] = newDrop(false)
      })
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => { cancelAnimationFrame(raf); ro.disconnect() }
  }, [began, textMs])
  return <canvas className="pillchoice-rain" ref={ref} aria-hidden data-testid="pill-rain" />
}

/**
 * The empty session side (the user's asks: "a text animation that slowly streams in with a reference to the Matrix
 * … taking the red or the blue pill", then "a whole animation that does the matrix waterfall of texts … smaller
 * versions of the pills inline with the text"). The scene: rain falls alone, Morpheus's lines decode out of it
 * (the typing head flickers through glyphs before each letter settles), the names in them are small pills of their
 * own, and the rain dims and stops. Every pill — inline or the big ones — works from the first frame, so the scene
 * never stands between the user and a session.
 */
function PillChoice({ label, onStart }: { label: string; onStart: (kind: FolderStart) => void }) {
  const lines = pillLines(label)
  const textMs = streamDuration(lines)
  const scene = sceneDuration(textMs)
  const still = reducedMotion()
  const [began] = useState(() => performance.now())
  const [t, setT] = useState(() => (still ? scene : 0))
  useEffect(() => {
    if (still) return
    let raf = 0
    const tick = () => {
      const now = performance.now() - began
      setT(Math.min(now, scene))
      if (now < scene) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [began, scene, still])
  const { shown, current, done } = streamedLines(lines, still ? textMs : t - RAIN_INTRO_MS)
  const typing = !done && t >= RAIN_INTRO_MS
  const caretLine = done ? lines.length - 1 : current
  const caret = <span className={`pillchoice-caret ${done ? 'is-rest' : ''}`} />
  const title = (kind: 'claude' | 'codex') =>
    `Start a ${kind === 'claude' ? 'TaylorMade CC (Claude Code)' : 'TaylorMade Codex'} chat in ${label}, here beside the files`

  /** A line as it stands: typed text, the head's flicker, the untyped rest laid out but invisible (so nothing moves). */
  const renderLine = (line: string, i: number) => {
    const typed = (shown[i] ?? '').length
    const head = i === caretLine
    const out: ReactNode[] = []
    for (const seg of pillSegments(line)) {
      const n = Math.max(0, Math.min(seg.text.length, typed - seg.start))
      const holdsHead = head && typed >= seg.start && typed < seg.start + seg.text.length
      if (seg.pill) {
        // The `[` brings the pill in; its name types inside it; the `]` closes it.
        const shownLabel = seg.label.slice(0, Math.max(0, n - 1))
        out.push(
          <button
            key={seg.start}
            type="button"
            className={`pill-inline is-${seg.pill === 'claude' ? 'red' : 'blue'} ${n === 0 ? 'is-pending' : ''}`}
            onClick={() => onStart(seg.pill!)}
            title={title(seg.pill)}
            tabIndex={n === 0 ? -1 : 0}
            data-testid={`pill-inline:${seg.pill}`}
          >
            <span className="pill-capsule is-mini" aria-hidden />
            <span>{shownLabel}<span className="pillchoice-rest">{seg.label.slice(shownLabel.length)}</span></span>
          </button>
        )
        if (holdsHead) out.push(<span key={`c${seg.start}`}>{caret}</span>)
        continue
      }
      const flicker = holdsHead && typing ? Math.min(DECODE_WIDTH, seg.text.length - n) : 0
      out.push(
        <span key={seg.start}>
          {seg.text.slice(0, n)}
          {holdsHead && caret}
          {flicker > 0 && <span className="pillchoice-decode">{Array.from({ length: flicker }, () => pick(DECODE_GLYPHS)).join('')}</span>}
          <span className="pillchoice-rest">{seg.text.slice(n + flicker)}</span>
        </span>
      )
    }
    // Done: the caret blinks after the last line's last word.
    if (head && typed >= line.length) out.push(<span key="end">{caret}</span>)
    return out
  }

  return (
    <div className="pillchoice" data-testid="pill-choice">
      {!still && <MatrixRain began={began} textMs={textMs} />}
      <div className="pillchoice-text" aria-label={lines.join(' ').replace(/[[\]]/g, '')} data-done={done || undefined}>
        {lines.map((line, i) => (
          <p key={i} className={`pillchoice-line ${i === 0 ? 'is-wake' : ''}`}>{renderLine(line, i)}</p>
        ))}
      </div>
      <div className="pillchoice-pills">
        <button className="pill-btn is-red" onClick={() => onStart('claude')} title={title('claude')} data-testid="pill:claude">
          <span className="pill-capsule" aria-hidden />
          <span className="pill-text"><span className="pill-name">Claude Code</span><span className="pill-sub">the red pill · TaylorMade CC</span></span>
        </button>
        <button className="pill-btn is-blue" onClick={() => onStart('codex')} title={title('codex')} data-testid="pill:codex">
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
