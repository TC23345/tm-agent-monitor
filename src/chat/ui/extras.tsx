// The pane's smaller pieces that are not transcript rows: the working line
// (the extension's spinner row, with loading.dev's Atom as its loader), the
// bar a selection raises (copied, quote, comment on a plan), find in the
// transcript, the side-question thread, the MCP servers panel, the context
// breakdown, the image preview, the rewind confirmation and the copy button
// that floats over a reply's code block. Each one that can be open carries
// `data-escape-close` and closes on Escape and on the host's `tm-escape`.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react'
import { Check, ChevronDown, ChevronUp, MessageSquareQuote, MessageSquarePlus, Plug, RotateCw, Send, X } from 'lucide-react'
import { WORKING_VERBS, fmtTokens, limitLines, relPath, verbDelay } from '../shared/present.mjs'
import type { ContextUsage, McpServer, RewindResult } from '../shared/chatModel.mjs'

/** Escape (and the host's `tm-escape`) closes whatever `ref` holds while `active`. */
export function useEscape(ref: RefObject<HTMLElement | null>, onClose: () => void, active = true) {
  useEffect(() => {
    const node = ref.current
    if (!node || !active) return
    const onEscape = () => onClose()
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return
      e.preventDefault()
      e.stopPropagation()
      onClose()
    }
    node.addEventListener('tm-escape', onEscape)
    node.addEventListener('keydown', onKey)
    return () => {
      node.removeEventListener('tm-escape', onEscape)
      node.removeEventListener('keydown', onKey)
    }
  }, [ref, onClose, active])
}

