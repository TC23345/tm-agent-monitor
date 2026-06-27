import { DEFAULTS, type Agent, type HookReport, type ToolKind } from '../shared/types.js'

function toolKind(name?: string): ToolKind {
  if (!name) return 'other'
  const n = name.toLowerCase()
  if (n.includes('bash') || n.includes('shell') || n.includes('terminal')) return 'bash'
  if (n.includes('edit') || n.includes('write') || n.includes('notebook')) return 'edit'
  if (n.includes('read') || n.includes('view') || n.includes('cat')) return 'read'
  if (n.includes('grep') || n.includes('glob') || n.includes('search') || n.includes('find')) return 'search'
  if (n.includes('web') || n.includes('fetch') || n.includes('url')) return 'web'
  if (n.includes('task') || n.includes('agent')) return 'task'
  return 'other'
}

function activityFor(tool: ToolKind, hint?: string): string {
  if (hint && hint.trim()) return hint.trim()
  switch (tool) {
    case 'bash': return 'running a command'
    case 'edit': return 'editing code'
    case 'read': return 'reading files'
    case 'search': return 'searching the codebase'
    case 'web': return 'fetching from the web'
    case 'task': return 'running a subagent'
    default: return 'working'
  }
}

/** Aggregates Claude Code hook events into a live map of agents. */
export class AgentStore {
  private agents = new Map<string, Agent>()

  apply(r: HookReport): void {
    const now = r.ts ?? Date.now()
    const prev = this.agents.get(r.sessionId)
    const project = r.cwd ? basename(r.cwd) : prev?.project ?? r.sessionId.slice(0, 8)
    const tool = toolKind(r.toolName) ?? prev?.tool

    const next: Agent = {
      id: r.sessionId,
      project,
      cwd: r.cwd ?? prev?.cwd,
      state: prev?.state ?? 'idle',
      tool: prev?.tool,
      activity: prev?.activity,
      waitReason: prev?.waitReason,
      question: prev?.question,
      since: prev?.since ?? now,
      updatedAt: now,
      contextPct: r.contextPct ?? prev?.contextPct,
      contextRising:
        r.contextRising ??
        (r.contextPct !== undefined && prev?.contextPct !== undefined
          ? r.contextPct > prev.contextPct
          : prev?.contextRising),
      tokensOut: r.tokensOut ?? prev?.tokensOut,
      focusHwnd: r.focusHwnd ?? prev?.focusHwnd,
      focusPid: r.focusPid ?? prev?.focusPid
    }

    const setState = (s: Agent['state']) => {
      if (next.state !== s) next.since = now
      next.state = s
    }

    switch (r.event) {
      case 'SessionStart':
        setState('idle'); next.activity = 'idle'; next.waitReason = undefined; next.question = undefined
        break
      case 'UserPromptSubmit':
      case 'PreToolUse':
      case 'PostToolUse':
        setState('running')
        next.tool = tool
        next.activity = activityFor(tool, r.activity)
        next.waitReason = undefined
        next.question = undefined
        break
      case 'Notification': {
        setState('waiting')
        const msg = r.message ?? ''
        const permission = /permission|approve|allow|wants to|use the/i.test(msg)
        next.waitReason = permission ? 'permission' : 'question'
        next.question = msg || (permission ? 'permission requested' : 'waiting for input')
        break
      }
      case 'Stop':
      case 'SubagentStop':
        setState('complete')
        next.activity = 'finished — ready for you'
        next.waitReason = undefined
        next.question = undefined
        break
      case 'SessionEnd':
        this.agents.delete(r.sessionId)
        return
    }

    this.agents.set(r.sessionId, next)
  }

  /** Returns agents sorted for display, pruning stale ones and aging idle ones. */
  snapshot(now = Date.now()): Agent[] {
    const out: Agent[] = []
    for (const [id, a] of this.agents) {
      if (now - a.updatedAt > DEFAULTS.staleMs) {
        this.agents.delete(id)
        continue
      }
      let agent = a
      if (a.state === 'running' && now - a.updatedAt > DEFAULTS.idleAfterMs) {
        agent = { ...a, state: 'idle', activity: 'idle', since: a.updatedAt }
      }
      out.push(agent)
    }
    // Order: waiting (questions first) → running → complete → idle, then most recent.
    const rank: Record<Agent['state'], number> = { waiting: 0, running: 1, complete: 2, idle: 3 }
    return out.sort((x, y) => {
      if (rank[x.state] !== rank[y.state]) return rank[x.state] - rank[y.state]
      if (x.state === 'waiting') {
        const wx = x.waitReason === 'question' ? 0 : 1
        const wy = y.waitReason === 'question' ? 0 : 1
        if (wx !== wy) return wx - wy
      }
      return y.updatedAt - x.updatedAt
    })
  }

  clear(): void {
    this.agents.clear()
  }
}

function basename(p: string): string {
  const parts = p.replace(/[\\/]+$/, '').split(/[\\/]/)
  return parts[parts.length - 1] || p
}
