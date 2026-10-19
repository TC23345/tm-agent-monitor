// The Codex side of the chat pane: one app-server connection per workspace
// (the Cursor extension keeps one too), and one `CodexThread` per pane that
// binds a transcript to a thread on it.
//
// Observed contract (docs/rea-findings.md): JSON-RPC-shaped messages without
// the `jsonrpc` field, `initialize` then the `initialized` notification,
// thread and turn methods from `codex app-server generate-ts` 0.162.1,
// approvals and questions as server requests answered under the same id.
// Two transports carry the same messages: our own child (`codex app-server`,
// one JSON object per stdio line) or the user's managed daemon (`codex
// app-server proxy` pipes bytes to the daemon's control socket, which is a
// WebSocket server — one JSON object per frame). This file imports no
// Electron; main (or a probe script) owns it.
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { Duplex } from 'node:stream'
import WebSocket from 'ws'
import {
  APPROVAL_METHODS, CODEX_MODES, CUSTOM_MODE, approvalResponse, codexModeId, foldNotification, foldServerRequest, foldTurnItems, mergeLimits, questionResponse, threadSummary, threadToTranscript,
  type CodexMode
} from './fold.mjs'
import { LineSplitter, PendingCalls, errorResponseLine, notificationLine, parseIncoming, requestLine, responseLine, type Incoming } from './rpc.mjs'
import {
  answerQuestion as answerQuestionItem, appendItem, beginTurn, decideApproval, enqueue, firstLine, setStatus, summarizeAttachments, unqueue, updateItem,
  type ApprovalChoice, type Attachment, type ChatConfigPatch, type ChatOptions, type CommandOption, type ContextUsage, type McpRequest, type McpServer, type ModelOption,
  type ReviewTarget, type SessionSummary, type Transcript
} from '../shared/chatModel.mjs'
import { fmtTokens, limitLines } from '../shared/present.mjs'
import { filePatch, relTo } from '../shared/diff.mjs'
import { resolveCodex } from '../shared/findCli.mjs'
import { killProcessTree } from '../shared/processTree.mjs'

/** The permission menu, in the Codex extension's words; defined with the fold, which maps thread settings back onto it. */
export { CODEX_MODES } from './fold.mjs'

/**
 * own: spawn `codex app-server` as our child. daemon: make sure the user's
 * managed daemon runs (`codex app-server daemon start`) and attach to it, so
 * every client on the machine that does the same shares one server and its
 * live threads. auto: the daemon when one is already running, else our own.
 */
export type CodexServerMode = 'own' | 'daemon' | 'auto'

export interface CodexServerOptions {
  /** The codex executable; resolved from PATH / the npm package when absent. */
  codexPath?: string
  mode?: CodexServerMode
  env?: Record<string, string | undefined>
  /** Per-request timeout; turns are not requests, they are notifications, so this is for list/read/start. */
  requestTimeoutMs?: number
  clientName?: string
  clientVersion?: string
  log?: (line: string) => void
}

export interface StartThreadOptions {
  cwd: string
  model?: string | null
  /** Codex `AskForApproval`: 'untrusted' | 'on-request' | 'never' */
  approvalPolicy?: string
  /** Codex `SandboxMode`: 'read-only' | 'workspace-write' | 'danger-full-access' */
  sandbox?: string
  ephemeral?: boolean
}

type ServerRequest = Extract<Incoming, { kind: 'server-request' }>
type Notification = Extract<Incoming, { kind: 'notification' }>

/** Codex `UserInput` items for a turn: text, local images, file mentions. Images must carry a `path` here (the host materialises pasted bytes). */
export function userInputs(text: string, attachments: Attachment[] = []): unknown[] {
  const inputs: unknown[] = [{ type: 'text', text, text_elements: [] }]
  for (const a of attachments) {
    if (a.kind === 'image' && a.path) inputs.push({ type: 'localImage', path: a.path })
    else if (a.kind === 'file') inputs.push({ type: 'mention', name: a.name ?? baseName(a.path), path: a.path })
  }
  return inputs
}

function baseName(p: string): string {
  const m = /[^\\/]+$/.exec(p)
  return m ? m[0] : p
}

/** The proxy child's stdio as one duplex "socket" for the WebSocket client. Node's
 * `net.connect({path})` is a named pipe on Windows, not AF_UNIX, so the proxy is the way in. */
function pipeSocket(proc: ChildProcessWithoutNullStreams): Duplex {
  const d = Duplex.from({ readable: proc.stdout, writable: proc.stdin }) as Duplex & Record<string, unknown>
  for (const m of ['setNoDelay', 'setKeepAlive', 'setTimeout', 'ref', 'unref']) d[m] = () => d
  d.remoteAddress = 'codex-daemon'
  return d
}

/**
 * One app-server connection. Events: `notification` (Notification),
 * `server-request` (ServerRequest), `exit` (code, signal), `log` (string).
 */
export class CodexAppServer extends EventEmitter {
  private proc: ChildProcessWithoutNullStreams | null = null
  private ws: WebSocket | null = null
  private pending = new PendingCalls()
  private splitter = new LineSplitter()
  private initialized: Promise<unknown> | null = null
  private closed = false
  readonly options: CodexServerOptions
  /** What `initialize` answered: userAgent, codexHome, platform. */
  info: Record<string, unknown> | null = null
  /** How this connection reached a server. */
  transport: 'own' | 'daemon' | null = null

