import type { SessionSummary, Transcript } from '../shared/chatModel.mjs'

export interface ClaudeFold {
  transcript: Transcript
  stream: { messageId: string | null; blocks: Record<number, string> }
}

export function startFold(transcript: Transcript): ClaudeFold
export function toolTitle(name: string, input: unknown): string
export function resultText(content: unknown): string
export function foldSdkMessage(f: ClaudeFold, msg: unknown): ClaudeFold
export function sessionMessagesToTranscript(meta: { sessionId: string; cwd: string; info?: any }, messages: any[]): Transcript
export function sessionSummary(info: any): SessionSummary
