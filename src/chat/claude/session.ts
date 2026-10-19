// The Claude Code side of the chat pane: one `claude` process per pane,
// driven through the Agent SDK exactly as the Cursor extension drives its
// bundled binary — `--input-format stream-json --output-format stream-json`,
// a streaming prompt so one process serves every turn, and `canUseTool` as
// the permission prompt and the question prompt (docs/rea-findings.md).
// History comes from the SDK's own readers over `~/.claude/projects/<cwd>/<session>.jsonl`.
// Sessions start the way the extension starts its own (docs/rea-findings.md,
// feature pass): file checkpoints on, so code can be rewound; each prompt
// echoed back with its uuid (`--replay-user-messages`), so a queued prompt
// knows when it was read; Markdown previews on questions; and a per-task stop
// control declared, so Stop ends the turn and spares background tasks.
// This file imports no Electron; main (or a probe script) owns it.
import { EventEmitter } from 'node:events'
import { randomUUID } from 'node:crypto'
import {
  forkSession, getSessionInfo, getSessionMessages, listSessions, query, renameSession,
  type CanUseTool, type EffortLevel, type ModelInfo, type PermissionMode, type PermissionResult, type PermissionUpdate, type Query, type SDKMessage, type SDKUserMessage
} from '@anthropic-ai/claude-agent-sdk'
import { foldSdkMessage, sessionMessagesToTranscript, sessionSummary, startFold, toolView, type ClaudeFold } from './fold.mjs'
import {
  answerQuestion as answerQuestionItem, appendItem, beginTurn, decideApproval, emptyTranscript, enqueue, setStatus, summarizeAttachments, unqueue,
  type ApprovalChoice, type Attachment, type ChatConfigPatch, type ChatItemApproval, type ChatItemQuestion, type ChatOptions, type ContextUsage, type McpRequest, type McpServer,
  type ModeOption, type Question, type RewindResult, type SessionSummary, type Transcript
} from '../shared/chatModel.mjs'
import { describePermissionUpdates } from '../shared/present.mjs'
import { resolveClaude } from '../shared/findCli.mjs'
import { killProcessTree } from '../shared/processTree.mjs'

/**
 * Control requests the SDK's runtime sends for the extension but leaves out of
 * its typings (docs/rea-findings.md, feature pass): a side question, and
 * taking back a queued prompt.
 */
interface QueryExtras {
  askSideQuestion?(question: string, options?: { history?: unknown[] }): Promise<{ response: string; synthetic?: boolean } | null>
  cancelAsyncMessage?(uuid: string): Promise<boolean>
}

export interface ClaudeSessionOptions {
  cwd: string
  /** Resume this session id; omit for a new session. */
  resume?: string | null
  /** When resuming, branch into a new session id instead of continuing. */
  fork?: boolean
  model?: string | null
  permissionMode?: PermissionMode
  effort?: EffortLevel | null
  /** `null` lets the SDK use its bundled binary; default is the user's install. */
  claudePath?: string | null
  env?: Record<string, string>
  /** Extra `--flag value` pairs (`{ effort: 'high' }`); `null` for a bare flag. */
  extraArgs?: Record<string, string | null>
  /** Allow Claude Code to read the user's settings (hooks included) — default true, like the extension. */
  settingSources?: ('user' | 'project' | 'local')[]
  log?: (line: string) => void
}

/** The streaming prompt: an async iterable the pane pushes user turns into. */
class InputQueue implements AsyncIterable<SDKUserMessage> {
  private items: SDKUserMessage[] = []
  private waiters: ((v: IteratorResult<SDKUserMessage>) => void)[] = []
  private done = false

  push(message: SDKUserMessage) {
    if (this.done) return
    const waiter = this.waiters.shift()
    if (waiter) waiter({ value: message, done: false })
    else this.items.push(message)
  }

  end() {
    this.done = true
    for (const w of this.waiters.splice(0)) w({ value: undefined as never, done: true })
  }