  constructor(options: CodexServerOptions = {}) {
    super()
    this.options = options
  }

  /** Spawn (or attach) and complete the handshake. Idempotent. */
  start(): Promise<unknown> {
    if (this.initialized) return this.initialized
    const exe = this.options.codexPath ? { file: this.options.codexPath, args: [] as string[], how: 'option' } : resolveCodex()
    if (!exe) return Promise.reject(new Error('codex executable not found — set CODEX_PATH or install @openai/codex'))
    const env: Record<string, string> = {}
    for (const [k, v] of Object.entries({ ...process.env, ...this.options.env })) if (typeof v === 'string') env[k] = v
    env.RUST_LOG ??= 'warn'
    this.transport = this.pickTransport(exe, env)
    const args = this.transport === 'daemon' ? [...exe.args, 'app-server', 'proxy'] : [...exe.args, 'app-server']
    this.log(`[codex] ${exe.file} ${args.join(' ')} (${exe.how}, ${this.transport})`)
    const proc = spawn(exe.file, args, { stdio: ['pipe', 'pipe', 'pipe'], env, windowsHide: true })
    this.proc = proc
    proc.stderr.setEncoding('utf8')
    proc.stderr.on('data', (chunk: string) => this.log(`[codex stderr] ${chunk.trimEnd()}`))
    proc.on('exit', (code, signal) => {
      this.log(`[codex] exited code=${code} signal=${signal}`)
      this.pending.failAll(`codex app-server exited (code ${code ?? 'null'})`)
      this.proc = null
      this.ws = null
      this.emit('exit', code, signal)
    })
    proc.on('error', (err) => {
      this.log(`[codex] spawn error ${err.message}`)
      this.pending.failAll(err.message)
      this.emit('exit', null, null)
    })
    let ready: Promise<void>
    if (this.transport === 'daemon') {
      const ws = new WebSocket('ws://localhost/', { createConnection: () => pipeSocket(proc) as never, perMessageDeflate: false })
      this.ws = ws
      ws.on('message', (data) => this.handleLine(String(data)))
      ws.on('error', (err) => this.log(`[codex daemon] ${err.message}`))
      ws.on('close', () => { if (this.proc) this.close() })
      ready = new Promise<void>((resolve, reject) => {
        ws.once('open', () => resolve())
        ws.once('error', (err) => reject(err))
        ws.once('unexpected-response', (_req, res) => reject(new Error(`daemon refused the WebSocket upgrade (${res.statusCode})`)))
      })
    } else {
      proc.stdout.setEncoding('utf8')
      proc.stdout.on('data', (chunk: string) => {
        for (const line of this.splitter.push(chunk)) this.handleLine(line)
      })
      ready = Promise.resolve()
    }
    this.initialized = ready.then(() => this.request('initialize', {
      clientInfo: { name: this.options.clientName ?? 'tm-chat-panes', title: 'TaylorMade Agent Monitor', version: this.options.clientVersion ?? '0.1.0' },
      // As the Codex extension does: plan mode, background terminals and predictions are experimental methods.
      capabilities: { experimentalApi: true, requestAttestation: false }
    })).then((info) => {
      this.info = (info ?? null) as Record<string, unknown> | null
      this.write(notificationLine('initialized', {}))
      return info
    })
    return this.initialized
  }

  /** Decide own vs daemon; starts the daemon in `daemon` mode. `codex app-server daemon version` answers only when one runs. */
  private pickTransport(exe: { file: string; args: string[] }, env: Record<string, string>): 'own' | 'daemon' {
    const mode = this.options.mode ?? 'own'
    if (mode === 'own') return 'own'
    const running = () => spawnSync(exe.file, [...exe.args, 'app-server', 'daemon', 'version'], { env, timeout: 5000, windowsHide: true, encoding: 'utf8' }).status === 0
    if (running()) return 'daemon'
    if (mode === 'auto') return 'own'
    const started = spawnSync(exe.file, [...exe.args, 'app-server', 'daemon', 'start'], { env, timeout: 30000, windowsHide: true, encoding: 'utf8' })
    if (started.status !== 0) {
      this.log(`[codex] daemon start failed (${started.status}): ${(started.stderr ?? '').trim().slice(0, 300)} — using own server`)
      return 'own'
    }
    return running() ? 'daemon' : 'own'
  }

  get alive(): boolean {
    return this.proc !== null && !this.closed
  }

  private log(line: string) {
    this.options.log?.(line)
    this.emit('log', line)
  }

  /** One message out: a stdio line to our own child, a frame to the daemon. */
  private write(line: string): boolean {
    if (this.ws) {
      if (this.ws.readyState !== WebSocket.OPEN) return false
      this.ws.send(line.trimEnd())
      return true
    }
    const stdin = this.proc?.stdin
    if (!stdin || stdin.destroyed) return false
    stdin.write(line)
    return true
  }

  private handleLine(line: string) {
    const msg = parseIncoming(line)
    if (!msg) {
      if (line.trim()) this.log(`[codex] unparsed line: ${line.slice(0, 200)}`)
      return
    }
    if (msg.kind === 'response') {
      if (!this.pending.settle(msg)) this.log(`[codex] response for unknown id ${String(msg.id)}`)
      return
    }
    if (msg.kind === 'notification') {
      this.emit('notification', msg)
      return
    }
    this.emit('server-request', msg)
  }

