import type { Agent } from '@shared/types'
import type { MenuState } from './AgentContextMenu'
import { AgentIcon, RunningSpinner, ArrowUp } from './Icons'
import { ProviderBadge } from './ProviderBadge'
import { shortDuration, contextTone, compactNumber, modelShort, money } from './format'
import { useNow } from './useNow'
import { tid } from './testid'

/** Short chip label + class for a non-default permission mode. */
function modeChip(mode?: string): { label: string; cls: string } | null {
  if (!mode || mode === 'default') return null
  if (/plan/i.test(mode)) return { label: 'plan', cls: 'mode--plan' }
  if (/acceptedits/i.test(mode)) return { label: 'auto', cls: 'mode--auto' }
  if (/bypass/i.test(mode)) return { label: 'bypass', cls: 'mode--bypass' }
  return { label: mode, cls: 'mode--other' }
}

/** One session within a project group. Project name lives in the group header. */
export function AgentRow({
  agent,
  onRowMenu,
  nested = false,
  childCount = 0,
  childrenExpanded = false,
  onToggleChildren
}: {
  agent: Agent
  onRowMenu: (menu: MenuState) => void
  nested?: boolean
  childCount?: number
  childrenExpanded?: boolean
  onToggleChildren?: () => void
}) {
  const now = useNow()
  const running = agent.state === 'running'
  const alert = agent.state === 'waiting' && agent.waitReason === 'question'
  const tone = contextTone(agent.contextPct)
  const text =
    (agent.state === 'waiting' ? agent.question : agent.activity) ??
    (agent.state === 'idle' ? 'idle' : 'starting…')
  // Imminent compaction: high fill AND still climbing — make the % pulse.
  const ctxHot = agent.contextRising && (agent.contextPct ?? 0) >= 85

  const where = agent.cwd ?? agent.project
  const model = modelShort(agent.model)
  const mode = modeChip(agent.permissionMode)
  const info = [
    model,
    agent.costUsd !== undefined && agent.costUsd > 0 ? `~${money(agent.costUsd)} so far` : undefined,
    mode ? `${agent.permissionMode} mode` : undefined
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
        <span className="row-text">{text}</span>
        {mode && (
          <span className={`row-mode ${mode.cls}`} title={`Permission mode: ${agent.permissionMode}`}>
            {mode.label}
          </span>
        )}
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
          {running && <RunningSpinner />}
          <span className="dur" title="Time in the current state">{shortDuration(agent.since, now)}</span>
        </span>
      </button>
      {(childCount > 0 || (agent.activeTasks ?? 0) > 0) && (
        <button
          className="row-tasks"
          title={`${childCount || agent.activeTasks} subagent${(childCount || agent.activeTasks) === 1 ? '' : 's'} · click to ${childrenExpanded ? 'hide' : 'show'}`}
          onClick={onToggleChildren}
          aria-expanded={childrenExpanded}
        >
          +{childCount || agent.activeTasks}
        </button>
      )}
    </div>
  )
}
