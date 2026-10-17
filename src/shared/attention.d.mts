import type { Agent, TerminalLaunch } from './types.js'

export interface PaneLike {
  id: string
  kind: string
  term?: { launch: TerminalLaunch; cwd?: string; sessionId?: string }
  /** A chat pane (src/chat): matched by its live handle (the hooks' `terminalId`), else by provider and folder. */
  chat?: { provider: 'claude' | 'codex'; cwd: string; chatId?: string }
}

export function paneForAgent<T extends PaneLike>(panes: T[], agent: Agent | undefined | null): T | null
export function agentForTerminal(agents: Agent[] | undefined, term: { launch: TerminalLaunch; cwd?: string; sessionId?: string } | undefined | null): Agent | null
export function waitingAgents(agents: Agent[] | undefined): Agent[]
export function nextWaiting(agents: Agent[] | undefined, currentId?: string | null): Agent | null
export function waitingFirst(agents: Agent[] | undefined): Agent[]
