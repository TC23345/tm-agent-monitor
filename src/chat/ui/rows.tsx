// The transcript rows, laid out as the Claude Code extension's timeline
// (docs/rea-findings.md, webview and feature passes): every step of a reply
// is a dot on a rail — green when it worked, amber when it failed, red while
// it needs you, blinking while it runs — with a bold tool name and a muted
// detail; commands open as IN / OUT, edits as a diff, thinking as "Thought for
// 2s", TodoWrite as a checklist and an Agent row with its own steps nested
// under it; prompts carry their time and their actions (fork, rewind), and a
// turn ends in a footer with its time and the files it changed. Rows are
// memoised on the item: an item is replaced, never mutated, so a streamed
// delta re-renders only its own row.
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react'
import {
  Check, ChevronDown, ChevronRight, CircleDot, Circle, CircleCheck, CornerUpLeft, FileCode, Image as ImageIcon, MessageCircleQuestion, MoveDownRight, Square, X
} from 'lucide-react'
import { DiffView } from './DiffView'
import { changeLines, changeSummary, countChanges, splitLines } from '../shared/diff.mjs'
import { activitySummary, clockTime, fmtTokens, formatElapsed, previewMarkdown, relPath, streamParts, dialogCard, type DialogAction } from '../shared/present.mjs'
import type {
  ApprovalChoice, AttachmentSummary, ChatItem, ChatItemApproval, ChatItemAssistant, ChatItemDialog, ChatItemQuestion, ChatItemSystem, ChatItemThinking, ChatItemTool, ChatItemTurn, ChatItemUser, Provider
} from '../shared/chatModel.mjs'

export type PromptAction = 'fork' | 'rewind' | 'fork-rewind'
export interface PlanComment { id: string; quote: string; text: string }

export interface RowActions {
  renderText: (text: string) => ReactNode
  onAnswer: (id: string, choice: ApprovalChoice, message?: string) => void
  onAnswerQuestion: (id: string, answers: Record<string, string[]> | null) => void
  /** One of Claude Code's user dialogs: its result (`null` dismisses), with the button that sent it. */
  onAnswerDialog?: (id: string, result: string | null, action?: DialogAction) => void
  /** Open a web page outside the app (a dialog's *Learn more*). */
  openUrl?: (url: string) => void
  copyText: (text: string) => void
  provider: Provider
  cwd: string
  /** The host opens a file (claude-watch: a File pane); without it paths are plain text. */
  openFile?: (path: string) => void
  /** Fork from a prompt, rewind code to before it, or both. Absent while the session cannot. */
  onPromptAction?: (itemId: string, action: PromptAction) => void
  /** File checkpoints exist, so the rewind entries are offered. */
  canRewind: boolean
  onBackground?: (toolUseId: string) => void
  onStopTask?: (taskId: string) => void
  onRetry?: () => void
  onRemoveComment?: (approvalId: string, commentId: string) => void
  /** Codex: undo (or reapply) a finished turn's file changes. */
  onUndoTurn?: (turnItemId: string, reapply: boolean) => void
  /** Codex plan mode: the plan item waiting for *Implement this plan?* */
  pendingPlan?: string | null
  onImplementPlan?: () => void
  onKeepPlanning?: () => void
  /** A wide pane's agents panel: an Agent row that has a card there is one line, and a click opens the card. */
  openAgent?: { has: (rowId: string) => boolean; open: (rowId: string) => void }
  /** A finished step's rail dot was pressed: open its copy / save menu beside the dot's box. */
  onStepMenu?: (item: ChatItemTool, anchor: DOMRect) => void
}

type Tone = 'ok' | 'bad' | 'wait' | 'run' | 'idle'

interface RowProps {
  item: ChatItem
  actions: RowActions
  /** An Agent row's own steps. */
  nested?: ChatItem[]
  /** A plan approval's comments, made on a selection of the plan. */
  comments?: PlanComment[]
  /** Under a prompt: the rewind confirmation it opened. */
  below?: ReactNode
  /** A Codex turn footer whose steps fold above it: the fold says how long it took. */
  folded?: boolean
}

export const Row = memo(function Row({ item, actions, nested, comments, below, folded }: RowProps) {
  switch (item.kind) {
    case 'user':
      return <UserRow item={item} actions={actions} below={below} />
    case 'assistant':
      if (item.plan) return <PlanCard item={item} actions={actions} />
      // A Codex preamble ("I'll read the file first") is a step, not the answer: no stamp, no copy button.
      if (item.phase === 'commentary') {
        return (
          <Timeline tone="idle" testid="chat-row:commentary" className={`is-assistant is-commentary ${item.streaming ? 'is-streaming' : ''}`}>
            <ReplyText text={item.text} streaming={!!item.streaming} render={actions.renderText} />
          </Timeline>
        )
      }
      return (
        <Timeline tone="idle" testid="chat-row:assistant" className={`is-assistant ${item.streaming ? 'is-streaming' : ''}`} stamp={item.streaming ? undefined : item.at}>
          <ReplyText text={item.text} streaming={!!item.streaming} render={actions.renderText} />
        </Timeline>
      )
    case 'thinking':
      return <ThinkingRow item={item} />
    case 'tool':
      return <ToolRow item={item} actions={actions} nested={nested} />
    case 'approval':
      return <ApprovalRow item={item} actions={actions} comments={comments} />
    case 'question':
      return <QuestionRow item={item} actions={actions} />
    case 'dialog':
      return <DialogRow item={item} actions={actions} />
    case 'system':
      return <SystemRow item={item} actions={actions} />
    case 'turn':
      return <TurnRow item={item} actions={actions} folded={folded} />
  }
})

/** One step on the rail: the dot's tone, an optional time stamp, the content. */
function Timeline({ tone, testid, className = '', stamp, itemId, children }: { tone: Tone; testid: string; className?: string; stamp?: number; itemId?: string; children: ReactNode }) {
  return (
    <div className={`chat-row is-tl tone-${tone} ${stamp !== undefined ? 'has-stamp' : ''} ${className}`} data-testid={testid} data-item={itemId}>
      {stamp !== undefined ? <Stamp at={stamp} /> : null}
      {children}
    </div>
  )
}

function Stamp({ at }: { at: number }) {
  return <time className="chat-stamp" dateTime={new Date(at).toISOString()} title={new Date(at).toLocaleString()}>{clockTime(at)}</time>
}


