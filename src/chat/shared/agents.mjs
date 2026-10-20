// The agents panel's cards: what a session's agents and background tasks are
// doing, read off the transcript for both providers. Pure and tested; the
// pane draws the cards (src/ui/agents.tsx) and decides when the panel shows.
//
// Claude Code: every top-level Agent row is a card, its steps the rows nested
// under it. A background agent's row closes as soon as it is launched, so it
// counts as running while the CLI lists its task (`background_tasks_changed`)
// or one of its steps still runs, and its end is what `task_notification`
// left on the row. A command sent to the background is a task card.
// Codex: a card per agent thread the multi-agent calls name, its state the
// latest of those calls' `agentsStates` and the `subAgentActivity` lines; a
// background terminal is a task card.

/** @typedef {import('./chatModel.mjs').Transcript} Transcript */
/** @typedef {import('./chatModel.mjs').ChatItem} ChatItem */
/** @typedef {import('./chatModel.mjs').ChatItemTool} ChatItemTool */

/**
 * @typedef {Object} AgentCard
 * @property {string} id the card's key: the Agent row's id (Claude), `agent:<thread id>` (Codex), `task:<task id>`
 * @property {'agent' | 'task'} kind
 * @property {string} name what it is doing: the Agent's description, the Codex agent's name, the command
 * @property {string} [type] Explore, general-purpose, a Codex model, Bash
 * @property {'running' | 'done' | 'failed' | 'stopped'} state
 * @property {boolean} background
 * @property {number} [startedAt]
 * @property {number} [endedAt]
 * @property {number} steps
 * @property {string} [latest] its latest step, one line
 * @property {string} [rowId] the transcript row it came from (where *Show in conversation* goes)
 * @property {string} [stopId] what Stop takes (`stopTask`): the CLI's task id, a Codex terminal's process id
 * @property {string} [prompt]
 * @property {string} [result]
 * @property {ChatItem[]} items its own steps, for the panel's detail view
 */

const ENDED = { completed: 'done', failed: 'failed', stopped: 'stopped' }
// CollabAgentStatus and SubAgentActivityKind (docs/rea/codex-app-server-ts/v2).
const CODEX_STATE = { pendingInit: 'running', running: 'running', interrupted: 'stopped', completed: 'done', errored: 'failed', shutdown: 'stopped', notFound: 'failed' }
const ACTIVITY_STATE = { started: 'running', interacted: 'running', interrupted: 'stopped', completed: 'done' }

/** A step's one line: its name and detail ("Fetch https://…"). */
export function stepLine(x) {
  if (x.kind === 'tool') return `${x.label ?? x.title}${x.label && x.detail ? ` ${x.detail}` : ''}`
  if (x.kind === 'system') return x.text
  return ''
}

/**
 * Every agent and background task of a session, running ones first in the
 * order they started, then the finished ones newest first.
 * @param {Transcript} t
 * @returns {AgentCard[]}
 */
export function agentCards(t) {
  const cards = t.provider === 'codex' ? codexAgents(t) : claudeAgents(t)
  const taken = new Set(cards.flatMap((c) => [c.rowId, c.stopId]).filter(Boolean))
  const rows = new Map(t.items.map((x) => [x.id, x]))
  for (const b of t.background) {
    if (taken.has(b.id) || (b.toolUseId && taken.has(b.toolUseId))) continue
    const row = b.toolUseId ? rows.get(b.toolUseId) : undefined
    const tool = row?.kind === 'tool' ? row : undefined
    cards.push({
      id: `task:${b.id}`, kind: 'task', name: b.description || tool?.detail || tool?.title || 'Background task',
      ...(tool?.label ? { type: tool.label } : b.type === 'terminal' ? { type: 'Terminal' } : {}),
      state: 'running', background: true, ...(tool ? { startedAt: tool.at, rowId: tool.id } : {}), steps: 0,
      ...(tool?.output ? { latest: lastLine(tool.output) } : {}), stopId: b.id, items: []
    })
  }
  // A task the CLI lists without a row has no start: it goes after the ones that do.
  const running = cards.filter((c) => c.state === 'running').sort((a, b) => (a.startedAt ?? Infinity) - (b.startedAt ?? Infinity))
  const ended = cards.filter((c) => c.state !== 'running').sort((a, b) => (b.endedAt ?? b.startedAt ?? 0) - (a.endedAt ?? a.startedAt ?? 0))
  return [...running, ...ended]
}

