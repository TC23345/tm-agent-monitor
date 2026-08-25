export const SIDEBAR_MIN: number
export const SIDEBAR_MAX: number
export const PANE_MIN: number
export const PANE_MIN_ROW: number

export type SizeBucket = 'full' | 'half'

export function defaultSidebarWidth(frameWidth: number): number
export function clampSidebarWidth(width: number | null | undefined, frameWidth: number): number
export function equalFractions(count: number): number[]
export function normalizeFractions(raw: unknown, count: number): number[]
export function resizeFractions(
  fractions: number[],
  index: number,
  deltaPx: number,
  leftPx: number,
  rightPx: number,
  minPx?: number
): number[]
export function viewportBucket(innerWidth: number, availWidth: number): SizeBucket
export function columnTemplate(fractions: number[], gutterPx: number): string
export function trackWidths(computed: string | null | undefined): number[]
