import type { Agent } from '@shared/types'
import type { MenuState } from './AgentContextMenu'
import { AgentIcon, ArrowUp } from './Icons'
import { ProviderBadge } from './ProviderBadge'
import { shortDuration, contextTone, compactNumber, modelShort, money } from './format'
import { useNow } from './useNow'
import { useSessionNames } from './sessionNames'
import { tid } from './testid'

/**
 * One session within a project group. Project name lives in the group header;
 * subagents sit nested under their session. The permission mode (auto,
 * bypass, plan) is not a chip on the row since 0.4.46 — it is in the tooltip.
 */
export function AgentRow({
  agent,
  onRowMenu,
  nested = false
}: {
  agent: Agent
  onRowMenu: (menu: MenuState) => void
  nested?: boolean
}) {
  const now = useNow()
  // What a person called this session, if anything. The activity text says what
  // it is doing; only a name says what it is for.
  const name = useSessionNames()[agent.id]
  const alert = agent.state === 'waiting' && agent.waitReason === 'question'
  const tone = contextTone(agent.contextPct)
  const text =
    (agent.state === 'waiting' ? agent.question : agent.activity) ??
    (agent.state === 'idle' ? 'idle' : 'starting…')
  // Imminent compaction: high fill AND still climbing — make the % pulse.
  const ctxHot = agent.contextRising && (agent.contextPct ?? 0) >= 85

  const where = agent.cwd ?? agent.project
  const model = modelShort(agent.model)
  const info = [
    model,
    agent.costUsd !== undefined && agent.costUsd > 0 ? `~${money(agent.costUsd)} so far` : undefined,
    agent.permissionMode && agent.permissionMode !== 'default' ? `${agent.permissionMode} mode` : undefined
  ].filter(Boolean).join(' · ')
  const rowTitle = `${where}${info ? `\n${info}` : ''}\nClick to focus its terminal · right-click for actions`
  const ctxTitle = `Context window used by this session${agent.contextRising ? ' — and climbing' : ''}`

  return (
    <div
      className={`row ${nested ? 'row--nested' : ''} ${alert ? 'row--alert' : ''} ${agent.state === 'waiting' ? 'is-waiting' : ''}`}
      data-testid={tid('agent', agent.id)}
      onContextMenu={(e) => {
        e.preventDefault()
        onRowMenu({
          x: e.clientX,
          y: e.clientY,
          cwd: agent.cwd ?? '',
          id: agent.id,
          provider: agent.provider,
          focusHwnd: agent.focusHwnd,
          focusPid: agent.focusPid,
          rawSessionId: agent.rawSessionId,
          activity: agent.activity,
          name,
          recentQuestions: agent.recentQuestions,
          waiting: agent.state === 'waiting',
          question: agent.question
        })
      }}
      title={rowTitle}
    >
      <button className="row-focus" onClick={() => window.watch.focusAgent(agent.id)}>
        <AgentIcon agent={agent} />
        <ProviderBadge provider={agent.provider} />
        {name && <span className="row-name" title={name}>{name}</span>}
        <span className={`row-text ${name ? 'row-text--dim' : ''}`}>{text}</span>
        {agent.tokensOut !== undefined && agent.tokensOut > 0 && (
          <span className="row-tokens" title={`Output tokens this session has produced so far${agent.costUsd ? ` (~${money(agent.costUsd)})` : ''}`}>
            {compactNumber(agent.tokensOut)}
          </span>
        )}
        <span className="row-meta">
          {agent.contextPct !== undefined && (
            <span className={`ctx ctx--${tone} ${ctxHot ? 'ctx--hot' : ''}`} title={ctxTitle}>
              {agent.contextRising && <ArrowUp className="ctx-arrow" strokeWidth={2.5} />}
              {Math.round(agent.contextPct)}%
            </span>
          )}
          <span className="dur" title="Time in the current state">{shortDuration(agent.since, now)}</span>
        </span>
      </button>
    </div>
  )
}
