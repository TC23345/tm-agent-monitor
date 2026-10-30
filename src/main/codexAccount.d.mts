import type { PlanWindow, CodexAccountUsage } from '../shared/types.js'
export function parseAccountLimits(raw: unknown): PlanWindow
export function parseAccountUsage(raw: unknown, now?: number): CodexAccountUsage
export class CodexAccount {
  constructor(read: (method: 'account/rateLimits/read' | 'account/usage/read') => Promise<unknown>, options?: { now?: () => number })
  get(kind: 'limits'): Promise<PlanWindow>
  get(kind: 'usage'): Promise<CodexAccountUsage>
  clear(): void
  notification(message: { method: string; params?: unknown }): void
}