export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches)
  useEffect(() => {
    if (typeof matchMedia !== 'function') return
    const mq = matchMedia('(prefers-reduced-motion: reduce)')
    const on = () => setReduced(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return reduced
}

/*
 * The Atom loader: three tilted orbits spinning inside a ring, drawn in
 * currentColor. Ported from loading.dev's Atom (loading-dev 0.3.5,
 * https://github.com/jakubkrehel/loading) — Copyright (c) 2026 Jakub Krehel,
 * MIT License — as markup plus the rules in chat.css, because the package
 * needs React 19 and both hosts run React 18.
 */
export function Atom({ size = 16 }: { size?: number }) {
  return (
    <span className="chat-atom" style={{ '--atom': `${size}px` } as CSSProperties} aria-hidden>
      <span className="chat-atom-shell" />
      {[0, 1, 2].map((i) => (
        <span key={i} className="chat-atom-orbit" style={{ '--atom-tilt': `${i * 60}deg` } as CSSProperties}>
          <span className="chat-atom-spin" style={{ '--atom-step': i } as CSSProperties}><span className="chat-atom-ring" /></span>
        </span>
      ))}
    </span>
  )
}

function pickVerb(not?: string): string {
  const pool = WORKING_VERBS.filter((v) => v !== not)
  return pool[Math.floor(Math.random() * pool.length)] ?? 'Working'
}

/** The verb typed in letter by letter (40 ms each), as the extension does; all at once under reduced motion. */
function useTyped(target: string, instant: boolean): string {
  const [shown, setShown] = useState(instant ? target : '')
  useEffect(() => {
    if (instant) {
      setShown(target)
      return
    }
    let n = 0
    setShown('')
    const id = window.setInterval(() => {
      n++
      setShown(target.slice(0, n))
      if (n >= target.length) window.clearInterval(id)
    }, 40)
    return () => window.clearInterval(id)
  }, [target, instant])
  return shown
}

/**
 * The working line under the last step while the agent works: the Atom where
 * the rail's next dot would be, and the extension's verbs ("Clauding…"),
 * swapped after 2 s, 3 s, 5 s and then every 5 s; *Compacting…* while the
 * context compacts, and the retry count while an API call is retried.
 */
export function WorkingLine({ provider, compacting, retry }: { provider: 'claude' | 'codex'; compacting: boolean; retry: { attempt: number; max: number } | null }) {
  const reduced = usePrefersReducedMotion()
  const [verb, setVerb] = useState(() => (provider === 'claude' ? pickVerb() : 'Working'))
  useEffect(() => {
    if (compacting || provider !== 'claude') return
    let swaps = 0
    let timer = 0
    const next = () => {
      timer = window.setTimeout(() => {
        setVerb((v) => pickVerb(v))
        swaps++
        next()
      }, verbDelay(swaps))
    }
    next()
    return () => window.clearTimeout(timer)
  }, [compacting, provider])
  const word = `${compacting ? 'Compacting' : verb}…`
  const shown = useTyped(word, reduced)
  const who = provider === 'claude' ? 'Claude' : 'Codex'
  return (
    <div className="chat-working" role="status" data-testid="chat-working">
      <Atom />
      <span className="chat-working-verb" aria-hidden style={{ minWidth: `${word.length}ch` }}>{shown}</span>
      <span className="chat-sr">{compacting ? 'Compacting conversation' : `${who} is working`}</span>
      {retry ? <span className="chat-working-note">{provider === 'codex' ? 'Reconnecting' : 'Retrying'} ({retry.attempt}{retry.max ? `/${retry.max}` : ''})</span> : null}
    </div>
  )
}

export interface SelectionInfo {
  text: string
  /** In the pane's coordinates: the middle of the selection's first line, and the bar's top. */
  x: number
  y: number
  /** The plan approval the selection lies in, when it is still waiting. */
  planId?: string
}

/**
 * What a selection in the transcript raises: it was copied (copy on select,
 * like a terminal pane), *Quote* puts it in the composer as a quote, and
 * inside a waiting plan *Comment* attaches a note to it.
 */
export function SelectionBar({ sel, onQuote, onComment, onClose }: { sel: SelectionInfo; onQuote: () => void; onComment?: (comment: string) => void; onClose: () => void }) {
  const ref = useRef<HTMLDivElement | null>(null)
  const [writing, setWriting] = useState(false)
  const [comment, setComment] = useState('')
  useEscape(ref, onClose)
  // Centred on the selection, kept inside the pane; measured before paint, because the bar's width depends on its buttons.
  const [left, setLeft] = useState<number | null>(null)
  useLayoutEffect(() => {
    const el = ref.current
    const host = el?.offsetParent as HTMLElement | null
    if (!el || !host) return
    setLeft(Math.max(8, Math.min(sel.x - el.offsetWidth / 2, host.clientWidth - el.offsetWidth - 8)))
  }, [sel.x, writing])
  const style: CSSProperties = { left: left ?? Math.max(8, sel.x - 120), top: sel.y }
  return (
    <div ref={ref} className="chat-selbar" style={style} data-escape-close="" data-testid="chat-selbar" onMouseDown={(e) => { if (!(e.target as HTMLElement).closest('input')) e.preventDefault() }}>
      <span className="chat-selbar-copied" data-testid="chat-selbar-copied"><Check className="chat-ic" aria-hidden /> Copied</span>
      {writing && onComment ? (
        <input
          className="chat-selbar-input" autoFocus placeholder="Comment on this part of the plan" value={comment}
          onChange={(e) => setComment(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && comment.trim()) { e.preventDefault(); onComment(comment.trim()) }
          }}
          data-testid="chat-selbar-comment-input"
        />
      ) : (
        <>
          <button className="chat-selbar-btn" onClick={onQuote} data-testid="chat-selbar-quote"><MessageSquareQuote className="chat-ic" aria-hidden /> Quote</button>
          {onComment ? <button className="chat-selbar-btn" onClick={() => setWriting(true)} data-testid="chat-selbar-comment"><MessageSquarePlus className="chat-ic" aria-hidden /> Comment</button> : null}
        </>
      )}
    </div>
  )
}

// The CSS Custom Highlight API (Chromium 105+), typed here so the pane needs no lib bump.
const highlights = (): Map<string, object> | undefined => (globalThis as unknown as { CSS?: { highlights?: Map<string, object> } }).CSS?.highlights
const HighlightCtor = (): (new (...ranges: Range[]) => object) | undefined => (globalThis as unknown as { Highlight?: new (...ranges: Range[]) => object }).Highlight

/**
 * Find in the transcript (Ctrl+F in the pane): every match highlighted
 * through the CSS Custom Highlight API, so the rows' markup is never touched;
 * Enter and Shift+Enter step through them. Only what is on screen is
 * searched — a folded step's hidden body is not.
 */
export function FindBar({ root, version, onClose }: { root: HTMLElement | null; version: unknown; onClose: () => void }) {
  const ref = useRef<HTMLDivElement | null>(null)
  const input = useRef<HTMLInputElement | null>(null)
  const [q, setQ] = useState('')
  const [index, setIndex] = useState(0)
  const [ranges, setRanges] = useState<Range[]>([])
  useEscape(ref, onClose)
  useEffect(() => input.current?.focus(), [])
  useEffect(() => {
    const needle = q.trim().toLowerCase()
    if (!root || needle.length < 1) {
      setRanges([])
      return
    }
    const found: Range[] = []
    const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => ((n.parentElement?.closest('button, .chat-stamp, [aria-hidden="true"]') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT))
    })
    for (let n = walk.nextNode(); n && found.length < 2000; n = walk.nextNode()) {
      const text = (n.textContent ?? '').toLowerCase()
      for (let at = text.indexOf(needle); at >= 0; at = text.indexOf(needle, at + needle.length)) {
        const r = document.createRange()
        r.setStart(n, at)
        r.setEnd(n, at + needle.length)
        found.push(r)
      }
    }
    setRanges(found)
    setIndex((i) => (found.length ? Math.min(i, found.length - 1) : 0))
  }, [q, root, version])
  useEffect(() => {
    const reg = highlights()
    const H = HighlightCtor()
    if (!reg || !H) return
    const current = ranges[index]
    reg.set('chat-find', new H(...ranges.filter((r) => r !== current)))
    if (current) reg.set('chat-find-current', new H(current))
    else reg.delete('chat-find-current')
    current?.startContainer.parentElement?.scrollIntoView({ block: 'center' })
    return () => {
      reg.delete('chat-find')
      reg.delete('chat-find-current')
    }
  }, [ranges, index])
  const step = (d: number) => setIndex((i) => (ranges.length ? (i + d + ranges.length) % ranges.length : 0))
  return (
    <div ref={ref} className="chat-find" data-escape-close="" data-testid="chat-find">
      <input
        ref={input} value={q} placeholder="Find in conversation" aria-label="Find in conversation"
        onChange={(e) => { setQ(e.target.value); setIndex(0) }}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); step(e.shiftKey ? -1 : 1) } }}
        data-testid="chat-find-input"
      />
      <span className="chat-find-count">{q.trim() ? (ranges.length ? `${index + 1} of ${ranges.length}` : 'No results') : ''}</span>
      <button className="chat-iconbtn" aria-label="Previous match" title="Previous (Shift+Enter)" onClick={() => step(-1)} disabled={!ranges.length}><ChevronUp className="chat-ic" /></button>
      <button className="chat-iconbtn" aria-label="Next match" title="Next (Enter)" onClick={() => step(1)} disabled={!ranges.length}><ChevronDown className="chat-ic" /></button>
      <button className="chat-iconbtn" aria-label="Close find" title="Close (Esc)" onClick={onClose}><X className="chat-ic" /></button>
    </div>
  )
}