  [Symbol.asyncIterator](): AsyncIterator<SDKUserMessage> {
    return {
      next: () => {
        const item = this.items.shift()
        if (item) return Promise.resolve({ value: item, done: false })
        if (this.done) return Promise.resolve({ value: undefined as never, done: true })
        return new Promise((resolve) => this.waiters.push(resolve))
      },
      return: () => {
        this.end()
        return Promise.resolve({ value: undefined as never, done: true })
      }
    }
  }
}

interface PendingPermission {
  resolve: (r: PermissionResult) => void
  suggestions: PermissionUpdate[]
  /** Set for AskUserQuestion: the tool input the answers are merged into. */
  questionInput?: Record<string, unknown>
  /** ExitPlanMode: a refusal keeps planning. */
  plan?: boolean
}

/**
 * The CLI's own words for a refusal (the extension's webview carries them too:
 * `YB`, `AD` and `fq1` in index.js 2.1.302). Said this way the model reads a
 * refusal as the user's; a bare sentence in a tool result reads as the tool's,
 * and was observed (2026-10-18) being doubted as a possible injection.
 */
export const REJECTED = "The user doesn't want to proceed with this tool use. The tool use was rejected (eg. if it was a file edit, the new_string was NOT written to the file)."
export const REJECTED_STOP = `${REJECTED} STOP what you are doing and wait for the user to tell you how to proceed.`
export const REJECTED_BECAUSE = `${REJECTED} The user provided the following reason for the rejection: `
export const KEEP_PLANNING = 'User chose to stay in plan mode and continue planning'

/** What a refusal tells Claude: the user's reason when they gave one, the plan's feedback when it was a plan. */
export function refusalMessage(said: string | undefined, plan: boolean): string {
  if (plan) return said ? `${KEEP_PLANNING}. The user's feedback on the plan: ${said}` : KEEP_PLANNING
  return said ? `${REJECTED_BECAUSE}${said}` : REJECTED_STOP
}

/** Claude's AskUserQuestion input → our questions (the question text is the id the answer is keyed by). */
export function questionsFromAskUserQuestion(input: Record<string, unknown>): Question[] {
  const list = Array.isArray(input.questions) ? (input.questions as any[]) : []
  return list.map((q) => ({
    id: String(q.question ?? ''),
    text: String(q.question ?? ''),
    header: q.header ? String(q.header) : undefined,
    options: Array.isArray(q.options) && q.options.length
      ? q.options.map((o: any) => ({ label: String(o.label ?? ''), description: o.description ? String(o.description) : undefined, ...(typeof o.preview === 'string' && o.preview ? { preview: o.preview } : {}) }))
      : null,
    multiSelect: q.multiSelect === true,
    allowOther: true
  })).filter((q) => q.text)
}

/**
 * The tool input AskUserQuestion continues with: the original questions plus
 * `answers`, one string per question keyed by the question text (multi-select
 * answers joined with ", "), the shape the SDK documents for `updatedInput`.
 */
export function askUserQuestionInput(input: Record<string, unknown>, answers: Record<string, string[]>): Record<string, unknown> {
  const out: Record<string, string> = {}
  for (const [q, list] of Object.entries(answers)) out[q] = list.join(', ')
  return { ...input, answers: out }
}

/**
 * The permission modes the composer offers, in the Claude Code extension's
 * own words (its mode table in webview/index.js, docs/rea-findings.md) —
 * except *Edit automatically*, whose "your selected text" is an editor's idea.
 * `bypassPermissions` is left out: switching to it mid-session needs the
 * session started with `allowDangerouslySkipPermissions`, which this host
 * never sets. `auto` is offered only on a model that supports it.
 */
export const CLAUDE_MODES: ModeOption[] = [
  { id: 'default', label: 'Manual', description: 'Claude will ask for approval before making each edit' },
  { id: 'acceptEdits', label: 'Edit automatically', description: 'Claude will make edits without asking first' },
  { id: 'plan', label: 'Plan', description: 'Claude will explore the code and present a plan before editing' },
  { id: 'auto', label: 'Auto', description: 'Claude will approve actions that pass a safety check and pause for anything risky' },
  { id: 'dontAsk', label: "Don't ask", description: 'Claude will deny actions that need approval instead of asking' }
]