/** True when the click ended a text selection rather than meaning a click. */
function selecting(): boolean {
  const sel = window.getSelection()
  return !!sel && !sel.isCollapsed && sel.toString().trim().length > 0
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

/** A long prompt folds at 250 px, as the extension folds it (`maxHeight: 250`). */
const FOLD_PX = 250
const COMMAND = /^\/([\w:.-]+)(\s[\s\S]*)?$/

function PromptText({ text }: { text: string }) {
  const command = COMMAND.exec(text)
  if (!command) return <>{text}</>
  return <><span className="chat-cmd">/{command[1]}</span>{command[2] ?? ''}</>
}

function UserRow({ item, actions, below }: { item: ChatItemUser; actions: RowActions; below?: ReactNode }) {
  const body = useRef<HTMLDivElement | null>(null)
  const [long, setLong] = useState(false)
  const [open, setOpen] = useState(false)
  useLayoutEffect(() => {
    const el = body.current
    if (el && !open) setLong(el.scrollHeight > FOLD_PX + 8)
  }, [item.text, open])
  return (
    <div className="chat-row is-user has-stamp" data-testid="chat-row:user" data-prompt={item.id}>
      <Stamp at={item.at} />
      <div className="chat-user-card">
        {item.attachments?.length ? <div className="chat-user-chips">{item.attachments.map((a, i) => <AttachmentChip key={i} a={a} />)}</div> : null}
        {item.text ? <div ref={body} className={`chat-user-text ${long && !open ? 'is-folded' : ''}`}><PromptText text={item.text} /></div> : null}
        {long ? <button className="chat-more" onClick={() => setOpen((v) => !v)} data-testid="chat-prompt-more">{open ? 'Show less' : 'Show more'}</button> : null}
        {actions.onPromptAction ? <PromptActions itemId={item.id} canRewind={actions.canRewind} onAction={actions.onPromptAction} /> : null}
      </div>
      {below}
    </div>
  )
}

/** The extension's "Message actions" on a prompt: fork from here, and with checkpoints rewind its code. */
function PromptActions({ itemId, canRewind, onAction }: { itemId: string; canRewind: boolean; onAction: (itemId: string, action: PromptAction) => void }) {
  const [open, setOpen] = useState(false)
  const wrap = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (!open) return
    const down = (e: MouseEvent) => { if (!wrap.current?.contains(e.target as Node)) setOpen(false) }
    const esc = () => setOpen(false)
    const node = wrap.current
    document.addEventListener('mousedown', down)
    node?.addEventListener('tm-escape', esc)
    return () => {
      document.removeEventListener('mousedown', down)
      node?.removeEventListener('tm-escape', esc)
    }
  }, [open])
  const pick = (action: PromptAction) => {
    setOpen(false)
    onAction(itemId, action)
  }
  return (
    <div className={`chat-prompt-actions ${open ? 'is-open' : ''}`} ref={wrap} {...(open ? { 'data-escape-close': '' } : {})} onKeyDown={(e) => { if (e.key === 'Escape' && open) { e.preventDefault(); e.stopPropagation(); setOpen(false) } }}>
      <button className="chat-mini" aria-label="Message actions" title="Message actions" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)} data-testid="chat-prompt-actions">
        <CornerUpLeft className="chat-ic" />
      </button>
      {open ? (
        <div className="chat-pop is-prompt" role="menu" data-testid="chat-menu:prompt">
          <button role="menuitem" className="chat-pop-item" onClick={() => pick('fork')} data-testid="chat-prompt:fork">
            <span className="chat-pop-label">Fork conversation from here</span>
            <span className="chat-pop-desc">A new session up to this prompt, with the prompt back in the box to edit</span>
          </button>
          {canRewind ? (
            <>
              <button role="menuitem" className="chat-pop-item" onClick={() => pick('rewind')} data-testid="chat-prompt:rewind">
                <span className="chat-pop-label">Rewind code to here</span>
                <span className="chat-pop-desc">Files go back to how they were before this prompt; the conversation stays</span>
              </button>
              <button role="menuitem" className="chat-pop-item" onClick={() => pick('fork-rewind')} data-testid="chat-prompt:fork-rewind">
                <span className="chat-pop-label">Fork conversation and rewind code</span>
                <span className="chat-pop-desc">Both: a new session from here, and the files as they were</span>
              </button>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

/** A prompt sent mid-turn, waiting for the agent to read it: dimmed, under the turn, and it can be taken back. */
export function QueuedRow({ item, onRemove, onSteer, provider = 'claude' }: { item: ChatItemUser; onRemove?: () => void; onSteer?: () => void; provider?: Provider }) {
  return (
    <div className="chat-row is-user is-queued" data-testid="chat-row:queued">
      <div className="chat-user-card">
        <div className="chat-queued-head">
          <span className="chat-queued-label">Queued</span>
          <span className="chat-queued-hint">{provider === 'codex' ? 'Sent as the next turn' : 'Claude reads this after the current step'}</span>
          {onSteer ? <button className="chat-textbtn" title="Submit without interrupting the model" onClick={onSteer} data-testid="chat-queued-steer">Steer</button> : null}
          {onRemove ? <button className="chat-mini" aria-label="Delete queued message" title="Delete queued message" onClick={onRemove} data-testid="chat-queued-remove"><X className="chat-ic" /></button> : null}
        </div>
        {item.text ? <div className="chat-user-text"><PromptText text={item.text} /></div> : null}
      </div>
    </div>
  )
}

function ThinkingRow({ item }: { item: ChatItemThinking }) {
  const [open, setOpen] = useState(false)
  const live = item.streaming && item.durationMs === undefined
  const label = item.durationMs !== undefined ? `Thought for ${Math.max(1, Math.round(item.durationMs / 1000))}s` : live ? 'Thinking…' : 'Thought'
  const text = item.text.trim()
  const tokens = live && item.tokens ? <span className="chat-thinking-tokens">{fmtTokens(item.tokens)} tokens</span> : null
  return (
    <Timeline tone={live ? 'run' : 'idle'} testid="chat-row:thinking" className="is-thinking">
      {text ? (
        <button className="chat-step-head is-toggle" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
          <span className="chat-thinking-label">{label}</span>
          {tokens}
          {open ? <ChevronDown className="chat-ic chat-step-chev" /> : <ChevronRight className="chat-ic chat-step-chev" />}
        </button>
      ) : (
        <div className="chat-step-head"><span className="chat-thinking-label">{label}</span>{tokens}</div>
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

const OPEN_VIEWS = new Set(['command', 'edit', 'write', 'todo'])

/** A file path in a step's head: the host opens it; the full path is its tooltip. */
function PathLink({ path, label, actions }: { path: string; label: string; actions: RowActions }) {
  if (!actions.openFile) return <>{label}</>
  return (
    <span
      className="chat-link" role="link" tabIndex={0} title={`Open ${path}`}
      onClick={(e) => { e.stopPropagation(); actions.openFile?.(path) }}
      onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); actions.openFile?.(path) } }}
    >{label}</span>
  )
}

export function ToolRow({ item, actions, nested }: { item: ChatItemTool; actions: RowActions; nested?: ChatItem[] }) {
  const view = item.view ?? 'other'
  const [open, setOpen] = useState(OPEN_VIEWS.has(view))
  // Rows folded before the label existed (an older transcript) read their one-line title.
  const label = item.label ?? item.title
  const detail = item.label ? item.detail : undefined
  const failed = item.status === 'failed'
  const running = item.status === 'running'
  const toggles = view === 'search' || view === 'other' || view === 'agent' || (view === 'read' && failed && !!item.output)
  const detailNode = detail ? (item.path && (view === 'read' || view === 'edit' || view === 'write') ? <PathLink path={item.path} label={view === 'read' ? detail : relPath(detail, actions.cwd)} actions={actions} /> : detail) : null
  // Only a task can move: the row has a task id once the CLI started it (not while it waits for approval).
  const canBackground = actions.onBackground && running && !item.background && !!item.taskId && (view === 'command' || view === 'agent') && actions.provider === 'claude'
  // On a wide pane an agent's card holds its steps: the row is one line that opens it.
  const toCard = view === 'agent' && !!actions.openAgent?.has(item.id)
  const stepCount = toCard ? (nested ?? []).filter((x) => x.kind === 'tool').length : 0
  const head = (
    <>
      <span className="chat-tool-name">{label}</span>
      {detailNode ? <span className={`chat-tool-detail ${item.detailMono ? 'is-mono' : ''}`} title={detail}>{detailNode}</span> : null}
      {item.elapsedMs !== undefined && item.elapsedMs >= 1000 && !running ? <span className="chat-tool-elapsed">in {formatElapsed(item.elapsedMs)}</span> : null}
      {running && item.progress && !toCard ? <span className="chat-tool-elapsed" title={item.progress}>{item.progress}</span> : null}
      {item.background ? <span className="chat-tag">In background</span> : null}
      {toCard && stepCount ? <span className="chat-tool-elapsed">{stepCount} step{stepCount === 1 ? '' : 's'}</span> : null}
      {toCard ? <ChevronRight className="chat-ic chat-step-chev" /> : toggles ? (open ? <ChevronDown className="chat-ic chat-step-chev" /> : <ChevronRight className="chat-ic chat-step-chev" />) : null}
    </>
  )
  // A finished step's dot opens the copy / save menu; a running or declined one has nothing to keep yet.
  const openStepMenu = actions.onStepMenu && (item.status === 'done' || item.status === 'failed')
    ? (e: ReactMouseEvent<HTMLButtonElement>) => { e.preventDefault(); e.stopPropagation(); actions.onStepMenu?.(item, e.currentTarget.getBoundingClientRect()) }
    : null
  return (
    <Timeline tone={toolTone(item)} testid="chat-row:tool" className={`is-tool is-${view} is-${item.status}`} itemId={item.id}>
      {openStepMenu ? <button className="chat-rail-hit" aria-label="Copy or save this step" title="Copy or save this step" onClick={openStepMenu} onContextMenu={openStepMenu} data-testid="chat-step-dot" /> : null}
      <div className="chat-step-line">
        {toCard
          ? <button className="chat-step-head is-toggle" onClick={() => { if (!selecting()) actions.openAgent?.open(item.id) }} title={`${item.title} — open in the agents panel`} data-testid="chat-open-agent">{head}</button>
          : toggles
          ? <button className="chat-step-head is-toggle" onClick={() => { if (!selecting()) setOpen((v) => !v) }} aria-expanded={open} title={item.title}>{head}</button>
          : <div className="chat-step-head" title={item.title}>{head}</div>}
        {canBackground || (item.background && item.taskId && running && actions.onStopTask) ? (
          <span className="chat-step-tools">
            {canBackground ? <button className="chat-textbtn" onClick={() => actions.onBackground?.(item.id)} data-testid="chat-tool:background"><MoveDownRight className="chat-ic" aria-hidden /> Run in background</button> : null}
            {item.background && item.taskId && running && actions.onStopTask ? <button className="chat-textbtn" onClick={() => actions.onStopTask?.(item.taskId!)} data-testid="chat-tool:stop-task"><Square className="chat-ic" aria-hidden /> Stop</button> : null}
          </span>
        ) : null}
      </div>
      {item.status === 'declined'
        ? <div className="chat-tool-summary">Declined{item.output ? <> · <span className="chat-reason">Reason: {item.output}</span></> : null}</div>
        : toCard ? null : <ToolBody item={item} view={view} open={open} actions={actions} nested={nested} />}
    </Timeline>
  )
}

function ToolBody({ item, view, open, actions, nested }: { item: ChatItemTool; view: string; open: boolean; actions: RowActions; nested?: ChatItem[] }) {
  const failed = item.status === 'failed'
  const running = item.status === 'running'
  switch (view) {
    case 'command':
      // The model is still writing the command (its input streams in with the block): nothing runs yet.
      if (running && !item.input) return <IoGrid><IoRow label="IN" muted="…" /></IoGrid>
      return (
        <IoGrid>
          <IoRow label="IN" text={item.input ?? ''} kind="in" />
          {item.output ? <IoRow label="OUT" text={item.output} kind="out" /> : running ? <IoRow label="OUT" muted={item.background ? 'Running in the background…' : 'Running…'} /> : null}
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
          {item.content ? <IoGrid><IoRow text={item.content} kind="in" /></IoGrid> : null}
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
          {open && item.output ? <IoGrid><IoRow label="OUT" text={item.output} kind="out" /></IoGrid> : null}
        </>
      )
    }
    case 'todo':
      return item.todos?.length ? <TodoList todos={item.todos} /> : null
    case 'agent':
      return <AgentBody item={item} open={open} actions={actions} nested={nested ?? []} />
    default:
      if (!open) return null
      return (
        <IoGrid>
          {item.input ? <IoRow label="IN" text={item.input} kind="in" /> : null}
          {item.output ? <IoRow label="OUT" text={item.output} kind="out" /> : running ? <IoRow label="OUT" muted="Running…" /> : null}
        </IoGrid>
      )
  }
}

/** TodoWrite as the extension draws it: a checklist — done checked, in progress half-filled, the rest open. */
function TodoList({ todos }: { todos: NonNullable<ChatItemTool['todos']> }) {
  return (
    <ul className="chat-todos" data-testid="chat-todos">
      {todos.map((t, i) => (
        <li key={i} className={`chat-todo is-${t.status}`}>
          {t.status === 'completed' ? <CircleCheck className="chat-ic" aria-label="done" /> : t.status === 'in_progress' ? <CircleDot className="chat-ic" aria-label="in progress" /> : <Circle className="chat-ic" aria-label="to do" />}
          <span>{t.status === 'in_progress' && t.activeForm ? t.activeForm : t.content}</span>
        </li>
      ))}
    </ul>
  )
}

/**
 * An Agent row: the subagent's prompt as IN, then its own steps on a rail of
 * their own — folded to a count and the latest step until opened — then its
 * result as OUT.
 */
function AgentBody({ item, open, actions, nested }: { item: ChatItemTool; open: boolean; actions: RowActions; nested: ChatItem[] }) {
  const steps = nested.filter((x) => x.kind === 'tool')
  const last = steps[steps.length - 1]
  const running = item.status === 'running'
  const count = steps.length ? `${steps.length} step${steps.length === 1 ? '' : 's'}` : running ? 'Starting…' : 'No steps'
  return (
    <>
      <div className="chat-tool-summary">
        {count}
        {!open && last?.kind === 'tool' ? <span className="chat-agent-last"> · {last.label ?? last.title}{last.detail ? ` ${last.detail}` : ''}</span> : null}
      </div>
      {open ? (
        <>
          {item.prompt ? <IoGrid><IoRow label="IN" text={item.prompt} kind="in" /></IoGrid> : null}
          {nested.length ? <div className="chat-nested" data-testid="chat-nested">{nested.map((x) => <Row key={x.id} item={x} actions={actions} />)}</div> : null}
          {item.output ? <IoGrid><IoRow label="OUT" text={item.output} kind="out" /></IoGrid> : null}
        </>
      ) : null}
    </>
  )
}

export function IoGrid({ children }: { children: ReactNode }) {
  return <div className="chat-io" data-testid="chat-io">{children}</div>
}

/** One IN / OUT row: clipped to 60 px with a fade, the rest one click away (the extension opens it in an editor tab). */
export function IoRow({ label, text, muted, kind }: { label?: string; text?: string; muted?: string; kind?: 'in' | 'out' }) {
  const box = useRef<HTMLDivElement | null>(null)
  const [open, setOpen] = useState(false)
  const [clipped, setClipped] = useState(false)
  useLayoutEffect(() => {
    const el = box.current
    if (el && !open) setClipped(el.scrollHeight > el.clientHeight + 1)
  }, [text, open])
  return (
    <div className={`chat-io-row ${label ? '' : 'is-bare'} ${kind ? `is-${kind}` : ''}`}>
      {label ? <div className="chat-io-label">{label}</div> : null}
      <div
        ref={box}
        className={`chat-io-content ${open ? 'is-open' : ''} ${clipped && !open ? 'is-clipped' : ''}`}
        onClick={clipped || open ? () => { if (!selecting()) setOpen((v) => !v) } : undefined}
        title={clipped && !open ? 'Show all' : undefined}
      >
        {muted ? <span className="chat-io-muted">{muted}</span> : <pre>{text}</pre>}
      </div>
    </div>
  )
}

const DECIDED: Record<ApprovalChoice, string> = {
  allow: 'Allowed', 'allow-session': 'Allowed, and not asked again', deny: 'Declined', cancel: 'Cancelled',
  'plan-auto': 'Plan approved · Bypass', 'plan-manual': 'Plan approved · Manual',
  'allow-rule': 'Allowed similar commands', 'allow-host': 'Always allowed'
}

/** What a decided prompt with its own options says: the picked option's words, past tense where the extension has one. */
function decidedText(item: ChatItemApproval): string {
  const choice = item.decided!
  if (!item.options) return DECIDED[choice]
  if (choice === 'cancel') return 'Cancelled'
  if (choice === 'deny') return 'Denied'
  const o = item.options.find((x) => x.choice === choice)
  return o ? `${o.label}${o.rule ? ` · ${o.rule}` : ''}` : DECIDED[choice]
}

/** Number keys pick an option while focus is inside the card and not in a field (the extension's 1 / 2 / 3). */
function numberKeys(pick: (n: number) => void) {
  return (e: KeyboardEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement
    if (target.closest('input, textarea') || e.ctrlKey || e.altKey || e.metaKey) return
    const n = Number(e.key)
    if (Number.isInteger(n) && n >= 1 && n <= 9) {
      e.preventDefault()
      pick(n)
    }
  }
}

/**
 * One of Claude Code's user dialogs, as the extension's card (`dialogCard` words it): a title, its paragraphs
 * and *Learn more*, then its buttons; the refusal and the Fable cards can be dismissed. Waiting, it is a red-edged
 * card like an approval; answered, it says what was chosen. A kind the card cannot read is dismissed at once.
 */
function DialogRow({ item, actions }: { item: ChatItemDialog; actions: RowActions }) {
  const card = useMemo(() => dialogCard(item), [item])
  const done = !!item.result || !!item.cancelled
  const [ready, setReady] = useState(!card?.delayMs)
  useEffect(() => {
    if (!card?.delayMs || done) return
    const timer = window.setTimeout(() => setReady(true), card.delayMs)
    return () => window.clearTimeout(timer)
  }, [card, done])
  useEffect(() => { if (!card && !done) actions.onAnswerDialog?.(item.id, null) }, [card, done, item.id, actions])
  if (!card) return null
  const chosen = item.result ? card.actions.find((a) => a.result === item.result)?.label ?? item.result : null
  return (
    <Timeline tone={done ? 'idle' : 'wait'} testid="chat-row:dialog" className={`is-question ${done ? 'is-decided' : 'is-waiting'}`}>
      <div className="chat-card" data-testid={`chat-dialog:${item.dialogKind}`}>
        <div className="chat-approval-title chat-dialog-title">
          <span>{card.title}</span>
          {!done && card.dismissable ? <button className="chat-iconbtn chat-dialog-x" aria-label="Dismiss" title="Dismiss" onClick={() => actions.onAnswerDialog?.(item.id, null)} data-testid="chat-dialog:dismiss"><X className="chat-ic" /></button> : null}
        </div>
        {card.body.map((p, i) => (
          <p key={i} className="chat-dialog-body">
            {p}
            {i === card.body.length - 1 && card.learnMore ? <> <a className="chat-dialog-link" href={card.learnMore} onClick={(e) => { e.preventDefault(); actions.openUrl?.(card.learnMore!) }}>Learn more</a></> : null}
          </p>
        ))}
        {done ? (
          <div className="chat-approval-decided">{item.cancelled ? 'Dismissed' : chosen}</div>
        ) : (
          <div className="chat-approval-actions">
            {card.actions.map((a) => (
              <button key={a.result} className={`chat-btn ${a.primary ? 'is-allow' : ''}`} disabled={!ready} onClick={() => actions.onAnswerDialog?.(item.id, a.result, a)} data-testid={`chat-dialog:${a.result}`}>{a.label}</button>
            ))}
          </div>
        )}
      </div>
    </Timeline>
  )
}

function ApprovalRow({ item, actions, comments }: { item: ChatItemApproval; actions: RowActions; comments?: PlanComment[] }) {
  return item.variant === 'plan' ? <PlanApproval item={item} actions={actions} comments={comments ?? []} /> : <ToolApproval item={item} actions={actions} />
}

/**
 * A permission prompt as the extension draws it: the tool's question, its own
 * body (the command, the diff, the URL), then numbered options — Yes; Yes, and
 * don't ask again (naming what that saves); No, with what to do instead —
 * and Escape to cancel.
 */
function ToolApproval({ item, actions }: { item: ChatItemApproval; actions: RowActions }) {
  const card = useRef<HTMLDivElement | null>(null)
  const [instead, setInstead] = useState('')
  const [inside, setInside] = useState(false)
  const decided = item.decided
  const { onAnswer } = actions
  useEffect(() => {
    // A prompt that arrives while nothing is being typed takes focus, so 1 / 2 / 3 answer it:
    // focus on the page itself, an empty composer, or the card of a prompt already answered.
    const box = card.current
    const active = document.activeElement as HTMLElement | null
    const idle = !active || active === document.body || (active.tagName === 'TEXTAREA' && !(active as HTMLTextAreaElement).value) || !!active.closest('.is-decided > .chat-card')
    if (!decided && box && idle) box.focus()
  }, [decided])
  useEffect(() => {
    // While focus is in the card the host hands it Escape (`data-escape-close` → `tm-escape`): cancel.
    const box = card.current
    if (!box || decided) return
    const cancel = () => onAnswer(item.id, 'cancel')
    box.addEventListener('tm-escape', cancel)
    return () => box.removeEventListener('tm-escape', cancel)
  }, [decided, item.id, onAnswer])
  const own = item.options
  const options: { choice: ApprovalChoice; label: ReactNode; hint?: string }[] = own
    ? own.filter((o) => o.choice !== 'deny').map((o) => ({ choice: o.choice, label: o.rule ? <>{o.label} <span className="chat-rule" title={o.hint ? `${o.hint} ${o.rule}` : undefined}>{o.rule}</span></> : o.label, hint: o.rule ? undefined : o.hint }))
    : [{ choice: 'allow', label: 'Yes' }]
  if (!own && item.choices.includes('allow-session')) options.push({ choice: 'allow-session', label: item.rule ? <>Yes, and don’t ask again for <span className="chat-rule">{item.rule}</span></> : 'Yes, and don’t ask again this session' })
  const denyLabel = own ? own.find((o) => o.choice === 'deny')?.label ?? 'Deny' : 'No'
  const deny = () => actions.onAnswer(item.id, 'deny', own ? undefined : instead.trim() || undefined)
  const onKey = numberKeys((n) => {
    if (decided) return
    if (n <= options.length) actions.onAnswer(item.id, options[n - 1]!.choice)
    else if (n === options.length + 1) deny()
  })
  return (
    <Timeline tone={decided ? 'idle' : 'wait'} testid="chat-row:approval" className={`is-approval ${decided ? 'is-decided' : 'is-waiting'}`}>
      <div
        className="chat-card" ref={card} tabIndex={-1} onKeyDown={onKey}
        onFocus={() => setInside(true)}
        onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setInside(false) }}
        onKeyDownCapture={(e) => { if (e.key === 'Escape' && !decided && !e.defaultPrevented) { e.preventDefault(); actions.onAnswer(item.id, 'cancel') } }}
        {...(!decided && inside ? { 'data-escape-close': '' } : {})}
      >
        <div className="chat-approval-title">{item.question ?? <>Do you want to proceed with <strong>{item.toolName ?? 'this tool'}</strong>?</>}</div>
        {item.command ? <IoGrid><IoRow label="IN" text={item.command} kind="in" /></IoGrid> : null}
        {item.edits?.length ? <DiffView edits={item.edits} /> : null}
        {item.detail ? <pre className="chat-pre">{item.detail}</pre> : null}
        {item.reason ? <div className="chat-approval-reason"><span className="chat-label">Reason</span> {item.reason}</div> : null}
        {decided ? (
          <div className="chat-approval-decided">{decidedText(item)}{item.message ? ` — “${item.message}”` : ''}</div>
        ) : (
          <>
            <div className="chat-options">
              {options.map((o, i) => (
                <button key={o.choice} className={`chat-option ${i === 0 ? 'is-primary' : ''}`} onClick={() => actions.onAnswer(item.id, o.choice)} title={o.hint} data-testid={`chat-approve:${o.choice}`}>
                  <span className="chat-option-key">{i + 1}</span><span className="chat-option-label">{o.label}{o.hint ? <span className="chat-option-hint">{o.hint}</span> : null}</span>
                </button>
              ))}
              {own ? (
                <button className="chat-option" onClick={deny} data-testid="chat-approve:deny">
                  <span className="chat-option-key">{options.length + 1}</span><span className="chat-option-label">{denyLabel}</span>
                </button>
              ) : (
                <div className="chat-option has-field">
                  <button className="chat-option-btn" onClick={deny} data-testid="chat-approve:deny">
                    <span className="chat-option-key">{options.length + 1}</span><span className="chat-option-label">{denyLabel}</span>
                  </button>
                  <input
                    className="chat-option-input" placeholder="Tell Claude what to do instead" value={instead} aria-label="Tell Claude what to do instead"
                    onChange={(e) => setInstead(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); deny() } }}
                    data-testid="chat-approve:instead"
                  />
                </div>
              )}
            </div>
            <div className="chat-keyhints">Esc to cancel</div>
          </>
        )}
      </div>
    </Timeline>
  )
}