interface SideTurn { question: string; answer?: string | null; error?: string }

/**
 * A side question, as the extension asks one: answered from the conversation
 * so far, beside the turn, without joining it or interrupting it.
 */
export function SidePanel({ ask, renderText, onClose }: { ask: (q: string) => Promise<string | null>; renderText: (text: string) => ReactNode; onClose: () => void }) {
  const ref = useRef<HTMLDivElement | null>(null)
  const list = useRef<HTMLDivElement | null>(null)
  const [turns, setTurns] = useState<SideTurn[]>([])
  const [q, setQ] = useState('')
  const busy = turns.some((t) => t.answer === undefined && !t.error)
  useEscape(ref, onClose)
  useLayoutEffect(() => { list.current?.scrollTo({ top: list.current.scrollHeight }) }, [turns])
  const send = () => {
    const question = q.trim()
    if (!question || busy) return
    setQ('')
    setTurns((t) => [...t, { question }])
    ask(question).then(
      (answer) => setTurns((t) => t.map((x) => (x.question === question && x.answer === undefined ? { ...x, answer } : x))),
      (err: Error) => setTurns((t) => t.map((x) => (x.question === question && x.answer === undefined ? { ...x, error: err.message } : x)))
    )
  }
  return (
    <div ref={ref} className="chat-side" data-escape-close="" data-testid="chat-side">
      <div className="chat-panel-head">
        <span className="chat-panel-title">Side question</span>
        <span className="chat-panel-hint">Answered from the conversation so far, without interrupting it</span>
        <button className="chat-iconbtn" aria-label="Close side question" title="Close (Esc)" onClick={onClose}><X className="chat-ic" /></button>
      </div>
      <div className="chat-side-list" ref={list}>
        {turns.map((t, i) => (
          <div key={i} className="chat-side-turn">
            <div className="chat-side-q">{t.question}</div>
            <div className="chat-side-a">
              {t.error ? <span className="chat-side-error">{t.error}</span> : t.answer === undefined ? <span className="chat-side-wait"><Atom size={12} /> Thinking…</span> : t.answer === null ? <span className="chat-side-wait">No answer came back.</span> : <div className="chat-text">{renderText(t.answer)}</div>}
            </div>
          </div>
        ))}
      </div>
      <div className="chat-side-input">
        <textarea
          rows={2} autoFocus value={q} placeholder="Ask a side question" aria-label="Ask a side question"
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
          data-testid="chat-side-input"
        />
        <button className="chat-iconbtn is-send" aria-label="Send side question" title="Send side question" onClick={send} disabled={!q.trim() || busy}><Send className="chat-ic" /></button>
      </div>
    </div>
  )
}

