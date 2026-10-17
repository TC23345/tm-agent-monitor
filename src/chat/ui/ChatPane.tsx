// The chat pane body: a transcript, approvals and questions inline, a
// composer with attachments, and a session picker over the provider's own
// history. The host draws the pane header (claude-watch's `Pane`), owns the
// processes behind `ChatBridge`, and may pass its Markdown renderer through
// `renderText`.
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type ChangeEvent, type ClipboardEvent, type KeyboardEvent, type ReactNode } from 'react'
import { AtSign, Bot, Check, ChevronDown, ChevronRight, CircleStop, History, Image as ImageIcon, MessageCircleQuestion, Paperclip, Plus, Search, Send, TerminalSquare, Wrench, X } from 'lucide-react'
import type { ChatBridge } from './bridge'
import {
  pendingRequests, sortSessions,
  type ApprovalChoice, type Attachment, type ChatItem, type ChatItemApproval, type ChatItemQuestion, type ChatItemTool, type Provider, type SessionSummary, type Transcript
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
  onFocus?: () => void
  /** The host raises attention (pane bell, tray) while an approval or question waits. */
  onAttention?: (waiting: boolean) => void
}

const PROVIDER_LABEL: Record<Provider, string> = { claude: 'Claude Code', codex: 'Codex' }
const MAX_IMAGE_BYTES = 20 * 1024 * 1024

