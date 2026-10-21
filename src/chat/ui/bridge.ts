// What the pane needs from its host. In claude-watch the host is the sandboxed
// preload over `chat:*` IPC routes (main owns the processes, exactly as it
// owns the PTYs); in a plain Node harness it is the clients themselves.
import type {
  ApprovalChoice, Attachment, ChatConfigPatch, ChatOptions, ContextUsage, McpRequest, McpServer, Provider, ReviewTarget, RewindResult, SessionSummary, Transcript, UndoResult
} from '../shared/chatModel.mjs'

export interface ChatCreateRequest {
  provider: Provider
  cwd: string
  /** Resume this provider session id; omit for a new one. */
  resume?: string | null
  model?: string | null
  /** Start in this permission mode (a fork keeps the mode of the session it came from). */
  permissionMode?: string | null
}

export interface ChatBridge {
  /** Start (or reattach to) a live session; `id` is the host's handle, not the provider's session id. */
  create(req: ChatCreateRequest): Promise<{ id: string; transcript: Transcript }>
  /** The current transcript of a live session, or null when the host no longer has it (an app restart). */
  get(id: string): Promise<Transcript | null>
  send(id: string, text: string, attachments?: Attachment[]): Promise<void>
  interrupt(id: string): Promise<void>
  /** `message`: with `deny`, what the user told the agent to do instead. */
  answer(id: string, approvalId: string, choice: ApprovalChoice, message?: string): Promise<void>
  /** Answers by question id; `null` dismisses the question. */
  answerQuestion(id: string, questionId: string, answers: Record<string, string[]> | null): Promise<void>
  /** One of Claude Code's user dialogs (a refusal's fallback, Fable credits, auto mode's fallback): its card's result, or `null` to dismiss. */
  answerDialog?(id: string, dialogId: string, result: string | null): Promise<void>
  /** Change the live session's model, effort, permission mode, fast mode or output style (the composer's chips); the transcript push reflects it. */
  configure(id: string, patch: ChatConfigPatch): Promise<void>
  /** What the composer's menus offer: models with their efforts, modes, slash commands, output styles. Fetched on demand. */
  options(id: string): Promise<ChatOptions>
  close(id: string): Promise<void>
  /** Transcript pushes; returns the unsubscribe. */
  onChange(cb: (id: string, transcript: Transcript) => void): () => void
  listSessions(provider: Provider, cwd?: string): Promise<SessionSummary[]>
  loadTranscript(provider: Provider, sessionId: string, cwd: string): Promise<Transcript>

  /** Take back a prompt still waiting in the queue; true when the agent dropped it. */
  removeQueued(id: string, itemId: string): Promise<boolean>
  /** Rewind the files changed since a prompt (Claude), or say what that would change (`dryRun`). */
  rewind(id: string, itemId: string, dryRun: boolean): Promise<RewindResult>
  /** Fork the conversation up to just before a prompt; `sessionId` null when it was the first one. Codex: without `itemId`, the whole thread (*Continue in new chat*). */
  fork(id: string, itemId?: string): Promise<{ sessionId: string | null; prompt: string }>
  /** Ask beside the turn without joining it (Claude's side question, Codex's ephemeral side chat); null when there was no answer. */
  sideQuestion(id: string, question: string): Promise<string | null>
  /** The context window by category (Claude), or used against free with the plan's rate limits (Codex). */
  contextUsage(id: string): Promise<ContextUsage>
  /** The session's MCP servers, after an optional toggle or reconnect (Claude); Codex only lists. */
  mcp(id: string, req: McpRequest): Promise<McpServer[]>
  /** Codex: send a queued prompt into the running turn now (`turn/steer`). */
  steer(id: string, itemId: string): Promise<void>
  /** Codex: send the queue's head after an interrupt paused it. */
  resumeQueue(id: string): Promise<void>
  /** Codex: run a `!` shell line through `thread/shellCommand`. */
  shell(id: string, command: string): Promise<void>
  /** Codex: `/review` of the uncommitted changes or against a base branch. */
  review(id: string, target: ReviewTarget): Promise<void>
  /** Codex: `/status` as a row in the transcript. */
  status(id: string): Promise<void>
  /** Codex: undo (or reapply) one finished turn's file changes with `git apply`; the answer is a sentence for the notice. */
  undoTurn(id: string, turnItemId: string, reapply?: boolean): Promise<UndoResult>
  /** Move a running command or agent to the background (Claude); all of them without `toolUseId`. False when it was not a running task. */
  background(id: string, toolUseId?: string): Promise<boolean>
  /** Stop one background task (Claude). */
  stopTask(id: string, taskId: string): Promise<void>
  /** Name the session. */
  rename(id: string, title: string): Promise<void>
  /** Compact the context now. */
  compact(id: string): Promise<void>
}
