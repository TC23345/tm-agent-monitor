// The transcript rows, laid out as the Claude Code extension's timeline
// (docs/rea-findings.md, webview pass): every step of a reply is a dot on a
// rail — green when it worked, amber when it failed, red while it needs you,
// blinking while it runs — with a bold tool name and a muted detail; commands
// open as IN / OUT, edits as a diff, thinking as "Thought for 2s"; user
// messages and finished replies carry their time. Rows are memoised on the
// item: an item is replaced, never mutated, so a streamed delta re-renders
// only its own row.
import { memo, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { Check, ChevronDown, ChevronRight, Copy, FileCode, Image as ImageIcon, MessageCircleQuestion } from 'lucide-react'
import { DiffView } from './DiffView'
import { changeLines, changeSummary, countChanges, splitLines } from '../shared/diff.mjs'
import { clockTime } from '../shared/present.mjs'
import type { ApprovalChoice, AttachmentSummary, ChatItem, ChatItemApproval, ChatItemQuestion, ChatItemThinking, ChatItemTool } from '../shared/chatModel.mjs'

export interface RowActions {
  renderText: (text: string) => ReactNode
  onAnswer: (id: string, choice: ApprovalChoice) => void
  onAnswerQuestion: (id: string, answers: Record<string, string[]> | null) => void
  copyText: (text: string) => void
}

type Tone = 'ok' | 'bad' | 'wait' | 'run' | 'idle'

export const Row = memo(function Row({ item, actions }: { item: ChatItem; actions: RowActions }) {
  switch (item.kind) {
    case 'user':
      return (
        <div className="chat-row is-user has-stamp" data-testid="chat-row:user">
          <Stamp at={item.at} />
          <div className="chat-user-card">
            {item.attachments?.length ? <div className="chat-user-chips">{item.attachments.map((a, i) => <AttachmentChip key={i} a={a} />)}</div> : null}
            {item.text ? <div className="chat-user-text">{item.text}</div> : null}
          </div>
        </div>
      )
    case 'assistant':
      return (
        <Timeline tone="idle" testid="chat-row:assistant" className={`is-assistant ${item.streaming ? 'is-streaming' : ''}`} stamp={item.streaming ? undefined : item.at}>
          <div className="chat-text">{item.streaming ? plain(item.text) : actions.renderText(item.text)}</div>
        </Timeline>
      )
    case 'thinking':
      return <ThinkingRow item={item} />
    case 'tool':
      return <ToolRow item={item} copyText={actions.copyText} />
    case 'approval':
      return <ApprovalRow item={item} onAnswer={actions.onAnswer} />
    case 'question':
      return <QuestionRow item={item} onAnswer={actions.onAnswerQuestion} />
    case 'system':
      return (
        <Timeline tone={item.level === 'error' ? 'bad' : 'idle'} testid="chat-row:system" className={`is-system is-${item.level}`}>
          <div className="chat-system-text">{item.text}</div>
        </Timeline>
      )
  }
})

/** One step on the rail: the dot's tone, an optional time stamp, the content. */
function Timeline({ tone, testid, className = '', stamp, children }: { tone: Tone; testid: string; className?: string; stamp?: number; children: ReactNode }) {
  return (
    <div className={`chat-row is-tl tone-${tone} ${stamp !== undefined ? 'has-stamp' : ''} ${className}`} data-testid={testid}>
      {stamp !== undefined ? <Stamp at={stamp} /> : null}
      {children}
    </div>
  )
}

function Stamp({ at }: { at: number }) {
  return <time className="chat-stamp" dateTime={new Date(at).toISOString()} title={new Date(at).toLocaleString()}>{clockTime(at)}</time>
}

function AttachmentChip({ a }: { a: AttachmentSummary }) {
  return (
    <span className={`chat-chip is-${a.kind}`} title={a.kind === 'file' ? a.path ?? a.name : a.name}>
      {a.kind === 'image' ? <ImageIcon className="chat-ic" aria-hidden /> : <FileCode className="chat-ic" aria-hidden />}
      <span className="chat-chip-label">{a.name}</span>
      {a.kind === 'image' && a.width && a.height ? <span className="chat-chip-meta">{a.width}×{a.height}</span> : null}
    </span>
  )
}

function ThinkingRow({ item }: { item: ChatItemThinking }) {
  const [open, setOpen] = useState(false)
  const live = item.streaming && item.durationMs === undefined
  const label = item.durationMs !== undefined ? `Thought for ${Math.max(1, Math.round(item.durationMs / 1000))}s` : live ? 'Thinking…' : 'Thought'
  const text = item.text.trim()
  return (
    <Timeline tone={live ? 'run' : 'idle'} testid="chat-row:thinking" className="is-thinking">
      {text ? (
        <button className="chat-step-head is-toggle" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
          <span className="chat-thinking-label">{label}</span>
          {open ? <ChevronDown className="chat-ic chat-step-chev" /> : <ChevronRight className="chat-ic chat-step-chev" />}
        </button>
      ) : (
        <div className="chat-step-head"><span className="chat-thinking-label">{label}</span></div>
      )}
      {open && text ? <div className="chat-thinking-text">{plain(item.text)}</div> : null}
    </Timeline>
  )
}

function toolTone(item: ChatItemTool): Tone {
  if (item.status === 'running') return 'run'
  if (item.status === 'failed') return 'bad'
  if (item.status === 'declined') return 'idle'
  return 'ok'
}

const OPEN_VIEWS = new Set(['command', 'edit', 'write'])

export function ToolRow({ item, copyText }: { item: ChatItemTool; copyText: (text: string) => void }) {
  const view = item.view ?? 'other'
  const [open, setOpen] = useState(OPEN_VIEWS.has(view))
  // Rows folded before the label existed (an older transcript) read their one-line title.
  const label = item.label ?? item.title
  const detail = item.label ? item.detail : undefined
  const failed = item.status === 'failed'
  const toggles = view === 'search' || view === 'other' || (view === 'read' && failed && !!item.output)
  const head = (
    <>
      <span className="chat-tool-name">{label}</span>
      {detail ? <span className={`chat-tool-detail ${item.detailMono ? 'is-mono' : ''}`}>{detail}</span> : null}
      {toggles ? (open ? <ChevronDown className="chat-ic chat-step-chev" /> : <ChevronRight className="chat-ic chat-step-chev" />) : null}
    </>
  )
  return (
    <Timeline tone={toolTone(item)} testid="chat-row:tool" className={`is-tool is-${view} is-${item.status}`}>
      {toggles
        ? <button className="chat-step-head is-toggle" onClick={() => setOpen((v) => !v)} aria-expanded={open} title={item.title}>{head}</button>
        : <div className="chat-step-head" title={item.title}>{head}</div>}
      {item.status === 'declined' ? <div className="chat-tool-summary">Declined</div> : <ToolBody item={item} view={view} open={open} copyText={copyText} />}
    </Timeline>
  )
}

function ToolBody({ item, view, open, copyText }: { item: ChatItemTool; view: string; open: boolean; copyText: (text: string) => void }) {
  const failed = item.status === 'failed'
  const running = item.status === 'running'
  switch (view) {
    case 'command':
      return (
        <IoGrid>
          <IoRow label="IN" text={item.input ?? ''} onCopy={item.input ? () => copyText(item.input ?? '') : undefined} />
          {item.output ? <IoRow label="OUT" text={item.output} /> : running ? <IoRow label="OUT" muted="Running…" /> : null}
        </IoGrid>
      )
    case 'edit': {
      const edits = item.edits ?? []
      const counts = edits.reduce((acc, e) => {
        const c = countChanges(changeLines(e))
        return { added: acc.added + c.added, removed: acc.removed + c.removed }
      }, { added: 0, removed: 0 })
      return (
        <>
          <div className="chat-tool-summary">{failed ? 'Edit failed' : running && !edits.length ? 'Editing…' : changeSummary(counts)}</div>
          {failed && item.output ? <div className="chat-tool-error">{firstLines(item.output, 3)}</div> : null}
          {edits.length ? <DiffView edits={edits} /> : null}
        </>
      )
    }
    case 'write': {
      const lines = splitLines(item.content ?? '').length
      return (
        <>
          <div className="chat-tool-summary">{failed ? 'Write failed' : `${lines} line${lines === 1 ? '' : 's'}`}</div>
          {failed && item.output ? <div className="chat-tool-error">{firstLines(item.output, 3)}</div> : null}
          {item.content ? <IoGrid><IoRow text={item.content} /></IoGrid> : null}
        </>
      )
    }
    case 'read':
      return failed && item.output && open ? <div className="chat-tool-error">{firstLines(item.output, 3)}</div> : null
    case 'search': {
      const n = item.output ? item.output.trim().split('\n').filter((l) => l.trim()).length : 0
      const files = item.name === 'Glob'
      const summary = running ? 'Searching…' : failed ? 'Search failed' : files
        ? (n === 0 || /^no files found/i.test(item.output ?? '') ? 'No files found' : `${n} file${n === 1 ? '' : 's'}`)
        : (n === 0 ? 'No matches found' : n === 1 ? '1 line of output' : `${n} lines of output`)
      return (
        <>
          <div className="chat-tool-summary">{summary}</div>
          {open && item.output ? <IoGrid><IoRow label="OUT" text={item.output} /></IoGrid> : null}
        </>
      )
    }
    default:
      if (!open) return null
      return (
        <IoGrid>
          {item.input ? <IoRow label="IN" text={item.input} /> : null}
          {item.output ? <IoRow label="OUT" text={item.output} /> : running ? <IoRow label="OUT" muted="Running…" /> : null}
        </IoGrid>
      )
  }
}

function IoGrid({ children }: { children: ReactNode }) {
  return <div className="chat-io" data-testid="chat-io">{children}</div>
}

/** One IN / OUT row: clipped to 60 px with a fade, the rest one click away (the extension opens it in an editor tab). */
function IoRow({ label, text, muted, onCopy }: { label?: string; text?: string; muted?: string; onCopy?: () => void }) {
  const box = useRef<HTMLDivElement | null>(null)
  const [open, setOpen] = useState(false)
  const [clipped, setClipped] = useState(false)
  const [copied, setCopied] = useState(false)
  useLayoutEffect(() => {
    const el = box.current
    if (el && !open) setClipped(el.scrollHeight > el.clientHeight + 1)
  }, [text, open])
  return (
    <div className={`chat-io-row ${label ? '' : 'is-bare'}`}>
      {label ? <div className="chat-io-label">{label}</div> : null}
      <div
        ref={box}
        className={`chat-io-content ${open ? 'is-open' : ''} ${clipped && !open ? 'is-clipped' : ''}`}
        onClick={clipped || open ? () => setOpen((v) => !v) : undefined}
        title={clipped && !open ? 'Show all' : undefined}
      >
        {muted ? <span className="chat-io-muted">{muted}</span> : <pre>{text}</pre>}
      </div>
      {onCopy ? (
        <button
          className="chat-io-copy" aria-label="Copy" title="Copy"
          onClick={(e) => {
            e.stopPropagation()
            onCopy()
            setCopied(true)
            setTimeout(() => setCopied(false), 1200)
          }}
        >
          {copied ? <Check className="chat-ic" /> : <Copy className="chat-ic" />}
        </button>
      ) : null}
    </div>
  )
}

function ApprovalRow({ item, onAnswer }: { item: ChatItemApproval; onAnswer: (id: string, choice: ApprovalChoice) => void }) {
  const label: Record<ApprovalChoice, string> = { allow: 'Allow', 'allow-session': 'Allow for this session', deny: 'Deny', cancel: 'Cancel' }
  return (
    <Timeline tone={item.decided ? 'idle' : 'wait'} testid="chat-row:approval" className={`is-approval ${item.decided ? 'is-decided' : 'is-waiting'}`}>
      <div className="chat-card">
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
    </Timeline>
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
    <Timeline tone={done ? 'idle' : 'wait'} testid="chat-row:question" className={`is-question ${done ? 'is-decided' : 'is-waiting'}`}>
      <div className="chat-card">
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
    </Timeline>
  )
}

export function plain(text: string): ReactNode {
  return text.split(/\n{2,}/).map((p, i) => <p key={i}>{p}</p>)
}

function firstLines(text: string, n: number): string {
  return text.split('\n').slice(0, n).join('\n')
}