export const ChatPane = forwardRef<ChatPaneHandle, Props>(function ChatPane({ bridge, config, onConfig, renderText, onFocus, onAttention }, ref) {
  const [transcript, setTranscript] = useState<Transcript | null>(null)
  const [chatId, setChatId] = useState<string | null>(config.chatId ?? null)
  const [picker, setPicker] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [refField, setRefField] = useState(false)
  const composer = useRef<HTMLTextAreaElement | null>(null)
  const fileInput = useRef<HTMLInputElement | null>(null)
  const scroller = useRef<HTMLDivElement | null>(null)
  const stickToBottom = useRef(true)

  // Attach: reuse the host's live session, else start one (resuming the stored provider session).
  const attach = useCallback(async (resume: string | null | undefined, reuse: string | null) => {
    setNotice(null)
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

  useEffect(() => bridge.onChange((id, t) => {
    if (id !== chatId) return
    setTranscript(t)
    if (t.sessionId && t.sessionId !== config.resumeId) onConfig({ resumeId: t.sessionId })
  }), [bridge, chatId, config.resumeId, onConfig])

  const waiting = transcript ? pendingRequests(transcript).length > 0 : false
  useEffect(() => onAttention?.(waiting), [waiting, onAttention])

  // Keep the newest row in view while the user has not scrolled up.
  useEffect(() => {
    const el = scroller.current
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight
  }, [transcript])

  const send = useCallback(() => {
    const el = composer.current
    if (!el || !chatId) return
    const text = el.value.trim()
    if (!text && attachments.length === 0) return
    el.value = ''
    el.style.height = ''
    const list = attachments
    setAttachments([])
    stickToBottom.current = true
    void bridge.send(chatId, text, list).catch((err) => setNotice((err as Error).message))
  }, [attachments, bridge, chatId])

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
    interrupt: () => { if (chatId) void bridge.interrupt(chatId) },
    newSession,
    pickSession: () => setPicker(true)
  }), [bridge, chatId, newSession])

  const addImages = useCallback((files: Iterable<File>) => {
    for (const file of files) {
      if (!file.type.startsWith('image/')) continue
      if (file.size > MAX_IMAGE_BYTES) {
        setNotice(`${file.name || 'Image'} is larger than 20 MB`)
        continue
      }
      const reader = new FileReader()
      reader.onload = () => {
        const url = String(reader.result ?? '')
        const data = url.slice(url.indexOf(',') + 1)
        setAttachments((list) => [...list, { kind: 'image', name: file.name || `pasted-${list.length + 1}.png`, mime: file.type, data }])
      }
      reader.readAsDataURL(file)
    }
  }, [])

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
    composer.current?.focus()
  }

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.altKey) {
      e.preventDefault()
      send()
    } else if (e.key === 'Escape' && transcript?.status === 'running' && chatId) {
      e.preventDefault()
      void bridge.interrupt(chatId)
    }
  }

  const answer = (approvalId: string, choice: ApprovalChoice) => {
    if (chatId) void bridge.answer(chatId, approvalId, choice)
  }
  const answerQuestion = (questionId: string, answers: Record<string, string[]> | null) => {
    if (chatId) void bridge.answerQuestion(chatId, questionId, answers)
  }

  const running = transcript?.status === 'running' || transcript?.status === 'waiting'

  return (
    <div className="chat" data-provider={config.provider} data-status={transcript?.status ?? 'starting'} onFocusCapture={onFocus}>
      <div className="chat-strip">
        <span className={`chat-dot is-${transcript?.status ?? 'starting'}`} aria-hidden />
        <span className="chat-strip-title" title={transcript?.sessionId ?? ''}>{transcript?.title ?? `${PROVIDER_LABEL[config.provider]} session`}</span>
        {transcript?.model ? <span className="chat-strip-meta">{transcript.model}</span> : null}
        {transcript?.usage.contextTokens ? <span className="chat-strip-meta" title="Context window in use">{fmtTokens(transcript.usage.contextTokens)}{transcript.usage.contextWindow ? ` / ${fmtTokens(transcript.usage.contextWindow)}` : ''}</span> : null}
        <span className="chat-strip-spacer" />
        <button className="chat-iconbtn" title="Sessions" aria-label="Sessions" onClick={() => setPicker((v) => !v)} data-testid="chat-tool:sessions"><History className="chat-ic" /></button>
        <button className="chat-iconbtn" title="New session" aria-label="New session" onClick={newSession} data-testid="chat-tool:new"><Plus className="chat-ic" /></button>
      </div>
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
        {transcript ? transcript.items.map((item) => <Row key={item.id} item={item} renderText={renderText} onAnswer={answer} onAnswerQuestion={answerQuestion} />) : <div className="chat-empty">Starting {PROVIDER_LABEL[config.provider]}…</div>}
        {transcript && transcript.items.length === 0 ? <div className="chat-empty">Ask {PROVIDER_LABEL[config.provider]} something about <code>{config.cwd}</code>.</div> : null}
      </div>
      {attachments.length || refField ? (
        <div className="chat-attachments" data-testid="chat-attachments">
          {attachments.map((a, i) => (
            <span key={`${a.kind}:${a.kind === 'image' ? a.name + i : a.path}`} className={`chat-chip is-${a.kind}`} title={a.kind === 'file' ? a.path : a.name}>
              {a.kind === 'image' ? <ImageIcon className="chat-ic" /> : <AtSign className="chat-ic" />}
              <span className="chat-chip-label">{a.kind === 'image' ? a.name : a.name ?? a.path}</span>
              <button className="chat-chip-x" aria-label={`Remove ${a.kind === 'image' ? a.name : a.path}`} onClick={() => setAttachments((list) => list.filter((_, j) => j !== i))}><X className="chat-ic" /></button>
            </span>
          ))}
          {refField ? (
            <input
              className="chat-ref-input" autoFocus placeholder="Path to reference, then Enter" data-testid="chat-ref-input"
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); addReference(e.currentTarget.value) }
                else if (e.key === 'Escape') { e.preventDefault(); setRefField(false); composer.current?.focus() }
              }}
              onBlur={(e) => { if (!e.currentTarget.value.trim()) setRefField(false) }}
            />
          ) : null}
        </div>
      ) : null}
      <div className="chat-composer">
        <button className="chat-iconbtn" title="Attach an image" aria-label="Attach an image" onClick={() => fileInput.current?.click()} disabled={!chatId} data-testid="chat-tool:attach"><Paperclip className="chat-ic" /></button>
        <button className={`chat-iconbtn ${refField ? 'is-on' : ''}`} title="Reference a file (@path)" aria-label="Reference a file" onClick={() => setRefField((v) => !v)} disabled={!chatId} data-testid="chat-tool:reference"><AtSign className="chat-ic" /></button>
        <input ref={fileInput} type="file" accept="image/*" multiple hidden onChange={onPickFiles} />
        <textarea
          ref={composer}
          rows={1}
          placeholder={waiting ? 'Answer the request above first' : `Message ${PROVIDER_LABEL[config.provider]} — Enter sends, Shift+Enter is a newline, paste an image to attach it`}
          onKeyDown={onKey}
          onPaste={onPaste}
          onInput={(e) => {
            const el = e.currentTarget
            el.style.height = ''
            el.style.height = `${Math.min(el.scrollHeight, 220)}px`
          }}
          disabled={!chatId}
          data-testid="chat-composer"
        />
        {running ? (
          <button className="chat-iconbtn is-stop" title="Stop (Esc)" aria-label="Stop" onClick={() => chatId && bridge.interrupt(chatId)} data-testid="chat-tool:stop"><CircleStop className="chat-ic" /></button>
        ) : (
          <button className="chat-iconbtn is-send" title="Send (Enter)" aria-label="Send" onClick={send} disabled={!chatId} data-testid="chat-tool:send"><Send className="chat-ic" /></button>
        )}
      </div>
    </div>
  )
})

