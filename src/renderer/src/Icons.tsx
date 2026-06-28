import {
  Terminal,
  FilePen,
  FileText,
  Search,
  Globe,
  Bot,
  Sparkles,
  MessageSquareWarning,
  ShieldAlert,
  CircleCheck,
  Moon,
  Loader2,
  ChevronDown,
  ChevronRight,
  ArrowUp,
  Settings,
  type LucideIcon
} from 'lucide-react'
import type { Agent, ToolKind } from '@shared/types'

function toolIcon(tool: ToolKind | undefined): LucideIcon {
  switch (tool) {
    case 'bash': return Terminal
    case 'edit': return FilePen
    case 'read': return FileText
    case 'search': return Search
    case 'web': return Globe
    case 'task': return Bot
    default: return Sparkles
  }
}

/** State icon + color class for an agent (Lucide, crisp single-stroke). */
export function AgentIcon({ agent }: { agent: Agent }) {
  let Icon: LucideIcon
  let cls: string
  switch (agent.state) {
    case 'waiting':
      if (agent.waitReason === 'question') {
        Icon = MessageSquareWarning
        cls = 'ic ic--question'
      } else {
        Icon = ShieldAlert
        cls = 'ic ic--permission'
      }
      break
    case 'complete':
      Icon = CircleCheck
      cls = 'ic ic--complete'
      break
    case 'idle':
      Icon = Moon
      cls = 'ic ic--idle'
      break
    default:
      Icon = toolIcon(agent.tool)
      cls = 'ic ic--running'
  }
  return (
    <span className={cls}>
      <Icon className="ic-svg" strokeWidth={2} />
    </span>
  )
}

/** Small spinning indicator for a live (running) session. */
export function RunningSpinner() {
  return <Loader2 className="spinner" strokeWidth={2.5} />
}

export { ChevronDown, ChevronRight, ArrowUp, Settings }
