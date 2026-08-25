import { DEFAULTS, type Agent, type AgentEventV1, type AppSettingsPatch, type HookReport, type ProviderId, type ToolKind, type ActivityEvent } from '../shared/types.js'
import { estimateCostUsd } from '../shared/pricing.mjs'

export type { AgentEventKind, ProviderId } from '../shared/types.js'
export type StoreEventV1 = AgentEventV1

/** Runtime-validation boundary for the only settings fields the renderer may mutate. */
export function validateMutableSettingsPatch(value: unknown): AppSettingsPatch | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const input = value as Record<string, unknown>
  const allowed = new Set(['hotkey', 'notifications', 'launchAtLogin', 'mock', 'sizeMode', 'pushUrl', 'pushAfterMin'])
  if (Object.keys(input).some((key) => !allowed.has(key))) return null

  const result: AppSettingsPatch = {}
  if ('hotkey' in input) {
    if (typeof input.hotkey !== 'string' || input.hotkey.length < 1 || input.hotkey.length > 80 || /[\r\n\0]/.test(input.hotkey)) return null
    result.hotkey = input.hotkey.trim()
    if (!result.hotkey) return null
  }
  if ('sizeMode' in input) {
    if (input.sizeMode !== 'full' && input.sizeMode !== 'left' && input.sizeMode !== 'right') return null
    result.sizeMode = input.sizeMode
  }
  for (const key of ['notifications', 'launchAtLogin', 'mock'] as const) {
    if (key in input) {
      if (typeof input[key] !== 'boolean') return null
      result[key] = input[key]
    }
  }
  if ('pushUrl' in input) {
    const url = input.pushUrl
    if (typeof url !== 'string' || url.length > 512 || /[\s\0]/.test(url)) return null
    if (url !== '' && !/^https?:\/\/\S+$/.test(url)) return null
    result.pushUrl = url
  }
  if ('pushAfterMin' in input) {
    const n = input.pushAfterMin
    if (typeof n !== 'number' || !Number.isInteger(n) || n < 1 || n > 240) return null
    result.pushAfterMin = n
  }
  return result
}

/** Bounded ring of attention-worthy moments, newest last; the feed reverses it. */
const MAX_EVENTS = 300

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

interface UsageAcc { input: number; output: number; cacheRead: number; cacheWrite: number }
interface UsageContribution extends UsageAcc { model?: string; provider: ProviderId }

function emptyUsage(): UsageAcc {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
}

function addUsage(into: UsageAcc, item: UsageAcc): void {
  into.input += item.input
  into.output += item.output
  into.cacheRead += item.cacheRead
  into.cacheWrite += item.cacheWrite
}

function providerKey(provider: ProviderId, sessionId: string, actorId?: string): string {
  const root = `${provider}:${encodeURIComponent(sessionId)}`
  return actorId ? `${root}:${encodeURIComponent(actorId)}` : root
}

type ExtendedAgent = Agent

function usageProvenance(value?: string): Agent['usageProvenance'] {
  return value === 'hook' || value === 'transcript' || value === 'rollout' || value === 'api'
    ? value
    : value ? 'unknown' : undefined
}

/** Aggregates provider hook events into a live map of agents. */
export class AgentStore {
  private agents = new Map<string, ExtendedAgent>()
  /** Message ledgers replace duplicate contributions and preserve per-model pricing. */
  private messages = new Map<string, Map<string, UsageContribution>>()
  private cumulative = new Map<string, UsageContribution>()
  private seenEvents = new Map<string, number>()
  private lastActorEventAt = new Map<string, number>()
  private endedSessions = new Map<string, number>()
  private sessionStartedAt = new Map<string, number>()
  private events: ActivityEvent[] = []

  constructor(private readonly maxAgents = 1_000) {}

  private record(e: ActivityEvent): void {
    this.events.push(e)
    if (this.events.length > MAX_EVENTS) this.events.splice(0, this.events.length - MAX_EVENTS)
  }

  /** Newest first. */
  recentEvents(limit = 200): ActivityEvent[] {
    return this.events.slice(-Math.max(0, limit)).reverse()
  }

