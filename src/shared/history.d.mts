import type { DailyUsageDay, ProviderId } from './types.js'

export type HistoryRange = '1d' | '3d' | '30d' | 'all'
export type HistoryMetric = 'tokens' | 'value'
export type HistoryUnit = 'hour' | 'day' | 'week' | 'month'
export type HistoryScope = 'recent' | 'all'

export const HISTORY_RANGES: readonly HistoryRange[]
export const HISTORY_METRICS: readonly HistoryMetric[]
export const HISTORY_RECENT_DAYS: number
export const HISTORY_MAX_DAYS: number
export const CALENDAR_MAX_WEEKS: number

export interface HistoryProviderDay {
  tokens: number
  value: number
  valueComplete: boolean
}
export interface HistoryDay {
  date: string
  label: string
  tokens: number
  value: number
  valueComplete: boolean
  apiValue: number
  providers: Partial<Record<ProviderId, HistoryProviderDay>>
  recorded: boolean
}
export interface HistoryTotals {
  tokens: number
  value: number
  apiValue: number
  byProvider: Partial<Record<ProviderId, { tokens: number; value: number }>>
  recordedDays: number
}
export interface HistorySeries {
  days: HistoryDay[]
  totals: HistoryTotals
  maxTokens: number
}

/** One mark on the shared x axis: an hour, a day, a week or a month. */
export interface HistoryBucket {
  key: string
  /** The bucket's (first) day. */
  date: string
  label: string
  title: string
  tokens: number
  value: number
  apiValue: number
  providers: Partial<Record<ProviderId, { tokens: number; value: number }>>
  active: boolean
  valueComplete: boolean
  /** Holds now. */
  current: boolean
  /** An hour of today that has not happened yet. */
  future: boolean
}
export interface HistoryTick {
  index: number
  label: string
  /** Pinned to the right edge rather than starting at its bucket. */
  end?: boolean
}
export interface HistoryPace {
  current: number[]
  previous: number[] | null
}
export interface HistoryView {
  range: HistoryRange
  unit: HistoryUnit
  since: string
  until: string
  buckets: HistoryBucket[]
  ticks: HistoryTick[]
  totals: HistoryTotals & { days: number; valueComplete: boolean; unplacedTokens: number }
  max: Record<HistoryMetric, number>
  /** Hours (1D / 3D) or days with any tokens, out of those elapsed. */
  active: { count: number; of: number; unit: 'hour' | 'day' }
  /** The busiest bucket so far, per measure. */
  peak: Record<HistoryMetric, HistoryBucket | null>
  previous: { tokens: number; value: number; label: string } | null
  pace: Record<HistoryMetric, HistoryPace>
}

export interface ModelMixRow {
  model: string
  tokens: number
  value: number
  valueComplete: boolean
  share: number
}
export interface ProjectMixRow {
  project: string
  tokens: number
  value: number
  valueComplete: boolean
  share: number
}
export interface WeekdayRow {
  dow: number
  label: string
  days: number
  tokens: number
  value: number
  avgTokens: number
  avgValue: number
}
export interface CalendarCell {
  date: string
  title: string
  tokens: number
  value: number
}
export interface CalendarGrid {
  weeks: (CalendarCell | null)[][]
  months: { week: number; label: string }[]
  /** Every active day's amount, ascending — what `heatLevel` ranks against. */
  scale: Record<HistoryMetric, number[]>
  since: string
}

export function dayKey(date?: Date): string
export function dateLabel(key: string): string
export function hourLabel(hour: number): string
export function sanitizeRange(value: unknown): HistoryRange
export function sanitizeMetric(value: unknown): HistoryMetric
export function readHistoryPrefs(raw: unknown): { range: HistoryRange; metric: HistoryMetric }
export function rangeScope(range: HistoryRange): HistoryScope
export function historySeries(days: DailyUsageDay[] | undefined, options?: { count?: number; today?: string }): HistorySeries
export function historyView(days: DailyUsageDay[] | undefined, options?: { range?: HistoryRange; today?: string; hour?: number }): HistoryView
export function modelMix(days: DailyUsageDay[] | undefined, options?: { since?: string | null; until?: string | null }): ModelMixRow[]
export function projectMix(days: DailyUsageDay[] | undefined, options?: { since?: string | null; until?: string | null }): ProjectMixRow[]
export function weekdayProfile(days: DailyUsageDay[] | undefined, options?: { since?: string; until?: string }): WeekdayRow[]
export function calendarWeeks(days: DailyUsageDay[] | undefined, options?: { since?: string; until?: string }): CalendarGrid
export function heatLevel(value: number, scale: number[]): 0 | 1 | 2 | 3 | 4
export function niceCeil(n: number): number
export function deltaOf(current: number, previous: number): number | null
