import type { Agent } from '@shared/types'
import { AgentIcon, RunningSpinner, ArrowUp } from './Icons'
import { shortDuration, contextTone } from './format'

/** One session within a project group. Project name lives in the group header. */
export function AgentRow({ agent, now }: { agent: Agent; now: number }) {
  const running = agent.state === 'running'
  const alert = agent.state === 'waiting' && agent.waitReason === 'question'
  const tone = contextTone(agent.contextPct)
  const text = agent.state === 'waiting' ? agent.question : agent.activity

  return (
    <div
      className={`row ${alert ? 'row--alert' : ''} ${agent.state === 'waiting' ? 'is-waiting' : ''}`}
      onClick={() => window.watch.focusAgent(agent.id, agent.focusHwnd, agent.focusPid)}
      onContextMenu={(e) => {
        e.preventDefault()
        if (agent.cwd) window.watch.openPath(agent.cwd)
      }}
      title={agent.cwd ? `${agent.cwd} — click to focus, right-click to open folder` : undefined}
    >
      <AgentIcon agent={agent} />
      <span className="row-text">{text}</span>
      <span className="row-meta">
        {agent.contextPct !== undefined && (
          <span className={`ctx ctx--${tone}`}>
            {agent.contextRising && <ArrowUp className="ctx-arrow" strokeWidth={2.5} />}
            {Math.round(agent.contextPct)}%
          </span>
        )}
        {running && <RunningSpinner />}
        <span className="dur">{shortDuration(agent.since, now)}</span>
      </span>
    </div>
  )
}