  apply(r: HookReport): void {
    const id = providerKey('claude', r.sessionId)
    const now = r.ts ?? Date.now()
    if (r.event === 'SessionEnd') {
      this.applyEvent({
        schemaVersion: 1,
        provider: 'claude',
        eventId: `legacy:${r.event}:${r.sessionId}:${now}`,
        sessionId: r.sessionId,
        actor: { kind: 'root' },
        kind: 'session_ended',
        timestamp: now
      })
      return
    }
    const endedAt = this.endedSessions.get(id)
    if (endedAt !== undefined) {
      if (r.event !== 'SessionStart' || now <= endedAt) return
    }
    const startedAt = this.sessionStartedAt.get(id)
    if (startedAt !== undefined && now < startedAt) return
    if (!this.agents.has(id) && this.agents.size >= this.maxAgents) return
    if (r.event === 'SessionStart') {
      this.endedSessions.delete(id)
      if (startedAt !== undefined && now > startedAt) this.removeSession(id)
      this.sessionStartedAt.set(id, now)
    }
    if ((r.event === 'SubagentStart' || r.event === 'SubagentStop') && r.actorId) {
      this.applyEvent({
        schemaVersion: 1,
        provider: 'claude',
        eventId: `legacy:${r.event}:${r.sessionId}:${r.actorId}:${now}`,
        sessionId: r.sessionId,
        actor: { kind: 'subagent', id: r.actorId },
        kind: r.event === 'SubagentStart' ? 'subagent_started' : 'subagent_completed',
        timestamp: now,
        cwd: r.cwd,
        model: r.model,
        permissionMode: r.permissionMode,
        activity: r.activity,
        focus: { hwnd: r.focusHwnd, pid: r.focusPid }
      })
      return
    }
    const prev = this.agents.get(id)

    if (r.msgId && (r.tokensOut ?? r.tokensIn ?? r.cacheRead ?? r.cacheWrite) !== undefined) {
      let ledger = this.messages.get(id)
      if (!ledger) this.messages.set(id, (ledger = new Map()))
      ledger.set(r.msgId, {
        input: r.tokensIn ?? 0,
        output: r.tokensOut ?? 0,
        cacheRead: r.cacheRead ?? 0,
        cacheWrite: r.cacheWrite ?? 0,
        model: r.model ?? prev?.model,
        provider: 'claude'
      })
    }

    const project = r.cwd ? basename(r.cwd) : prev?.project ?? r.sessionId.slice(0, 8)
    const tool = toolKind(r.toolName)
    const totals = this.usageTotals(id)
    const value = this.usageValue(id)
    const next: ExtendedAgent = {
      id,
      provider: 'claude',
      rawSessionId: r.sessionId,
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
      tokensOut: totals.output || prev?.tokensOut,
      costUsd: value.cost ?? prev?.costUsd,
      valueComplete: value.hasUsage ? value.complete : prev?.valueComplete,
      model: r.model ?? prev?.model,
      permissionMode: r.permissionMode ?? prev?.permissionMode,
      activeTasks: prev?.activeTasks,
      recentQuestions: prev?.recentQuestions,
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
        if (r.toolName && toolKind(r.toolName) === 'task') {
          if (r.event === 'PreToolUse') next.activeTasks = (next.activeTasks ?? 0) + 1
          if (r.event === 'PostToolUse') next.activeTasks = Math.max(0, (next.activeTasks ?? 0) - 1)
        }
        break
      case 'Notification': {
        setState('waiting')
        const msg = r.message ?? ''
        const permission = /permission|approve|allow|wants to|use the/i.test(msg)
        next.waitReason = permission ? 'permission' : 'question'
        next.question = msg || (permission ? 'permission requested' : 'waiting for input')
        if (msg) next.recentQuestions = [{ text: msg, at: now }, ...(prev?.recentQuestions ?? [])].slice(0, 5)
        break
      }
      case 'Stop':
        setState('complete')
        next.activity = 'finished — ready for you'
        next.waitReason = undefined
        next.question = undefined
        break
      case 'SubagentStop':
        // Legacy reports do not identify the child. Never complete the root.
        next.activeTasks = Math.max(0, (next.activeTasks ?? 0) - 1)
        break
    }

    this.agents.set(id, next)
  }

