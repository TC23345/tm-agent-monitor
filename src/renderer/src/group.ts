import type { Agent, AgentState } from '@shared/types'

export interface ProjectGroup {
  /** Stable key for collapse persistence (cwd when known, else project name). */
  key: string
  project: string
  cwd?: string
  agents: Agent[]
  childrenByParent: Map<string, Agent[]>
  /** How many sessions in this project are waiting on the user. */
  needsInput: number
  /** Most-important state across the group (drives ordering + the header dot). */
  rollupState: AgentState
}

const RANK: Record<AgentState, number> = { waiting: 0, running: 1, complete: 2, idle: 3 }

/**
 * Group the (already state-sorted) agent list by project. Agents keep their
 * incoming order within a group; groups are ordered so the one most needing
 * attention floats to the top.
 */
export function groupByProject(agents: Agent[]): ProjectGroup[] {
  const map = new Map<string, ProjectGroup>()
  const byId = new Map(agents.map((a) => [a.id, a]))
  const roots = agents.filter((a) => !a.parentId || !byId.has(a.parentId))
  for (const a of roots) {
    const rawKey = a.cwd ?? a.project
    const key = rawKey.replace(/[\\/]+$/, '').toLocaleLowerCase()
    let g = map.get(key)
    if (!g) {
      g = { key, project: a.project, cwd: a.cwd, agents: [], childrenByParent: new Map(), needsInput: 0, rollupState: a.state }
      map.set(key, g)
    }
    g.agents.push(a)
    if (a.state === 'waiting') g.needsInput++
    if (RANK[a.state] < RANK[g.rollupState]) g.rollupState = a.state
  }
  for (const child of agents.filter((a) => a.parentId && byId.has(a.parentId))) {
    const parent = byId.get(child.parentId!)!
    const key = (parent.cwd ?? parent.project).replace(/[\\/]+$/, '').toLocaleLowerCase()
    const g = map.get(key)
    if (!g) continue
    const list = g.childrenByParent.get(parent.id) ?? []
    list.push(child)
    g.childrenByParent.set(parent.id, list)
    if (child.state === 'waiting') g.needsInput++
    if (RANK[child.state] < RANK[g.rollupState]) g.rollupState = child.state
  }
  return [...map.values()].sort((x, y) => {
    if (RANK[x.rollupState] !== RANK[y.rollupState]) return RANK[x.rollupState] - RANK[y.rollupState]
    const xt = Math.max(...x.agents.map((a) => a.updatedAt))
    const yt = Math.max(...y.agents.map((a) => a.updatedAt))
    return yt - xt
  })
}
