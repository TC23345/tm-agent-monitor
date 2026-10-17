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
  approvalResponse, foldNotification, foldServerRequest, foldTurnItems, questionResponse, threadSummary, threadToTranscript
} from './fold.mjs'
import { LineSplitter, PendingCalls, errorResponseLine, notificationLine, parseIncoming, requestLine, responseLine, type Incoming } from './rpc.mjs'
import {
  answerQuestion as answerQuestionItem, decideApproval, setStatus, summarizeAttachments,
  type ApprovalChoice, type Attachment, type SessionSummary, type Transcript
} from '../shared/chatModel.mjs'
import { resolveCodex } from '../shared/findCli.mjs'

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
      capabilities: null
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

  startTurn(threadId: string, input: unknown[], opts: { model?: string | null; effort?: string | null; cwd?: string | null } = {}): Promise<{ turn: any }> {
    return this.request('turn/start', { threadId, input, model: opts.model ?? null, effort: opts.effort ?? null, cwd: opts.cwd ?? null })
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
    const killer = setTimeout(() => {
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
  private approvals = new Map<string, ServerRequest>()
  private questions = new Map<string, ServerRequest>()
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
    if (n.method === 'turn/started' && p.threadId === this.threadId) this.turnId = p.turn?.id ?? this.turnId
    if (n.method === 'turn/completed' && p.threadId === this.threadId) this.turnId = null
    this.update(foldNotification(this.transcript, n))
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

  /** Start a fresh thread or rejoin the transcript's. */
  async open(opts: Omit<StartThreadOptions, 'cwd'> = {}): Promise<void> {
    const cwd = this.transcript.cwd
    const res = this.threadId ? await this.server.resumeThread(this.threadId, { cwd, ...opts }) : await this.server.startThread({ cwd, ...opts })
    this.threadId = res.thread?.id ?? this.threadId
    this.update({ ...this.transcript, sessionId: this.threadId, model: res.model ?? this.transcript.model, title: res.thread?.name ?? this.transcript.title })
  }

  async send(text: string, attachments: Attachment[] = [], opts: { model?: string | null; effort?: string | null } = {}): Promise<void> {
    if (!this.threadId) await this.open()
    const at = Date.now()
    this.update(setStatus({ ...this.transcript, items: [...this.transcript.items, { kind: 'user', id: `local:${at}`, text, attachments: summarizeAttachments(attachments), at }] }, 'running'))
    try {
      const res = await this.server.startTurn(this.threadId!, userInputs(text, attachments), opts)
      this.turnId = res.turn?.id ?? this.turnId
    } catch (err) {
      this.update(setStatus(this.transcript, 'error', (err as Error).message))
      throw err
    }
  }

  async interrupt(): Promise<void> {
    if (!this.threadId || !this.turnId) return
    await this.server.interruptTurn(this.threadId, this.turnId)
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
