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
export const BRIDGE_VERSION: string
export interface HealthOptions {
  silentAfterMs?: number
  /** Override the expected hook-bridge version (tests). */
  bridgeVersion?: string
}
export function providerLabel(provider: ProviderId | string): string
export function ago(ms: number): string
export function providerStatus(health: ProviderHealth | undefined, now: number, options?: HealthOptions): ProviderStatus
export function overallStatus(
  providers: Partial<Record<ProviderId, ProviderHealth>> | undefined,
  now: number,
  mock?: boolean,
  options?: HealthOptions
): OverallStatus
