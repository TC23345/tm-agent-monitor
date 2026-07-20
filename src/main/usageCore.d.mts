import type { ApiUsage } from '../shared/types.js'

export interface FetchApiUsageOptions {
  label?: string
  dailyBudgetUsd?: number
  now?: number | (() => number)
  fetchImpl?: typeof fetch
  baseUrl?: string
  timeoutMs?: number
}

export function parseDecimalCents(value: unknown): number
export function sumNumericField(node: unknown, key: string): number
export function fetchApiUsage(adminKey: string | undefined, options?: FetchApiUsageOptions): Promise<ApiUsage>
