export const MAX_DRAFT: number
export const MAX_CONTEXT: number
export const MAX_COMPLETION: number
export const SYSTEM: string
export function samplePrompt(draft: string): string
export function completionPrompt(draft: string, context?: string | null): { system: string; prompt: string }
export function cleanCompletion(answer: string, draft: string): string
