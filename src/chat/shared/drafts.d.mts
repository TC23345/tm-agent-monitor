export interface DraftCard { kind: 'quote' | 'paste'; text: string }
export type DraftAttachment =
  | { kind: 'image'; name: string; mime: string; data: string; width?: number; height?: number }
  | { kind: 'file'; path: string; name?: string }
export interface Draft { text: string; cards: DraftCard[]; attachments: DraftAttachment[]; at: number }

export const DRAFTS_KEY: string
export const MAX_DRAFTS: number
export const DRAFT_TTL_MS: number
export const MAX_DRAFT_IMAGE_CHARS: number
export function isEmptyDraft(d: Draft | null | undefined): boolean
export function cleanDraft(raw: unknown, now?: number): Draft | null
export function sanitizeDrafts(raw: unknown, now?: number): Record<string, Draft>
export function parseDrafts(text: unknown, now?: number): Record<string, Draft>
export function withDraft(all: Record<string, Draft>, key: string, draft: Omit<Draft, 'at'> | null, now?: number): Record<string, Draft>
export function withoutImages(all: Record<string, Draft>): Record<string, Draft>