  /** Apply one authenticated, provider-neutral v1 event. Returns false if deduplicated/out of order/capped. */
  applyEvent(event: StoreEventV1): boolean {
    const eventKey = `${event.provider}:${event.eventId}`
    if (this.seenEvents.has(eventKey)) return false
    const actorId = event.actor.kind === 'subagent' ? event.actor.id : undefined
    const id = providerKey(event.provider, event.sessionId, actorId)
    const rootId = providerKey(event.provider, event.sessionId)
    const parentId = actorId ? rootId : undefined
    const activeStartedAt = this.sessionStartedAt.get(rootId)
    if (event.kind === 'session_started') {
      if (activeStartedAt !== undefined && event.timestamp <= activeStartedAt) return false
    } else if (activeStartedAt !== undefined && event.timestamp < activeStartedAt) return false
    const endedAt = this.endedSessions.get(rootId)
    if (endedAt !== undefined) {
      if (event.kind !== 'session_started' || event.timestamp <= endedAt) return false
    }
    if (event.kind === 'session_ended') {
      for (const [actorKey, at] of this.lastActorEventAt) {
        const belongs = actorKey === rootId || this.agents.get(actorKey)?.parentId === rootId
        if (belongs && at > event.timestamp) return false
      }
    }
    const lastAt = this.lastActorEventAt.get(id)
    if (lastAt !== undefined && event.timestamp < lastAt) return false
    if (event.kind !== 'session_ended' && !this.agents.has(id) && this.agents.size >= this.maxAgents) return false

    if (event.kind === 'session_started') {
      this.endedSessions.delete(rootId)
      if (activeStartedAt !== undefined) this.removeSession(rootId)
    }

    this.seenEvents.set(eventKey, event.timestamp)
    this.lastActorEventAt.set(id, event.timestamp)
    this.trimSeenEvents(event.timestamp)

    if (event.kind === 'session_ended') {
      const gone = this.agents.get(rootId)
      if (gone) this.record({ at: event.timestamp, kind: 'ended', agentId: rootId, provider: event.provider, project: gone.project, cwd: gone.cwd })
      this.endedSessions.set(rootId, event.timestamp)
      this.removeSession(rootId)
      return true
    }
    if (event.kind === 'session_started') this.sessionStartedAt.set(rootId, event.timestamp)

    const prev = this.agents.get(id)
    const project = event.cwd ? basename(event.cwd) : prev?.project ?? event.sessionId.slice(0, 8)
    const usage = event.usage
    if (usage) this.applyEventUsage(id, event.provider, event.model ?? prev?.model, usage)
    const totals = this.usageTotals(id)
    const value = this.usageValue(id)
    const next: ExtendedAgent = {
      id,
      provider: event.provider,
      rawSessionId: event.sessionId,
      parentId,
      actorId,
      project,
      cwd: event.cwd ?? prev?.cwd,
      state: prev?.state ?? 'idle',
      tool: prev?.tool,
      activity: prev?.activity,
      waitReason: prev?.waitReason,
      question: prev?.question,
      since: prev?.since ?? event.timestamp,
      updatedAt: event.timestamp,
      contextPct: usage?.contextPct ?? prev?.contextPct,
      contextRising: usage?.contextPct !== undefined && prev?.contextPct !== undefined
        ? usage.contextPct > prev.contextPct
        : prev?.contextRising,
      tokensOut: totals.output || prev?.tokensOut,
      costUsd: value.cost ?? prev?.costUsd,
      valueComplete: value.hasUsage ? value.complete : prev?.valueComplete,
      model: event.model ?? prev?.model,
      permissionMode: event.permissionMode ?? prev?.permissionMode,
      recentQuestions: prev?.recentQuestions,
      focusHwnd: event.focus?.hwnd ?? prev?.focusHwnd,
      focusPid: event.focus?.pid ?? prev?.focusPid,
      usageProvenance: usageProvenance(usage?.source) ?? prev?.usageProvenance
    }
    const setState = (state: Agent['state']) => {
      if (next.state !== state) next.since = event.timestamp
      next.state = state
    }

    switch (event.kind) {
      case 'session_started':
        setState('idle'); next.activity = 'idle'; next.waitReason = undefined; next.question = undefined
        if (!actorId) this.record({ at: event.timestamp, kind: 'started', agentId: id, provider: event.provider, project, cwd: next.cwd })
        break
      case 'prompt_submitted':
      case 'tool_started':
      case 'tool_finished':
      case 'subagent_started':
      case 'context_compacting':
      case 'context_compacted':
        if (event.kind === 'context_compacted' && !actorId) this.record({ at: event.timestamp, kind: 'compacted', agentId: id, provider: event.provider, project, cwd: next.cwd })
        setState('running')
        next.tool = toolKind(event.toolName)
        next.activity = activityFor(next.tool, event.activity)
        next.waitReason = undefined
        next.question = undefined
        break
      case 'attention_required': {
        setState('waiting')
        const reason = event.attention?.reason ?? 'question'
        const message = event.attention?.message ?? (reason === 'permission' ? 'permission requested' : 'waiting for input')
        next.waitReason = reason
        next.question = message
        next.recentQuestions = [{ text: message, at: event.timestamp }, ...(prev?.recentQuestions ?? [])].slice(0, 5)
        this.record({ at: event.timestamp, kind: 'waiting', agentId: id, provider: event.provider, project, cwd: next.cwd, text: message })
        break
      }
      case 'turn_completed':
      case 'subagent_completed':
        if (event.kind === 'turn_completed' && !actorId) this.record({ at: event.timestamp, kind: 'finished', agentId: id, provider: event.provider, project, cwd: next.cwd })
        setState('complete')
        next.activity = 'finished — ready for you'
        next.waitReason = undefined
        next.question = undefined
        break
    }
    this.agents.set(id, next)
    this.refreshRootTaskCount(event.provider, event.sessionId)
    return true
  }