/**
 * The plan prompt (ExitPlanMode): the plan, comments made on a selection of
 * it, then approve it — leaving plan mode for *Bypass* or
 * *Manual* — or keep planning with what should change. With comments, keeping
 * planning sends them as the feedback.
 */
function PlanApproval({ item, actions, comments }: { item: ChatItemApproval; actions: RowActions; comments: PlanComment[] }) {
  const [feedback, setFeedback] = useState('')
  const decided = item.decided
  const keepPlanning = () => {
    const notes = comments.map((c) => `On "${c.quote.length > 80 ? `${c.quote.slice(0, 80)}…` : c.quote}": ${c.text}`)
    const message = [...notes, feedback.trim()].filter(Boolean).join('\n')
    actions.onAnswer(item.id, 'deny', message || undefined)
  }
  const onKey = numberKeys((n) => {
    if (decided) return
    if (n === 1) actions.onAnswer(item.id, 'plan-auto')
    else if (n === 2) actions.onAnswer(item.id, 'plan-manual')
    else if (n === 3) keepPlanning()
  })
  return (
    <Timeline tone={decided ? 'idle' : 'wait'} testid="chat-row:plan" className={`is-approval is-plan ${decided ? 'is-decided' : 'is-waiting'}`}>
      <div className="chat-card" tabIndex={-1} onKeyDown={onKey}>
        <div className="chat-approval-title">Claude’s plan</div>
        <div className="chat-plan" data-plan={decided ? undefined : item.id} data-testid="chat-plan">
          <div className="chat-text">{actions.renderText(item.plan || '(The plan is empty.)')}</div>
        </div>
        {comments.length ? (
          <div className="chat-comments" data-testid="chat-plan-comments">
            <div className="chat-comments-title">Comments ({comments.length})</div>
            {comments.map((c) => (
              <div key={c.id} className="chat-comment">
                <div className="chat-comment-body"><div className="chat-comment-quote">“{c.quote.length > 80 ? `${c.quote.slice(0, 80)}…` : c.quote}”</div><div>{c.text}</div></div>
                {!decided && actions.onRemoveComment ? <button className="chat-mini" aria-label="Remove comment" title="Remove comment" onClick={() => actions.onRemoveComment?.(item.id, c.id)}><X className="chat-ic" /></button> : null}
              </div>
            ))}
          </div>
        ) : null}
        {decided ? (
          <div className="chat-approval-decided">{decided === 'deny' ? 'Stayed in plan mode' : DECIDED[decided]}{item.message && decided === 'deny' ? ` — “${firstLines(item.message, 2)}”` : ''}</div>
        ) : (
          <>
            <div className="chat-approval-question">{comments.length ? 'Continue planning?' : 'Accept this plan?'} <span className="chat-approval-hint">{comments.length ? `${comments.length} comment${comments.length === 1 ? '' : 's'} will be sent as feedback` : 'Select text in the plan to comment on it'}</span></div>
            <div className="chat-options">
              <button className={`chat-option ${comments.length ? '' : 'is-primary'}`} onClick={() => actions.onAnswer(item.id, 'plan-auto')} data-testid="chat-plan:auto"><span className="chat-option-key">1</span><span className="chat-option-label">Yes, and auto-accept edits</span></button>
              <button className="chat-option" onClick={() => actions.onAnswer(item.id, 'plan-manual')} data-testid="chat-plan:manual"><span className="chat-option-key">2</span><span className="chat-option-label">Yes, and manually approve edits</span></button>
              <div className={`chat-option has-field ${comments.length ? 'is-primary' : ''}`}>
                <button className="chat-option-btn" onClick={keepPlanning} data-testid="chat-plan:keep"><span className="chat-option-key">3</span><span className="chat-option-label">No, keep planning</span></button>
                <input
                  className="chat-option-input" placeholder="Tell Claude what to change" value={feedback} aria-label="Tell Claude what to change"
                  onChange={(e) => setFeedback(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); keepPlanning() } }}
                  data-testid="chat-plan:feedback"
                />
              </div>
            </div>
          </>
        )}
      </div>
    </Timeline>
  )
}