  /** A JSON-RPC request; rejects on an error response, a timeout, or exit. */
  request<T = unknown>(method: string, params: unknown, timeoutMs = this.options.requestTimeoutMs ?? 60_000): Promise<T> {
    if (!this.proc) return Promise.reject(new Error('codex app-server is not running'))
    const id = this.pending.nextId()
    const wait = this.pending.wait(id, method, { timeoutMs }) as Promise<T>
    if (!this.write(requestLine(id, method, params))) {
      this.pending.settle({ kind: 'response', id, error: { message: 'connection closed' } })
    }
    return wait
  }

  /** Answer a server request (an approval, a question). */
  respond(id: string | number, result: unknown): void {
    this.write(responseLine(id, result))
  }

  respondError(id: string | number, message: string): void {
    this.write(errorResponseLine(id, message))
  }

  // ---- the thread/turn surface the panes use --------------------------------

  async listThreads(opts: { cwd?: string | string[]; limit?: number; cursor?: string | null; archived?: boolean } = {}): Promise<{ sessions: SessionSummary[]; nextCursor: string | null }> {
    await this.start()
    const res = await this.request<{ data: any[]; nextCursor: string | null }>('thread/list', {
      limit: opts.limit ?? 50, cursor: opts.cursor ?? null, sortKey: 'recency_at', archived: opts.archived ?? false,
      modelProviders: null, sourceKinds: null, cwd: opts.cwd ?? null, useStateDbOnly: true
    })
    return { sessions: (res.data ?? []).map(threadSummary), nextCursor: res.nextCursor ?? null }
  }

  /** A stored thread's transcript (metadata read, then its turns with full items, oldest first). */
  async readTranscript(threadId: string): Promise<Transcript> {
    await this.start()
    const res = await this.request<{ thread: any }>('thread/read', { threadId, includeTurns: false })
    let t = threadToTranscript(res.thread)
    const turns = await this.listTurns(threadId)
    for (const turn of turns) t = foldTurnItems(t, turn)
    return t
  }

  /** Every turn of a thread with its full items, oldest first, through `thread/turns/list` pages
   * (the default `summary` view carries only the messages — observed 2026-10-17). */
  async listTurns(threadId: string, pageSize = 50): Promise<any[]> {
    const turns: any[] = []
    let cursor: string | null = null
    for (let page = 0; page < 200; page++) {
      const res: { data: any[]; nextCursor: string | null } = await this.request('thread/turns/list', { threadId, limit: pageSize, cursor, sortDirection: 'asc', itemsView: 'full' })
      turns.push(...(res.data ?? []))
      cursor = res.nextCursor ?? null
      if (!cursor) break
    }
    return turns
  }

  async startThread(opts: StartThreadOptions): Promise<{ thread: any; model: string }> {
    await this.start()
    return this.request('thread/start', {
      cwd: opts.cwd, model: opts.model ?? null, approvalPolicy: opts.approvalPolicy ?? null, sandbox: opts.sandbox ?? null,
      ephemeral: opts.ephemeral ?? false, sessionStartSource: null
    })
  }

  async resumeThread(threadId: string, opts: Partial<StartThreadOptions> = {}): Promise<{ thread: any; model: string }> {
    await this.start()
    return this.request('thread/resume', {
      threadId, cwd: opts.cwd ?? null, model: opts.model ?? null, approvalPolicy: opts.approvalPolicy ?? null, sandbox: opts.sandbox ?? null, excludeTurns: true
    })
  }

  startTurn(threadId: string, input: unknown[], opts: { model?: string | null; effort?: string | null; cwd?: string | null; approvalPolicy?: string | null; sandboxPolicy?: Record<string, unknown> | null; approvalsReviewer?: string | null; serviceTier?: string | null; summary?: string | null } = {}): Promise<{ turn: any }> {
    return this.request('turn/start', {
      threadId, input, model: opts.model ?? null, effort: opts.effort ?? null, cwd: opts.cwd ?? null,
      approvalPolicy: opts.approvalPolicy ?? null, sandboxPolicy: opts.sandboxPolicy ?? null,
      ...(opts.approvalsReviewer ? { approvalsReviewer: opts.approvalsReviewer } : {}),
      ...(opts.serviceTier ? { serviceTier: opts.serviceTier } : {}),
      ...(opts.summary ? { summary: opts.summary } : {})
    })
  }

  private modelCache: ModelOption[] | null = null

  /** The picker's models (`model/list`, hidden ones left out), with each one's reasoning efforts. Cached per connection. */
  async listModels(): Promise<ModelOption[]> {
    if (this.modelCache) return this.modelCache
    await this.start()
    const res = await this.request<{ data: any[] }>('model/list', { limit: 100, includeHidden: false })
    this.modelCache = (res.data ?? []).filter((m) => !m.hidden).map((m) => {
      // Fast is the model's `priority` service tier (composer.intelligencePicker.fastMode); its description says what it costs.
      const fast = (m.serviceTiers ?? []).find((s: any) => s?.id === 'priority')
      return {
        id: String(m.model ?? m.id), label: String(m.displayName ?? m.model ?? m.id), description: m.description || undefined,
        efforts: (m.supportedReasoningEfforts ?? []).map((e: any) => String(e.reasoningEffort)).filter(Boolean),
        defaultEffort: m.defaultReasoningEffort ?? null, model: String(m.model ?? m.id),
        ...(fast ? { fastMode: true, fastLabel: String(fast.description ?? fast.name ?? 'Faster') } : {})
      }
    })
    return this.modelCache
  }

