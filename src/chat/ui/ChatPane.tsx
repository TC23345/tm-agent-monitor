// The chat pane body: a timeline transcript (rows.tsx), approvals and
// questions inline, a composer with the model, effort, mode and context
// controls (composer.tsx), and a session picker over the provider's own
// history. The layout and wording follow the Claude Code extension's webview
// (docs/rea-findings.md, webview pass). The host draws the pane header
// (claude-watch's `Pane`: the provider's name, the folder, and Sessions / New
// session through `ChatPaneHandle`), owns the processes behind `ChatBridge`,
// and may pass its Markdown renderer through `renderText` and its clipboard
// through `copyText`. The body's strip shows only what neither the header nor
// the composer does: the session's own title, once it has one.
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type ReactNode } from 'react'
import { Search, X } from 'lucide-react'
import type { ChatBridge } from './bridge'
import { Row, plain, type RowActions } from './rows'
import { Composer, type ComposerHandle } from './composer'
import {
  pendingRequests, sortSessions,
  type ApprovalChoice, type Attachment, type ChatConfigPatch, type ChatOptions, type Provider, type SessionSummary, type Transcript
} from '../shared/chatModel.mjs'

export interface ChatPaneConfig {
  provider: Provider
  cwd: string
  /** The host's live-session handle, kept across remounts; stale after an app restart. */
  chatId?: string
  /** The provider session to resume after a restart (the transcript's own id). */
  resumeId?: string
  model?: string | null
}

export interface ChatPaneHandle {
  focus(): void
  interrupt(): void
  newSession(): void
  pickSession(): void
}

interface Props {
  bridge: ChatBridge
  config: ChatPaneConfig
  onConfig: (patch: Partial<ChatPaneConfig>) => void
  /** Host-provided text renderer (Markdown in claude-watch); plain paragraphs by default. */
  renderText?: (text: string) => ReactNode
  /** Host-provided clipboard (claude-watch's `copyText`); the browser clipboard by default. */
  copyText?: (text: string) => void
  onFocus?: () => void
  /** The host raises attention (pane bell, tray) while an approval or question waits. */
  onAttention?: (waiting: boolean) => void
}

const PROVIDER_LABEL: Record<Provider, string> = { claude: 'Claude Code', codex: 'Codex' }

