// What the pane needs from its host. In claude-watch the host is the sandboxed
// preload over `chat:*` IPC routes (main owns the processes, exactly as it
// owns the PTYs); in a plain Node harness it is the clients themselves.
import type { ApprovalChoice, Attachment, Provider, SessionSummary, Transcript } from '../shared/chatModel.mjs'

export interface ChatCreateRequest {
  provider: Provider
  cwd: string
  /** Resume this provider session id; omit for a new one. */
  resume?: string | null
  model?: string | null
}

export interface ChatBridge {
  /** Start (or reattach to) a live session; `id` is the host's handle, not the provider's session id. */
  create(req: ChatCreateRequest): Promise<{ id: string; transcript: Transcript }>
  /** The current transcript of a live session, or null when the host no longer has it (an app restart). */
  get(id: string): Promise<Transcript | null>
  send(id: string, text: string, attachments?: Attachment[]): Promise<void>
  interrupt(id: string): Promise<void>
  answer(id: string, approvalId: string, choice: ApprovalChoice): Promise<void>
  /** Answers by question id; `null` dismisses the question. */
  answerQuestion(id: string, questionId: string, answers: Record<string, string[]> | null): Promise<void>
  close(id: string): Promise<void>
  /** Transcript pushes; returns the unsubscribe. */
  onChange(cb: (id: string, transcript: Transcript) => void): () => void
  listSessions(provider: Provider, cwd?: string): Promise<SessionSummary[]>
  loadTranscript(provider: Provider, sessionId: string, cwd: string): Promise<Transcript>
}