  /** The models already listed on this connection, if any (labels for the model-changed row). */
  cachedModels(): ModelOption[] | null {
    return this.modelCache
  }

  interruptTurn(threadId: string, turnId: string): Promise<unknown> {
    return this.request('turn/interrupt', { threadId, turnId })
  }

  close(): void {
    this.closed = true
    const proc = this.proc
    if (!proc) return
    try {
      this.ws?.close()
      proc.stdin.end()
    } catch {
      /* already gone */
    }
    // Still running after its input closed: end it with the MCP servers it started (a plain kill orphans them on Windows).
    const killer = setTimeout(() => {
      killProcessTree(proc.pid)
      try {
        proc.kill()
      } catch {
        /* already gone */
      }
    }, 1500)
    proc.once('exit', () => clearTimeout(killer))
  }
}

/**
 * The Codex composer's slash commands. The app-server has no slash commands
 * of its own (they are the TUI's and the extension's), so each is the pane's,
 * mapped onto an app-server call (composer.*SlashCommand in the extension).
 */
export const CODEX_COMMANDS: CommandOption[] = [
  { name: 'compact', description: 'Compact this chat’s context', local: true },
  { name: 'review', description: 'Review uncommitted changes, or compare against a branch', argumentHint: '[base branch]', local: true },
  { name: 'plan', description: 'Turn plan mode on or off', local: true },
  { name: 'fork', description: 'Continue in a new chat from here', local: true },
  { name: 'new', description: 'Start a blank chat in the same workspace', local: true },
  { name: 'init', description: 'Create an AGENTS.md file with instructions for Codex', local: true },
  { name: 'status', description: 'Show the chat ID, context usage and rate limits', local: true },
  { name: 'mcp', description: 'Show MCP server status', local: true },
  { name: 'side', description: 'Ask a quick side question without interrupting', local: true }
]

/** What a side question asks the throwaway fork, so it answers from the conversation without acting. */
const SIDE_PREFIX = 'Answer this side question briefly from what you already know about this conversation and folder. Do not run commands, edit files or call tools.\n\n'

/**
 * One pane's thread on a server. Holds the transcript, folds the thread's
 * traffic, turns approvals and questions into items and answers them.
 * Events: `change` (transcript), `approval` (item), `question` (item),
 * `open-url` (url) when the user accepts a browser elicitation.
 */
export class CodexThread extends EventEmitter {
  transcript: Transcript
  threadId: string | null
  readonly server: CodexAppServer
  private turnId: string | null = null
  /** The composer's picks; sent with every turn (they persist server-side for the turns after too). */
  private overrides: { model?: string | null; effort?: string | null; mode?: CodexMode; serviceTier?: string } = {}
  private approvals = new Map<string, ServerRequest>()
  private questions = new Map<string, ServerRequest>()
  /** Attachments of prompts queued while a turn runs, by queued item id. */
  private queuedFiles = new Map<string, Attachment[]>()
  /** The latest aggregated unified diff of each turn (`turn/diff/updated`), for Undo. */
  private turnDiffs = new Map<string, string>()
  private backgroundTimer: ReturnType<typeof setTimeout> | null = null
  private onNotification = (n: Notification) => this.handleNotification(n)
  private onRequest = (r: ServerRequest) => this.handleServerRequest(r)
  private onExit = () => this.update(setStatus(this.transcript, 'closed', 'Codex exited'))

  constructor(server: CodexAppServer, transcript: Transcript) {
    super()
    this.server = server
    this.transcript = transcript
    this.threadId = transcript.sessionId
    server.on('notification', this.onNotification)
    server.on('server-request', this.onRequest)
    server.on('exit', this.onExit)
  }

  private update(next: Transcript) {
    if (next === this.transcript) return
    this.transcript = next
    this.emit('change', next)
  }

  private handleNotification(n: Notification) {
    const p = (n.params ?? {}) as any
    // Every pane shares the connection: traffic that names another thread (a sibling pane, a side question's fork) is not ours.
    const named = p.threadId ?? p.thread?.id
    if (named && named !== this.threadId) return
    const mine = p.threadId === this.threadId
    if (n.method === 'turn/started' && mine) this.turnId = p.turn?.id ?? this.turnId
    if (n.method === 'turn/diff/updated' && mine && typeof p.diff === 'string' && p.turnId) this.turnDiffs.set(p.turnId, p.diff.slice(0, MAX_DIFF))
    this.update(foldNotification(this.transcript, n))
    if (!mine) return
    if (n.method === 'turn/completed') {
      this.turnId = null
      this.refreshBackground()
      void this.requestPrediction(p.turn?.id)
      // The next queued prompt goes as its own turn, unless an interrupt paused the queue.
      if (this.transcript.queue.length && !this.transcript.queuePaused) void this.sendQueued()
    }
    if (n.method === 'item/completed' && p.item?.type === 'commandExecution') this.refreshBackground()
  }

  private handleServerRequest(r: ServerRequest) {
    const p = (r.params ?? {}) as any
    const threadId = p.threadId ?? p.conversationId
    if (threadId !== this.threadId) return
    const { transcript, approval, question } = foldServerRequest(this.transcript, r)
    if (approval) {
      this.approvals.set(approval.id, r)
      this.update(transcript)
      this.emit('approval', approval)
      return
    }
    if (question) {
      this.questions.set(question.id, r)
      this.update(transcript)
      this.emit('question', question)
      return
    }
    // Dynamic tool calls, token refreshes and attestations belong to richer hosts; refuse so the turn is not stuck.
    this.server.respondError(r.id, `${r.method} is not supported by this client`)
  }