export const CLAUDE_EFFORTS: readonly EffortLevel[] = ['low', 'medium', 'high', 'xhigh', 'max']

const QUESTIONS: Record<string, string> = { WebFetch: 'Allow fetching this url?', WebSearch: 'Allow searching for this query?' }

/**
 * A permission prompt as the extension draws it (docs/rea-findings.md, feature
 * pass): the tool's own body — the command, the diff, the URL — its question,
 * and what "don't ask again" would save. ExitPlanMode is the plan prompt: the
 * plan, then approve it (leaving plan mode for *Edit automatically* or
 * *Manual*) or keep planning.
 */
export function approvalItem(id: string, toolName: string, input: Record<string, unknown>, ctx: { title?: string; decisionReason?: string; blockedPath?: string; suggestions?: PermissionUpdate[] }, at: number): ChatItemApproval {
  if (toolName === 'ExitPlanMode') {
    return { kind: 'approval', id, title: 'Claude’s plan', toolName, variant: 'plan', plan: typeof input.plan === 'string' ? input.plan : '', choices: ['plan-auto', 'plan-manual', 'deny'], at }
  }
  const view = toolView(toolName, input)
  const edits = view.view === 'edit' ? view.edits : view.view === 'write' ? [{ path: view.path ?? '', before: '', after: view.content ?? '' }] : undefined
  const literal = toolName === 'WebFetch' ? input.url : toolName === 'WebSearch' ? input.query : undefined
  const detail = [typeof literal === 'string' ? literal : '', ctx.decisionReason ?? '', ctx.blockedPath ? `Path: ${ctx.blockedPath}` : ''].filter(Boolean).join('\n')
  const rule = describePermissionUpdates(ctx.suggestions)
  return {
    kind: 'approval', id, title: ctx.title ?? `Allow ${toolName}`, toolName, variant: 'tool',
    ...(QUESTIONS[toolName] ? { question: QUESTIONS[toolName] } : {}),
    ...(typeof input.command === 'string' ? { command: input.command } : {}),
    ...(edits?.length ? { edits } : {}),
    ...(detail ? { detail } : {}),
    ...(rule ? { rule } : {}),
    choices: ctx.suggestions?.length ? ['allow', 'allow-session', 'deny', 'cancel'] : ['allow', 'deny', 'cancel'],
    at
  }
}

/** Build the user message content: plain text, or blocks when images ride along. File references become `@path` tokens the CLI expands. */
export function userContent(text: string, attachments: Attachment[] = []): string | unknown[] {
  const refs = attachments.filter((a): a is Extract<Attachment, { kind: 'file' }> => a.kind === 'file').map((a) => `@${a.path}`)
  const full = refs.length && !refs.every((r) => text.includes(r)) ? `${text}\n\n${refs.filter((r) => !text.includes(r)).join(' ')}` : text
  const images = attachments.filter((a): a is Extract<Attachment, { kind: 'image' }> => a.kind === 'image')
  if (!images.length) return full
  return [
    { type: 'text', text: full },
    ...images.map((img) => ({ type: 'image', source: { type: 'base64', media_type: img.mime, data: img.data } }))
  ]
}

/**
 * Events: `change` (transcript), `approval` (item), `question` (item), `exit`.
 */
export class ClaudeSession extends EventEmitter {
  transcript: Transcript
  private fold: ClaudeFold
  private readonly config: ClaudeSessionOptions
  private input = new InputQueue()
  private q: Query | null = null
  private abort = new AbortController()
  private pending = new Map<string, PendingPermission>()
  private seq = 0
  /** Commands whose UX is the terminal's (`/exit`, `/statusline`): kept out of the pane's slash menu. */
  private terminalCommands = new Set<string>()
  private models: ModelInfo[] = []
  private outputStyles: string[] = []
  /** Stop was pressed: the result that ends this turn reads as *Interrupted*. */
  private interrupting = false
  /** The CLI's process id (the SDK's `onProcessSpawned`), so close can end what it started too. */
  private pid: number | null = null
  /** The consume loop; resolves when the process is gone (close, exit, or error). */
  done: Promise<void> | null = null

