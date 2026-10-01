import type { ButtonHTMLAttributes } from 'react'
import type { ProjectGroup as Group } from './group'
import { AgentRow } from './AgentRow'
import type { MenuState } from './AgentContextMenu'
import { ChevronDown, ChevronRight } from './Icons'
import { useCollapse } from './useCollapse'
import { modelShort } from './format'
import { tid } from './testid'
import { useGitStatus } from './useProject'
import { describeGitStatus } from '@shared/gitStatus.mjs'

/** A collapsible project header over its nested session rows. */
export function ProjectGroup({
  group,
  onRowMenu,
  forceWaitingOpen = false,
  dragHandle
}: {
  group: Group
  onRowMenu: (menu: MenuState) => void
  forceWaitingOpen?: boolean
  /** Spread on the header so the group can be dragged into a manual order. */
  dragHandle?: ButtonHTMLAttributes<HTMLButtonElement>
}) {
  const [collapsed, toggle] = useCollapse(group.key, false, true)
  const displayCollapsed = forceWaitingOpen ? false : collapsed
  const Chevron = displayCollapsed ? ChevronRight : ChevronDown

  const git = useGitStatus(group.cwd)
  const gitText = describeGitStatus(git)
  const n = group.agents.length
  const headTitle = `${group.cwd ?? group.project}\n${n} session${n === 1 ? '' : 's'} in this project · click to collapse/expand · drag to reorder`
  // Show the model on the header only when every session here agrees on one.
  const models = new Set(group.agents.map((a) => a.model).filter(Boolean))
  const model = models.size === 1 ? modelShort(group.agents.find((a) => a.model)?.model) : undefined

  return (
    <div className={`group ${group.needsInput > 0 ? 'group--alert' : ''}`}>
      <button className="group-head" onClick={toggle} title={headTitle} data-testid={tid('group', group.key)} {...dragHandle}>
        <Chevron className="group-chevron" strokeWidth={2.5} />
        <span className="group-name">{group.project}</span>
        {model && <span className="group-model">{model}</span>}
        {gitText && (
          <span
            className={`group-git ${git?.dirty ? 'is-dirty' : ''}`}
            title={`${git?.worktree ? 'Linked worktree · ' : ''}branch ${git?.branch ?? '(detached)'}${git?.dirty ? ` · ${git.dirty} changed path${git.dirty === 1 ? '' : 's'}` : ' · clean'}${git?.ahead ? ` · ${git.ahead} ahead` : ''}${git?.behind ? ` · ${git.behind} behind` : ''}`}
            data-testid="group-git"
          >
            {git?.worktree ? '⑂ ' : ''}{gitText}
          </span>
        )}
        {group.needsInput > 0 && (
          <span className="group-dot" title={`${group.needsInput} session${group.needsInput === 1 ? '' : 's'} here waiting for your input`} />
        )}
        {n > 1 && <span className="group-count">{n}</span>}
      </button>
      {!displayCollapsed && (
        <div className="group-rows">
          {/* Subagents always show under their session: working, then a green dot when done. */}
          {group.agents.map((a) => (
            <div key={a.id} className="agent-tree">
              <AgentRow agent={a} onRowMenu={onRowMenu} />
              {(group.childrenByParent.get(a.id) ?? []).map((child) => (
                <AgentRow key={child.id} agent={child} onRowMenu={onRowMenu} nested />
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
