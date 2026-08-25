import type { ProviderHealth, ProviderId } from './types.js'

export type HealthTone = 'on' | 'warn' | 'idle' | 'off'
export interface ProviderStatus {
  tone: HealthTone
  reason: string
}
export interface OverallStatus {
  state: 'on' | 'warn' | 'off'
  label: string
  title: string
}

export const SILENT_AFTER_MS: number
export function providerLabel(provider: ProviderId | string): string
export function ago(ms: number): string
export function providerStatus(
  health: ProviderHealth | undefined,
  now: number,
  appVersion: string | undefined,
  options?: { silentAfterMs?: number }
): ProviderStatus
export function overallStatus(
  providers: Partial<Record<ProviderId, ProviderHealth>> | undefined,
  now: number,
  appVersion: string | undefined,
  mock?: boolean,
  options?: { silentAfterMs?: number }
): OverallStatus