  constructor(options: ClaudeSessionOptions, transcript?: Transcript) {
    super()
    this.config = options
    const t = transcript ?? emptyTranscript('claude', { cwd: options.cwd, sessionId: options.resume ?? null, model: options.model ?? null, effort: options.effort ?? null, permissionMode: options.permissionMode ?? 'default' })
    // Every session runs with file checkpoints, so its prompts can rewind code.
    // A resumed transcript carries no mode; the CLI starts in the one asked for, else Manual.
    this.transcript = { ...t, checkpoints: true, permissionMode: options.permissionMode ?? t.permissionMode ?? 'default' }
    this.fold = startFold(this.transcript)
  }

  private update(next: Transcript) {
    if (next === this.transcript) return
    this.transcript = next
    this.fold = { ...this.fold, transcript: next }
    this.emit('change', next)
  }

  private log(line: string) {
    this.config.log?.(line)
  }

  /** Spawn the process. Idempotent; `send` calls it. */
  start(): void {
    if (this.q) return
    const o = this.config
    const claude = o.claudePath === undefined ? resolveClaude() : o.claudePath ? { file: o.claudePath, args: [], how: 'option' } : null
    const canUseTool: CanUseTool = (toolName, input, ctx) => this.askPermission(toolName, input, ctx)
    this.q = query({
      prompt: this.input,
      options: {
        cwd: o.cwd,
        resume: o.resume ?? undefined,
        forkSession: o.fork ?? undefined,
        model: o.model ?? undefined,
        effort: o.effort ?? undefined,
        permissionMode: o.permissionMode ?? 'default',
        pathToClaudeCodeExecutable: claude?.file,
        env: { ...process.env, ...o.env } as Record<string, string>,
        extraArgs: { 'replay-user-messages': null, ...o.extraArgs },
        settingSources: o.settingSources ?? ['user', 'project', 'local'],
        includePartialMessages: true,
        enableFileCheckpointing: true,
        // Summarized thinking, so a thinking row has text to open (the extension asks for it when its
        // thinking setting is on); adaptive leaves how much the model thinks to the effort level.
        thinking: { type: 'adaptive', display: 'summarized' },
        perTaskStopAffordance: true,
        promptSuggestions: true,
        toolConfig: { askUserQuestion: { previewFormat: 'markdown' } },
        // Called by the SDK's runtime, absent from its typings (the extension passes it too).
        ...({ onProcessSpawned: (pid: number) => { this.pid = pid } } as Record<string, unknown>),
        canUseTool,
        abortController: this.abort,
        stderr: (data) => this.log(`[claude stderr] ${data.trimEnd()}`)
      }
    })
    this.log(`[claude] started via ${claude?.how ?? 'sdk-bundled'} in ${o.cwd}${o.resume ? ` resuming ${o.resume}` : ''}`)
    this.done = this.consume(this.q)
    // The window now, not at init: with a streaming prompt the CLI sends its init only with the first message.
    void this.readWindow()
  }

  private async consume(q: Query): Promise<void> {
    try {
      for await (const msg of q) this.handle(msg)
      this.update(setStatus(this.transcript, 'closed'))
    } catch (err) {
      if (this.abort.signal.aborted) this.update(setStatus(this.transcript, 'closed'))
      else this.update(setStatus(this.transcript, 'error', (err as Error).message))
    } finally {
      this.q = null
      for (const [, p] of this.pending) p.resolve({ behavior: 'deny', message: 'session ended' })
      this.pending.clear()
      this.emit('exit')
    }
  }

  private handle(msg: SDKMessage): void {
    if (msg.type === 'system' && msg.subtype === 'init') {
      this.terminalCommands = new Set(msg.terminal_slash_commands ?? [])
      void this.readWindow()
    }
    const next = foldSdkMessage(this.fold, msg, { interrupted: this.interrupting })
    if (msg.type === 'result') this.interrupting = false
    if (next !== this.fold) {
      this.fold = next
      if (next.transcript !== this.transcript) {
        this.transcript = next.transcript
        this.emit('change', this.transcript)
      }
    }
  }

