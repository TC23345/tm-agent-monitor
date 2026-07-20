import type { DayTotals } from './localUsage.js'
import type { DailyUsageDay, ProviderId } from '../shared/types.js'
export interface ApiDayUsage { date: string; tokensOut?: number; costUsd?: number }
export function machineId(): string
export function hasFlushPayload(days: DayTotals[], api?: ApiDayUsage, additional?: Partial<Record<ProviderId, DayTotals[]>>): boolean
export function dailyDocuments(days: DayTotals[], api?: ApiDayUsage, additional?: Partial<Record<ProviderId, DayTotals[]>>): Array<Record<string, unknown>>
export function normalizeDailyDocument(doc: Record<string, unknown>): DailyUsageDay
