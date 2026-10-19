import type { ChatItemTool, SessionSummary, Transcript } from '../shared/chatModel.mjs'

export interface ClaudeFold {
  transcript: Transcript
  stream: { messageId: string | null; blocks: Record<number, string> }
  /** The compaction row still waiting for its summary. */
  compactId?: string | null
}

export function startFold(transcript: Transcript): ClaudeFold
export function toolTitle(name: string, input: unknown): string
export function toolView(name: string, input: unknown): Pick<ChatItemTool, 'label' | 'detail' | 'detailMono' | 'view' | 'edits' | 'content' | 'path' | 'todos' | 'prompt'>
export function resultText(content: unknown): string
export function toolOutcome(text: string, isError: boolean): { status: 'done' | 'failed' | 'declined'; output: string }
export function storedCommand(text: string): string | null
export function storedCommandOutput(text: string): string | null
export function foldSdkMessage(f: ClaudeFold, msg: unknown, opts?: { interrupted?: boolean }): ClaudeFold
export function sessionMessagesToTranscript(meta: { sessionId: string; cwd: string; info?: any }, messages: any[]): Transcript
export function sessionSummary(info: any): SessionSummary
