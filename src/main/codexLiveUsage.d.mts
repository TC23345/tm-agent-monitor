import type { scanCodexUsage, CodexTokenTotals, CodexRolloutResult } from './codexUsage.mjs'
export interface LiveUsage { threadId: string; at: number; cwd: string; model: string; total: CodexTokenTotals; last: CodexTokenTotals }
export function normalizeLiveUsage(params: unknown, metadata: unknown, now?: number): LiveUsage | undefined
export function reconcileLiveUsage(results: CodexRolloutResult[], events: LiveUsage[]): { results: CodexRolloutResult[]; pendingEvents: number }
export class CodexUsageLedger {
  constructor(options?: { rootDir?: string; now?: number })
  refresh(): Promise<Awaited<ReturnType<typeof scanCodexUsage>> | null>
  ingest(value: unknown): Awaited<ReturnType<typeof scanCodexUsage>> | null
}
