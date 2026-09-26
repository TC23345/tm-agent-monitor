export interface ClipColumn {
  id: string
  /** The default `grid-template-columns` track. */
  track: string
  min: number
  fixed?: true
  flex?: true
}

export type ClipColBucket = 'pane' | 'picker'
export type ClipColWidths = Record<string, number>

export const CLIP_COL_GAP: number
export const CLIP_COL_MAX: number
export const CLIP_COLS_KEY: string
export const CLIP_COLUMNS: Readonly<Record<ClipColBucket, readonly ClipColumn[]>>
export const CLIP_COL_BUCKETS: readonly ClipColBucket[]

export function boundaryColumn(model: readonly ClipColumn[], index: number): { index: number; sign: 1 | -1 } | null
export function gripColumns(model: readonly ClipColumn[]): number[]
export function sanitizeWidths(model: readonly ClipColumn[], raw: unknown): ClipColWidths
export function readClipCols(raw: unknown, bucket: ClipColBucket): ClipColWidths
export function withClipCols(raw: unknown, bucket: ClipColBucket, widths: ClipColWidths): Partial<Record<ClipColBucket, ClipColWidths>>
export function resizeColumns(model: readonly ClipColumn[], widths: number[], index: number, deltaPx: number, available: number, stored?: ClipColWidths): ClipColWidths
export function resetColumn(model: readonly ClipColumn[], stored: ClipColWidths, index: number): ClipColWidths
export const AUTO_KEY_MAX: number
export function autoKeyWidth(labels: readonly string[]): number
export function templateFor(model: readonly ClipColumn[], widths: ClipColWidths, autoKey?: number): string
