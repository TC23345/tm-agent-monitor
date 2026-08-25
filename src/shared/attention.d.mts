import type { Agent, TerminalLaunch } from './types.js'

export interface PaneLike {
  id: string
  kind: string
  term?: { launch: TerminalLaunch; cwd?: string; sessionId?: string }
}

export function paneForAgent<T extends PaneLike>(panes: T[], agent: Agent | undefined | null): T | null
export function waitingAgents(agents: Agent[] | undefined): Agent[]
export function nextWaiting(agents: Agent[] | undefined, currentId?: string | null): Agent | null
export function waitingFirst(agents: Agent[] | undefined): Agent[]
