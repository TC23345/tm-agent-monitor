import type { Clip, ClipSource } from '../shared/clips.mjs'

export interface ClipStoreCrypto {
  available: () => boolean
  protect: (text: string) => Promise<Buffer>
  unprotect: (buffer: Buffer) => Promise<string>
}

/** Capture and retention preferences, stored beside the clips (not in settings.json). */
export interface ClipMeta {
  groups: string[]
  favoritesOrder: string[]
  /** 0 = capturing; -1 = paused until resumed; else a timestamp the pause ends at. */
  pausedUntil: number
  blockedExes: string[]
  redactSecrets: boolean
  captureImages: boolean
  maxItems: number
  maxAgeDays: number
}

export type ClipSettingsPatch = Partial<Pick<ClipMeta, 'blockedExes' | 'redactSecrets' | 'captureImages' | 'maxItems' | 'maxAgeDays'>>

export type ClipInput = Omit<Clip, 'createdAt' | 'copiedAt' | 'copies' | 'groups' | 'favorite'> & Partial<Clip>

export function sanitizeMeta(raw: unknown): ClipMeta

export class ClipStore {
  constructor(dir: string, crypto: ClipStoreCrypto, log?: (line: string) => void, opts?: { now?: () => number })
  /** Plaintext fallback was used because DPAPI was unavailable. */
  unprotected: boolean
  onChange(listener: () => void): () => void
  load(): Promise<void>
  list(): Clip[]
  get(id: string): Clip | undefined
  settings(): ClipMeta
  isPaused(now?: number): boolean
  /** `minutes` > 0 pauses for that long, 0 or undefined pauses until resumed, null resumes. */
  pause(minutes: number | null | undefined): void
  updateSettings(patch: ClipSettingsPatch): void
  add(incoming: ClipInput, opts?: { png?: Buffer; thumb?: Buffer; keepSource?: boolean }): Promise<Clip | null>
  update(id: string, patch: { title?: string | null; text?: string; groups?: string[]; favorite?: boolean }): Clip | null
  remove(ids: string[]): number
  clear(all?: boolean): number
  merge(ids: string[], source: ClipSource): Promise<Clip | null>
  /** A backup's text clips; the same content already in history is skipped. */
  importClips(items: Array<{ text: string; title?: string; favorite?: boolean; groups?: string[]; createdAt?: number; copiedAt?: number; sourceUrl?: string; order?: number; merged?: boolean; edited?: boolean }>): Promise<{ added: number; skipped: number }>
  exportData(): { app: string; schemaVersion: 1; exportedAt: string; groups: string[]; favoritesOrder: string[]; clips: Clip[] }
  setGroups(names: string[]): string[]
  setFavoritesOrder(ids: string[]): void
  imageDataUrl(id: string, thumb: boolean): Promise<string | null>
  imageBytes(id: string): Promise<Buffer | null>
  flush(): Promise<void>
}