  private askPermission(toolName: string, input: Record<string, unknown>, ctx: Parameters<CanUseTool>[2]): Promise<PermissionResult> {
    const id = `perm:${++this.seq}`
    const at = Date.now()
    // Register the resolver *before* the item is announced: a listener may answer synchronously.
    if (toolName === 'AskUserQuestion') {
      const questions = questionsFromAskUserQuestion(input)
      if (questions.length) {
        const item: ChatItemQuestion = { kind: 'question', id, title: 'Claude needs a decision', questions, at }
        const promise = new Promise<PermissionResult>((resolve) => {
          this.pending.set(id, { resolve, suggestions: [], questionInput: input })
          ctx.signal.addEventListener('abort', () => {
            if (this.pending.delete(id)) {
              this.update(answerQuestionItem(this.transcript, id, null))
              resolve({ behavior: 'deny', message: 'cancelled' })
            }
          }, { once: true })
        })
        this.update(setStatus(appendItem(this.transcript, item), 'waiting'))
        this.emit('question', item)
        return promise
      }
    }
    const approval = approvalItem(id, toolName, input, ctx, at)
    const promise = new Promise<PermissionResult>((resolve) => {
      this.pending.set(id, { resolve, suggestions: ctx.suggestions ?? [], plan: approval.variant === 'plan' })
      ctx.signal.addEventListener('abort', () => {
        if (this.pending.delete(id)) {
          this.update(decideApproval(this.transcript, id, 'cancel'))
          resolve({ behavior: 'deny', message: 'cancelled' })
        }
      }, { once: true })
    })
    this.update(setStatus(appendItem(this.transcript, approval), 'waiting'))
    this.emit('approval', approval)
    return promise
  }

  /**
   * Answer an approval. `deny` carries what the user told Claude to do
   * instead, when they typed it. A plan approved leaves plan mode for
   * *Edit automatically* (`plan-auto`) or *Manual* (`plan-manual`), the way the
   * CLI's own plan prompt does, through a session `setMode` update.
   */
  answer(approvalId: string, choice: ApprovalChoice, message?: string): void {
    const p = this.pending.get(approvalId)
    if (!p || p.questionInput) return
    this.pending.delete(approvalId)
    const said = message?.trim() || undefined
    this.update(decideApproval(this.transcript, approvalId, choice, choice === 'deny' ? said : undefined))
    const setMode = (mode: PermissionMode): PermissionUpdate[] => [{ type: 'setMode', mode, destination: 'session' }]
    if (choice === 'allow') p.resolve({ behavior: 'allow' })
    else if (choice === 'allow-session') p.resolve({ behavior: 'allow', updatedPermissions: p.suggestions })
    else if (choice === 'plan-auto') p.resolve({ behavior: 'allow', updatedPermissions: setMode('acceptEdits') })
    else if (choice === 'plan-manual') p.resolve({ behavior: 'allow', updatedPermissions: setMode('default') })
    else if (choice === 'deny') p.resolve({ behavior: 'deny', message: refusalMessage(said, !!p.plan) })
    else p.resolve({ behavior: 'deny', message: 'The user cancelled.', interrupt: true })
  }

  /** Answer an AskUserQuestion (answers by question text); `null` dismisses it. */
  answerQuestion(questionId: string, answers: Record<string, string[]> | null): void {
    const p = this.pending.get(questionId)
    if (!p || !p.questionInput) return
    this.pending.delete(questionId)
    this.update(answerQuestionItem(this.transcript, questionId, answers))
    if (answers) p.resolve({ behavior: 'allow', updatedInput: askUserQuestionInput(p.questionInput, answers) })
    else p.resolve({ behavior: 'deny', message: 'The user dismissed the question.' })
  }

