import type { PlanWindow, CodexAccountUsage } from '../shared/types.js'
export interface CodexAccountStatus {
  available: boolean
  stale?: boolean
  note?: string
  signedIn?: boolean
  requiresAuth?: boolean
  method?: string
  plan?: string
}
export function parseAccountLimits(raw: unknown): PlanWindow
export function parseAccountUsage(raw: unknown, now?: number): CodexAccountUsage
export function parseAccountStatus(raw: unknown): CodexAccountStatus
export function accountStatusLine(status: CodexAccountStatus | null): { connected: boolean; value: string; detail: string }
export class CodexAccount {
  constructor(read: (method: 'account/read' | 'account/rateLimits/read' | 'account/usage/read') => Promise<unknown>, options?: { now?: () => number })
  get(kind: 'limits', rereads?: number): Promise<PlanWindow>
  get(kind: 'usage', rereads?: number): Promise<CodexAccountUsage>
  get(kind: 'status', rereads?: number): Promise<CodexAccountStatus>
  clear(): void
  notification(message: { method: string; params?: unknown }): void
}
