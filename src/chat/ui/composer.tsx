// The composer, after the Claude Code extension's (docs/rea-findings.md,
// webview pass): one box holding the attachments, the text and a footer of
// controls — attach, reference, the slash-command menu (also opened by typing
// `/`), a clock, the model and effort chip, the context pie (click to
// compact), the permission mode chip (Shift+Tab cycles it, as in the CLI) and
// send / stop. Menus open inside the pane and close on Escape; in claude-watch
// they carry `data-escape-close`, so the host hands them its Escape
// (`tm-escape`) instead of hiding the workspace.
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type ChangeEvent, type ClipboardEvent, type KeyboardEvent, type ReactNode, type RefObject } from 'react'
import { AtSign, Check, ChevronDown, CircleStop, Clock, FileCode, Hand, ListChecks, Lock, Paperclip, PencilLine, Send, ShieldCheck, ShieldOff, Slash, Sparkles, X } from 'lucide-react'
import { effortLabel, fmtTokens, formatElapsed, modelLabel } from '../shared/present.mjs'
import type { Attachment, ChatConfigPatch, ChatOptions, CommandOption, ModelOption, Provider, Transcript } from '../shared/chatModel.mjs'

const PROVIDER_LABEL: Record<Provider, string> = { claude: 'Claude Code', codex: 'Codex' }
const MAX_IMAGE_BYTES = 20 * 1024 * 1024
/** The extension's effort scale (low … max), for the meter's dots. */
const EFFORT_SCALE = ['low', 'medium', 'high', 'xhigh', 'max']

export interface ComposerHandle { focus(): void }

interface Props {
  provider: Provider
  transcript: Transcript | null
  chatId: string | null
  options: ChatOptions | null
  onRefreshOptions: () => void
  onSend: (text: string, attachments: Attachment[]) => void
  onInterrupt: () => void
  onConfigure: (patch: ChatConfigPatch) => void
  onNotice: (text: string) => void
}

type Menu = 'model' | 'mode' | 'slash' | null

