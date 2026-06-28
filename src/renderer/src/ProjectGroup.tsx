import type { ProjectGroup as Group } from './group'
import { AgentRow } from './AgentRow'
import { ChevronDown, ChevronRight } from './Icons'
import { useCollapse } from './useCollapse'

/** A collapsible project header over its nested session rows. */
export function ProjectGroup({ group, now }: { group: Group; now: number }) {
  const [collapsed, toggle] = useCollapse(group.key, false)
  const Chevron = collapsed ? ChevronRight : ChevronDown

  return (
    <div className={`group ${group.needsInput > 0 ? 'group--alert' : ''}`}>
      <button className="group-head" onClick={toggle} title={group.cwd ?? group.project}>
        <Chevron className="group-chevron" strokeWidth={2.5} />
        <span className="group-name">{group.project}</span>
        {group.needsInput > 0 && (
          <span className="group-dot" title={`${group.needsInput} waiting for input`} />
        )}
        <span className="group-count">{group.agents.length}</span>
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
