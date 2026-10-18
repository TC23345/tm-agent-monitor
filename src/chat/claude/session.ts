// The Claude Code side of the chat pane: one `claude` process per pane,
// driven through the Agent SDK exactly as the Cursor extension drives its
// bundled binary — `--input-format stream-json --output-format stream-json`,
// a streaming prompt so one process serves every turn, and `canUseTool` as
// the permission prompt and the question prompt (docs/rea-findings.md).
// History comes from the SDK's own readers over `~/.claude/projects/<cwd>/<session>.jsonl`.
// This file imports no Electron; main (or a probe script) owns it.
import { EventEmitter } from 'node:events'
import {
  getSessionInfo, getSessionMessages, listSessions, query,
  type CanUseTool, type EffortLevel, type ModelInfo, type PermissionMode, type PermissionResult, type PermissionUpdate, type Query, type SDKMessage, type SDKUserMessage
} from '@anthropic-ai/claude-agent-sdk'
import { foldSdkMessage, sessionMessagesToTranscript, sessionSummary, startFold, type ClaudeFold } from './fold.mjs'
import {
  answerQuestion as answerQuestionItem, appendItem, beginTurn, decideApproval, emptyTranscript, setStatus, summarizeAttachments,
  type ApprovalChoice, type Attachment, type ChatConfigPatch, type ChatItemApproval, type ChatItemQuestion, type ChatOptions, type ModeOption, type Question, type SessionSummary, type Transcript
} from '../shared/chatModel.mjs'
import { resolveClaude } from '../shared/findCli.mjs'

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
}

/** Claude's AskUserQuestion input → our questions (the question text is the id the answer is keyed by). */
export function questionsFromAskUserQuestion(input: Record<string, unknown>): Question[] {
  const list = Array.isArray(input.questions) ? (input.questions as any[]) : []
  return list.map((q) => ({
    id: String(q.question ?? ''),
    text: String(q.question ?? ''),
    header: q.header ? String(q.header) : undefined,
    options: Array.isArray(q.options) && q.options.length ? q.options.map((o: any) => ({ label: String(o.label ?? ''), description: o.description ? String(o.description) : undefined })) : null,
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
  /** The consume loop; resolves when the process is gone (close, exit, or error). */
  done: Promise<void> | null = null

  constructor(options: ClaudeSessionOptions, transcript?: Transcript) {
    super()
    this.config = options
    this.transcript = transcript ?? emptyTranscript('claude', { cwd: options.cwd, sessionId: options.resume ?? null, model: options.model ?? null, effort: options.effort ?? null, permissionMode: options.permissionMode ?? 'default' })
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
        extraArgs: o.extraArgs,
        settingSources: o.settingSources ?? ['user', 'project', 'local'],
        includePartialMessages: true,
        canUseTool,
        abortController: this.abort,
        stderr: (data) => this.log(`[claude stderr] ${data.trimEnd()}`)
      }
    })
    this.log(`[claude] started via ${claude?.how ?? 'sdk-bundled'} in ${o.cwd}${o.resume ? ` resuming ${o.resume}` : ''}`)
    this.done = this.consume(this.q)
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
    if (msg.type === 'system' && msg.subtype === 'init') this.terminalCommands = new Set(msg.terminal_slash_commands ?? [])
    const next = foldSdkMessage(this.fold, msg)
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
    const title = ctx.title ?? `Allow ${toolName}`
    const detail = [typeof input.command === 'string' ? input.command : '', ctx.decisionReason ?? '', ctx.blockedPath ? `Path: ${ctx.blockedPath}` : ''].filter(Boolean).join('\n')
    const approval: ChatItemApproval = { kind: 'approval', id, title, detail: detail || undefined, choices: ['allow', 'allow-session', 'deny', 'cancel'], at }
    const promise = new Promise<PermissionResult>((resolve) => {
      this.pending.set(id, { resolve, suggestions: ctx.suggestions ?? [] })
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

  answer(approvalId: string, choice: ApprovalChoice): void {
    const p = this.pending.get(approvalId)
    if (!p || p.questionInput) return
    this.pending.delete(approvalId)
    this.update(decideApproval(this.transcript, approvalId, choice))
    if (choice === 'allow') p.resolve({ behavior: 'allow' })
    else if (choice === 'allow-session') p.resolve({ behavior: 'allow', updatedPermissions: p.suggestions })
    else if (choice === 'deny') p.resolve({ behavior: 'deny', message: 'The user declined this action.' })
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

  /** Queue a user turn. The user row is appended locally; the CLI does not echo it. */
  send(text: string, attachments: Attachment[] = []): void {
    this.start()
    const at = Date.now()
    this.update(beginTurn(appendItem(this.transcript, { kind: 'user', id: `local:${at}`, text, attachments: summarizeAttachments(attachments), at }), at))
    this.input.push({
      type: 'user',
      message: { role: 'user', content: userContent(text, attachments) as any },
      parent_tool_use_id: null,
      session_id: this.transcript.sessionId ?? '',
      origin: { kind: 'human' }
    } as SDKUserMessage)
  }

  async interrupt(): Promise<void> {
    await this.q?.interrupt()
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
    this.update(t)
  }

  /** What the composer's menus offer: the CLI's models (with their effort levels), the modes, and the slash commands. */
  async options(): Promise<ChatOptions> {
    const q = this.live()
    const [models, commands] = await Promise.all([q.supportedModels().catch(() => [] as ModelInfo[]), q.supportedCommands().catch(() => [])])
    this.models = models
    const id = this.transcript.model ?? 'default'
    const current = models.find((m) => m.value === id) ?? models.find((m) => m.resolvedModel === id)
    return {
      models: models.map((m) => ({
        id: m.value, label: m.displayName, description: m.description || undefined, model: m.resolvedModel,
        efforts: m.supportsEffort === false ? [] : [...(m.supportedEffortLevels ?? [])]
      })),
      modes: CLAUDE_MODES.filter((m) => m.id !== 'auto' || current?.supportsAutoMode === true || this.transcript.permissionMode === 'auto'),
      commands: commands.filter((c) => !this.terminalCommands.has(c.name)).map((c) => ({ name: c.name, description: c.description, argumentHint: c.argumentHint || undefined }))
    }
  }

  /** End the process; the session stays resumable from disk. */
  close(): void {
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