function Row({ item, renderText, onAnswer, onAnswerQuestion }: { item: ChatItem; renderText?: (text: string) => ReactNode; onAnswer: (id: string, choice: ApprovalChoice) => void; onAnswerQuestion: (id: string, answers: Record<string, string[]> | null) => void }) {
  switch (item.kind) {
    case 'user':
      return (
        <div className="chat-row is-user" data-testid="chat-row:user">
          <div className="chat-bubble">
            {item.text ? plain(item.text) : null}
            {item.attachments?.length ? <div className="chat-bubble-attachments">{item.attachments.map((a, i) => <span key={i} className={`chat-chip is-${a.kind}`}>{a.kind === 'image' ? <ImageIcon className="chat-ic" /> : <AtSign className="chat-ic" />}<span className="chat-chip-label">{a.name}</span></span>)}</div> : null}
          </div>
        </div>
      )
    case 'assistant':
      return (
        <div className={`chat-row is-assistant ${item.streaming ? 'is-streaming' : ''}`} data-testid="chat-row:assistant">
          <Bot className="chat-ic chat-row-ic" aria-hidden />
          <div className="chat-text">{renderText && !item.streaming ? renderText(item.text) : plain(item.text)}</div>
        </div>
      )
    case 'thinking':
      return <Fold className="is-thinking" icon={<ChevronRight className="chat-ic" />} title={item.streaming ? 'Thinking…' : 'Thought'} testid="chat-row:thinking"><div className="chat-text is-muted">{plain(item.text)}</div></Fold>
    case 'tool':
      return <ToolRow item={item} />
    case 'approval':
      return <ApprovalRow item={item} onAnswer={onAnswer} />
    case 'question':
      return <QuestionRow item={item} onAnswer={onAnswerQuestion} />
    case 'system':
      return <div className={`chat-row is-system is-${item.level}`} data-testid="chat-row:system">{item.text}</div>
  }
}

function ToolRow({ item }: { item: ChatItemTool }) {
  const glyph = item.name === 'commandExecution' || item.name === 'Bash' || item.name === 'PowerShell' ? <TerminalSquare className="chat-ic" /> : <Wrench className="chat-ic" />
  const status = item.status === 'running' ? <span className="chat-spin" aria-label="running" /> : item.status === 'done' ? <Check className="chat-ic is-ok" /> : <X className="chat-ic is-bad" />
  const body = [item.input && item.input !== item.title ? item.input : '', item.output ?? ''].filter(Boolean).join('\n\n')
  return (
    <Fold className={`is-tool is-${item.status}`} icon={glyph} title={item.title} trailing={status} testid="chat-row:tool" open={false}>
      {body ? <pre className="chat-pre">{body}</pre> : null}
    </Fold>
  )
}

function ApprovalRow({ item, onAnswer }: { item: ChatItemApproval; onAnswer: (id: string, choice: ApprovalChoice) => void }) {
  const label: Record<ApprovalChoice, string> = { allow: 'Allow', 'allow-session': 'Allow for this session', deny: 'Deny', cancel: 'Cancel' }
  return (
    <div className={`chat-row is-approval ${item.decided ? 'is-decided' : 'is-waiting'}`} data-testid="chat-row:approval">
      <div className="chat-approval-title">{item.title}</div>
      {item.detail ? <pre className="chat-pre">{item.detail}</pre> : null}
      {item.decided ? (
        <div className="chat-approval-decided">{label[item.decided]}</div>
      ) : (
        <div className="chat-approval-actions">
          {item.choices.map((c) => (
            <button key={c} className={`chat-btn is-${c}`} onClick={() => onAnswer(item.id, c)} data-testid={`chat-approve:${c}`}>{label[c]}</button>
          ))}
        </div>
      )}
    </div>
  )
}

