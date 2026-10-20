export type PrefKind = 'model' | 'mode'
export interface LabelOverride { label?: string; description?: string }
export interface ChatPrefs {
  labels: Record<string, Record<PrefKind, Record<string, LabelOverride>>>
  defaults: Record<string, { model?: string; mode?: string }>
}

export const CHAT_PREFS_KEY: string
export const MAX_LABEL: number
export const MAX_DESCRIPTION: number
export function emptyPrefs(): ChatPrefs
export function sanitizePrefs(raw: unknown): ChatPrefs
export function parsePrefs(text: unknown): ChatPrefs
export function labelFor(prefs: ChatPrefs, provider: string, kind: PrefKind, id: string, row: { label: string; description?: string }): { label: string; description?: string; renamed: boolean }
export function withLabel(prefs: ChatPrefs, provider: string, kind: PrefKind, id: string, next: { label?: string; description?: string }, original: { label: string; description?: string }): ChatPrefs
export function withDefault(prefs: ChatPrefs, provider: string, kind: PrefKind, id: string | null): ChatPrefs
export function defaultFor(prefs: ChatPrefs, provider: string, kind: PrefKind): string | null