  /** Returns agents sorted for display, pruning stale ones and persisting idle transitions. */
  snapshot(now = Date.now()): Agent[] {
    const out: ExtendedAgent[] = []
    for (const [id, current] of this.agents) {
      if (now - current.updatedAt > DEFAULTS.staleMs) {
        if (current.parentId) this.removeAgent(id)
        else this.removeSession(id)
        continue
      }
      let agent = current
      if (current.state === 'running' && now - current.updatedAt > DEFAULTS.idleAfterMs) {
        agent = { ...current, state: 'idle', activity: 'idle', since: current.updatedAt }
        this.agents.set(id, agent)
      }
      out.push(agent)
    }
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
    this.messages.clear()
    this.cumulative.clear()
    this.seenEvents.clear()
    this.lastActorEventAt.clear()
    this.endedSessions.clear()
    this.sessionStartedAt.clear()
  }

  private applyEventUsage(id: string, provider: ProviderId, model: string | undefined, usage: NonNullable<StoreEventV1['usage']>): void {
    const contribution: UsageContribution = {
      input: usage.inputTokens ?? 0,
      output: usage.outputTokens ?? 0,
      cacheRead: usage.cachedInputTokens ?? 0,
      cacheWrite: usage.cacheWriteTokens ?? 0,
      model,
      provider
    }
    if (usage.kind === 'cumulative') {
      this.cumulative.set(id, contribution)
      return
    }
    const messageId = usage.messageId
    if (!messageId) return
    let ledger = this.messages.get(id)
    if (!ledger) this.messages.set(id, (ledger = new Map()))
    ledger.set(messageId, contribution)
  }

  private usageTotals(id: string): UsageAcc {
    const cumulative = this.cumulative.get(id)
    if (cumulative) return { ...cumulative }
    const total = emptyUsage()
    for (const contribution of this.messages.get(id)?.values() ?? []) addUsage(total, contribution)
    return total
  }

  private usageValue(id: string): { cost?: number; complete: boolean; hasUsage: boolean } {
    const cumulative = this.cumulative.get(id)
    if (cumulative) {
      const cost = estimateCostUsd(cumulative, cumulative.model, cumulative.provider)
      return { cost, complete: cost !== undefined, hasUsage: true }
    }
    const ledger = this.messages.get(id)
    if (!ledger?.size) return { complete: true, hasUsage: false }
    let total = 0
    let priced = 0
    for (const contribution of ledger.values()) {
      const cost = estimateCostUsd(contribution, contribution.model, contribution.provider)
      if (cost !== undefined) { total += cost; priced++ }
    }
    return { cost: priced ? total : undefined, complete: priced === ledger.size, hasUsage: true }
  }

  private refreshRootTaskCount(provider: ProviderId, sessionId: string): void {
    const rootId = providerKey(provider, sessionId)
    const root = this.agents.get(rootId)
    if (!root) return
    let count = 0
    let updatedAt = root.updatedAt
    for (const child of this.agents.values()) {
      if (child.parentId !== rootId) continue
      updatedAt = Math.max(updatedAt, child.updatedAt)
      if (child.state !== 'complete') count++
    }
    this.agents.set(rootId, { ...root, activeTasks: count, updatedAt })
  }

  private trimSeenEvents(now: number): void {
    if (this.seenEvents.size > 20_000) {
      const cutoff = now - DEFAULTS.staleMs
      for (const [key, at] of this.seenEvents) {
        if (at < cutoff || this.seenEvents.size > 40_000) this.seenEvents.delete(key)
      }
    }
    if (this.endedSessions.size > 20_000) {
      for (const key of this.endedSessions.keys()) {
        this.endedSessions.delete(key)
        if (!this.agents.has(key)) this.sessionStartedAt.delete(key)
        if (this.endedSessions.size <= 10_000) break
      }
    }
  }

  private removeAgent(id: string): void {
    const removed = this.agents.get(id)
    this.agents.delete(id)
    this.messages.delete(id)
    this.cumulative.delete(id)
    this.lastActorEventAt.delete(id)
    if (removed?.parentId) {
      const root = this.agents.get(removed.parentId)
      if (root) {
        let count = 0
        for (const child of this.agents.values()) {
          if (child.parentId === removed.parentId && child.state !== 'complete') count++
        }
        this.agents.set(removed.parentId, { ...root, activeTasks: count })
      }
    }
  }

  private removeSession(rootId: string): void {
    const ids = [...this.agents].filter(([id, agent]) => id === rootId || agent.parentId === rootId).map(([id]) => id)
    for (const id of ids) this.removeAgent(id)
  }
}

function basename(p: string): string {
  const parts = p.replace(/[\\/]+$/, '').split(/[\\/]/)
  return parts[parts.length - 1] || p
}
