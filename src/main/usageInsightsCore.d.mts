import type { UsageInsights } from '../shared/types.js'
export function parseClaudeTranscriptLines(lines: Iterable<string>, options?: Record<string, unknown>): unknown
export function parseCodexRolloutLines(lines: Iterable<string>, options?: Record<string, unknown>): unknown
export function buildUsageInsights(sessions: unknown[], now?: number, options?: { available?: boolean; note?: string }): UsageInsights
export function scanUsageInsights(options?: { claudeRoot?: string; codexRoot?: string; now?: number }): Promise<UsageInsights>
export const INSIGHT_THRESHOLDS: { largeContextTokens: number; longSessionMs: number }
