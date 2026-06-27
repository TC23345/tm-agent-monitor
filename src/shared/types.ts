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
  /** "Session" | "Week" */
  label: string
  /** 0..100 */
  usedPct: number
  /** ms epoch when the quota resets, or null if unknown. */
  resetsAt: number | null
  /** 'amber' bar (session) | 'blue' bar (week). */
  tone: 'amber' | 'blue'
}

export interface UsageSummary {
  session?: Quota
  week?: Quota
  /** Total output tokens today across sessions. */
  todayTokensOut?: number
  /** Output tokens / minute (recent). */
  burnPerMin?: number
  /** Minutes until the session quota is exhausted at the current burn rate. */
  etaToLimitMin?: number
  /** Where the usage numbers came from. */
  source: 'api' | 'hooks' | 'mock' | 'none'
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
  hotkey: 'Control+Alt+W',
  pollMs: 1000,
  /** An agent with no update within this window is pruned. */
  staleMs: 15 * 60 * 1000,
  /** Running agents idle this long with no tool activity are marked 'idle'. */
  idleAfterMs: 90 * 1000
} as const