  /** Start a fresh thread or rejoin the transcript's, then read the account's rate limits once. */
  async open(opts: Omit<StartThreadOptions, 'cwd'> = {}): Promise<void> {
    const cwd = this.transcript.cwd
    const res = this.threadId ? await this.server.resumeThread(this.threadId, { cwd, ...opts }) : await this.server.startThread({ cwd, ...opts })
    this.threadId = res.thread?.id ?? this.threadId
    // The start/resume answer carries the thread's effective settings: show its real mode, effort, Fast and plan mode at once.
    const r = res as any
    this.update({
      ...this.transcript, sessionId: this.threadId, model: res.model ?? this.transcript.model, title: res.thread?.name ?? this.transcript.title,
      ...(r.approvalPolicy ? { permissionMode: codexModeId({ approvalPolicy: r.approvalPolicy, sandboxPolicy: r.sandbox, approvalsReviewer: r.approvalsReviewer }) } : {}),
      ...(r.reasoningEffort !== undefined ? { effort: r.reasoningEffort ?? null } : {}),
      ...(r.serviceTier !== undefined ? { fastMode: r.serviceTier === 'priority' ? 'on' as const : 'off' as const } : {}),
      ...(r.collaborationMode ? { planMode: r.collaborationMode.mode === 'plan' } : {})
    })
    void this.readLimits()
    this.refreshBackground()
  }

  private async readLimits(): Promise<void> {
    try {
      const res = await this.server.request<{ rateLimits?: unknown }>('account/rateLimits/read', {})
      this.update({ ...this.transcript, limits: mergeLimits(this.transcript.limits, res.rateLimits) })
    } catch {
      /* an API-key login has no plan limits */
    }
  }

  /** Send, or queue while a turn runs (the extension's queue: each queued prompt is its own next turn; Steer sends one now). */
  async send(text: string, attachments: Attachment[] = [], opts: { model?: string | null; effort?: string | null } = {}): Promise<void> {
    if (!this.threadId) await this.open()
    const at = Date.now()
    const busy = this.transcript.status === 'running' || this.transcript.status === 'waiting'
    if (busy || (this.transcript.queuePaused && this.transcript.queue.length)) {
      const id = `queued:${at}`
      this.queuedFiles.set(id, attachments)
      this.update(enqueue(this.transcript, { kind: 'user', id, text, attachments: summarizeAttachments(attachments), at }))
      return
    }
    await this.startTurn(text, attachments, opts, at)
  }

  private async startTurn(text: string, attachments: Attachment[], opts: { model?: string | null; effort?: string | null }, at: number): Promise<void> {
    this.update(beginTurn({ ...this.transcript, pendingPlan: null, items: [...this.transcript.items, { kind: 'user', id: `local:${at}`, text, attachments: summarizeAttachments(attachments), at }] }, at))
    try {
      const o = this.overrides
      const res = await this.server.startTurn(this.threadId!, userInputs(text, attachments), {
        model: opts.model ?? o.model ?? null, effort: opts.effort ?? o.effort ?? null,
        approvalPolicy: o.mode?.approvalPolicy ?? null, sandboxPolicy: o.mode?.sandboxPolicy ?? null, approvalsReviewer: o.mode?.approvalsReviewer ?? null,
        serviceTier: o.serviceTier ?? null, summary: 'auto'
      })
      this.turnId = res.turn?.id ?? this.turnId
    } catch (err) {
      this.update(setStatus(this.transcript, 'error', (err as Error).message))
      throw err
    }
  }

  /** The queue's head as the next turn. */
  private async sendQueued(): Promise<void> {
    const next = this.transcript.queue[0]
    if (!next) return
    const files = this.queuedFiles.get(next.id) ?? []
    this.queuedFiles.delete(next.id)
    this.update(unqueue(this.transcript, next.id))
    await this.startTurn(next.text, files, {}, Date.now()).catch(() => { /* the transcript shows the error */ })
  }

  /** Take a queued prompt back. */
  removeQueued(itemId: string): boolean {
    if (!this.transcript.queue.some((x) => x.id === itemId)) return false
    this.queuedFiles.delete(itemId)
    let t = unqueue(this.transcript, itemId)
    if (!t.queue.length) t = { ...t, queuePaused: false }
    this.update(t)
    return true
  }

  /**
   * Steer: send a queued prompt into the running turn now, without
   * interrupting it (`turn/steer`, composer.queuedMessage.sendNow). With no
   * turn running it simply goes next.
   */
  async steer(itemId: string): Promise<void> {
    const item = this.transcript.queue.find((x) => x.id === itemId)
    if (!item) return
    const files = this.queuedFiles.get(itemId) ?? []
    if (!this.turnId || !this.threadId) {
      this.queuedFiles.delete(itemId)
      this.update(unqueue(this.transcript, itemId))
      await this.startTurn(item.text, files, {}, Date.now())
      return
    }
    await this.server.request('turn/steer', { threadId: this.threadId, input: userInputs(item.text, files), expectedTurnId: this.turnId })
    this.queuedFiles.delete(itemId)
    // The server echoes the steered message; it lands on this row (same text) instead of doubling.
    const t = unqueue(this.transcript, itemId)
    this.update({ ...t, items: [...t.items, { ...item, id: `local:${Date.now()}`, steered: true, turnId: this.turnId }] })
  }

