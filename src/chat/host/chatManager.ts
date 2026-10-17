// The host side of `ChatBridge`: owns every live chat process the way
// claude-watch's `TerminalManager` owns PTYs. Codex panes share one
// app-server connection (own child, or the user's daemon through the proxy,
// per `codexMode`); each Claude pane is its own `claude` process. Imports no
// Electron — main wraps it in `chat:*` IPC routes, a Node harness calls it
// directly.
import { EventEmitter } from 'node:events'
import { randomUUID } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ClaudeSession, listClaudeSessions, loadClaudeTranscript } from '../claude/session'
import { CodexAppServer, CodexThread, type CodexServerMode } from '../codex/appServer'
import { emptyTranscript, type ApprovalChoice, type Attachment, type ChatItemApproval, type ChatItemQuestion, type Provider, type SessionSummary, type Transcript } from '../shared/chatModel.mjs'
import type { ChatBridge, ChatCreateRequest } from '../ui/bridge'

export interface ChatManagerOptions {
  /** Extra environment for every spawned CLI (claude-watch passes its daemon endpoint file and a pane id). */
  envFor?: (chatId: string, provider: Provider) => Record<string, string>
  log?: (line: string) => void
  codexPath?: string
  codexMode?: CodexServerMode
  claudePath?: string | null
  /** Where pasted images are written for Codex (`localImage` takes a path). Default: the OS temp dir. */
  scratchDir?: string
}

interface Live {
  id: string
  provider: Provider
  cwd: string
  claude?: ClaudeSession
  codex?: CodexThread
}

const MAX_IMAGE_BYTES = 20 * 1024 * 1024
const EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' }

/**
 * Events: `change` (id, transcript), `approval` (id, item), `question` (id,
 * item) — main forwards them to the renderer and raises attention for the
 * last two — and `open-url` (id, url) for a browser elicitation the user accepted.
 */
export class ChatManager extends EventEmitter implements ChatBridge {
  private live = new Map<string, Live>()
  private codex: CodexAppServer | null = null
  private readonly options: ChatManagerOptions

  constructor(options: ChatManagerOptions = {}) {
    super()
    this.options = options
  }

  private server(): CodexAppServer {
    if (this.codex?.alive) return this.codex
    const server = new CodexAppServer({ codexPath: this.options.codexPath, mode: this.options.codexMode ?? 'own', log: this.options.log })
    server.on('exit', () => {
      if (this.codex === server) this.codex = null
    })
    this.codex = server
    return server
  }

  /** How the Codex connection reached a server, once it has. */
  codexTransport(): 'own' | 'daemon' | null {
    return this.codex?.transport ?? null
  }

  async create(req: ChatCreateRequest): Promise<{ id: string; transcript: Transcript }> {
    const id = randomUUID()
    const env = this.options.envFor?.(id, req.provider) ?? {}
    if (req.provider === 'claude') {
      const transcript = req.resume ? await loadClaudeTranscript(req.resume, req.cwd).catch(() => undefined) : undefined
      const session = new ClaudeSession({ cwd: req.cwd, resume: req.resume ?? null, model: req.model ?? null, env, claudePath: this.options.claudePath, log: this.options.log }, transcript)
      session.on('change', (t: Transcript) => this.emit('change', id, t))
      session.on('approval', (a: ChatItemApproval) => this.emit('approval', id, a))
      session.on('question', (q: ChatItemQuestion) => this.emit('question', id, q))
      session.on('exit', () => this.emit('change', id, session.transcript))
      this.live.set(id, { id, provider: 'claude', cwd: req.cwd, claude: session })
      // Spawn now so the init message (session id, model) arrives before the first send.
      session.start()
      return { id, transcript: session.transcript }
    }
    const server = this.server()
    const transcript = req.resume ? await server.readTranscript(req.resume) : emptyTranscript('codex', { cwd: req.cwd, model: req.model ?? null })
    const thread = new CodexThread(server, transcript)
    thread.on('change', (t: Transcript) => this.emit('change', id, t))
    thread.on('approval', (a: ChatItemApproval) => this.emit('approval', id, a))
    thread.on('question', (q: ChatItemQuestion) => this.emit('question', id, q))
    thread.on('open-url', (url: string) => this.emit('open-url', id, url))
    this.live.set(id, { id, provider: 'codex', cwd: req.cwd, codex: thread })
    await thread.open({ model: req.model ?? null })
    return { id, transcript: thread.transcript }
  }

