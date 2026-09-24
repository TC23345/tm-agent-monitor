export const CF_HDROP: number
export const EXCLUSION_FORMATS: Readonly<{ exclude: string; history: string; cloud: string }>
export const MAX_CLIPS: number
export const MAX_CLIP_BYTES: number
export const MAX_IMAGE_BYTES: number
export const MAX_FILES: number
export const RETENTION_DAYS: number
export const MAX_GROUPS: number
export const MAX_GROUP_NAME: number
export const MAX_TITLE: number
export const INTERNAL_COPY_WINDOW_MS: number
export const BURST_MS: number
export const BUILTIN_GROUPS: readonly string[]
export const PASSWORD_MANAGER_EXES: readonly string[]
export const SECRET_PATTERNS: ReadonlyArray<readonly [string, RegExp]>

export type ClipKind = 'text' | 'image' | 'files'
export type ClipSourceKind = 'app' | 'terminal' | 'chrome' | 'agent' | 'manual'

export interface ClipSource {
  kind: ClipSourceKind
  exe?: string
  app?: string
  title?: string
  url?: string
  terminalId?: string
  project?: string
  provider?: 'claude' | 'codex' | 'cursor'
  agentId?: string
}

export interface ClipImage {
  width: number
  height: number
  bytes: number
  /** sha1 hex of the PNG bytes — the dedupe key for images. */
  hash: string
}

export interface Clip {
  id: string
  kind: ClipKind
  /** The text; a file list joined by newlines; '' for an image. */
  text: string
  files?: string[]
  image?: ClipImage
  title?: string
  createdAt: number
  copiedAt: number
  copies: number
  groups: string[]
  favorite: boolean
  source: ClipSource
  bytes: number
  seq?: number
  edited?: boolean
  merged?: boolean
  manual?: boolean
}

/** A clip without its body, for the renderer's list. */
export interface ClipSummary extends Omit<Clip, 'text' | 'title'> {
  title: string
  preview: string
  /** The title is one the user set (not derived from the text). */
  custom: boolean
}

export interface CaptureSnapshot {
  text: string
  files?: string[]
  hasImage?: boolean
  imageBytes?: number
  excluded?: boolean
}

export interface CaptureContext {
  ownerExe?: string
  blockedExes?: string[]
  redactSecrets?: boolean
  paused?: boolean
}

export type CaptureDecision = { keep: true; kind: ClipKind } | { keep: false; reason: string }

export interface ProcessInfo { hwnd?: string; pid: number; exe: string; title?: string }

export function looksSecret(text: string): string | null
export function parseDropFiles(buf: Uint8Array | Buffer | null | undefined): string[]
export function blockedExe(exe: string | undefined, list: readonly string[]): boolean
export function domainBlocked(url: string, domains: readonly string[]): boolean
export function shouldCapture(snap: CaptureSnapshot, ctx?: CaptureContext): CaptureDecision
export function dedupeKey(clip: Partial<Clip> | null | undefined): string
export function upsertClip(clips: Clip[], incoming: Omit<Clip, 'createdAt' | 'copiedAt' | 'copies' | 'groups' | 'favorite'> & Partial<Clip>, now?: number, opts?: { keepSource?: boolean; burstMs?: number }): { clips: Clip[]; clip: Clip; existed: boolean; burst?: boolean }
export function isPinned(clip: Clip | null | undefined): boolean
export function applyRetention(clips: Clip[], opts?: { maxItems?: number; maxAgeMs?: number; now?: number }): Clip[]
export function sortClips<T extends { copiedAt?: number }>(clips: T[]): T[]
export function groupNameOk(name: unknown): name is string
export function inGroup(clip: Pick<Clip, 'favorite' | 'kind' | 'groups'> | null | undefined, group: string | undefined): boolean
export function fromSource(clip: Pick<Clip, 'source'> | null | undefined, filter: string | undefined): boolean
export function searchText(clip: Clip): string
export function filterClips<T extends Clip>(clips: T[], opts?: { group?: string; source?: string; query?: string; limit?: number }): T[]
export function firstLine(text: string | undefined): string
export function clipTitle(clip: Partial<Clip> | null | undefined): string
export function clipPreview(clip: Partial<Clip> | null | undefined, max?: number): string
export function sizeLabel(bytes: number): string
export function looksLikeCode(text: string | undefined): boolean
export function describeSource(input: { owner?: ProcessInfo | null; foreground?: ProcessInfo | null; selfPid?: number; internal?: { at: number; terminalId?: string; cwd?: string; project?: string } | null; agent?: { provider: 'claude' | 'codex' | 'cursor'; id: string; project?: string } | null; now?: number }): ClipSource
export function appLabel(exe: string | undefined): string
export function sourceLabel(source: ClipSource | null | undefined): string
export function mergeText(clips: Array<Pick<Clip, 'kind' | 'text' | 'files'>>): string
export function sanitizeSource(raw: unknown): ClipSource
export function sanitizeClip(raw: unknown): Clip | null
export function sanitizeGroups(raw: unknown): string[]
export function orderFavorites<T extends { id: string; favorite: boolean; copiedAt?: number }>(clips: T[], order: unknown): T[]
export function summarize(clip: Clip): ClipSummary
export function parseSnippetNote(text: string | undefined): { shortcut: string | null; body: string }
