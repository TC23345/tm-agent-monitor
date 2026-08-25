import type { SizeBucket } from './layout.mjs'
import type { TerminalLaunch } from './types.js'

export interface SanitizedTerm {
  launch: TerminalLaunch
  cwd?: string
  label?: string
  sessionId?: string
  initialCommand?: string
}
export interface SanitizedPane<K extends string = string> {
  id: string
  kind: K
  term?: SanitizedTerm
}
export type Fractions = Record<string, number[]>
export interface Sizes {
  sidebar: number | null
  cols: Fractions
  rows: Fractions
}

export function sanitizePanes<K extends string>(
  raw: unknown,
  options: { kinds: readonly K[]; isUnique: (kind: K) => boolean; maxPanes: number; launches?: readonly string[] }
): SanitizedPane<K>[]
export function migratePanesV3<K extends string>(
  rawV2: unknown,
  options: { newId: string; kinds: readonly K[]; isUnique: (kind: K) => boolean; maxPanes: number; launches?: readonly string[] }
): SanitizedPane<K>[]
export function sanitizeSidebarViews<V extends string>(raw: unknown, legacyRaw: unknown, options: { ids: readonly V[]; defaults: readonly V[] }): V[]
export function sanitizeCollapsed<V extends string>(raw: unknown, options: { ids: readonly V[]; defaults: readonly V[] }): V[]
export function readPaneCols(raw: unknown): 'auto' | 1 | 2 | 3
export function emptySizes(): Sizes
export function readAllSizes(raw: unknown): Record<SizeBucket, Sizes>
export function readLaunch<L extends string>(raw: unknown, launches: readonly L[]): L