/**
 * One or more questions, in the approval card's vocabulary: full-width
 * numbered options (one answer, or several for a multi-select question), the
 * focused option's preview beside them (below on a narrow pane), *Other* as
 * the last option with its field, then Submit and Dismiss.
 */
function QuestionRow({ item, actions }: { item: ChatItemQuestion; actions: RowActions }) {
  const card = useRef<HTMLDivElement | null>(null)
  const [picked, setPicked] = useState<Record<string, string[]>>({})
  const [other, setOther] = useState<Record<string, string>>({})
  const [focus, setFocus] = useState<Record<string, string>>({})
  const done = !!item.answers || !!item.cancelled
  const byId = (qid: string) => item.questions.find((q) => q.id === qid)
  const toggle = (qid: string, label: string, multi: boolean) => {
    setPicked((p) => {
      const cur = p[qid] ?? []
      if (multi) return { ...p, [qid]: cur.includes(label) ? cur.filter((x) => x !== label) : [...cur, label] }
      return { ...p, [qid]: cur[0] === label ? [] : [label] }
    })
    // One answer: an option takes the place of what was typed under Other.
    if (!multi) setOther((o) => (o[qid] ? { ...o, [qid]: '' } : o))
  }
  const type = (qid: string, text: string) => {
    setOther((o) => ({ ...o, [qid]: text }))
    // …and typed text takes the place of a picked option.
    if (text.trim() && !byId(qid)?.multiSelect) setPicked((p) => (p[qid]?.length ? { ...p, [qid]: [] } : p))
  }
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
  const answered = item.questions.filter((q) => (picked[q.id]?.length ?? 0) > 0 || (other[q.id] ?? '').trim()).length
  const complete = answered === item.questions.length
  // With one question, its options answer to 1–9 as well, and the number after them goes to Other.
  const first = item.questions.length === 1 ? item.questions[0] : undefined
  const onKey = numberKeys((n) => {
    if (done || !first?.options) return
    const o = first.options[n - 1]
    if (o) toggle(first.id, o.label, first.multiSelect)
    else if (n === first.options.length + 1 && first.allowOther) card.current?.querySelector<HTMLInputElement>(`[data-other="${first.id}"]`)?.focus()
  })
  const field = (q: ChatItemQuestion['questions'][number], className: string) => (
    <input
      className={className}
      type={q.secret ? 'password' : 'text'}
      placeholder={q.options ? 'Type your answer…' : 'Your answer'}
      aria-label={q.options ? 'Other' : q.text}
      value={other[q.id] ?? ''}
      onChange={(e) => type(q.id, e.target.value)}
      onKeyDown={(e) => { if (e.key === 'Enter' && complete) { e.preventDefault(); actions.onAnswerQuestion(item.id, answers()) } }}
      data-other={q.id}
      data-testid={`chat-other:${q.id}`}
    />
  )
  return (
    <Timeline tone={done ? 'idle' : 'wait'} testid="chat-row:question" className={`is-question ${done ? 'is-decided' : 'is-waiting'}`}>
      <div className="chat-card" ref={card} tabIndex={-1} onKeyDown={onKey}>
        <div className="chat-approval-title"><MessageCircleQuestion className="chat-ic" aria-hidden /> {item.title}</div>
        {item.detail ? <pre className="chat-pre">{item.detail}</pre> : null}
        {item.questions.map((q) => {
          const options = q.options ?? []
          const previews = options.some((o) => o.preview)
          // The preview follows the pointer and the keys; until then it is the picked option's, else the first one's.
          const shown = options.find((o) => o.label === (focus[q.id] ?? picked[q.id]?.[0])) ?? options[0]
          return (
            <div key={q.id} className="chat-q">
              {q.header ? <div className="chat-q-header">{q.header}</div> : null}
              <div className="chat-q-text">{q.text}{!done && q.multiSelect ? <span className="chat-approval-hint">Select all that apply</span> : null}</div>
              {done ? (
                <div className="chat-approval-decided">{item.cancelled ? 'Dismissed' : (item.answers?.[q.id] ?? []).join(', ') || '—'}</div>
              ) : q.options ? (
                <div className={`chat-q-body ${previews ? 'has-preview' : ''}`}>
                  <div className="chat-options">
                    {options.map((o, i) => {
                      const on = (picked[q.id] ?? []).includes(o.label)
                      return (
                        <button
                          key={o.label}
                          className={`chat-option ${on ? 'is-on' : ''} ${previews && shown === o ? 'is-shown' : ''}`}
                          aria-pressed={on}
                          onClick={() => toggle(q.id, o.label, q.multiSelect)}
                          onMouseEnter={() => setFocus((f) => ({ ...f, [q.id]: o.label }))}
                          onFocus={() => setFocus((f) => ({ ...f, [q.id]: o.label }))}
                          data-testid={`chat-option:${o.label}`}
                        >
                          {first === q ? <span className="chat-option-key">{i + 1}</span> : null}
                          <span className="chat-option-label">{o.label}{o.description ? <span className="chat-option-hint">{o.description}</span> : null}</span>
                          {on ? <Check className="chat-ic chat-option-check" aria-hidden /> : null}
                        </button>
                      )
                    })}
                    {q.allowOther ? (
                      <div className={`chat-option has-field ${(other[q.id] ?? '').trim() ? 'is-on' : ''}`}>
                        <button className="chat-option-btn" tabIndex={-1} onClick={(e) => e.currentTarget.parentElement?.querySelector('input')?.focus()} data-testid={`chat-other-key:${q.id}`}>
                          {first === q ? <span className="chat-option-key">{options.length + 1}</span> : null}<span className="chat-option-label">Other</span>
                        </button>
                        {field(q, 'chat-option-input')}
                      </div>
                    ) : null}
                  </div>
                  {previews ? (
                    <div className="chat-q-preview" data-testid="chat-question-preview">
                      {shown?.preview ? <div className="chat-text">{actions.renderText(previewMarkdown(shown.preview))}</div> : <span className="chat-io-muted">No preview for this option</span>}
                    </div>
                  ) : null}
                </div>
              ) : field(q, 'chat-q-answer')}
            </div>
          )
        })}
        {done ? null : (
          <div className="chat-approval-actions">
            <button className="chat-btn is-allow" disabled={!complete} onClick={() => actions.onAnswerQuestion(item.id, answers())} data-testid="chat-question:submit">Submit</button>
            <button className="chat-btn is-quiet" onClick={() => actions.onAnswerQuestion(item.id, null)} data-testid="chat-question:dismiss">Dismiss</button>
            {item.questions.length > 1 && !complete ? <span className="chat-approval-hint" data-testid="chat-question:progress">{answered} of {item.questions.length} answered</span> : null}
          </div>
        )}
      </div>
    </Timeline>
  )
}