  /**
   * Send a prompt under a uuid of our own — the id the CLI stores it by, and
   * so the one a rewind or a fork names. Idle, it starts a turn; mid-turn it
   * waits in the queue until the CLI echoes it back as read.
   */
  send(text: string, attachments: Attachment[] = []): void {
    this.start()
    const at = Date.now()
    const uuid = randomUUID()
    const item = { kind: 'user' as const, id: uuid, uuid, text, attachments: summarizeAttachments(attachments), at }
    const busy = this.transcript.status === 'running' || this.transcript.status === 'waiting'
    this.update(busy ? enqueue(this.transcript, item) : beginTurn(appendItem(this.transcript, item), at))
    this.input.push({
      type: 'user',
      message: { role: 'user', content: userContent(text, attachments) as any },
      parent_tool_use_id: null,
      session_id: this.transcript.sessionId ?? '',
      origin: { kind: 'human' },
      uuid
    } as SDKUserMessage)
  }

  /** Take back a prompt still waiting in the queue (`cancelAsyncMessage`). True when the CLI dropped it. */
  async removeQueued(id: string): Promise<boolean> {
    const q = this.q as (Query & QueryExtras) | null
    if (!this.transcript.queue.some((x) => x.id === id)) return false
    const cancelled = q?.cancelAsyncMessage ? await q.cancelAsyncMessage(id).catch(() => false) : false
    if (cancelled) this.update(unqueue(this.transcript, id))
    return cancelled
  }

  async interrupt(): Promise<void> {
    if (!this.q) return
    this.interrupting = true
    await this.q.interrupt()
  }

  /**
   * Rewind the files Claude changed since the prompt `userMessageId` to how
   * they were before it (or, with `dryRun`, say what that would change).
   */
  async rewind(userMessageId: string, dryRun: boolean): Promise<RewindResult> {
    const q = this.live()
    // A real rewind answers without the file list (observed 2026-10-18, CLI 2.1.302); its dry run names the files.
    const preview = dryRun ? null : await q.rewindFiles(userMessageId, { dryRun: true }).catch(() => null)
    const r = await q.rewindFiles(userMessageId, { dryRun })
    const files = r.filesChanged?.length ? r.filesChanged : preview?.filesChanged ?? []
    const result: RewindResult = { canRewind: r.canRewind, files, insertions: r.insertions ?? preview?.insertions ?? 0, deletions: r.deletions ?? preview?.deletions ?? 0, ...(r.error ? { error: r.error } : {}) }
    if (!dryRun && r.canRewind) {
      const n = result.files.length
      const skipped = r.skippedLinks ? ` ${r.skippedLinks} linked file${r.skippedLinks === 1 ? ' was' : 's were'} left alone.` : ''
      this.update(appendItem(this.transcript, {
        kind: 'system', id: `rewind:${Date.now()}`, level: 'info', at: Date.now(), variant: 'notice',
        text: n ? `Restored ${n} file${n === 1 ? '' : 's'} to before that prompt.${skipped}` : 'No files needed restoring.'
      }))
    }
    return result
  }

  /**
   * Fork the conversation up to just before the prompt `userMessageId`. The
   * new session ends at the message before that prompt, so the prompt can be
   * edited and sent again; `sessionId` is null when it was the first prompt
   * (start a fresh session with it instead). The extension's
   * `fork_conversation` does the same (`forkSession(id, resumeSessionAt)`).
   */
  async fork(userMessageId: string): Promise<{ sessionId: string | null; prompt: string }> {
    const prompt = this.transcript.items.find((x) => x.kind === 'user' && (x.uuid ?? x.id) === userMessageId)
    const text = prompt?.kind === 'user' ? prompt.text : ''
    const sessionId = this.transcript.sessionId
    if (!sessionId) return { sessionId: null, prompt: text }
    const cwd = this.transcript.cwd || this.config.cwd
    const messages = await getSessionMessages(sessionId, { dir: cwd })
    const at = messages.findIndex((m) => m.uuid === userMessageId)
    if (at < 0) throw new Error('That prompt is not in the saved session yet')
    const before = messages[at - 1]
    if (!before) return { sessionId: null, prompt: text }
    const forked = await forkSession(sessionId, { dir: cwd, upToMessageId: before.uuid })
    return { sessionId: forked.sessionId, prompt: text }
  }

  /** A side question: answered beside the turn, from the conversation so far, without joining it. Null when Claude had no answer. */
  async sideQuestion(question: string): Promise<string | null> {
    const q = this.live() as Query & QueryExtras
    if (!q.askSideQuestion) throw new Error('This Claude Code version cannot take side questions')
    const r = await q.askSideQuestion(question)
    return r?.response ?? null
  }