  /** After an interrupt the queue waits (composer.queuedMessage.interruptedQueue); Resume sends its head. */
  async resumeQueue(): Promise<void> {
    this.update({ ...this.transcript, queuePaused: false })
    if (this.transcript.status !== 'running' && this.transcript.status !== 'waiting') await this.sendQueued()
  }

  async interrupt(): Promise<void> {
    if (!this.threadId || !this.turnId) return
    if (this.transcript.queue.length) this.update({ ...this.transcript, queuePaused: true })
    await this.server.interruptTurn(this.threadId, this.turnId)
  }

  /**
   * A shell line the user typed (`!git status`): `thread/shellCommand`, which
   * runs it in the thread's shell outside the sandbox, the way the Codex TUI's
   * `!` does. Its output arrives as a command row.
   */
  async shell(command: string): Promise<void> {
    if (!this.threadId) await this.open()
    await this.server.request('thread/shellCommand', { threadId: this.threadId, command })
  }

  /** `/review`: a code review of the uncommitted changes or against a base branch, inline on this thread. */
  async review(target: ReviewTarget): Promise<void> {
    if (!this.threadId) await this.open()
    const at = Date.now()
    const label = target.type === 'baseBranch' ? `Review against ${target.branch}` : 'Review uncommitted changes'
    this.update(beginTurn({ ...this.transcript, items: [...this.transcript.items, { kind: 'user', id: `review:${at}`, text: label, at }] }, at))
    try {
      const res = await this.server.request<{ turn?: { id?: string } }>('review/start', { threadId: this.threadId, target, delivery: 'inline' })
      this.turnId = res.turn?.id ?? this.turnId
    } catch (err) {
      this.update(setStatus(this.transcript, 'error', (err as Error).message))
      throw err
    }
  }

  /**
   * Fork the thread through the turn before the prompt `itemId` (`thread/fork`
   * with `lastTurnId`), so that prompt can be edited and sent again. Null when
   * it was the first prompt: start a fresh thread with it instead. With no
   * `itemId`, fork the whole thread (*Continue in new chat*).
   */
  async fork(itemId?: string): Promise<{ sessionId: string | null; prompt: string }> {
    if (!itemId) {
      if (!this.threadId) return { sessionId: null, prompt: '' }
      const res = await this.server.request<{ thread?: { id?: string } }>('thread/fork', { threadId: this.threadId, excludeTurns: true })
      return { sessionId: res.thread?.id ?? null, prompt: '' }
    }
    const items = this.transcript.items
    const at = items.findIndex((x) => x.id === itemId && x.kind === 'user')
    const prompt = at >= 0 && items[at]?.kind === 'user' ? (items[at] as { text: string }).text : ''
    let lastTurnId: string | undefined
    for (let i = at - 1; i >= 0 && !lastTurnId; i--) {
      const x = items[i]
      if (x?.kind === 'user' && x.turnId) lastTurnId = x.turnId
    }
    if (!this.threadId || !lastTurnId) return { sessionId: null, prompt }
    const res = await this.server.request<{ thread?: { id?: string } }>('thread/fork', { threadId: this.threadId, lastTurnId, excludeTurns: true })
    return { sessionId: res.thread?.id ?? null, prompt }
  }

  /**
   * A side question (the extension's side chat): an ephemeral fork of this
   * thread answers it, read-only and without approvals, and is dropped after.
   * The main thread is never interrupted.
   */
  async sideQuestion(question: string): Promise<string | null> {
    if (!this.threadId) throw new Error('Send a message first — a side question is asked about the conversation so far')
    const fork = await this.server.request<{ thread?: { id?: string } }>('thread/fork', { threadId: this.threadId, ephemeral: true, excludeTurns: true })
    const forkId = fork.thread?.id
    if (!forkId) return null
    return new Promise<string | null>((resolve) => {
      let answer = ''
      const done = (text: string | null) => {
        clearTimeout(timer)
        this.server.off('notification', listen)
        this.server.off('server-request', refuse)
        void this.server.request('thread/unsubscribe', { threadId: forkId }).catch(() => undefined)
        resolve(text)
      }
      const listen = (n: Notification) => {
        const p = (n.params ?? {}) as any
        if (p.threadId !== forkId) return
        if (n.method === 'item/completed' && p.item?.type === 'agentMessage' && p.item.text) answer = p.item.text
        if (n.method === 'turn/completed') done(answer.trim() || null)
      }
      // The fork must not act: anything it asks to do is declined.
      const refuse = (r: ServerRequest) => {
        const p = (r.params ?? {}) as any
        if ((p.threadId ?? p.conversationId) !== forkId) return
        if (APPROVAL_METHODS.has(r.method)) this.server.respond(r.id, approvalResponse(r.method, 'deny', r.params))
        else this.server.respondError(r.id, 'not available in a side question')
      }
      const timer = setTimeout(() => done(answer.trim() || null), 120_000)
      this.server.on('notification', listen)
      this.server.on('server-request', refuse)
      this.server.startTurn(forkId, userInputs(SIDE_PREFIX + question), {
        approvalPolicy: 'never', sandboxPolicy: { type: 'readOnly', networkAccess: false }, effort: 'low', summary: 'none'
      }).catch(() => done(null))
    })
  }