/** One or more questions: option buttons (single or multi), an "Other" text field, Submit and Dismiss. */
function QuestionRow({ item, onAnswer }: { item: ChatItemQuestion; onAnswer: (id: string, answers: Record<string, string[]> | null) => void }) {
  const [picked, setPicked] = useState<Record<string, string[]>>({})
  const [other, setOther] = useState<Record<string, string>>({})
  const done = !!item.answers || !!item.cancelled
  const toggle = (qid: string, label: string, multi: boolean) =>
    setPicked((p) => {
      const cur = p[qid] ?? []
      if (multi) return { ...p, [qid]: cur.includes(label) ? cur.filter((x) => x !== label) : [...cur, label] }
      return { ...p, [qid]: cur[0] === label ? [] : [label] }
    })
  const answers = (): Record<string, string[]> => {
    const out: Record<string, string[]> = {}
    for (const q of item.questions) {
      const list = [...(picked[q.id] ?? [])]
      const free = (other[q.id] ?? '').trim()
      if (free) list.push(free)
      out[q.id] = list
    }
    return out
  }
  const complete = item.questions.every((q) => (picked[q.id]?.length ?? 0) > 0 || (other[q.id] ?? '').trim())
  return (
    <div className={`chat-row is-question ${done ? 'is-decided' : 'is-waiting'}`} data-testid="chat-row:question">
      <div className="chat-approval-title"><MessageCircleQuestion className="chat-ic" aria-hidden /> {item.title}</div>
      {item.detail ? <pre className="chat-pre">{item.detail}</pre> : null}
      {item.questions.map((q) => (
        <div key={q.id} className="chat-q">
          {q.header ? <div className="chat-q-header">{q.header}</div> : null}
          <div className="chat-q-text">{q.text}</div>
          {done ? (
            <div className="chat-approval-decided">{item.cancelled ? 'Dismissed' : (item.answers?.[q.id] ?? []).join(', ') || '—'}</div>
          ) : (
            <>
              {q.options ? (
                <div className="chat-q-options">
                  {q.options.map((o) => (
                    <button
                      key={o.label}
                      className={`chat-btn is-option ${(picked[q.id] ?? []).includes(o.label) ? 'is-on' : ''}`}
                      title={o.description}
                      aria-pressed={(picked[q.id] ?? []).includes(o.label)}
                      onClick={() => toggle(q.id, o.label, q.multiSelect)}
                      data-testid={`chat-option:${o.label}`}
                    >
                      {o.label}{o.description ? <span className="chat-q-desc">{o.description}</span> : null}
                    </button>
                  ))}
                </div>
              ) : null}
              {q.options === null || q.allowOther ? (
                <input
                  className="chat-ref-input"
                  type={q.secret ? 'password' : 'text'}
                  placeholder={q.options ? 'Other…' : 'Your answer'}
                  value={other[q.id] ?? ''}
                  onChange={(e) => setOther((o) => ({ ...o, [q.id]: e.target.value }))}
                  onKeyDown={(e) => { if (e.key === 'Enter' && complete) { e.preventDefault(); onAnswer(item.id, answers()) } }}
                  data-testid={`chat-other:${q.id}`}
                />
              ) : null}
            </>
          )}
        </div>
      ))}
      {done ? null : (
        <div className="chat-approval-actions">
          <button className="chat-btn is-allow" disabled={!complete} onClick={() => onAnswer(item.id, answers())} data-testid="chat-question:submit">Submit</button>
          <button className="chat-btn" onClick={() => onAnswer(item.id, null)} data-testid="chat-question:dismiss">Dismiss</button>
        </div>
      )}
    </div>
  )
}

function Fold({ className, icon, title, trailing, children, testid, open: initial = false }: { className: string; icon: ReactNode; title: string; trailing?: ReactNode; children: ReactNode; testid: string; open?: boolean }) {
  const [open, setOpen] = useState(initial)
  return (
    <div className={`chat-row is-fold ${className} ${open ? 'is-open' : ''}`} data-testid={testid}>
      <button className="chat-fold-head" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        {open ? <ChevronDown className="chat-ic" /> : icon}
        <span className="chat-fold-title">{title}</span>
        {trailing}
      </button>
      {open ? <div className="chat-fold-body">{children}</div> : null}
    </div>
  )
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

function plain(text: string): ReactNode {
  return text.split(/\n{2,}/).map((p, i) => <p key={i}>{p}</p>)
}

function fmtTokens(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(n >= 100000 ? 0 : 1)}k` : String(n)
}

function relTime(at: number): string {
  const s = Math.max(0, (Date.now() - at) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}
