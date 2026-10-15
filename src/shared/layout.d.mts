export const SIDEBAR_MIN: number
export const SIDEBAR_MAX: number
export const PANE_MIN: number
export const PANE_MIN_ROW: number
export const SECTION_SNAP: number
export const SECTION_RESERVE: number

export type SizeBucket = 'full' | 'half'

/** A sidebar section's dragged height: 0 folds it, else whole pixels from the snap to the sidebar minus its reserve. */
export function clampSectionHeight(height: number, sidebarHeight: number): number
/** `{ [view]: px }` for known views only, each a sane whole number. */
export function sanitizeSectionHeights(raw: unknown, ids: readonly string[]): Record<string, number>

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
