import type { DailyUsageDay, ProviderId } from './types.js'

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
export interface HistorySeries {
  days: HistoryDay[]
  totals: {
    tokens: number
    value: number
    apiValue: number
    byProvider: Partial<Record<ProviderId, { tokens: number; value: number }>>
    recordedDays: number
  }
  maxTokens: number
}
export interface ModelMixRow {
  model: string
  tokens: number
  value: number
  valueComplete: boolean
  share: number
}

export function dayKey(date?: Date): string
export function historySeries(days: DailyUsageDay[] | undefined, options?: { count?: number; today?: string }): HistorySeries
export function modelMix(days: DailyUsageDay[] | undefined, options?: { since?: string | null }): ModelMixRow[]
