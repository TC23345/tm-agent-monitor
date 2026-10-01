import {
  MessageSquareWarning,
  ShieldAlert,
  ChevronDown,
  ChevronRight,
  ArrowUp,
  Settings,
  type LucideIcon
} from 'lucide-react'
import type { Agent, ToolKind } from '@shared/types'

/** Short label describing an agent's state (used for hover tooltips). */
export function stateLabel(agent: Agent): string {
  switch (agent.state) {
    case 'waiting':
      return agent.waitReason === 'question' ? 'Waiting for your answer' : 'Waiting for permission'
    case 'complete':
      return 'Finished — ready for you'
    case 'idle':
      return 'Idle'
    default:
      return 'Running'
  }
}

/** What a running session is doing, for the working indicator's tooltip. */
function toolLabel(tool: ToolKind | undefined): string {
  switch (tool) {
    case 'bash': return 'running a command'
    case 'edit': return 'editing'
    case 'read': return 'reading'
    case 'search': return 'searching'
    case 'web': return 'on the web'
    case 'task': return 'running a subagent'
    default: return 'working'
  }
}

/**
 * State mark for an agent. Waiting keeps its icons (red means *you*, amber a
 * permission), because those ask for something. The rest are dots: a
 * working session is a small orbit — a dot with an arc turning around it —
 * that settles into a solid green dot when it is done, and a quiet hollow dot
 * when idle. Same slot, same size, so a row never shifts as it changes state.
 */
export function AgentIcon({ agent }: { agent: Agent }) {
  switch (agent.state) {
    case 'waiting': {
      const question = agent.waitReason === 'question'
      const Icon: LucideIcon = question ? MessageSquareWarning : ShieldAlert
      return (
        <span className={`ic ${question ? 'ic--question' : 'ic--permission'}`} title={stateLabel(agent)}>
          <Icon className="ic-svg" strokeWidth={2} />
        </span>
      )
    }
    case 'complete':
      return <span className="ic ic--complete" title={stateLabel(agent)}><span className="ic-dot" /></span>
    case 'idle':
      return <span className="ic ic--idle" title={stateLabel(agent)}><span className="ic-dot" /></span>
    default:
      return <span className="ic ic--running" title={`Running — ${toolLabel(agent.tool)}`}><span className="ic-work" /></span>
  }
}

export { ChevronDown, ChevronRight, ArrowUp, Settings }
