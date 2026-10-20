import type { ChatItem, Transcript } from './chatModel.mjs'

export interface AgentCard {
  /** The Agent row's id (Claude), `agent:<thread id>` (Codex), `task:<task id>`. */
  id: string
  kind: 'agent' | 'task'
  name: string
  type?: string
  state: 'running' | 'done' | 'failed' | 'stopped'
  background: boolean
  startedAt?: number
  endedAt?: number
  steps: number
  latest?: string
  /** The transcript row it came from. */
  rowId?: string
  /** What Stop takes (`stopTask`). */
  stopId?: string
  prompt?: string
  result?: string
  /** Its own steps, for the panel's detail view. */
  items: ChatItem[]
}

export function stepLine(x: ChatItem): string
export function agentCards(t: Transcript): AgentCard[]
export function runningLabel(cards: AgentCard[]): string | null
