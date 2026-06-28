import type { ProjectGroup as Group } from './group'
import { AgentRow } from './AgentRow'
import { ChevronDown, ChevronRight } from './Icons'
import { useCollapse } from './useCollapse'

/** A collapsible project header over its nested session rows. */
export function ProjectGroup({ group, now }: { group: Group; now: number }) {
  const [collapsed, toggle] = useCollapse(group.key, false)
  const Chevron = collapsed ? ChevronRight : ChevronDown

  const n = group.agents.length
  const headTitle = `${group.cwd ?? group.project}\n${n} session${n === 1 ? '' : 's'} in this project · click to collapse/expand`

  return (
    <div className={`group ${group.needsInput > 0 ? 'group--alert' : ''}`}>
      <button className="group-head" onClick={toggle} title={headTitle}>
        <Chevron className="group-chevron" strokeWidth={2.5} />
        <span className="group-name">{group.project}</span>
        {group.needsInput > 0 && (
          <span className="group-dot" title={`${group.needsInput} session${group.needsInput === 1 ? '' : 's'} here waiting for your input`} />
        )}
        <span className="group-count" title="Sessions in this project">{n}</span>
      </button>
      {!collapsed && (
        <div className="group-rows">
          {group.agents.map((a) => (
            <AgentRow key={a.id} agent={a} now={now} />
          ))}
        </div>
      )}
    </div>
  )
}
