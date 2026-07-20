export interface CodexTokenTotals {
  inputTokens: number
  cachedInputTokens: number
  outputTokens: number
  reasoningOutputTokens: number
  totalTokens: number
}

export interface CodexUsageDiagnostic {
  code: string
  source: string
  line: number
  message: string
}

export interface CodexRateLimitWindow {
  usedPct?: number
  windowMinutes?: number
  resetsAt?: number
}

export interface CodexRateLimits {
  limitId?: string
  limitName?: string
  planType?: string
  primary?: CodexRateLimitWindow
  secondary?: CodexRateLimitWindow
  observedAt: number
}

export interface CodexRolloutResult {
  provider: 'codex'
  source: string
  session: { id?: string; cwd?: string; model?: string; modelProvider?: string }
  totals: CodexTokenTotals
  usageEvents: Array<{
    date?: string
    timestamp?: string
    cwd?: string
    project: string
    model: string
    tokens: CodexTokenTotals
  }>
  rateLimits?: CodexRateLimits
  diagnostics: CodexUsageDiagnostic[]
  schemaDrift: boolean
}

export function parseCodexRolloutLines(lines: Iterable<string>, options?: { source?: string }): CodexRolloutResult
export function parseCodexRolloutText(text: string, options?: { source?: string }): CodexRolloutResult
export function parseCodexRolloutFile(path: string): Promise<CodexRolloutResult>
export function scanCodexUsage(options?: {
  rootDir?: string
  now?: number
  lookbackMs?: number
}): Promise<{
  provider: 'codex'
  totals: CodexTokenTotals
  byDay: Array<CodexTokenTotals & {
    date: string
    byProject: Array<CodexTokenTotals & { project: string }>
    byModel: Array<CodexTokenTotals & { model: string }>
    byProjectModel: Array<CodexTokenTotals & { project: string; model: string }>
  }>
  rateLimits?: CodexRateLimits
  filesScanned: number
  diagnostics: CodexUsageDiagnostic[]
  schemaDrift: boolean
}>