/** @param {Transcript} t @returns {AgentCard[]} */
function claudeAgents(t) {
  const ids = new Set(t.items.map((x) => x.id))
  /** @type {Map<string, ChatItem[]>} */
  const kids = new Map()
  for (const x of t.items) {
    const parent = 'parent' in x ? x.parent : undefined
    if (!parent || !ids.has(parent)) continue
    const list = kids.get(parent) ?? []
    list.push(x)
    kids.set(parent, list)
  }
  // Its tools are its steps; its thinking and text show in the detail view with them.
  /** @type {AgentCard[]} */
  const cards = []
  for (const x of t.items) {
    if (x.kind !== 'tool' || x.view !== 'agent' || (x.parent && ids.has(x.parent))) continue
    const steps = kids.get(x.id) ?? []
    const tools = steps.filter((s) => s.kind === 'tool')
    const task = t.background.find((b) => b.toolUseId === x.id || (!!x.taskId && b.id === x.taskId))
    const stepRunning = tools.some((s) => s.status === 'running')
    /** @type {AgentCard['state']} */
    let state
    if (x.status === 'running' || task || (x.background && !x.outcome && stepRunning)) state = 'running'
    else if (x.outcome) state = /** @type {AgentCard['state']} */ (ENDED[x.outcome])
    else if (x.status === 'failed') state = 'failed'
    else if (x.status === 'declined') state = 'stopped'
    else state = 'done'
    const last = tools[tools.length - 1]
    const stopId = state === 'running' && x.background ? x.taskId ?? task?.id : undefined
    // A background agent's summary is its last reply, already among its steps: no second copy as OUT.
    const said = x.summary?.trim()
    const result = said && steps.some((s) => s.kind === 'assistant' && s.text.trim() === said) ? undefined : x.summary ?? (x.background ? undefined : x.output)
    cards.push({
      id: x.id, kind: 'agent', name: x.detail || 'Agent', ...(x.agentType ? { type: x.agentType } : {}), state, background: !!x.background,
      startedAt: x.at, ...(x.endedAt ? { endedAt: x.endedAt } : {}), steps: tools.length, ...(last ? { latest: stepLine(last) } : {}),
      rowId: x.id, ...(stopId ? { stopId } : {}), ...(x.prompt ? { prompt: x.prompt } : {}), ...(result ? { result } : {}), items: steps
    })
  }
  // A command sent to the background is a task, live or finished.
  for (const x of t.items) {
    if (x.kind !== 'tool' || !x.background || x.view === 'agent') continue
    const task = t.background.find((b) => b.toolUseId === x.id || (!!x.taskId && b.id === x.taskId))
    const state = task ? 'running' : x.outcome ? ENDED[x.outcome] : 'done'
    cards.push({
      id: `task:${x.taskId ?? x.id}`, kind: 'task', name: x.detail || x.title, type: x.label ?? x.name, state, background: true,
      startedAt: x.at, ...(x.endedAt ? { endedAt: x.endedAt } : {}), steps: 0, ...(x.output ? { latest: lastLine(x.output) } : {}),
      rowId: x.id, ...(task ? { stopId: task.id } : {}), ...(x.summary ? { result: x.summary } : {}), items: []
    })
  }
  return cards
}

/** @param {Transcript} t @returns {AgentCard[]} */
function codexAgents(t) {
  /** @type {Map<string, { first: ChatItemTool | null, items: ChatItem[], state: AgentCard['state'], name: string | null, message: string | null, model: string | null, endedAt?: number }>} */
  const agents = new Map()
  const entry = (id) => {
    let a = agents.get(id)
    if (!a) agents.set(id, (a = { first: null, items: [], state: 'running', name: null, message: null, model: null }))
    return a
  }
  for (const x of t.items) {
    if (x.kind === 'tool' && x.collab) {
      const named = new Set([...x.collab.receivers, ...Object.keys(x.collab.states)])
      for (const id of named) {
        const a = entry(id)
        if (!a.first) a.first = x
        a.items.push(x)
        if (x.collab.model && !a.model) a.model = x.collab.model
        const s = x.collab.states[id]
        if (s) {
          a.state = /** @type {AgentCard['state']} */ (CODEX_STATE[s.status] ?? a.state)
          if (s.message) a.message = s.message
          if (a.state !== 'running') a.endedAt = x.at
        }
      }
    } else if (x.kind === 'system' && x.agent) {
      const a = entry(x.agent.id)
      a.items.push(x)
      a.name = x.agent.name
      a.state = /** @type {AgentCard['state']} */ (ACTIVITY_STATE[x.agent.kind] ?? a.state)
      if (a.state !== 'running') a.endedAt = x.at
    }
  }
  return [...agents].map(([id, a]) => {
    const last = a.items[a.items.length - 1]
    const prompt = a.first?.collab?.tool === 'spawnAgent' ? a.first.prompt : undefined
    const latest = firstLine(a.message ?? (last ? stepLine(last) : ''))
    const started = a.first ?? last
    return {
      id: `agent:${id}`, kind: 'agent', name: a.name ?? (prompt ? firstLine(prompt) : 'Agent'), ...(a.model ? { type: a.model } : {}), state: a.state, background: true,
      ...(started ? { startedAt: started.at } : {}), ...(a.first ? { rowId: a.first.id } : {}), ...(a.endedAt && a.state !== 'running' ? { endedAt: a.endedAt } : {}),
      steps: a.items.length, ...(latest ? { latest } : {}), ...(prompt ? { prompt } : {}), ...(a.state !== 'running' && a.message ? { result: a.message } : {}), items: a.items
    }
  })
}

/**
 * The composer chip's words for what runs now: "2 agents", "1 in background",
 * "1 agent · 1 in background"; null when nothing runs.
 * @param {AgentCard[]} cards
 */
export function runningLabel(cards) {
  const live = cards.filter((c) => c.state === 'running')
  const agents = live.filter((c) => c.kind === 'agent').length
  const tasks = live.length - agents
  const parts = [agents ? `${agents} agent${agents === 1 ? '' : 's'}` : null, tasks ? `${tasks} in background` : null].filter(Boolean)
  return parts.length ? parts.join(' · ') : null
}

function lastLine(text) {
  const lines = String(text).split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  return firstLine(lines[lines.length - 1] ?? '')
}

function firstLine(text, max = 120) {
  const line = (String(text).split(/\r?\n/).find((l) => l.trim()) ?? '').trim()
  return line.length > max ? `${line.slice(0, max - 1)}…` : line
}