export const Composer = forwardRef<ComposerHandle, Props>(function Composer({ provider, transcript, chatId, options, onRefreshOptions, onSend, onInterrupt, onConfigure, onNotice }, ref) {
  const [text, setText] = useState('')
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [refField, setRefField] = useState(false)
  const [menu, setMenu] = useState<Menu>(null)
  const [slashIndex, setSlashIndex] = useState(0)
  const [slashDismissed, setSlashDismissed] = useState(false)
  const [focused, setFocused] = useState(false)
  const area = useRef<HTMLTextAreaElement | null>(null)
  const fileInput = useRef<HTMLInputElement | null>(null)
  const inputBox = useRef<HTMLDivElement | null>(null)

  useImperativeHandle(ref, () => ({ focus: () => area.current?.focus() }), [])

  const status = transcript?.status
  const running = status === 'running' || status === 'waiting'
  const waiting = status === 'waiting'
  const commands = options?.commands ?? []
  const canSlash = provider === 'claude'

  // `/word` at the start of an otherwise empty line opens the menu on that word.
  const slashQuery = /^\/(\S*)$/.exec(text)?.[1] ?? null
  const slashOpen = canSlash && (menu === 'slash' || (slashQuery !== null && !slashDismissed))
  const slashList = useMemo(() => filterCommands(commands, menu === 'slash' && slashQuery === null ? '' : slashQuery ?? ''), [commands, menu, slashQuery])
  useEffect(() => setSlashIndex(0), [slashQuery, menu])
  useEffect(() => {
    if (slashQuery === null) setSlashDismissed(false)
  }, [slashQuery])
  useEffect(() => {
    if (slashOpen) onRefreshOptions()
    // Refresh once per opening: skills a session discovers mid-way join the list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slashOpen])

  const fit = useCallback(() => {
    const el = area.current
    if (!el) return
    el.style.height = ''
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`
  }, [])
  useEffect(fit, [text, fit])

  const send = () => {
    const body = text.trim()
    if (!chatId || (!body && attachments.length === 0)) return
    onSend(body, attachments)
    setText('')
    setAttachments([])
    setMenu(null)
  }

  const insertCommand = (c: CommandOption) => {
    setText((t) => {
      const rest = t.replace(/^\/\S*\s?/, '')
      return `/${c.name} ${rest}`
    })
    setMenu(null)
    setSlashDismissed(true)
    area.current?.focus()
  }

  const modes = options?.modes ?? []
  const cycleMode = () => {
    if (!modes.length) return
    const i = modes.findIndex((m) => m.id === transcript?.permissionMode)
    const next = modes[(i + 1) % modes.length]
    if (next) onConfigure({ permissionMode: next.id })
  }

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (slashOpen && slashList.length) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        const d = e.key === 'ArrowDown' ? 1 : -1
        setSlashIndex((i) => (i + d + slashList.length) % slashList.length)
        return
      }
      if ((e.key === 'Enter' && !e.shiftKey) || e.key === 'Tab') {
        const pick = slashList[slashIndex]
        if (pick) {
          e.preventDefault()
          insertCommand(pick)
          return
        }
      }
    }
    if (e.key === 'Escape') {
      // In claude-watch the host already routed this Escape to whatever owns it (`tm-escape`).
      if (e.defaultPrevented) return
      if (slashOpen) {
        e.preventDefault()
        setMenu(null)
        setSlashDismissed(true)
      } else if (running) {
        e.preventDefault()
        onInterrupt()
      }
      return
    }
    if (e.key === 'Tab' && e.shiftKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault()
      cycleMode()
      return
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.altKey) {
      e.preventDefault()
      send()
    }
  }

  // While a turn runs and the text box has focus, Escape interrupts it; the host learns that through data-escape-close.
  useEffect(() => {
    const el = inputBox.current
    if (!el) return
    const onEscape = () => {
      if (slashOpen) {
        setMenu(null)
        setSlashDismissed(true)
      } else if (running) onInterrupt()
    }
    el.addEventListener('tm-escape', onEscape)
    return () => el.removeEventListener('tm-escape', onEscape)
  }, [running, slashOpen, onInterrupt])

  const addImages = useCallback((files: Iterable<File>) => {
    for (const file of files) {
      if (!file.type.startsWith('image/')) continue
      if (file.size > MAX_IMAGE_BYTES) {
        onNotice(`${file.name || 'Image'} is larger than 20 MB`)
        continue
      }
      const reader = new FileReader()
      reader.onload = () => {
        const url = String(reader.result ?? '')
        const data = url.slice(url.indexOf(',') + 1)
        const add = (size: { width: number; height: number } | null) =>
          setAttachments((list) => [...list, { kind: 'image', name: file.name || `pasted-${list.length + 1}.png`, mime: file.type, data, ...(size ?? {}) }])
        const img = new Image()
        img.onload = () => add({ width: img.naturalWidth, height: img.naturalHeight })
        img.onerror = () => add(null)
        img.src = url
      }
      reader.readAsDataURL(file)
    }
  }, [onNotice])

  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(e.clipboardData?.files ?? []).filter((f) => f.type.startsWith('image/'))
    if (!files.length) return
    e.preventDefault()
    addImages(files)
  }

  const onPickFiles = (e: ChangeEvent<HTMLInputElement>) => {
    addImages(Array.from(e.target.files ?? []))
    e.target.value = ''
  }

  const addReference = (path: string) => {
    const p = path.trim()
    if (!p) return
    setAttachments((list) => (list.some((a) => a.kind === 'file' && a.path === p) ? list : [...list, { kind: 'file', path: p, name: p.replace(/^.*[\\/]/, '') }]))
    setRefField(false)
    area.current?.focus()
  }

  const placeholder = waiting ? 'Answer the request above first' : running ? 'Queue another message…' : `Message ${PROVIDER_LABEL[provider]} — Enter sends, Shift+Enter is a newline, paste an image to attach it`

  return (
    <div className="chat-composer">
      {slashOpen ? (
        <Popover onClose={() => { setMenu(null); setSlashDismissed(true) }} className="is-slash" testid="chat-menu:slash">
          <div className="chat-pop-title">Slash commands</div>
          {options === null ? <div className="chat-pop-empty">Loading…</div> : slashList.length === 0 ? <div className="chat-pop-empty">No matching command</div> : slashList.map((c, i) => (
            <button
              key={c.name} className={`chat-pop-item ${i === slashIndex ? 'is-active' : ''}`}
              onMouseEnter={() => setSlashIndex(i)} onMouseDown={(e) => e.preventDefault()} onClick={() => insertCommand(c)} title={c.description || undefined}
              data-testid={`chat-command:${c.name}`}
            >
              <span className="chat-pop-label is-mono">/{c.name}{c.argumentHint ? <span className="chat-pop-hint"> {c.argumentHint}</span> : null}</span>
              {c.description ? <span className="chat-pop-desc">{c.description}</span> : null}
            </button>
          ))}
        </Popover>
      ) : null}
      {menu === 'model' ? <ModelMenu transcript={transcript} options={options} onConfigure={onConfigure} onClose={() => setMenu(null)} /> : null}
      {menu === 'mode' ? (
        <Popover onClose={() => setMenu(null)} className="is-mode" testid="chat-menu:mode">
          <div className="chat-pop-title">Mode <kbd className="chat-kbd">Shift+Tab</kbd></div>
          {options === null ? <div className="chat-pop-empty">Loading…</div> : modes.map((m) => (
            <button key={m.id} className={`chat-pop-item ${m.id === transcript?.permissionMode ? 'is-on' : ''}`} onClick={() => { onConfigure({ permissionMode: m.id }); setMenu(null) }} data-testid={`chat-mode:${m.id}`}>
              <span className="chat-pop-label"><ModeIcon id={m.id} /> {m.label}</span>
              <span className="chat-pop-desc">{m.description}</span>
              {m.id === transcript?.permissionMode ? <Check className="chat-ic chat-pop-check" /> : null}
            </button>
          ))}
        </Popover>
      ) : null}

      <div
        ref={inputBox}
        className={`chat-input ${focused ? 'is-focused' : ''}`}
        onMouseDown={(e) => { if (e.target === e.currentTarget) { e.preventDefault(); area.current?.focus() } }}
        {...(focused && running ? { 'data-escape-close': '' } : {})}
      >
        {attachments.length || refField ? (
          <div className="chat-attachments" data-testid="chat-attachments">
            {attachments.map((a, i) => (
              <span key={`${a.kind}:${a.kind === 'image' ? a.name + i : a.path}`} className={`chat-chip is-${a.kind}`} title={a.kind === 'file' ? a.path : a.name}>
                {a.kind === 'image' ? <img className="chat-chip-thumb" alt="" src={`data:${a.mime};base64,${a.data}`} /> : <FileCode className="chat-ic" aria-hidden />}
                <span className="chat-chip-label">{a.kind === 'image' ? a.name : a.name ?? a.path}</span>
                {a.kind === 'image' && a.width && a.height ? <span className="chat-chip-meta">{a.width}×{a.height}</span> : null}
                <button className="chat-chip-x" aria-label={`Remove ${a.kind === 'image' ? a.name : a.path}`} onClick={() => setAttachments((list) => list.filter((_, j) => j !== i))}><X className="chat-ic" /></button>
              </span>
            ))}
            {refField ? (
              <input
                className="chat-ref-input" autoFocus placeholder="Path to reference, then Enter" data-testid="chat-ref-input"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { e.preventDefault(); addReference(e.currentTarget.value) }
                  else if (e.key === 'Escape') { e.preventDefault(); setRefField(false); area.current?.focus() }
                }}
                onBlur={(e) => { if (!e.currentTarget.value.trim()) setRefField(false) }}
              />
            ) : null}
          </div>
        ) : null}
        <textarea
          ref={area}
          rows={1}
          value={text}
          placeholder={placeholder}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKey}
          onPaste={onPaste}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          disabled={!chatId}
          data-testid="chat-composer"
        />
        <div className="chat-input-foot">
          <button className="chat-iconbtn" title="Attach an image" aria-label="Attach an image" onClick={() => fileInput.current?.click()} disabled={!chatId} data-testid="chat-tool:attach"><Paperclip className="chat-ic" /></button>
          <button className={`chat-iconbtn ${refField ? 'is-on' : ''}`} title="Reference a file (@path)" aria-label="Reference a file" onClick={() => setRefField((v) => !v)} disabled={!chatId} data-testid="chat-tool:reference"><AtSign className="chat-ic" /></button>
          {canSlash ? (
            <button className={`chat-iconbtn ${slashOpen ? 'is-on' : ''}`} title="Slash commands" aria-label="Slash commands" onClick={() => { setMenu((m) => (m === 'slash' ? null : 'slash')); setSlashDismissed(false); area.current?.focus() }} disabled={!chatId} data-testid="chat-tool:slash"><Slash className="chat-ic" /></button>
          ) : null}
          <input ref={fileInput} type="file" accept="image/*" multiple hidden onChange={onPickFiles} />
          {transcript ? <ElapsedChip transcript={transcript} /> : null}
          {transcript ? (
            <button className={`chat-footchip ${menu === 'model' ? 'is-on' : ''}`} onClick={() => { setMenu((m) => (m === 'model' ? null : 'model')); onRefreshOptions() }} disabled={!chatId} title="Model and effort" data-testid="chat-chip:model">
              <span>{currentModelLabel(transcript, options)}</span>
              {transcript.effort ? <span className="chat-footchip-sub">{effortLabel(transcript.effort)}</span> : null}
              <ChevronDown className="chat-ic chat-footchip-chev" />
            </button>
          ) : null}
          <span className="chat-foot-gap" />
          {transcript ? <ContextPie transcript={transcript} onCompact={provider === 'claude' && !running && chatId ? () => onSend('/compact', []) : undefined} /> : null}
          {transcript ? (
            <button className={`chat-footchip ${menu === 'mode' ? 'is-on' : ''}`} onClick={() => { setMenu((m) => (m === 'mode' ? null : 'mode')); onRefreshOptions() }} disabled={!chatId} title="Permission mode (Shift+Tab)" data-testid="chat-chip:mode">
              <ModeIcon id={transcript.permissionMode} />
              <span>{modeLabel(transcript.permissionMode, options)}</span>
            </button>
          ) : null}
          {running ? (
            <button className="chat-iconbtn is-stop" title="Stop (Esc)" aria-label="Stop" onClick={onInterrupt} data-testid="chat-tool:stop"><CircleStop className="chat-ic" /></button>
          ) : (
            <button className="chat-iconbtn is-send" title="Send (Enter)" aria-label="Send" onClick={send} disabled={!chatId || (!text.trim() && !attachments.length)} data-testid="chat-tool:send"><Send className="chat-ic" /></button>
          )}
        </div>
      </div>
    </div>
  )
})

/** A menu that opens above the composer and closes on Escape or a click outside it. */
function Popover({ onClose, className, testid, children }: { onClose: () => void; className: string; testid: string; children: ReactNode }) {
  const el = useRef<HTMLDivElement | null>(null)
  useOutside(el, onClose)
  useEffect(() => {
    const node = el.current
    if (!node) return
    const onEscape = () => onClose()
    const onKey = (e: globalThis.KeyboardEvent) => { if (e.key === 'Escape' && !e.defaultPrevented) { e.preventDefault(); onClose() } }
    node.addEventListener('tm-escape', onEscape)
    node.addEventListener('keydown', onKey)
    return () => {
      node.removeEventListener('tm-escape', onEscape)
      node.removeEventListener('keydown', onKey)
    }
  }, [onClose])
  return <div ref={el} className={`chat-pop ${className}`} data-escape-close="" data-testid={testid} role="menu">{children}</div>
}

function useOutside(ref: RefObject<HTMLElement | null>, onOut: () => void) {
  useEffect(() => {
    const down = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null
      // The chips that open a menu toggle it themselves.
      if (ref.current && t && !ref.current.contains(t) && !t.closest('.chat-footchip, [data-testid="chat-tool:slash"]')) onOut()
    }
    document.addEventListener('mousedown', down)
    return () => document.removeEventListener('mousedown', down)
  }, [ref, onOut])
}

function ModelMenu({ transcript, options, onConfigure, onClose }: { transcript: Transcript | null; options: ChatOptions | null; onConfigure: (p: ChatConfigPatch) => void; onClose: () => void }) {
  const models = options?.models ?? []
  const current = currentModel(transcript, options)
  const efforts = current?.efforts ?? []
  const effort = transcript?.effort ?? null
  return (
    <Popover onClose={onClose} className="is-model" testid="chat-menu:model">
      <div className="chat-pop-title">Model</div>
      {options === null ? <div className="chat-pop-empty">Loading…</div> : models.length === 0 ? <div className="chat-pop-empty">No models listed</div> : models.map((m) => (
        <button key={m.id} className={`chat-pop-item ${m === current ? 'is-on' : ''}`} onClick={() => { onConfigure({ model: m.id }); onClose() }} data-testid={`chat-model:${m.id}`}>
          <span className="chat-pop-label">{m.label}</span>
          {m.description ? <span className="chat-pop-desc">{m.description}</span> : null}
          {m === current ? <Check className="chat-ic chat-pop-check" /> : null}
        </button>
      ))}
      {efforts.length ? (
        <>
          <div className="chat-pop-sep" />
          <div className="chat-pop-title">Effort <EffortDots effort={effort} /> <span className="chat-pop-hint">{effortLabel(effort)}</span></div>
          <div className="chat-effort" role="radiogroup" aria-label="Effort">
            <button className={`chat-seg ${effort === null ? 'is-on' : ''}`} role="radio" aria-checked={effort === null} onClick={() => onConfigure({ effort: null })} title="The model's default" data-testid="chat-effort:auto">Auto</button>
            {efforts.map((e) => (
              <button key={e} className={`chat-seg ${e === effort ? 'is-on' : ''}`} role="radio" aria-checked={e === effort} onClick={() => onConfigure({ effort: e })} data-testid={`chat-effort:${e}`}>{effortLabel(e)}</button>
            ))}
          </div>
        </>
      ) : null}
    </Popover>
  )
}

/** The extension's five-dot effort meter. */
function EffortDots({ effort }: { effort: string | null }) {
  const level = effort ? EFFORT_SCALE.indexOf(effort) + 1 : 0
  return (
    <svg className="chat-effort-dots" width="30" height="8" viewBox="0 0 30 8" aria-hidden>
      {EFFORT_SCALE.map((_, i) => <circle key={i} cx={3 + i * 6} cy="4" r="2.2" className={i < level ? 'is-on' : ''} />)}
    </svg>
  )
}

/** While a turn runs, how long it has been running; otherwise how long the session has been going. Only this chip ticks. */
function ElapsedChip({ transcript }: { transcript: Transcript }) {
  const running = (transcript.status === 'running' || transcript.status === 'waiting') && transcript.turnStartedAt
  const first = transcript.items[0]?.at
  const now = useTicker(running ? 1000 : 30_000)
  if (running) return <span className="chat-foot-clock is-live" title="This turn so far" data-testid="chat-clock"><Clock className="chat-ic" />{formatElapsed(now - (transcript.turnStartedAt ?? now))}</span>
  if (!first) return null
  return <span className="chat-foot-clock" title="Since this session's first message" data-testid="chat-clock"><Clock className="chat-ic" />{formatElapsed(now - first)}</span>
}

function useTicker(ms: number): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    setNow(Date.now())
    const t = setInterval(() => setNow(Date.now()), ms)
    return () => clearInterval(t)
  }, [ms])
  return now
}

/** The extension's context indicator: a pie of the window in use; a click compacts (Claude). */
function ContextPie({ transcript, onCompact }: { transcript: Transcript; onCompact?: () => void }) {
  const used = transcript.usage.contextTokens
  const size = transcript.usage.contextWindow
  if (!used) return null
  if (!size) return <span className="chat-foot-context" title={`${used.toLocaleString()} tokens in context`}>{fmtTokens(used)}</span>
  const pct = Math.min(100, (used / size) * 100)
  const left = Math.max(0, 100 - pct)
  const title = `${Math.round(pct)}% context used (${fmtTokens(used)} of ${fmtTokens(size)})${onCompact ? ` — ${Math.round(left)}% left before auto-compact. Click to compact.` : ''}`
  const r = 6
  const c = 2 * Math.PI * r
  return (
    <button className={`chat-foot-context ${pct >= 80 ? 'is-hot' : ''}`} title={title} aria-label={title} onClick={onCompact} disabled={!onCompact} data-testid="chat-context">
      <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
        <circle cx="8" cy="8" r={r} className="chat-pie-track" />
        <circle cx="8" cy="8" r={r} className="chat-pie-fill" strokeDasharray={`${(pct / 100) * c} ${c}`} transform="rotate(-90 8 8)" />
      </svg>
      <span>{Math.round(pct)}%</span>
    </button>
  )
}

function ModeIcon({ id }: { id: string | null | undefined }) {
  switch (id) {
    case 'acceptEdits': return <PencilLine className="chat-ic" aria-hidden />
    case 'plan': return <ListChecks className="chat-ic" aria-hidden />
    case 'auto': return <Sparkles className="chat-ic" aria-hidden />
    case 'dontAsk': return <ShieldOff className="chat-ic" aria-hidden />
    case 'read-only': return <Lock className="chat-ic" aria-hidden />
    case 'full-access': return <ShieldOff className="chat-ic" aria-hidden />
    case 'default': return <Hand className="chat-ic" aria-hidden />
    default: return <ShieldCheck className="chat-ic" aria-hidden />
  }
}

const MODE_FALLBACK: Record<string, string> = { default: 'Manual', acceptEdits: 'Edit automatically', plan: 'Plan', auto: 'Auto', dontAsk: "Don't ask", bypassPermissions: 'Bypass permissions', 'read-only': 'Read only', 'full-access': 'Full access' }

function modeLabel(id: string | null, options: ChatOptions | null): string {
  if (!id) return 'Default'
  return options?.modes.find((m) => m.id === id)?.label ?? MODE_FALLBACK[id] ?? id
}

/**
 * The model row the session is on: an exact id first, then the row that
 * resolves to it (preferring a named model over "Default", which resolves to
 * one too), and "Default" itself until the CLI has said which model it runs.
 */
function currentModel(t: Transcript | null, options: ChatOptions | null): ModelOption | undefined {
  const models = options?.models ?? []
  if (!t?.model) return models.find((m) => m.id === 'default')
  return models.find((m) => m.id === t.model) ?? models.find((m) => m.id !== 'default' && m.model === t.model) ?? models.find((m) => m.model === t.model)
}

function currentModelLabel(t: Transcript, options: ChatOptions | null): string {
  return currentModel(t, options)?.label ?? (modelLabel(t.model) || 'Default')
}

/** Commands whose name starts with the query first, then those that contain it (name or description). */
export function filterCommands(list: CommandOption[], query: string): CommandOption[] {
  const q = query.toLowerCase()
  if (!q) return list.slice(0, 80)
  const starts = list.filter((c) => c.name.toLowerCase().startsWith(q))
  const rest = list.filter((c) => !c.name.toLowerCase().startsWith(q) && (c.name.toLowerCase().includes(q) || c.description.toLowerCase().includes(q)))
  return [...starts, ...rest].slice(0, 80)
}