  async rename(title: string): Promise<void> {
    if (!this.threadId) throw new Error('The thread has no id yet — send a message first')
    await this.server.request('thread/name/set', { threadId: this.threadId, name: title })
    this.update({ ...this.transcript, title })
  }

  /** Compact the thread's context now (`thread/compact/start`); a contextCompaction item reports it. */
  async compact(): Promise<void> {
    if (!this.threadId) return
    this.update({ ...this.transcript, activity: 'compacting' })
    try {
      await this.server.request('thread/compact/start', { threadId: this.threadId })
    } catch (err) {
      this.update({ ...this.transcript, activity: null })
      throw err
    }
  }

  /** The context as the pane's breakdown shows it: the last call's tokens against the window, plus the plan's rate limits. */
  async contextUsage(): Promise<ContextUsage> {
    await this.readLimits()
    const t = this.transcript
    const used = t.usage.contextTokens ?? 0
    const max = t.usage.contextWindow ?? 0
    return {
      total: used, max, percent: max ? Math.round((used / max) * 100) : 0,
      categories: max ? [{ name: 'Conversation', tokens: used, kind: 'messages' }, { name: 'Free space', tokens: Math.max(0, max - used), kind: 'free' }] : [],
      memoryFiles: [], limits: t.limits
    }
  }

  /** `/status`: the chat id, the model, the context and the rate limits as one row (composer.statusPlain.*). */
  async status(): Promise<void> {
    await this.readLimits()
    const t = this.transcript
    const used = t.usage.contextTokens
    const max = t.usage.contextWindow
    const lines = [
      `Session: ${t.sessionId ?? 'not started'}`,
      `Model: ${t.model ?? 'default'}${t.effort ? ` · ${t.effort}` : ''}`,
      used && max ? `Context: ${Math.max(0, 100 - Math.round((used / max) * 100))}% left (${fmtTokens(used)} used / ${fmtTokens(max)})` : 'Context: nothing used yet',
      ...limitLines(t.limits)
    ]
    this.update(appendItem(t, { kind: 'system', id: `status:${Date.now()}`, text: 'Status', level: 'info', at: Date.now(), variant: 'status', detail: lines.join('\n') }))
  }

  /** MCP servers as the panel lists them (`mcpServerStatus/list`). Codex keeps their switches in config.toml, so the panel only reads. */
  async mcp(req: McpRequest): Promise<McpServer[]> {
    if (req.op !== 'list') throw new Error('Codex keeps its MCP servers in config.toml — change them there or with `codex mcp` in a terminal')
    const res = await this.server.request<{ data?: any[] }>('mcpServerStatus/list', { detail: 'toolsAndAuthOnly', limit: 100, ...(this.threadId ? { threadId: this.threadId } : {}) })
    return (res.data ?? []).map((s) => ({
      name: String(s.name),
      status: s.runtimeStatus === 'connected' ? 'connected' : s.runtimeStatus === 'failed' || s.toolsError ? 'failed' : s.runtimeStatus === 'authenticationRequired' || s.authStatus === 'notLoggedIn' ? 'needs-auth' : s.runtimeStatus === 'disabled' ? 'disabled' : 'pending',
      ...(s.toolsError ? { error: String(s.toolsError) } : {}),
      tools: Object.keys(s.tools ?? {}).length
    }))
  }

  /** Background terminals still running after their command row (experimental `thread/backgroundTerminals/list`), debounced. */
  private refreshBackground(): void {
    if (!this.threadId) return
    if (this.backgroundTimer) clearTimeout(this.backgroundTimer)
    this.backgroundTimer = setTimeout(() => {
      this.backgroundTimer = null
      this.server.request<{ data?: any[] }>('thread/backgroundTerminals/list', { threadId: this.threadId, limit: 50 })
        .then((res) => {
          const background = (res.data ?? []).map((b) => ({ id: String(b.processId), description: firstLine(String(b.command ?? ''), 80), type: 'terminal', toolUseId: b.itemId ? String(b.itemId) : undefined }))
          if (JSON.stringify(background) !== JSON.stringify(this.transcript.background)) this.update({ ...this.transcript, background })
        })
        .catch(() => { /* a server without the experimental API */ })
    }, 600)
  }

  /** Stop a background terminal (`thread/backgroundTerminals/terminate`). */
  async stopTask(processId: string): Promise<void> {
    if (!this.threadId) return
    await this.server.request('thread/backgroundTerminals/terminate', { threadId: this.threadId, processId })
    this.refreshBackground()
  }

  /** Ask for the suggested next prompt after a turn (experimental `thread/prediction/request`); it arrives as `thread/prediction/updated`. */
  private async requestPrediction(turnId: string | undefined): Promise<void> {
    if (!turnId || !this.threadId) return
    await this.server.request('thread/prediction/request', { threadId: this.threadId, sourceTurnId: turnId }).catch(() => undefined)
  }

  /**
   * The unified diff a turn made, for Undo and Reapply: the server's
   * aggregated `turn/diff/updated` when this session saw the turn, else one
   * rebuilt from the turn's file changes (a stored thread carries no turn
   * diff). Paths are relative to the thread's folder.
   */
  turnDiff(turnItemId: string): string | null {
    const items = this.transcript.items
    const end = items.findIndex((x) => x.id === turnItemId)
    const turn = items[end]
    if (!turn || turn.kind !== 'turn') return null
    if (turn.turnId && this.turnDiffs.has(turn.turnId)) return this.turnDiffs.get(turn.turnId)!
    let start = end
    while (start > 0 && (items[start - 1]!.kind !== 'user' || (items[start - 1] as { steered?: boolean }).steered)) start--
    const patches: string[] = []
    for (const x of items.slice(start, end)) {
      if (x.kind !== 'tool' || x.view !== 'edit' || x.status !== 'done') continue
      for (const e of x.edits ?? []) {
        const p = filePatch(relTo(e.path || x.path || '', this.transcript.cwd), e.kind, e.diff ?? '')
        if (p) patches.push(p)
      }
    }
    return patches.length ? patches.join('') : null
  }