  /**
   * The model's context window as soon as the session starts (again at init
   * and after a model change), from the CLI's local estimate — no token-count
   * call; it answers before the CLI's init, which a streaming prompt only gets
   * with the first message. The
   * window used to arrive only with the first result's `modelUsage`, so during
   * a session's first turn the composer could show nothing but a raw count
   * ("66.6k"). A transcript that already has a context figure keeps it; one
   * with none shows what the system prompt and tools already take.
   */
  private async readWindow(): Promise<void> {
    try {
      const r = await this.live().getContextUsage({ detail: 'summary' })
      if (typeof r?.maxTokens !== 'number' || r.maxTokens <= 0) return
      const u = this.transcript.usage
      const fill = u.contextTokens === undefined && typeof r.totalTokens === 'number' && r.totalTokens > 0
      this.update({ ...this.transcript, usage: { ...u, contextWindow: r.maxTokens, ...(fill ? { contextTokens: r.totalTokens } : {}) } })
    } catch {
      /* an older CLI without the call, or the session already ended */
    }
  }

  /** The context window by category, from local estimates (no token-count calls). */
  async contextUsage(): Promise<ContextUsage> {
    const r = await this.live().getContextUsage({ detail: 'summary' })
    return {
      total: r.totalTokens, max: r.maxTokens, percent: r.percentage,
      categories: r.categories.filter((c) => c.tokens > 0 && !c.isDeferred).map((c) => ({ name: c.name, tokens: c.tokens, kind: c.kind })),
      memoryFiles: r.memoryFiles.map((m) => ({ path: m.path, tokens: m.tokens })).sort((a, b) => b.tokens - a.tokens)
    }
  }

  /** The session's MCP servers; toggling or reconnecting one answers the list as it is after. */
  async mcp(req: McpRequest): Promise<McpServer[]> {
    const q = this.live()
    if (req.op === 'toggle') await q.toggleMcpServer(req.name, req.enabled)
    else if (req.op === 'reconnect') await q.reconnectMcpServer(req.name)
    const list = await q.mcpServerStatus()
    return list.map((s) => ({ name: s.name, status: s.status, ...(s.error ? { error: s.error } : {}), tools: s.tools?.length ?? 0, ...(s.scope ? { scope: s.scope } : {}) }))
  }

  /**
   * Move a running command or agent to the background (all foreground tasks
   * without `toolUseId`), as Ctrl+B does in the terminal. False when that call
   * is not a running foreground task (any more).
   */
  async background(toolUseId?: string): Promise<boolean> {
    return this.live().backgroundTasks(toolUseId)
  }

  async stopTask(taskId: string): Promise<void> {
    await this.live().stopTask(taskId)
  }

  /** Name the session; the name is what the session picker and `claude --resume` show. */
  async rename(title: string): Promise<void> {
    const sessionId = this.transcript.sessionId
    if (!sessionId) throw new Error('The session has no id yet — send a message first')
    await renameSession(sessionId, title, { dir: this.transcript.cwd || this.config.cwd })
    this.update({ ...this.transcript, title })
  }

  async setPermissionMode(mode: PermissionMode): Promise<void> {
    await this.configure({ permissionMode: mode })
  }

  private live(): Query {
    if (this.transcript.status === 'closed') throw new Error('this Claude session has ended')
    this.start()
    return this.q!
  }