  async get(id: string): Promise<Transcript | null> {
    const l = this.live.get(id)
    return l?.claude?.transcript ?? l?.codex?.transcript ?? null
  }

  async send(id: string, text: string, attachments: Attachment[] = []): Promise<void> {
    const l = this.must(id)
    const list = attachments.filter((a) => a.kind === 'file' || (a.kind === 'image' && a.data.length * 0.75 <= MAX_IMAGE_BYTES))
    if (l.claude) l.claude.send(text, list)
    else await l.codex!.send(text, this.materialize(list))
  }

  /** Codex takes images by path: write pasted bytes to the scratch folder once. */
  private materialize(list: Attachment[]): Attachment[] {
    const dir = join(this.options.scratchDir ?? tmpdir(), 'tm-chat-panes')
    return list.map((a) => {
      if (a.kind !== 'image' || a.path) return a
      mkdirSync(dir, { recursive: true })
      const path = join(dir, `${randomUUID()}.${EXT[a.mime] ?? 'png'}`)
      writeFileSync(path, Buffer.from(a.data, 'base64'))
      return { ...a, path }
    })
  }

  async interrupt(id: string): Promise<void> {
    const l = this.must(id)
    if (l.claude) await l.claude.interrupt()
    else await l.codex!.interrupt()
  }

  async answer(id: string, approvalId: string, choice: ApprovalChoice): Promise<void> {
    const l = this.must(id)
    if (l.claude) l.claude.answer(approvalId, choice)
    else l.codex!.answer(approvalId, choice)
  }

  async answerQuestion(id: string, questionId: string, answers: Record<string, string[]> | null): Promise<void> {
    const l = this.must(id)
    if (l.claude) l.claude.answerQuestion(questionId, answers)
    else l.codex!.answerQuestion(questionId, answers)
  }

  async close(id: string): Promise<void> {
    const l = this.live.get(id)
    if (!l) return
    this.live.delete(id)
    l.claude?.close()
    l.codex?.dispose()
    if (![...this.live.values()].some((x) => x.provider === 'codex') && this.codex) {
      this.codex.close()
      this.codex = null
    }
  }

  onChange(cb: (id: string, transcript: Transcript) => void): () => void {
    this.on('change', cb)
    return () => this.off('change', cb)
  }

  async listSessions(provider: Provider, cwd?: string): Promise<SessionSummary[]> {
    if (provider === 'claude') return listClaudeSessions({ cwd })
    const { sessions } = await this.server().listThreads({ cwd, limit: 100 })
    return sessions
  }

  async loadTranscript(provider: Provider, sessionId: string, cwd: string): Promise<Transcript> {
    if (provider === 'claude') return loadClaudeTranscript(sessionId, cwd)
    return this.server().readTranscript(sessionId)
  }

  /** Every live chat, for the host's status and for quit. */
  list(): { id: string; provider: Provider; cwd: string; sessionId: string | null; status: string }[] {
    return [...this.live.values()].map((l) => {
      const t = l.claude?.transcript ?? l.codex!.transcript
      return { id: l.id, provider: l.provider, cwd: l.cwd, sessionId: t.sessionId, status: t.status }
    })
  }

  /** Kill everything (app quit). Sessions stay resumable from disk. */
  closeAll(): void {
    for (const id of [...this.live.keys()]) void this.close(id)
    this.codex?.close()
    this.codex = null
  }

  private must(id: string): Live {
    const l = this.live.get(id)
    if (!l) throw new Error(`no live chat ${id}`)
    return l
  }
}
