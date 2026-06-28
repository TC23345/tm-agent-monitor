// Shared between the Electron main process, preload, and renderer.

export type AgentState = 'running' | 'waiting' | 'complete' | 'idle'

/** Why an agent is waiting — drives the bubble color in the UI. */
export type WaitReason = 'permission' | 'question'

/** Normalized tool family, used to pick the row icon for running agents. */
export type ToolKind = 'bash' | 'edit' | 'read' | 'search' | 'web' | 'task' | 'other'

export interface Agent {
  id: string // Claude Code session id
  project: string // project / repo name (basename of cwd)
  cwd?: string
  state: AgentState
  tool?: ToolKind
  /** One-line activity, e.g. "$ npm run build", "editing StatusModel.swift". */
  activity?: string
  /** Present when state === 'waiting'. */
  waitReason?: WaitReason
  /** The blocking question / permission prompt text. */
  question?: string
  /** ms epoch when the current state/op began (drives the duration column). */
  since: number
  updatedAt: number
  /** Context-window fill for this chat, 0..100. */
  contextPct?: number
  /** Whether context is climbing (shows the ↑ arrow). */
  contextRising?: boolean
  /** Tokens emitted by this session so far (best effort, from hooks). */
  tokensOut?: number
  /** HWND (as string) of the terminal window hosting this session. */
  focusHwnd?: string
  /** PID owning that window, used to re-resolve a stale HWND. */
  focusPid?: number
}

export interface Quota {
  /** "Session" | "Week" | "Budget" */
  label: string
  /** 0..100 (real utilization from the OAuth usage endpoint). */
  usedPct: number
  /** ms epoch when the window resets, or null if unknown. */
  resetsAt: number | null
  /** Bar color. */
  tone: 'amber' | 'blue' | 'green'
  /** Drives warning/critical coloring of the percentage. */
  severity?: 'normal' | 'warning' | 'critical'
}

/**
 * A Claude *subscription* account's rate-limit windows (Max / Team seats),
 * from the real OAuth usage endpoint. Session = 5-hour, week = 7-day.
 */
export interface PlanWindow {
  available: boolean
  /** "You · Max" | "Growth Saloon" etc. */
  label: string
  session?: Quota
  week?: Quota
  /** Output tokens today (from local transcripts; personal account only). */
  todayTokensOut?: number
  /** Why it's unavailable (e.g. "not signed in", "auth expired"). */
  note?: string
}

/** Org API-key usage from the Admin API — pay-per-use, no 5-hour window. */
export interface ApiUsage {
  available: boolean
  label: string
  todayTokensOut?: number
  todayCostUsd?: number
  /** Optional daily-budget bar, shown only when a budget is configured. */
  budget?: Quota
}

export interface UsageSummary {
  /** Your personal Max plan — drives ALL Claude Code here (CLI, VS Code, desktop). */
  personal: PlanWindow
  /** The org's API-key token usage (a separate, pay-per-use account). */
  api: ApiUsage
  mock: boolean
}

export interface StatusSnapshot {
  agents: Agent[]
  usage: UsageSummary
  /** Count of agents currently awaiting input (drives the badge / blur title). */
  waitingCount: number
  daemonConnected: boolean
  mock: boolean
  generatedAt: number
}

/** Payload the Claude Code hook POSTs to the daemon's /report endpoint. */
export interface HookReport {
  event:
    | 'SessionStart'
    | 'UserPromptSubmit'
    | 'PreToolUse'
    | 'PostToolUse'
    | 'Notification'
    | 'Stop'
    | 'SubagentStop'
    | 'SessionEnd'
  sessionId: string
  cwd?: string
  toolName?: string
  /** Raw, single-line activity hint derived by the hook (e.g. the command). */
  activity?: string
  message?: string // notification / question text
  contextPct?: number
  contextRising?: boolean
  tokensOut?: number
  focusHwnd?: string
  focusPid?: number
  ts?: number
}

export const DEFAULTS = {
  port: 7459,
  // Control+Alt+W — chosen by the user. (On some layouts Ctrl+Alt = AltGr; if it
  // ever stops firing, override CLAUDE_WATCH_HOTKEY, e.g. Alt+C.)
  hotkey: 'Control+Alt+W',
  pollMs: 1000,
  /** An agent with no update within this window is pruned. */
  staleMs: 15 * 60 * 1000,
  /** Running agents idle this long with no tool activity are marked 'idle'. */
  idleAfterMs: 90 * 1000
} as const