  /**
   * Change the model, the effort or the permission mode of the live session —
   * the three controls of the extension's composer, through the SDK's own
   * `setModel`, `applyFlagSettings({ effortLevel })` and `setPermissionMode`.
   * Effort `null` returns to the model's default.
   */
  async configure(patch: ChatConfigPatch): Promise<void> {
    const q = this.live()
    let t = this.transcript
    if (patch.model !== undefined) {
      await q.setModel(patch.model ?? undefined)
      const info = this.models.find((m) => m.value === patch.model)
      t = { ...t, model: info?.resolvedModel ?? patch.model ?? t.model }
    }
    if (patch.effort !== undefined) {
      if (patch.effort !== null && !CLAUDE_EFFORTS.includes(patch.effort as EffortLevel)) throw new Error(`unknown effort ${patch.effort}`)
      await q.applyFlagSettings({ effortLevel: (patch.effort ?? null) as EffortLevel | null })
      t = { ...t, effort: patch.effort ?? null }
    }
    if (patch.permissionMode !== undefined && patch.permissionMode !== null) {
      if (!CLAUDE_MODES.some((m) => m.id === patch.permissionMode)) throw new Error(`unknown permission mode ${patch.permissionMode}`)
      await q.setPermissionMode(patch.permissionMode as PermissionMode)
      t = { ...t, permissionMode: patch.permissionMode }
    }
    if (patch.fastMode !== undefined) {
      await q.applyFlagSettings({ fastMode: patch.fastMode })
      t = { ...t, fastMode: patch.fastMode ? 'on' : 'off' }
    }
    if (patch.outputStyle !== undefined) {
      // The same writer /output-style uses: the project's local settings, applied live.
      if (this.outputStyles.length && !this.outputStyles.includes(patch.outputStyle)) throw new Error(`unknown output style ${patch.outputStyle}`)
      await q.updateSettings('localSettings', { outputStyle: patch.outputStyle })
      t = { ...t, outputStyle: patch.outputStyle }
    }
    this.update(t)
    // Another model can have another window.
    if (patch.model !== undefined) void this.readWindow()
  }

  /** What the composer's menus offer: the CLI's models (with their effort levels and fast mode), the modes, the slash commands and the output styles. */
  async options(): Promise<ChatOptions> {
    const q = this.live()
    const [models, commands, init] = await Promise.all([
      q.supportedModels().catch(() => [] as ModelInfo[]),
      q.supportedCommands().catch(() => []),
      q.initializationResult().catch(() => null)
    ])
    this.models = models
    this.outputStyles = init?.available_output_styles ?? []
    if (init?.output_style && init.output_style !== this.transcript.outputStyle) this.update({ ...this.transcript, outputStyle: init.output_style })
    const id = this.transcript.model ?? 'default'
    const current = models.find((m) => m.value === id) ?? models.find((m) => m.resolvedModel === id)
    return {
      models: models.map((m) => ({
        id: m.value, label: m.displayName, description: m.description || undefined, model: m.resolvedModel,
        efforts: m.supportsEffort === false ? [] : [...(m.supportedEffortLevels ?? [])],
        ...(m.supportsFastMode ? { fastMode: true } : {})
      })),
      modes: CLAUDE_MODES.filter((m) => m.id !== 'auto' || current?.supportsAutoMode === true || this.transcript.permissionMode === 'auto'),
      commands: commands.filter((c) => !this.terminalCommands.has(c.name)).map((c) => ({ name: c.name, description: c.description, argumentHint: c.argumentHint || undefined })),
      outputStyles: [...this.outputStyles],
      fastMode: current?.supportsFastMode === true
    }
  }

  /** End the process and the MCP servers it started; the session stays resumable from disk. */
  close(): void {
    // The tree first: once the CLI is gone its servers can no longer be found by parent id.
    killProcessTree(this.pid)
    this.input.end()
    this.abort.abort()
  }
}

// ---- history ---------------------------------------------------------------

/** Sessions for a folder (or every folder), newest first, IDE-style: no headless SDK sessions. */
export async function listClaudeSessions(opts: { cwd?: string; limit?: number } = {}): Promise<SessionSummary[]> {
  const infos = await listSessions({ dir: opts.cwd, limit: opts.limit ?? 100, includeProgrammatic: false })
  return infos.map(sessionSummary)
}

export async function loadClaudeTranscript(sessionId: string, cwd: string): Promise<Transcript> {
  const [info, messages] = await Promise.all([
    getSessionInfo(sessionId, { dir: cwd }).catch(() => undefined),
    getSessionMessages(sessionId, { dir: cwd, includeSystemMessages: true })
  ])
  return sessionMessagesToTranscript({ sessionId, cwd: info?.cwd ?? cwd, info }, messages)
}