const MCP_WORDS: Record<McpServer['status'], string> = { connected: 'Connected', failed: 'Failed', 'needs-auth': 'Needs sign-in', pending: 'Connecting…', disabled: 'Off' }

/** The session's MCP servers: status, tools, on/off and reconnect. Adding, removing and sign-in stay in the CLI (`/mcp`). */
export function McpPanel({ load, onClose }: { load: (req: { op: 'list' } | { op: 'toggle'; name: string; enabled: boolean } | { op: 'reconnect'; name: string }) => Promise<McpServer[]>; onClose: () => void }) {
  const ref = useRef<HTMLDivElement | null>(null)
  const [servers, setServers] = useState<McpServer[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEscape(ref, onClose)
  const run = useCallback((req: Parameters<typeof load>[0], name: string | null) => {
    setBusy(name)
    setError(null)
    load(req).then(setServers, (err: Error) => setError(err.message)).finally(() => setBusy(null))
  }, [load])
  useEffect(() => run({ op: 'list' }, null), [run])
  return (
    <div ref={ref} className="chat-picker chat-mcp" data-escape-close="" data-testid="chat-mcp">
      <div className="chat-panel-head">
        <Plug className="chat-ic" aria-hidden />
        <span className="chat-panel-title">MCP servers</span>
        <span className="chat-panel-hint">Add, remove or sign in with /mcp in a terminal</span>
        <button className="chat-iconbtn" aria-label="Close MCP servers" title="Close (Esc)" onClick={onClose}><X className="chat-ic" /></button>
      </div>
      {error ? <div className="chat-mcp-error">{error}</div> : null}
      <div className="chat-picker-list">
        {servers === null ? <div className="chat-empty">Loading…</div> : servers.length === 0 ? <div className="chat-empty">No MCP servers in this session.</div> : servers.map((s) => (
          <div key={s.name} className="chat-mcp-row" data-testid={`chat-mcp:${s.name}`}>
            <div className="chat-mcp-main">
              <span className="chat-mcp-name">{s.name}</span>
              <span className={`chat-mcp-status is-${s.status}`}>{MCP_WORDS[s.status] ?? s.status}{s.status === 'connected' ? ` · ${s.tools} tool${s.tools === 1 ? '' : 's'}` : ''}{s.scope ? ` · ${s.scope}` : ''}</span>
              {s.error ? <span className="chat-mcp-detail" title={s.error}>{s.error}</span> : null}
            </div>
            <button className="chat-iconbtn" aria-label={`Reconnect ${s.name}`} title="Reconnect" disabled={busy !== null || s.status === 'disabled'} onClick={() => run({ op: 'reconnect', name: s.name }, s.name)}><RotateCw className={`chat-ic ${busy === s.name ? 'is-spinning' : ''}`} /></button>
            <button
              className={`chat-switch ${s.status !== 'disabled' ? 'is-on' : ''}`} role="switch" aria-checked={s.status !== 'disabled'} aria-label={`${s.name} on or off`}
              disabled={busy !== null} onClick={() => run({ op: 'toggle', name: s.name, enabled: s.status === 'disabled' }, s.name)}
            ><span className="chat-switch-thumb" /></button>
          </div>
        ))}
      </div>
    </div>
  )
}

/** The context window by category, over the pie: a stacked bar in the pressure ramp's fill, the categories, the biggest memory files and Compact now. */
export function ContextBreakdown({ usage, error, cwd, onCompact }: { usage: ContextUsage | null; error: string | null; cwd: string; onCompact?: () => void }) {
  const used = usage ? usage.categories.filter((c) => c.kind !== 'free' && c.kind !== 'buffer') : []
  return (
    <div className="chat-ctx" data-testid="chat-context-breakdown">
      <div className="chat-pop-title">Context{usage ? <span className="chat-pop-hint">{Math.round(usage.percent)}% of {fmtTokens(usage.max)}</span> : null}</div>
      {error ? <div className="chat-pop-empty">{error}</div> : !usage ? <div className="chat-pop-empty">Loading…</div> : (
        <>
          <div className="chat-ctx-bar" aria-hidden>
            {used.map((c, i) => <span key={c.name} style={{ width: `${(c.tokens / Math.max(1, usage.max)) * 100}%`, opacity: Math.max(0.35, 1 - i * 0.14) }} />)}
          </div>
          <div className="chat-ctx-rows">
            {usage.categories.map((c) => (
              <div key={c.name} className={`chat-ctx-row ${c.kind === 'free' || c.kind === 'buffer' ? 'is-free' : ''}`}>
                <span className="chat-ctx-name">{c.name}</span>
                <span className="chat-ctx-num">{fmtTokens(c.tokens)}</span>
                <span className="chat-ctx-num">{((c.tokens / Math.max(1, usage.max)) * 100).toFixed(1)}%</span>
              </div>
            ))}
          </div>
          {usage.memoryFiles.length ? (
            <div className="chat-ctx-files">
              {usage.memoryFiles.slice(0, 3).map((m) => <div key={m.path} className="chat-ctx-row" title={m.path}><span className="chat-ctx-name is-mono">{relPath(m.path, cwd)}</span><span className="chat-ctx-num">{fmtTokens(m.tokens)}</span></div>)}
            </div>
          ) : null}
          {limitLines(usage.limits).length ? (
            <div className="chat-ctx-files" data-testid="chat-context-limits">
              <div className="chat-pop-title">Usage remaining</div>
              {limitLines(usage.limits).map((line) => <div key={line} className="chat-ctx-row"><span className="chat-ctx-name">{line}</span></div>)}
            </div>
          ) : null}
        </>
      )}
      {onCompact ? <button className="chat-btn chat-ctx-compact" onClick={onCompact} data-testid="chat-compact-now">Compact now</button> : null}
    </div>
  )
}

/**
 * The image viewer: a pasted or attached image as large as the workspace allows (fixed, so it covers the
 * host's whole frame rather than one narrow pane), with its name and real size under it. The X, a click
 * outside the image or Escape closes it.
 */
export function ImagePreview({ src, name, onClose }: { src: string; name: string; onClose: () => void }) {
  const ref = useRef<HTMLDivElement | null>(null)
  const [size, setSize] = useState<string | null>(null)
  useEscape(ref, onClose)
  useEffect(() => ref.current?.focus(), [])
  return (
    <div ref={ref} className="chat-preview" tabIndex={-1} data-escape-close="" onClick={onClose} role="dialog" aria-label={name} data-testid="chat-image-preview">
      <img src={src} alt={name} onClick={(e) => e.stopPropagation()} onLoad={(e) => setSize(`${e.currentTarget.naturalWidth}×${e.currentTarget.naturalHeight}`)} />
      <span className="chat-preview-cap">{size ? `${name} · ${size}` : name}</span>
      <button className="chat-iconbtn chat-preview-x" aria-label="Close (Esc)" title="Close (Esc)" onClick={onClose}><X className="chat-ic" /></button>
    </div>
  )
}

/**
 * Before code is rewound: the dry run's files and line counts, the warning the
 * extension gives, and the one action asked for.
 */
export function RewindCard({ fork, load, onConfirm, onCancel, cwd }: { fork: boolean; load: () => Promise<RewindResult>; onConfirm: () => void; onCancel: () => void; cwd: string }) {
  const ref = useRef<HTMLDivElement | null>(null)
  const [check, setCheck] = useState<RewindResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEscape(ref, onCancel)
  useEffect(() => { load().then(setCheck, (err: Error) => setError(err.message)) }, [load])
  const files = check?.files ?? []
  const lines = (n: number) => `${n} line${n === 1 ? '' : 's'}`
  return (
    <div ref={ref} className="chat-rewind" data-escape-close="" data-testid="chat-rewind" tabIndex={-1}>
      <div className="chat-approval-title">{fork ? 'Fork the conversation and rewind code' : 'Rewind code to before this prompt'}</div>
      {error ? <div className="chat-tool-error">{error}</div> : !check ? <div className="chat-tool-summary">Checking code changes…</div> : !check.canRewind ? (
        <div className="chat-tool-summary">{check.error ?? 'There is no file checkpoint for this prompt.'}</div>
      ) : files.length ? (
        <>
          <div className="chat-tool-summary">{lines(check.deletions)} will be removed and {lines(check.insertions)} will be added across {files.length} file{files.length === 1 ? '' : 's'}:</div>
          <ul className="chat-rewind-files">{files.map((f) => <li key={f} title={f}>{relPath(f, cwd)}</li>)}</ul>
        </>
      ) : <div className="chat-tool-summary">The code has not changed since this prompt, so no code will be restored.</div>}
      <div className="chat-rewind-warn">Rewinding does not affect files edited manually or via bash.</div>
      <div className="chat-approval-actions">
        <button className="chat-btn is-allow" disabled={!check?.canRewind} onClick={onConfirm} data-testid="chat-rewind:confirm">{fork ? 'Fork and rewind code' : 'Rewind code'}</button>
        <button className="chat-btn" onClick={onCancel} data-testid="chat-rewind:cancel">Cancel</button>
      </div>
    </div>
  )
}


/** "Jump to latest" while the transcript is scrolled up, with how many rows arrived since. */
export function JumpToLatest({ count, onJump }: { count: number; onJump: () => void }) {
  return (
    <button className="chat-jump" onClick={onJump} data-testid="chat-jump">
      <ChevronDown className="chat-ic" aria-hidden /> {count > 0 ? `${count} new` : 'Jump to latest'}
    </button>
  )
}

/** The prompt of the turn on screen, pinned over the transcript once its card scrolls away (the extension's sticky prompt). */
export function PinnedPrompt({ text, onJump }: { text: string; onJump: () => void }) {
  const line = useMemo(() => text.replace(/\s+/g, ' ').trim(), [text])
  return (
    <button className="chat-pinned" onClick={onJump} title="Scroll to this prompt" data-testid="chat-pinned">
      <span className="chat-pinned-text">{line}</span>
    </button>
  )
}
