export type Provider = 'claude' | 'codex'
export type SessionStatus = 'idle' | 'running' | 'waiting' | 'error' | 'closed'
export type ApprovalChoice = 'allow' | 'allow-session' | 'deny' | 'cancel' | 'plan-auto' | 'plan-manual' | 'allow-rule' | 'allow-host'
/** One numbered option of a prompt, in the provider's own words (Codex lists its decisions; Claude's are fixed in the row). */
export interface ApprovalOption { choice: ApprovalChoice; label: string; hint?: string; rule?: string }

export type Attachment =
  | { kind: 'image'; name: string; mime: string; data: string; path?: string; width?: number; height?: number }
  | { kind: 'file'; path: string; name?: string }
export interface AttachmentSummary { kind: 'image' | 'file'; name: string; width?: number; height?: number; path?: string }

export interface ChatItemUser { kind: 'user'; id: string; text: string; attachments?: AttachmentSummary[]; at: number; uuid?: string; turnId?: string; steered?: boolean; shell?: boolean }
/** `parent`: a subagent's text or thinking, nested under its Agent row (Claude's `parent_tool_use_id`). */
export interface ChatItemAssistant { kind: 'assistant'; id: string; text: string; streaming: boolean; at: number; phase?: 'commentary' | 'final'; plan?: boolean; parent?: string }
export interface ChatItemThinking { kind: 'thinking'; id: string; text: string; streaming: boolean; at: number; durationMs?: number; tokens?: number; parent?: string }
export type ToolView = 'command' | 'edit' | 'write' | 'read' | 'search' | 'todo' | 'agent' | 'other'
export interface FileChange { path: string; before?: string; after?: string; diff?: string; kind?: 'add' | 'delete' | 'update' }
export interface TodoEntry { content: string; status: 'pending' | 'in_progress' | 'completed'; activeForm?: string }
export interface ChatItemTool {
  kind: 'tool'
  id: string
  name: string
  title: string
  input?: string
  output?: string
  status: 'running' | 'done' | 'failed' | 'declined'
  at: number
  parent?: string
  label?: string
  detail?: string
  detailMono?: boolean
  view?: ToolView
  edits?: FileChange[]
  content?: string
  path?: string
  todos?: TodoEntry[]
  prompt?: string
  taskId?: string
  background?: boolean
  /** How long the step ran (Codex reports it), shown as "in 2s". */
  elapsedMs?: number
  /** An Agent row: the subagent's type (Explore, general-purpose). */
  agentType?: string
  /** A background task's end (`task_notification`): its row closed when it was launched. */
  outcome?: 'completed' | 'failed' | 'stopped'
  endedAt?: number
  /** What the finished background task reported. */
  summary?: string
  /** While it runs: an agent's one-line status (Claude's task_progress) or an MCP call's progress message (Codex). */
  progress?: string
  /** Codex: a multi-agent call — the tool, the agent threads it named, each one's last state. */
  collab?: CollabCall
}
export interface CollabCall { tool: string; receivers: string[]; states: Record<string, { status: string; message?: string }>; model?: string }
export interface ChatItemApproval {
  kind: 'approval'
  id: string
  title: string
  detail?: string
  choices: ApprovalChoice[]
  decided?: ApprovalChoice
  at: number
  toolName?: string
  variant?: 'tool' | 'plan'
  question?: string
  command?: string
  edits?: FileChange[]
  plan?: string
  rule?: string
  message?: string
  /** The prompt's own options, in order; absent = the row's fixed Claude set. */
  options?: ApprovalOption[]
  /** The model's reason for asking, shown under the prompt. */
  reason?: string
  /** The tool call it asks about, when the card stands in for that step (ExitPlanMode). */
  toolUseId?: string
}
export interface Question {
  id: string
  text: string
  header?: string
  options: { label: string; description?: string; preview?: string }[] | null
  multiSelect: boolean
  allowOther: boolean
  secret?: boolean
}
export interface ChatItemQuestion {
  kind: 'question'
  id: string
  title: string
  detail?: string
  questions: Question[]
  answers?: Record<string, string[]>
  cancelled?: boolean
  at: number
  /** The AskUserQuestion call it stands in for. */
  toolUseId?: string
}
export interface ChatItemSystem {
  kind: 'system'
  id: string
  text: string
  level: 'info' | 'warning' | 'error'
  at: number
  variant?: 'interrupt' | 'compact' | 'command' | 'cleared' | 'task' | 'limit' | 'notice' | 'status' | 'model' | 'review' | 'fork'
  running?: boolean
  detail?: string
  tokens?: number
  /** Codex: a subagent's activity (subAgentActivity) — its thread, its name, what happened. */
  agent?: { id: string; name: string; kind: string }
}
export interface TurnFile { path: string; added: number; removed: number }
export interface ChatItemTurn { kind: 'turn'; id: string; at: number; durationMs?: number; outputTokens?: number; files: TurnFile[]; turnId?: string; undone?: boolean; interrupted?: boolean }
export interface ChatItemDialog {
  kind: 'dialog'
  id: string
  dialogKind: string
  payload: Record<string, unknown>
  at: number
  toolUseId?: string
  result?: string
  cancelled?: boolean
}
export type ChatItem = ChatItemUser | ChatItemAssistant | ChatItemThinking | ChatItemTool | ChatItemApproval | ChatItemQuestion | ChatItemDialog | ChatItemSystem | ChatItemTurn

