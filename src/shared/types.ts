// Shared between the Electron main process, preload, hooks, and renderer.

export type ProviderId = 'claude' | 'codex'
export type AgentState = 'running' | 'waiting' | 'complete' | 'idle'
export type WaitReason = 'permission' | 'question'
export type ToolKind = 'bash' | 'edit' | 'read' | 'search' | 'web' | 'task' | 'other'
export type UsageProvenance = 'hook' | 'transcript' | 'rollout' | 'api' | 'unknown'

export interface Agent {
  /** Provider-qualified stable identity. */
  id: string
  provider: ProviderId
  rawSessionId: string
  /** Provider-qualified root id for a nested subagent. */
  parentId?: string
  actorId?: string
  project: string
  cwd?: string
  state: AgentState
  tool?: ToolKind
  activity?: string
  waitReason?: WaitReason
  question?: string
  since: number
  updatedAt: number
  contextPct?: number
  contextRising?: boolean
  tokensOut?: number
  costUsd?: number
  /** False means some tokens could not be priced. */
  valueComplete?: boolean
  usageProvenance?: UsageProvenance
  model?: string
  permissionMode?: string
  activeTasks?: number
  recentQuestions?: { text: string; at: number }[]
  focusHwnd?: string
  focusPid?: number
}

export interface Quota {
  label: string
  usedPct: number
  resetsAt: number | null
  tone: 'amber' | 'blue' | 'green'
  severity?: 'normal' | 'warning' | 'critical'
}

export interface UsageSample { t: number; pct: number }

export interface ProjectUsage {
  project: string
  tokensOut: number
  costUsd: number
  valueComplete?: boolean
}

export interface ProviderUsageTotals {
  tokensOut: number
  costUsd: number
  valueComplete?: boolean
  byProject?: ProjectUsage[]
  byModel?: { model: string; tokensOut: number; costUsd: number; valueComplete?: boolean }[]
}

export interface DailyUsageDay extends ProviderUsageTotals {
  date: string
  /** Additive v2 provider split. Legacy records are interpreted as Claude. */
  byProvider?: Partial<Record<ProviderId, ProviderUsageTotals>>
  /** Actual Anthropic Admin API spend, kept separate from estimated agent value. */
  apiCostUsd?: number
  apiTokensOut?: number
}

export interface UsageAccount {
  id: string
  provider: ProviderId
  kind: 'subscription' | 'api' | 'local'
  available: boolean
  label: string
  session?: Quota
  week?: Quota
  /** Additional provider-reported quota windows (for example, model-scoped weekly limits). */
  quotas?: Quota[]
  budget?: Quota
  todayTokensOut?: number
  todayCostUsd?: number
  todayByProject?: ProjectUsage[]
  projectedLimitAt?: number
  note?: string
  provenance?: UsageProvenance
  /** Estimated API-equivalent value, not subscription billing. */
  valueComplete?: boolean
  /** True for actual organization spend returned by a provider API. */
  actualSpend?: boolean
  /** UTC report bucket represented by provider API totals (YYYY-MM-DD). */
  sourceDate?: string
}

export interface UsageSummary {
  accounts: UsageAccount[]
  mock: boolean
}

export interface UsageInsightMetric {
  id: 'large-context' | 'subagent-heavy' | 'long-running'
  usedPct: number
  tokens: number
}

export interface UsageInsightRow {
  name: string
  usedPct: number
  tokens: number
  providers: ProviderId[]
}

export interface UsageInsightPeriod {
  totalTokens: number
  sessions: number
  byProvider: Partial<Record<ProviderId, number>>
  metrics: UsageInsightMetric[]
  skills: UsageInsightRow[]
  subagents: UsageInsightRow[]
  mcpServers: UsageInsightRow[]
}

export interface UsageInsights {
  generatedAt: number
  available: boolean
  note?: string
  day: UsageInsightPeriod
  week: UsageInsightPeriod
}

/** Compatibility aliases for provider-specific services. */
export type PlanWindow = Omit<UsageAccount, 'id' | 'provider' | 'kind'>
export type ApiUsage = Omit<UsageAccount, 'id' | 'provider' | 'kind'>

export interface ProviderHealth {
  installed: boolean
  needsRepair?: boolean
  awaitingTrust: boolean
  reporting: boolean
  lastReportAt?: number
  error?: string
  bridgeVersion?: string
}

export interface StatusSnapshot {
  agents: Agent[]
  usage: UsageSummary
  waitingCount: number
  providers: Record<ProviderId, ProviderHealth>
  mock: boolean
  generatedAt: number
}

export type AgentEventKind =
  | 'session_started'
  | 'prompt_submitted'
  | 'tool_started'
  | 'tool_finished'
  | 'attention_required'
  | 'turn_completed'
  | 'session_ended'
  | 'subagent_started'
  | 'subagent_completed'
  | 'context_compacting'
  | 'context_compacted'

export interface AgentEventV1 {
  schemaVersion: 1
  provider: ProviderId
  eventId: string
  sessionId: string
  turnId?: string
  actor: { kind: 'root' } | { kind: 'subagent'; id: string }
  kind: AgentEventKind
  timestamp: number
  cwd?: string
  model?: string
  permissionMode?: string
  toolName?: string
  activity?: string
  attention?: { reason: WaitReason; message?: string }
  usage?: {
    kind: 'delta' | 'cumulative'
    inputTokens?: number
    outputTokens?: number
    cachedInputTokens?: number
    cacheWriteTokens?: number
    contextPct?: number
    messageId?: string
    source?: UsageProvenance
  }
  transcript?: { path: string }
  focus?: { hwnd?: string; pid?: number }
}

/** Legacy Claude compatibility payload accepted only by POST /report. */
export interface HookReport {
  event:
    | 'SessionStart' | 'UserPromptSubmit' | 'PreToolUse' | 'PostToolUse'
    | 'Notification' | 'Stop' | 'SubagentStart' | 'SubagentStop' | 'SessionEnd'
  sessionId: string
  cwd?: string
  toolName?: string
  activity?: string
  message?: string
  contextPct?: number
  contextRising?: boolean
  tokensOut?: number
  tokensIn?: number
  cacheRead?: number
  cacheWrite?: number
  msgId?: string
  model?: string
  permissionMode?: string
  actorId?: string
  focusHwnd?: string
  focusPid?: number
  ts?: number
}

export interface AppSettingsPatch {
  hotkey?: string
  notifications?: boolean
  launchAtLogin?: boolean
  mock?: boolean
}

export interface AppSettings {
  hotkey: string
  notifications: boolean
  launchAtLogin: boolean
  mock: boolean
  hasAdminKey: boolean
  port: number
  version: string
  providers: Record<ProviderId, ProviderHealth>
  historySync: { state: 'off' | 'connecting' | 'ok' | 'error'; detail?: string; lastFlushAt?: number }
}

export const DEFAULTS = {
  port: 7459,
  hotkey: 'Control+Alt+W',
  pollMs: 1000,
  staleMs: 15 * 60 * 1000,
  idleAfterMs: 90 * 1000
} as const
