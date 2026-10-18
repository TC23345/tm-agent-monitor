export type Provider = 'claude' | 'codex'
export type SessionStatus = 'idle' | 'running' | 'waiting' | 'error' | 'closed'
export type ApprovalChoice = 'allow' | 'allow-session' | 'deny' | 'cancel'

export type Attachment =
  | { kind: 'image'; name: string; mime: string; data: string; path?: string; width?: number; height?: number }
  | { kind: 'file'; path: string; name?: string }
export interface AttachmentSummary { kind: 'image' | 'file'; name: string; width?: number; height?: number; path?: string }

export interface ChatItemUser { kind: 'user'; id: string; text: string; attachments?: AttachmentSummary[]; at: number }
export interface ChatItemAssistant { kind: 'assistant'; id: string; text: string; streaming: boolean; at: number }
export interface ChatItemThinking { kind: 'thinking'; id: string; text: string; streaming: boolean; at: number; durationMs?: number }
export type ToolView = 'command' | 'edit' | 'write' | 'read' | 'search' | 'other'
export interface FileChange { path: string; before?: string; after?: string; diff?: string; kind?: 'add' | 'delete' | 'update' }
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
}
export interface ChatItemApproval {
  kind: 'approval'
  id: string
  title: string
  detail?: string
  choices: ApprovalChoice[]
  decided?: ApprovalChoice
  at: number
}
export interface Question {
  id: string
  text: string
  header?: string
  options: { label: string; description?: string }[] | null
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
}
export interface ChatItemSystem { kind: 'system'; id: string; text: string; level: 'info' | 'error'; at: number }
export type ChatItem = ChatItemUser | ChatItemAssistant | ChatItemThinking | ChatItemTool | ChatItemApproval | ChatItemQuestion | ChatItemSystem

export interface Usage { inputTokens: number; outputTokens: number; contextTokens?: number; contextWindow?: number; costUsd?: number }

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
}

export interface ModelOption { id: string; label: string; description?: string; efforts: string[]; defaultEffort?: string | null; model?: string }
export interface ModeOption { id: string; label: string; description: string }
export interface CommandOption { name: string; description: string; argumentHint?: string }
export interface ChatOptions { models: ModelOption[]; modes: ModeOption[]; commands: CommandOption[] }
export interface ChatConfigPatch { model?: string | null; effort?: string | null; permissionMode?: string | null }

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
export function appendDelta(t: Transcript, id: string, kind: 'assistant' | 'thinking', delta: string | undefined, at: number): Transcript
export function settleStreams(t: Transcript): Transcript
export function pendingApprovals(t: Transcript): ChatItemApproval[]
export function pendingQuestions(t: Transcript): ChatItemQuestion[]
export function pendingRequests(t: Transcript): (ChatItemApproval | ChatItemQuestion)[]
export function answerQuestion(t: Transcript, id: string, answers: Record<string, string[]> | null): Transcript
export function summarizeAttachments(list?: Attachment[]): AttachmentSummary[] | undefined
export function setStatus(t: Transcript, status: SessionStatus, error?: string | null): Transcript
export function decideApproval(t: Transcript, id: string, choice: ApprovalChoice): Transcript
export function addUsage(t: Transcript, delta: Partial<Usage>): Transcript
export function transcriptSummary(t: Transcript): string
export function firstLine(text: string | undefined, max?: number): string
export function sortSessions(list: SessionSummary[], limit?: number): SessionSummary[]