export interface Usage { inputTokens: number; outputTokens: number; contextTokens?: number; contextWindow?: number; costUsd?: number }
export interface BackgroundTask { id: string; description: string; type: string; toolUseId?: string }
export interface LimitWindow { usedPercent: number; windowMins: number | null; resetsAt: number | null }
export interface RateLimits { primary: LimitWindow | null; secondary: LimitWindow | null; reached?: string | null }

export interface Transcript {
  provider: Provider
  sessionId: string | null
  cwd: string
  model: string | null
  title: string | null
  status: SessionStatus
  items: ChatItem[]
  usage: Usage
  error: string | null
  effort: string | null
  permissionMode: string | null
  turnStartedAt: number | null
  activity: 'compacting' | null
  retry: { attempt: number; max: number } | null
  background: BackgroundTask[]
  suggestion: string | null
  checkpoints: boolean
  outputStyle: string | null
  fastMode: 'off' | 'on' | 'cooldown' | null
  queue: ChatItemUser[]
  /** Codex: the rolling rate limits (account/rateLimits). */
  limits: RateLimits | null
  /** Codex: plan mode (collaborationMode plan). */
  planMode: boolean
  /** Codex: the queue waits after an interrupt until Resume. */
  queuePaused: boolean
  /** Codex: the plan the last turn proposed, waiting for *Implement this plan?* (the plan item's id). */
  pendingPlan: string | null
}

export interface ModelOption { id: string; label: string; description?: string; efforts: string[]; defaultEffort?: string | null; model?: string; fastMode?: boolean; fastLabel?: string }
export interface ModeOption { id: string; label: string; description: string; confirm?: { title: string; body: string; action: string } }
export interface CommandOption { name: string; description: string; argumentHint?: string; local?: boolean }
export interface ChatOptions { models: ModelOption[]; modes: ModeOption[]; commands: CommandOption[]; outputStyles?: string[]; fastMode?: boolean; fastLabel?: string; planMode?: boolean; shell?: boolean }
export interface ChatConfigPatch { model?: string | null; effort?: string | null; permissionMode?: string | null; fastMode?: boolean; outputStyle?: string; planMode?: boolean }
export type ReviewTarget = { type: 'uncommittedChanges' } | { type: 'baseBranch'; branch: string }
export interface UndoResult { ok: boolean; message: string }

export interface RewindResult { canRewind: boolean; files: string[]; insertions: number; deletions: number; error?: string }
export interface ContextUsage { total: number; max: number; percent: number; categories: { name: string; tokens: number; kind: string }[]; memoryFiles: { path: string; tokens: number }[]; limits?: RateLimits | null }
export interface McpServer { name: string; status: 'connected' | 'failed' | 'needs-auth' | 'pending' | 'disabled'; error?: string; tools: number; scope?: string }
export type McpRequest = { op: 'list' } | { op: 'toggle'; name: string; enabled: boolean } | { op: 'reconnect'; name: string }

export interface SessionSummary {
  provider: Provider
  id: string
  title: string
  cwd: string
  updatedAt: number
  createdAt?: number
  model?: string | null
  branch?: string | null
}

export const MAX_ITEMS: number
export const MAX_TOOL_OUTPUT: number
export const MAX_TEXT: number

export function emptyTranscript(provider: Provider, init: { cwd: string; sessionId?: string | null; model?: string | null; title?: string | null; effort?: string | null; permissionMode?: string | null }): Transcript
export function beginTurn(t: Transcript, at: number): Transcript
export function clip(text: unknown, max: number): string
export function appendItem(t: Transcript, item: ChatItem): Transcript
export function updateItem(t: Transcript, id: string, update: Partial<ChatItem> | ((item: ChatItem) => ChatItem)): Transcript
export function removeItem(t: Transcript, id: string): Transcript
export function enqueue(t: Transcript, item: ChatItemUser): Transcript
export function dequeue(t: Transcript, id: string, at: number): Transcript
export function unqueue(t: Transcript, id: string): Transcript
export function turnFiles(items: ChatItem[]): TurnFile[]
export function closeTurn(t: Transcript, info: { at: number; durationMs?: number; outputTokens?: number; id?: string; turnId?: string; interrupted?: boolean }): Transcript
export function appendDelta(t: Transcript, id: string, kind: 'assistant' | 'thinking', delta: string | undefined, at: number, parent?: string): Transcript
export function settleStreams(t: Transcript): Transcript
export function pendingApprovals(t: Transcript): ChatItemApproval[]
export function pendingQuestions(t: Transcript): ChatItemQuestion[]
export function pendingRequests(t: Transcript): (ChatItemApproval | ChatItemQuestion | ChatItemDialog)[]
export function settleDialog(t: Transcript, id: string, result: string | null): Transcript
export function answerQuestion(t: Transcript, id: string, answers: Record<string, string[]> | null): Transcript
export function summarizeAttachments(list?: Attachment[]): AttachmentSummary[] | undefined
export function setStatus(t: Transcript, status: SessionStatus, error?: string | null): Transcript
export function decideApproval(t: Transcript, id: string, choice: ApprovalChoice, message?: string): Transcript
export function addUsage(t: Transcript, delta: Partial<Usage>): Transcript
export function transcriptSummary(t: Transcript): string
export function firstLine(text: string | undefined, max?: number): string
export function sortSessions(list: SessionSummary[], limit?: number): SessionSummary[]
