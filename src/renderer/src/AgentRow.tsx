import type { Agent } from '@shared/types'
import { AgentIcon, ArrowUp } from './Icons'
import { shortDuration, contextTone } from './format'

export function AgentRow({ agent, now }: { agent: Agent; now: number }) {
  const highlight = agent.state === 'waiting' && agent.waitReason === 'question'
  const animate = agent.state === 'running' ? 'is-running' : agent.state === 'waiting' ? 'is-waiting' : ''
  const tone = contextTone(agent.contextPct)
  const subtitle = agent.state === 'waiting' ? agent.question : agent.activity

  return (
    <div
      className={`agent ${highlight ? 'agent--highlight' : ''} ${animate}`}
      onClick={() => window.watch.focusAgent(agent.id, agent.focusHwnd, agent.focusPid)}
      onContextMenu={(e) => {
        e.preventDefault()
        if (agent.cwd) window.watch.openPath(agent.cwd)
      }}
      title={agent.cwd ? `${agent.cwd} — click to focus, right-click to open folder` : undefined}
    >
      <AgentIcon agent={agent} />
      <div className="agent-body">
        <div className="agent-name">{agent.project}</div>
        <div className="agent-sub">{subtitle}</div>
      </div>
      <div className="agent-meta">
        {agent.contextPct !== undefined && (
          <span className={`ctx ctx--${tone}`}>
            {agent.contextRising && <ArrowUp className="ctx-arrow" />}
            {Math.round(agent.contextPct)}%
          </span>
        )}
        <span className="dur">{shortDuration(agent.since, now)}</span>
      </div>
    </div>
  )
}