export const ChatPane = forwardRef<ChatPaneHandle, Props>(function ChatPane({ bridge, config, onConfig, renderText, copyText, onFocus, onAttention }, ref) {
  const [transcript, setTranscript] = useState<Transcript | null>(null)
  const [chatId, setChatId] = useState<string | null>(config.chatId ?? null)
  const [options, setOptions] = useState<ChatOptions | null>(null)
  const [picker, setPicker] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const composer = useRef<ComposerHandle | null>(null)
  const scroller = useRef<HTMLDivElement | null>(null)
  const stickToBottom = useRef(true)

  // Attach: reuse the host's live session, else start one (resuming the stored provider session).
  const attach = useCallback(async (resume: string | null | undefined, reuse: string | null) => {
    setNotice(null)
    setOptions(null)
    if (reuse) {
      const live = await bridge.get(reuse)
      if (live) {
        setChatId(reuse)
        setTranscript(live)
        return
      }
    }
    try {
      const { id, transcript: t } = await bridge.create({ provider: config.provider, cwd: config.cwd, resume: resume ?? null, model: config.model ?? null })
      setChatId(id)
      setTranscript(t)
      onConfig({ chatId: id, resumeId: t.sessionId ?? resume ?? undefined })
    } catch (err) {
      setNotice((err as Error).message)
    }
  }, [bridge, config.provider, config.cwd, config.model, onConfig])

  useEffect(() => {
    void attach(config.resumeId, config.chatId ?? null)
    // The pane attaches once per mount; a new session or a pick re-attaches explicitly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // The host passes fresh callbacks on every render; the subscription and the rows read them through refs.
  const onConfigRef = useRef(onConfig)
  onConfigRef.current = onConfig
  const resumeRef = useRef(config.resumeId)
  resumeRef.current = config.resumeId
  useEffect(() => bridge.onChange((id, t) => {
    if (id !== chatId) return
    setTranscript(t)
    if (t.sessionId && t.sessionId !== resumeRef.current) onConfigRef.current({ resumeId: t.sessionId })
  }), [bridge, chatId])

  // What the composer's menus offer; again when the model changes (its efforts and modes differ).
  const refreshOptions = useCallback(() => {
    if (!chatId) return
    bridge.options(chatId).then(setOptions).catch(() => { /* the menus say Loading… and retry on open */ })
  }, [bridge, chatId])
  const model = transcript?.model ?? null
  const ready = !!transcript?.sessionId || transcript?.provider === 'codex'
  useEffect(() => {
    if (chatId && ready) refreshOptions()
  }, [chatId, ready, model, refreshOptions])

  const waiting = transcript ? pendingRequests(transcript).length > 0 : false
  useEffect(() => onAttention?.(waiting), [waiting, onAttention])

  // Keep the newest row in view while the user has not scrolled up.
  useEffect(() => {
    const el = scroller.current
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight
  }, [transcript])

  const send = useCallback((text: string, attachments: Attachment[]) => {
    if (!chatId) return
    stickToBottom.current = true
    void bridge.send(chatId, text, attachments).catch((err) => setNotice((err as Error).message))
  }, [bridge, chatId])

  const interrupt = useCallback(() => {
    if (chatId) void bridge.interrupt(chatId)
  }, [bridge, chatId])

  const configure = useCallback((patch: ChatConfigPatch) => {
    if (!chatId) return
    void bridge.configure(chatId, patch).catch((err) => setNotice((err as Error).message))
  }, [bridge, chatId])

  const newSession = useCallback(() => {
    if (chatId) void bridge.close(chatId)
    setChatId(null)
    setTranscript(null)
    onConfig({ chatId: undefined, resumeId: undefined })
    void attach(null, null)
  }, [attach, bridge, chatId, onConfig])

  const pick = useCallback((s: SessionSummary) => {
    setPicker(false)
    if (chatId) void bridge.close(chatId)
    setChatId(null)
    setTranscript(null)
    onConfig({ chatId: undefined, resumeId: s.id, cwd: s.cwd || config.cwd })
    void attach(s.id, null)
  }, [attach, bridge, chatId, config.cwd, onConfig])

  useImperativeHandle(ref, () => ({
    focus: () => composer.current?.focus(),
    interrupt,
    newSession,
    pickSession: () => setPicker(true)
  }), [interrupt, newSession])

  const renderRef = useRef(renderText)
  renderRef.current = renderText
  const copyRef = useRef(copyText)
  copyRef.current = copyText
  const actions = useMemo<RowActions>(() => ({
    renderText: (text) => (renderRef.current ? renderRef.current(text) : plain(text)),
    onAnswer: (approvalId: string, choice: ApprovalChoice) => { if (chatId) void bridge.answer(chatId, approvalId, choice) },
    onAnswerQuestion: (questionId: string, answers: Record<string, string[]> | null) => { if (chatId) void bridge.answerQuestion(chatId, questionId, answers) },
    copyText: (text: string) => (copyRef.current ? copyRef.current(text) : browserCopy(text))
  }), [bridge, chatId])

  return (
    <div className="chat" data-provider={config.provider} data-status={transcript?.status ?? 'starting'} onFocusCapture={onFocus}>
      {transcript?.title ? (
        <div className="chat-strip" data-testid="chat-strip">
          <span className={`chat-dot is-${transcript.status}`} aria-hidden />
          <span className="chat-strip-title" title={transcript.sessionId ?? ''}>{transcript.title}</span>
        </div>
      ) : null}
      {notice ? <div className="chat-notice" role="alert">{notice}<button className="chat-iconbtn" aria-label="Dismiss" onClick={() => setNotice(null)}><X className="chat-ic" /></button></div> : null}
      {transcript?.error && transcript.status === 'error' ? <div className="chat-notice is-error" role="alert">{transcript.error}</div> : null}
      {picker ? <SessionPicker bridge={bridge} provider={config.provider} cwd={config.cwd} onPick={pick} onClose={() => setPicker(false)} /> : null}
      <div
        className="chat-scroll"
        ref={scroller}
        onScroll={(e) => {
          const el = e.currentTarget
          stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40
        }}
      >
        {transcript ? transcript.items.map((item) => <Row key={item.id} item={item} actions={actions} />) : <div className="chat-empty">Starting {PROVIDER_LABEL[config.provider]}…</div>}
        {transcript && transcript.items.length === 0 ? <div className="chat-empty" title={config.cwd}>Ask {PROVIDER_LABEL[config.provider]} something about this folder.</div> : null}
      </div>
      <Composer
        ref={composer}
        provider={config.provider}
        transcript={transcript}
        chatId={chatId}
        options={options}
        onRefreshOptions={refreshOptions}
        onSend={send}
        onInterrupt={interrupt}
        onConfigure={configure}
        onNotice={setNotice}
      />
    </div>
  )
})

function browserCopy(text: string) {
  navigator.clipboard?.writeText(text).catch(() => {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    document.execCommand('copy')
    ta.remove()
  })
}

function SessionPicker({ bridge, provider, cwd, onPick, onClose }: { bridge: ChatBridge; provider: Provider; cwd: string; onPick: (s: SessionSummary) => void; onClose: () => void }) {
  const [all, setAll] = useState<SessionSummary[] | null>(null)
  const [everywhere, setEverywhere] = useState(false)
  const [q, setQ] = useState('')
  useEffect(() => {
    let live = true
    setAll(null)
    bridge.listSessions(provider, everywhere ? undefined : cwd).then((list) => { if (live) setAll(sortSessions(list)) }).catch(() => { if (live) setAll([]) })
    return () => { live = false }
  }, [bridge, provider, cwd, everywhere])
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return (all ?? []).filter((s) => !needle || s.title.toLowerCase().includes(needle) || s.cwd.toLowerCase().includes(needle))
  }, [all, q])
  return (
    <div className="chat-picker" data-testid="chat-picker">
      <div className="chat-picker-head">
        <Search className="chat-ic" aria-hidden />
        <input autoFocus placeholder="Find a session" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Escape') onClose() }} />
        <label className="chat-picker-scope"><input type="checkbox" checked={everywhere} onChange={(e) => setEverywhere(e.target.checked)} /> every folder</label>
        <button className="chat-iconbtn" aria-label="Close" onClick={onClose}><X className="chat-ic" /></button>
      </div>
      <div className="chat-picker-list">
        {all === null ? <div className="chat-empty">Loading…</div> : shown.length === 0 ? <div className="chat-empty">No sessions{everywhere ? '' : ' in this folder'}.</div> : shown.map((s) => (
          <button key={s.id} className="chat-picker-row" onClick={() => onPick(s)} title={s.id} data-testid={`chat-session:${s.id}`}>
            <span className="chat-picker-title">{s.title}</span>
            <span className="chat-picker-meta">{relTime(s.updatedAt)}{s.branch ? ` · ${s.branch}` : ''}{everywhere ? ` · ${s.cwd}` : ''}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

function relTime(at: number): string {
  const s = Math.max(0, (Date.now() - at) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}