  /** Mark a turn's footer undone (or reapplied). */
  markUndone(turnItemId: string, undone: boolean): void {
    this.update(updateItem(this.transcript, turnItemId, (x) => (x.kind === 'turn' ? { ...x, undone } : x)))
  }

  /** Pick a model, an effort, a preset, Fast or plan mode; they ride on the next `turn/start` (plan mode on `thread/settings/update`). */
  async configure(patch: ChatConfigPatch): Promise<void> {
    let t = this.transcript
    if (patch.model !== undefined && patch.model !== null && patch.model !== t.model) {
      // Changing models mid-conversation is the extension's one warning (localConversation.modelChanged).
      if (t.items.some((x) => x.kind === 'user') && t.model) {
        const label = (id: string) => this.server.cachedModels()?.find((m) => m.id === id || m.model === id)?.label ?? id
        t = appendItem(t, { kind: 'system', id: `model:${Date.now()}`, text: `Model changed from ${label(t.model)} to ${label(patch.model)}.`, level: 'info', at: Date.now(), variant: 'model', detail: 'Changing models mid-conversation can degrade performance, and the context may compact automatically.' })
      }
      this.overrides.model = patch.model
      t = { ...t, model: patch.model }
    }
    if (patch.effort !== undefined) {
      this.overrides.effort = patch.effort
      t = { ...t, effort: patch.effort ?? null }
    }
    if (patch.permissionMode !== undefined && patch.permissionMode !== null && patch.permissionMode !== 'custom') {
      const mode = CODEX_MODES.find((m) => m.id === patch.permissionMode)
      if (!mode) throw new Error(`unknown Codex mode ${patch.permissionMode}`)
      this.overrides.mode = mode
      t = { ...t, permissionMode: mode.id }
    }
    if (patch.fastMode !== undefined) {
      this.overrides.serviceTier = patch.fastMode ? 'priority' : 'default'
      t = { ...t, fastMode: patch.fastMode ? 'on' : 'off' }
    }
    this.update(t)
    if (patch.planMode !== undefined) {
      if (!this.threadId) await this.open()
      const model = this.overrides.model ?? this.transcript.model
      await this.server.request('thread/settings/update', {
        threadId: this.threadId,
        collaborationMode: { mode: patch.planMode ? 'plan' : 'default', settings: { model, reasoning_effort: this.overrides.effort ?? this.transcript.effort ?? null, developer_instructions: null } }
      })
      this.update({ ...this.transcript, planMode: patch.planMode, ...(patch.planMode ? {} : { pendingPlan: null }) })
    }
  }

  /** The composer's menus: the extension's permission set, Fast where the model has the tier, plan mode, the pane's slash commands. */
  async options(): Promise<ChatOptions> {
    const models = await this.server.listModels().catch(() => [])
    const current = models.find((m) => m.id === this.transcript.model || m.model === this.transcript.model)
    const modes = CODEX_MODES.map(({ id, label, description, confirm }) => ({ id, label, description, ...(confirm ? { confirm } : {}) }))
    if (this.transcript.permissionMode === 'custom') modes.push(CUSTOM_MODE)
    return {
      models, modes, commands: CODEX_COMMANDS, planMode: true, shell: true,
      fastMode: !!current?.fastMode, ...(current?.fastLabel ? { fastLabel: current.fastLabel } : {})
    }
  }

  answer(approvalId: string, choice: ApprovalChoice): void {
    const req = this.approvals.get(approvalId)
    if (!req) return
    this.approvals.delete(approvalId)
    this.server.respond(req.id, approvalResponse(req.method, choice, req.params))
    this.update(decideApproval(this.transcript, approvalId, choice))
  }

  /** Answers by question id; `null` dismisses (declines) the request. */
  answerQuestion(questionId: string, answers: Record<string, string[]> | null): void {
    const req = this.questions.get(questionId)
    if (!req) return
    this.questions.delete(questionId)
    const p = (req.params ?? {}) as any
    this.server.respond(req.id, questionResponse(req, answers))
    if (p.mode === 'url' && answers?.url?.[0] === 'Open in browser' && typeof p.url === 'string') this.emit('open-url', p.url)
    this.update(answerQuestionItem(this.transcript, questionId, answers))
  }

  dispose(): void {
    if (this.backgroundTimer) clearTimeout(this.backgroundTimer)
    this.server.off('notification', this.onNotification)
    this.server.off('server-request', this.onRequest)
    this.server.off('exit', this.onExit)
    for (const [id, req] of this.approvals) {
      this.server.respond(req.id, approvalResponse(req.method, 'cancel', req.params))
      this.approvals.delete(id)
    }
    for (const [id, req] of this.questions) {
      this.server.respond(req.id, questionResponse(req, null))
      this.questions.delete(id)
    }
  }
}

/** A turn diff kept for Undo is bounded. */
const MAX_DIFF = 4 * 1024 * 1024
