import type { ChatItemTool, Transcript } from './chatModel.mjs'

export function imageSize(base64: string): { width: number; height: number } | null
export function serverTitle(server: string): string
export function mcpTitle(server: string, tool?: string): string
export function splitMcpName(name: string): { server: string; tool: string } | null
export function argDetail(args: unknown): string | undefined
export function effortLabel(effort: string | null | undefined, provider?: 'claude' | 'codex'): string
export function activitySummary(items: import('./chatModel.mjs').ChatItem[]): string
export const CODEX_INIT_PROMPT: string
export function limitName(windowMins: number | null | undefined): string
export function resetPhrase(resetsAt: number | null | undefined, now?: number, locale?: string): string
export function limitLines(limits: import('./chatModel.mjs').RateLimits | null | undefined, now?: number): string[]
export function modelLabel(id: string | null | undefined): string
export function latestModels<M extends { id: string; label: string }>(models: M[], keep?: string): M[]
export function formatElapsed(ms: number): string
export function clockTime(at: number, locale?: string): string
export function fmtTokens(n: number): string
export const WORKING_VERBS: string[]
export function verbDelay(swaps: number): number
export function describePermissionUpdates(suggestions: unknown): string | undefined
export function relPath(path: string, cwd: string | null | undefined): string
export function matchFiles(paths: string[], query: string, limit?: number): string[]
export function previewMarkdown(text: string | null | undefined): string
export function cardSteps(items: import('./chatModel.mjs').ChatItem[]): Set<string>
/** A streaming reply split for drawing: finished blocks (Markdown), the block being written (plain), and a table's header while its rows arrive. */
export function streamParts(text: string): { settled: string; live: string; table: string | null }
export function transcriptMarkdown(t: Transcript): string
export interface TextCard { kind: 'quote' | 'paste'; text: string }
export const PASTE_CARD_LINES: number
export const PASTE_CARD_CHARS: number
export function isLongPaste(text: string): boolean
export function cardTitle(text: string): string
export function quoteBlock(text: string): string
export function composeMessage(cards: TextCard[], text: string): string
export function cardInsertion(card: TextCard, text: string, caret: number): { start: number; end: number; insert: string; after: string; caret: number }
export interface ChatDigestItem { kind: 'user' | 'assistant' | 'tool' | 'approval' | 'question' | 'dialog' | 'system'; text: string; [extra: string]: unknown }
export interface ChatDigest {
  provider: string; sessionId: string | null; cwd: string; title: string | null; model: string | null; status: string; error?: string
  waitingFor: { kind: 'approval' | 'question' | 'dialog'; text: string } | null; queued: number; total: number; items: ChatDigestItem[]
}
export function chatDigest(t: Transcript, limit?: number): ChatDigest
export const DIALOG_KINDS: string[]
export interface DialogAction { label: string; result: string; primary?: boolean; openUrl?: string; editPrompt?: boolean }
export interface DialogCard { title: string; body: string[]; learnMore: string | null; dismissable: boolean; delayMs: number; actions: DialogAction[] }
export function dialogCard(dialog: { dialogKind: string; payload: Record<string, unknown> }, name?: (model: string) => string): DialogCard | null
export const MAX_STEP_TITLE: number
export function stepText(item: ChatItemTool): string
export function stepTitle(item: ChatItemTool): string