/**
 * A system line: an interruption, a compaction (open it for its summary), a
 * slash command's output, a background task that finished, a usage limit,
 * a notice — and an error, with Retry when the turn can be retried (select its text to copy it).
 */
function SystemRow({ item, actions }: { item: ChatItemSystem; actions: RowActions }) {
  // A /status row opens on its lines; anything else folds its detail away.
  const [open, setOpen] = useState(item.variant === 'status')
  const tone: Tone = item.running ? 'run' : item.level === 'error' || item.level === 'warning' ? 'bad' : 'idle'
  const extra = item.variant === 'compact' && item.tokens ? `from ${fmtTokens(item.tokens)} tokens` : null
  const foldable = !!item.detail && item.detail.trim() !== item.text.trim()
  return (
    <Timeline tone={tone} testid="chat-row:system" className={`is-system is-${item.level} ${item.variant ? `is-${item.variant}` : ''}`}>
      {foldable ? (
        <button className="chat-step-head is-toggle" onClick={() => { if (!selecting()) setOpen((v) => !v) }} aria-expanded={open}>
          <span className="chat-system-text">{item.text}</span>
          {extra ? <span className="chat-system-extra">{extra}</span> : null}
          {open ? <ChevronDown className="chat-ic chat-step-chev" /> : <ChevronRight className="chat-ic chat-step-chev" />}
        </button>
      ) : (
        <div className="chat-step-head"><span className="chat-system-text">{item.text}</span>{extra ? <span className="chat-system-extra">{extra}</span> : null}</div>
      )}
      {open && item.detail ? (item.variant === 'command' ? <IoGrid><IoRow text={item.detail} kind="out" /></IoGrid> : <div className="chat-system-detail">{plain(item.detail)}</div>) : null}
      {item.level === 'error' && actions.onRetry ? (
        <div className="chat-system-actions">
          <button className="chat-textbtn" onClick={actions.onRetry} data-testid="chat-retry">Retry</button>
        </div>
      ) : null}
    </Timeline>
  )
}

