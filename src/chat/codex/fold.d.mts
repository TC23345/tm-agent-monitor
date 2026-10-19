import type { ApprovalChoice, ApprovalOption, ChatItem, ChatItemApproval, ChatItemQuestion, ModeOption, Question, RateLimits, SessionSummary, Transcript } from '../shared/chatModel.mjs'

export const APPROVAL_METHODS: Set<string>
export const QUESTION_METHODS: Set<string>
export const DECISIONS: Partial<Record<ApprovalChoice, string>>
export const LEGACY_DECISIONS: Partial<Record<ApprovalChoice, string>>

export interface CodexMode extends ModeOption {
  approvalPolicy: string
  approvalsReviewer: string
  sandboxPolicy: Record<string, unknown>
}
export const CODEX_MODES: CodexMode[]
export const CUSTOM_MODE: ModeOption
export const EDIT_OPTIONS: ApprovalOption[]

export function codexModeId(settings: any): string
export function innerCommand(command: unknown, actions: unknown): string
export function commandOptions(params: any): ApprovalOption[]
export function mergeLimits(prev: RateLimits | null, snap: any): RateLimits | null
export function itemToChat(item: unknown, at: number, live?: boolean): ChatItem | null
export function threadToTranscript(thread: any): Transcript
export function foldTurnItems(t: Transcript, turn: any): Transcript
export function foldNotification(t: Transcript, n: { method: string; params: any; emittedAtMs?: number }): Transcript
export function foldServerRequest(t: Transcript, req: { id: string | number; method: string; params: any }, at?: number): { transcript: Transcript; approval: ChatItemApproval | null; question: ChatItemQuestion | null }
export function approvalResponse(method: string, choice: ApprovalChoice, params?: any): unknown
export function questionFromRequest(req: { id: string | number; method: string; params: any }, at: number): ChatItemQuestion | null
export function schemaQuestions(schema: any): Question[]
export function questionResponse(req: { id: string | number; method: string; params: any }, answers: Record<string, string[]> | null): unknown
export function threadSummary(thread: any): SessionSummary
