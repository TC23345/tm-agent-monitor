import type { Transcript } from './chatModel.mjs'

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
