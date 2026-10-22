// The host side of `ChatBridge`: owns every live chat process the way
// claude-watch's `TerminalManager` owns PTYs. Codex panes share one
// app-server connection (own child, or the user's daemon through the proxy,
// per `codexMode`); each Claude pane is its own `claude` process. Imports no
// Electron — main wraps it in `chat:*` IPC routes, a Node harness calls it
// directly.
import { spawnSync } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { randomUUID } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ClaudeSession, listClaudeSessions, loadClaudeTranscript } from '../claude/session'
import { completeDraft } from '../claude/complete'
import type { AdoptProcess } from '../shared/processTree.mjs'
import { CodexAppServer, CodexThread, type CodexServerMode } from '../codex/appServer'
import {
  emptyTranscript,
  type ApprovalChoice, type Attachment, type ChatConfigPatch, type ChatItemApproval, type ChatItemQuestion, type ChatOptions, type ContextUsage, type McpRequest, type McpServer,
  type Provider, type ReviewTarget, type RewindResult, type SessionSummary, type Transcript, type UndoResult
} from '../shared/chatModel.mjs'
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
  /** Keep everything each CLI starts together, so closing a chat ends its MCP servers too (claude-watch: a Windows job). */
  adoptProcess?: AdoptProcess
  /** Offer Claude's *Bypass* mode (`ClaudeSessionOptions.allowBypass`): off unless the host says so. */
  allowBypass?: boolean
  /** The permission mode a new Claude chat starts in when the request names none (the user's own default, set in the mode menu, still wins). */
  defaultMode?: string
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
  private readonly config: ChatManagerOptions

  constructor(options: ChatManagerOptions = {}) {
    super()
    this.config = options
  }

  private server(): CodexAppServer {
    if (this.codex?.alive) return this.codex
    const server = new CodexAppServer({ codexPath: this.config.codexPath, mode: this.config.codexMode ?? 'own', log: this.config.log, adoptProcess: this.config.adoptProcess })
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
    const env = this.config.envFor?.(id, req.provider) ?? {}
    if (req.provider === 'claude') {
      const transcript = req.resume ? await loadClaudeTranscript(req.resume, req.cwd).catch(() => undefined) : undefined
      const wanted = req.permissionMode ?? this.config.defaultMode
      const permissionMode = wanted ? (wanted as ConstructorParameters<typeof ClaudeSession>[0]['permissionMode']) : undefined
      const session = new ClaudeSession({ cwd: req.cwd, resume: req.resume ?? null, model: req.model ?? null, permissionMode, env, claudePath: this.config.claudePath, log: this.config.log, adoptProcess: this.config.adoptProcess, allowBypass: this.config.allowBypass }, transcript)
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
    let transcript = emptyTranscript('codex', { cwd: req.cwd, model: req.model ?? null })
    if (req.resume) {
      try {
        transcript = await server.readTranscript(req.resume)
      } catch (err) {
        // A thread nobody sent a message to is never written to disk, so after a restart Codex cannot read or
        // resume it ("thread not loaded", "no rollout found"). The pane starts a new one and says why, rather
        // than failing to start at all (the debug profile's Codex pane was stuck this way until 2026-10-21).
        this.config.log?.(`[chat] codex thread ${req.resume} could not be read: ${(err as Error)?.message ?? err}`)
        transcript = {
          ...transcript,
          items: [{ kind: 'system', id: `resume-lost:${req.resume}`, level: 'info', at: Date.now(), variant: 'notice', text: 'The earlier Codex thread was never saved (it had no messages), so this is a new one.' }]
        }
      }
    }
    const thread = new CodexThread(server, transcript)
    thread.on('change', (t: Transcript) => this.emit('change', id, t))
    thread.on('approval', (a: ChatItemApproval) => this.emit('approval', id, a))
    thread.on('question', (q: ChatItemQuestion) => this.emit('question', id, q))
    thread.on('open-url', (url: string) => this.emit('open-url', id, url))
    this.live.set(id, { id, provider: 'codex', cwd: req.cwd, codex: thread })
    await thread.open({ model: req.model ?? null })
    if (req.permissionMode) await thread.configure({ permissionMode: req.permissionMode }).catch(() => { /* not a Codex preset */ })
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
    const dir = join(this.config.scratchDir ?? tmpdir(), 'tm-chat-panes')
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

  async answer(id: string, approvalId: string, choice: ApprovalChoice, message?: string): Promise<void> {
    const l = this.must(id)
    if (l.claude) l.claude.answer(approvalId, choice, message)
    else l.codex!.answer(approvalId, choice)
  }

  async removeQueued(id: string, itemId: string): Promise<boolean> {
    const l = this.must(id)
    return l.claude ? l.claude.removeQueued(itemId) : l.codex!.removeQueued(itemId)
  }

  async steer(id: string, itemId: string): Promise<void> {
    await this.codexThread(id, 'Claude Code reads a queued message after its current step').steer(itemId)
  }

  async resumeQueue(id: string): Promise<void> {
    await this.codexThread(id, 'Claude Code’s queue never pauses').resumeQueue()
  }

  async shell(id: string, command: string): Promise<void> {
    await this.codexThread(id, 'Type ! commands in TaylorMade Codex; in TaylorMade CC, ! is a CLI mode').shell(command)
  }

  async review(id: string, target: ReviewTarget): Promise<void> {
    await this.codexThread(id, 'In Claude Code, /review is a slash command').review(target)
  }

  async status(id: string): Promise<void> {
    await this.codexThread(id, 'In Claude Code, /status is a slash command').status()
  }

  /**
   * Undo (or with `reapply`, redo) the file changes of one finished Codex turn
   * by reverse-applying its diff with `git apply` in the chat's folder — the
   * Codex extension's Undo, which also needs a Git repository. Answers a plain
   * sentence either way.
   */
  async undoTurn(id: string, turnItemId: string, reapply = false): Promise<UndoResult> {
    const l = this.must(id)
    const thread = this.codexThread(id, 'Claude Code rewinds code from a prompt’s menu instead')
    const diff = thread.turnDiff(turnItemId)
    if (!diff) return { ok: false, message: 'That turn changed no files Codex can undo.' }
    const git = (args: string[]) => spawnSync('git', args, { cwd: l.cwd, input: diff, encoding: 'utf8', windowsHide: true, timeout: 15_000 })
    const inside = spawnSync('git', ['rev-parse', '--is-inside-work-tree'], { cwd: l.cwd, encoding: 'utf8', windowsHide: true, timeout: 5000 })
    if (inside.status !== 0) return { ok: false, message: `${reapply ? 'Reapply' : 'Undo'} needs a Git repository.` }
    const args = ['apply', '--whitespace=nowarn', ...(reapply ? [] : ['-R'])]
    const check = git([...args, '--check', '-'])
    if (check.status !== 0) {
      const why = (check.stderr || check.stdout || '').trim().split(/\r?\n/)[0] ?? ''
      return { ok: false, message: `Could not ${reapply ? 'reapply' : 'undo'} the changes: the files changed since. ${why}`.trim() }
    }
    const run = git([...args, '-'])
    if (run.status !== 0) return { ok: false, message: (run.stderr || 'git apply failed').trim().split(/\r?\n/)[0]! }
    thread.markUndone(turnItemId, !reapply)
    return { ok: true, message: reapply ? 'Changes reapplied.' : 'Changes reverted.' }
  }

  async rewind(id: string, itemId: string, dryRun: boolean): Promise<RewindResult> {
    return this.claude(id, 'Codex keeps no file checkpoints, so there is no code to rewind').rewind(itemId, dryRun)
  }

  async fork(id: string, itemId?: string): Promise<{ sessionId: string | null; prompt: string }> {
    const l = this.must(id)
    if (l.claude) {
      if (!itemId) throw new Error('Fork TaylorMade CC from a prompt’s menu')
      return l.claude.fork(itemId)
    }
    return l.codex!.fork(itemId)
  }

  async sideQuestion(id: string, question: string): Promise<string | null> {
    const l = this.must(id)
    return l.claude ? l.claude.sideQuestion(question) : l.codex!.sideQuestion(question)
  }

  async contextUsage(id: string): Promise<ContextUsage> {
    const l = this.must(id)
    return l.claude ? l.claude.contextUsage() : l.codex!.contextUsage()
  }

  async mcp(id: string, req: McpRequest): Promise<McpServer[]> {
    const l = this.must(id)
    return l.claude ? l.claude.mcp(req) : l.codex!.mcp(req)
  }

  async background(id: string, toolUseId?: string): Promise<boolean> {
    return this.claude(id, 'Codex starts its own background terminals; stop them from the background menu').background(toolUseId)
  }

  async stopTask(id: string, taskId: string): Promise<void> {
    const l = this.must(id)
    if (l.claude) await l.claude.stopTask(taskId)
    else await l.codex!.stopTask(taskId)
  }

  async rename(id: string, title: string): Promise<void> {
    const l = this.must(id)
    if (l.claude) await l.claude.rename(title)
    else await l.codex!.rename(title)
  }

  async compact(id: string): Promise<void> {
    const l = this.must(id)
    if (l.claude) l.claude.send('/compact')
    else await l.codex!.compact()
  }

  /** Answer one of Claude Code's user dialogs (Codex has none); `null` dismisses it. */
  async answerDialog(id: string, dialogId: string, result: string | null): Promise<void> {
    this.must(id).claude?.answerDialog(dialogId, result)
  }

  async answerQuestion(id: string, questionId: string, answers: Record<string, string[]> | null): Promise<void> {
    const l = this.must(id)
    if (l.claude) l.claude.answerQuestion(questionId, answers)
    else l.codex!.answerQuestion(questionId, answers)
  }

  async configure(id: string, patch: ChatConfigPatch): Promise<void> {
    const l = this.must(id)
    if (l.claude) await l.claude.configure(patch)
    else await l.codex!.configure(patch)
  }

  async options(id: string): Promise<ChatOptions> {
    const l = this.must(id)
    return l.claude ? l.claude.options() : l.codex!.options()
  }

  /** Claude: an editable copy of a built-in output style, written to the user's style folder; its path. */
  /**
   * The composer's auto-complete (Shift+Tab): a one-shot Haiku call beside the session, for a Claude or a Codex
   * pane alike, with the conversation's last reply as context. The continuation, or '' when there was none.
   */
  async complete(id: string, draft: string): Promise<string> {
    const l = this.must(id)
    const t = (l.claude ?? l.codex)!.transcript
    const last = [...t.items].reverse().find((x) => x.kind === 'assistant' && 'text' in x && x.text) as { text: string } | undefined
    return completeDraft({
      cwd: l.cwd, draft, context: last?.text ?? null, claudePath: this.config.claudePath,
      env: this.config.envFor?.(id, l.provider), adoptProcess: this.config.adoptProcess, log: this.config.log
    })
  }

  async duplicateStyle(id: string, name: string): Promise<string> {
    const l = this.must(id)
    if (!l.claude) throw new Error('Codex has no output styles')
    return l.claude.duplicateStyle(name)
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

  /** The live Codex thread behind `id`, or `why` as the error when it is a Claude chat. */
  private codexThread(id: string, why: string): CodexThread {
    const l = this.must(id)
    if (!l.codex) throw new Error(why)
    return l.codex
  }

  /** The live Claude session behind `id`, or `why` as the error when it is a Codex chat. */
  private claude(id: string, why: string): ClaudeSession {
    const l = this.must(id)
    if (!l.claude) throw new Error(why)
    return l.claude
  }
}