/** The end of a turn: how long it took, what it produced, and the files it changed (open the list; a file opens in the host). */
function TurnRow({ item, actions, folded }: { item: ChatItemTurn; actions: RowActions; folded?: boolean }) {
  const [open, setOpen] = useState(false)
  const files = item.files
  const added = files.reduce((n, f) => n + f.added, 0)
  const removed = files.reduce((n, f) => n + f.removed, 0)
  const codex = actions.provider === 'codex'
  const parts = [
    item.durationMs !== undefined && !folded ? `${codex ? 'Worked for' : 'Worked'} ${formatElapsed(item.durationMs)}` : null,
    item.outputTokens ? `${fmtTokens(item.outputTokens)} tokens out` : null
  ].filter(Boolean)
  if (!parts.length && !files.length) return null
  // Codex's Undo / Reapply (codex.unifiedDiff.revertChangesTooltip / reapplyChangesTooltip): git apply of the turn's diff.
  const undo = files.length && actions.onUndoTurn ? (
    <button className="chat-textbtn" onClick={() => actions.onUndoTurn?.(item.id, !!item.undone)} title={item.undone ? 'Reapply these changes' : 'Undo these changes with git'} data-testid={item.undone ? 'chat-turn-reapply' : 'chat-turn-undo'}>
      {item.undone ? 'Reapply' : 'Undo'}
    </button>
  ) : null
  return (
    <div className="chat-row is-turn" data-testid="chat-row:turn">
      <span className="chat-turn-line">{parts.join(' · ')}</span>
      {files.length && parts.length ? <span className="chat-turn-sep" aria-hidden>·</span> : null}
      {files.length ? (
        <button className="chat-turn-files" onClick={() => setOpen((v) => !v)} aria-expanded={open} data-testid="chat-turn-files">
          {item.undone ? 'Reverted · ' : ''}{files.length} file{files.length === 1 ? '' : 's'} changed <span className="chat-turn-num">+{added} −{removed}</span>
          {open ? <ChevronDown className="chat-ic chat-step-chev" /> : <ChevronRight className="chat-ic chat-step-chev" />}
        </button>
      ) : null}
      {undo}
      {open ? (
        <ul className="chat-turn-list">
          {files.map((f) => (
            <li key={f.path}>
              {actions.openFile ? <span className="chat-link" role="link" tabIndex={0} title={`Open ${f.path}`} onClick={() => actions.openFile?.(f.path)} onKeyDown={(e) => { if (e.key === 'Enter') actions.openFile?.(f.path) }}>{relPath(f.path, actions.cwd)}</span> : relPath(f.path, actions.cwd)}
              <span className="chat-turn-num">+{f.added} −{f.removed}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}

/**
 * Focus view: a run of steps between a prompt and a reply folded into one
 * line on the rail ("6 steps"), its tone the run's outcome; open, the steps
 * show as usual.
 */
export function StepFold({ items, actions, open, onToggle, nestedFor, turn }: { items: ChatItem[]; actions: RowActions; open: boolean; onToggle: () => void; nestedFor: (id: string) => ChatItem[] | undefined; turn?: ChatItemTurn }) {
  const tools = items.filter((x): x is ChatItemTool => x.kind === 'tool')
  const tone: Tone = tools.some((x) => x.status === 'running') ? 'run' : tools.some((x) => x.status === 'failed') ? 'bad' : tools.length ? 'ok' : 'idle'
  const label = useMemo(() => {
    // A Codex turn folds as the extension writes it: "Worked for 23s · Ran commands, edited a file".
    if (turn) {
      const head = turn.durationMs !== undefined ? `Worked for ${formatElapsed(turn.durationMs)}` : 'Worked'
      const what = activitySummary(items)
      return what ? `${head} · ${what}` : head
    }
    const n = items.length
    const kinds = new Set(tools.map((x) => x.label ?? x.name))
    return `${n} step${n === 1 ? '' : 's'}${kinds.size ? ` · ${[...kinds].slice(0, 4).join(', ')}${kinds.size > 4 ? '…' : ''}` : ''}`
  }, [items, tools, turn])
  return (
    <>
      <Timeline tone={tone} testid="chat-row:fold" className="is-fold">
        <button className="chat-step-head is-toggle" onClick={onToggle} aria-expanded={open}>
          <span className="chat-fold-label">{label}</span>
          {open ? <ChevronDown className="chat-ic chat-step-chev" /> : <ChevronRight className="chat-ic chat-step-chev" />}
        </button>
      </Timeline>
      {open ? items.map((x) => <Row key={x.id} item={x} actions={actions} nested={nestedFor(x.id)} />) : null}
    </>
  )
}

/**
 * A Codex plan (plan mode's `plan` item): the plan as Markdown under *Plan*
 * (*Writing plan* while it streams), and while it is the turn's last word,
 * *Implement this plan?* (implementPlanRequest.*): 1 implements it — plan
 * mode off, then the extension's own message — 2 keeps planning.
 */
function PlanCard({ item, actions }: { item: ChatItemAssistant; actions: RowActions }) {
  const asking = actions.pendingPlan === item.id && !!actions.onImplementPlan
  const card = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    const active = document.activeElement as HTMLElement | null
    const idle = !active || active === document.body || (active.tagName === 'TEXTAREA' && !(active as HTMLTextAreaElement).value)
    if (asking && idle) card.current?.focus()
  }, [asking])
  const onKey = numberKeys((n) => {
    if (!asking) return
    if (n === 1) actions.onImplementPlan?.()
    else if (n === 2) actions.onKeepPlanning?.()
  })
  return (
    <Timeline tone={asking ? 'wait' : item.streaming ? 'run' : 'idle'} testid="chat-row:codex-plan" className={`is-approval is-plan ${asking ? 'is-waiting' : 'is-decided'}`} stamp={item.streaming ? undefined : item.at}>
      <div className="chat-card" ref={card} tabIndex={-1} onKeyDown={onKey}>
        <div className="chat-approval-title">{item.streaming ? 'Writing plan' : 'Plan'}</div>
        <div className="chat-plan-text" data-plan={item.id}>{item.streaming ? plain(item.text) : actions.renderText(item.text)}</div>
        {asking ? (
          <>
            <div className="chat-plan-ask">Implement this plan?</div>
            <div className="chat-options">
              <button className="chat-option is-primary" onClick={actions.onImplementPlan} data-testid="chat-plan:implement">
                <span className="chat-option-key">1</span><span className="chat-option-label">Yes, implement this plan</span>
              </button>
              <button className="chat-option" onClick={actions.onKeepPlanning} data-testid="chat-plan:keep">
                <span className="chat-option-key">2</span><span className="chat-option-label">No, keep planning<span className="chat-option-hint">Tell Codex what to change in the box below</span></span>
              </button>
            </div>
          </>
        ) : null}
      </div>
    </Timeline>
  )
}

/** How long after a reply finishes a table that only now settles still rolls in (a reply that ends on its table). */
const REVEAL_TAIL_MS = 800

/**
 * A reply's text. Finished: Markdown. Streaming (`streamParts`): its finished
 * blocks as Markdown, as the extension draws them, and the block being written
 * as plain text so it streams; once that block reaches a table, only the
 * table's header shows, shimmering, until the table is finished. Then the
 * whole table settles into the Markdown above and its rows roll in under the
 * header (`is-revealing`, which only a streaming reply carries, so a stored
 * reply's tables are simply there). The settled Markdown keeps its place as
 * the first child, so the reply ending re-renders it rather than mounting it
 * again, and its tables do not roll in twice.
 */
function ReplyText({ text, streaming, render }: { text: string; streaming: boolean; render: (text: string) => ReactNode }) {
  const parts = useMemo(() => (streaming ? streamParts(text) : null), [text, streaming])
  const settled = parts ? parts.settled : text
  const settledNode = useMemo(() => (settled ? render(settled) : null), [settled, render])
  const [revealing, setRevealing] = useState(streaming)
  useEffect(() => {
    if (streaming) { setRevealing(true); return }
    const timer = window.setTimeout(() => setRevealing(false), REVEAL_TAIL_MS)
    return () => window.clearTimeout(timer)
  }, [streaming])
  return (
    <div className={`chat-text ${revealing ? 'is-revealing' : ''}`}>
      {settledNode}
      {parts?.live ? plain(parts.live) : null}
      {parts?.table ? <div className="chat-table-pending" aria-busy="true" data-testid="chat-table-pending">{render(parts.table)}</div> : null}
    </div>
  )
}

export function plain(text: string): ReactNode {
  return text.split(/\n{2,}/).map((p, i) => <p key={i}>{p}</p>)
}

function firstLines(text: string, n: number): string {
  return text.split('\n').slice(0, n).join('\n')
}
