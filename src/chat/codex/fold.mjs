// Folds Codex app-server notifications, server requests and stored threads
// into the shared transcript. Pure; the vocabulary is the one
// `codex app-server generate-ts` emits for 0.163.0 (docs/rea/codex-app-server-ts,
// experimental fields included since the client opts into `experimentalApi`),
// the shapes the probes observed (docs/rea/codex-samples,
// scripts/probe-codex-features.mjs), and the Codex extension's own wording
// (docs/rea-findings.md, "Codex pass").
import { addUsage, answerQuestion, appendDelta, appendItem, clip, closeTurn, decideApproval, emptyTranscript, MAX_TOOL_OUTPUT, setStatus, settleStreams, updateItem } from '../shared/chatModel.mjs'
import { argDetail, formatElapsed, mcpTitle } from '../shared/present.mjs'

/** Codex server-request methods the pane answers as approvals. */
export const APPROVAL_METHODS = new Set([
  'item/commandExecution/requestApproval',
  'item/fileChange/requestApproval',
  'item/permissions/requestApproval',
  'execCommandApproval',
  'applyPatchApproval'
])

/** Codex server-request methods the pane answers as questions. */
export const QUESTION_METHODS = new Set(['item/tool/requestUserInput', 'mcpServer/elicitation/request'])

/** Our choices in Codex's words (CommandExecutionApprovalDecision / FileChangeApprovalDecision); the two amendments are built from the request. */
export const DECISIONS = { allow: 'accept', 'allow-session': 'acceptForSession', deny: 'decline', cancel: 'cancel' }

/** The legacy pair (`execCommandApproval`, `applyPatchApproval`) answers with ReviewDecision. */
export const LEGACY_DECISIONS = { allow: 'approved', 'allow-session': 'approved_for_session', 'allow-rule': 'approved_for_session', 'allow-host': 'approved_for_session', deny: 'denied', cancel: 'abort' }

/**
 * The Codex extension's permission menu (composer.permissionsDropdown.*), in
 * one word each (the user's call, 2026-10-20: *Ask for approval*, *Approve for
 * me* and *Full access* are Ask, Auto and Full), spelled as the `turn/start` overrides `approvalPolicy`, `sandboxPolicy` and
 * `approvalsReviewer`. `custom` is never sent: it names a thread whose
 * settings came from the user's config.toml and match none of the three.
 */
export const CODEX_MODES = [
  {
    id: 'ask', label: 'Ask', description: 'Always ask to edit external files and use the internet',
    approvalPolicy: 'on-request', approvalsReviewer: 'user', sandboxPolicy: { type: 'workspaceWrite', writableRoots: [], networkAccess: false, excludeTmpdirEnvVar: false, excludeSlashTmp: false }
  },
  {
    id: 'auto-review', label: 'Auto', description: 'Only ask for actions detected as potentially unsafe',
    approvalPolicy: 'on-request', approvalsReviewer: 'auto_review', sandboxPolicy: { type: 'workspaceWrite', writableRoots: [], networkAccess: false, excludeTmpdirEnvVar: false, excludeSlashTmp: false }
  },
  {
    id: 'full-access', label: 'Full', description: 'Unrestricted access to the internet and any file on your computer',
    approvalPolicy: 'never', approvalsReviewer: 'user', sandboxPolicy: { type: 'dangerFullAccess' },
    confirm: {
      title: 'Turn on Full Access?',
      body: 'Codex will be able to run commands, use the internet, and create and edit files anywhere on this computer without your permission. This comes with risks like loss or exposure of sensitive data and prompt injection.',
      action: 'Confirm'
    }
  }
]
export const CUSTOM_MODE = { id: 'custom', label: 'Custom (config.toml)', description: 'Uses permissions defined in config.toml' }

/** Which of the menu's modes a thread's effective settings (thread/settings/updated) are, else `custom`. */
export function codexModeId(settings) {
  const policy = settings?.approvalPolicy
  const sandbox = settings?.sandboxPolicy?.type
  const reviewer = settings?.approvalsReviewer ?? 'user'
  if (policy === 'never' && sandbox === 'dangerFullAccess') return 'full-access'
  if (policy === 'on-request' && sandbox === 'workspaceWrite') return reviewer === 'user' ? 'ask' : 'auto-review'
  return 'custom'
}

const msFrom = (sec) => (typeof sec === 'number' ? sec * 1000 : Date.now())

/**
 * The command Codex actually ran, without the shell wrapper it is launched
 * through (`"…\pwsh.exe" -Command '…'`, `bash -lc '…'`): a single parsed
 * action's own command, else the wrapper's argument, else the whole line.
 */
export function innerCommand(command, actions) {
  const list = Array.isArray(actions) ? actions : []
  if (list.length === 1 && list[0]?.command) return list[0].command
  const cmd = String(command ?? '')
  const m = /^(?:"[^"]+"|\S+)\s+(?:-NoProfile\s+|-NoLogo\s+)*-(?:Command|c|lc)\s+(['"])([\s\S]*)\1\s*$/i.exec(cmd)
  if (m) return m[1] === "'" ? m[2].replace(/''/g, "'") : m[2].replace(/\\"/g, '"')
  return cmd
}

/**
 * One ThreadItem → one or none ChatItem. `at` is epoch ms. `live` says
 * whether the item has just started (item/started), which some rows word
 * differently ("Searching the web" → "Searched the web").
 */
export function itemToChat(item, at, live = false) {
  if (!item || typeof item !== 'object') return null
  switch (item.type) {
    case 'userMessage': {
      const text = (item.content ?? []).map((c) => (c.type === 'text' ? c.text : c.type === 'mention' || c.type === 'skill' ? `@${c.name}` : `[${c.type}]`)).join('')
      return { kind: 'user', id: item.id, text, at }
    }
    case 'agentMessage':
      return { kind: 'assistant', id: item.id, text: item.text ?? '', streaming: false, at, ...(item.phase === 'commentary' ? { phase: 'commentary' } : item.phase === 'final_answer' ? { phase: 'final' } : {}) }
    case 'reasoning': {
      const text = [...(item.summary ?? []), ...(item.content ?? [])].join('\n\n')
      return text ? { kind: 'thinking', id: item.id, text, streaming: false, at } : null
    }
    case 'plan':
      return { kind: 'assistant', id: item.id, text: item.text ?? '', streaming: false, at, plan: true }
    case 'commandExecution': {
      const input = innerCommand(item.command, item.commandActions)
      return {
        kind: 'tool', id: item.id, name: 'commandExecution', title: commandTitle(item, input), input,
        output: item.aggregatedOutput ? clip(item.aggregatedOutput, MAX_TOOL_OUTPUT) : undefined,
        status: toolStatus(item.status, item.exitCode), at, ...commandView(item, input),
        ...(typeof item.durationMs === 'number' ? { elapsedMs: item.durationMs } : {})
      }
    }
    case 'fileChange': {
      const changes = item.changes ?? []
      const files = changes.map((c) => c.path).filter(Boolean)
      const edits = changes.map((c) => ({ path: c.path ?? '', kind: c.kind?.type, diff: clip(String(c.diff ?? ''), MAX_TOOL_OUTPUT) }))
      return {
        kind: 'tool', id: item.id, name: 'fileChange', title: files.length ? `Edited ${files.map(baseName).join(', ')}` : 'Edited files', input: files.join('\n'), status: toolStatus(item.status), at,
        label: item.status === 'inProgress' ? 'Editing' : 'Edited', detail: files.length > 1 ? `${files.length} files` : files.map(baseName).join(', ') || undefined, detailMono: files.length === 1, view: 'edit', edits,
        ...(files.length === 1 ? { path: files[0] } : {})
      }
    }
    case 'mcpToolCall':
      return {
        kind: 'tool', id: item.id, name: `${item.server}.${item.tool}`, title: `${item.server} · ${item.tool}`, input: safeJson(item.arguments),
        output: item.result ? clip(mcpResultText(item.result), MAX_TOOL_OUTPUT) : item.error ? clip(String(item.error.message ?? safeJson(item.error)), MAX_TOOL_OUTPUT) : undefined,
        status: toolStatus(item.status), at, label: mcpTitle(item.server ?? '', item.tool ?? ''), detail: argDetail(item.arguments), view: 'other',
        ...(typeof item.durationMs === 'number' ? { elapsedMs: item.durationMs } : {})
      }
    case 'dynamicToolCall':
      return { kind: 'tool', id: item.id, name: item.tool, title: item.tool, input: safeJson(item.arguments), status: item.success === false ? 'failed' : toolStatus(item.status), at, label: item.tool, view: 'other' }
    case 'webSearch':
      return webSearchItem(item, at, live)
    case 'imageView':
      return { kind: 'tool', id: item.id, name: 'imageView', title: `Viewed ${baseName(item.path ?? '')}`, status: 'done', at, label: 'Viewed image', detail: baseName(item.path ?? '') || undefined, detailMono: true, view: 'read', ...(item.path ? { path: item.path } : {}) }
    case 'imageGeneration': {
      const failed = !!item.failure || item.status === 'failed'
      return {
        kind: 'tool', id: item.id, name: 'imageGeneration', title: 'Generated image', status: live && !item.savedPath && !failed ? 'running' : failed ? 'failed' : 'done', at,
        label: live && !item.savedPath ? 'Generating image' : 'Generated image', detail: item.revisedPrompt || undefined, view: 'read', ...(item.savedPath ? { path: item.savedPath } : {})
      }
    }
    case 'sleep':
      return { kind: 'tool', id: item.id, name: 'sleep', title: 'Waited', status: live ? 'running' : 'done', at, label: live ? 'Waiting' : 'Waited', detail: typeof item.durationMs === 'number' ? formatElapsed(item.durationMs) : undefined, view: 'other' }
    case 'collabAgentToolCall':
      return collabItem(item, at)
    case 'subAgentActivity':
      return {
        kind: 'system', id: item.id, text: `${agentName(item.agentPath)} ${SUBAGENT_KIND[item.kind] ?? 'updated'}`, level: 'info', at, variant: 'task',
        ...(item.agentThreadId ? { agent: { id: String(item.agentThreadId), name: agentName(item.agentPath), kind: String(item.kind ?? '') } } : {})
      }
    case 'enteredReviewMode':
      return { kind: 'system', id: item.id, text: 'Code review started', level: 'info', at, variant: 'review', ...(item.review ? { detail: item.review } : {}) }
    case 'exitedReviewMode':
      return item.review ? { kind: 'assistant', id: item.id, text: item.review, streaming: false, at, phase: 'final' } : null
    case 'error':
      return { kind: 'system', id: item.id, text: item.message ?? 'error', level: 'error', at }
    case 'contextCompaction':
      return live
        ? { kind: 'system', id: item.id, text: 'Compacting context', level: 'info', at, variant: 'compact', running: true }
        : { kind: 'system', id: item.id, text: 'Context compacted', level: 'info', at, variant: 'compact' }
    default:
      return null
  }
}

const SUBAGENT_KIND = { started: 'started working', interacted: 'updated', interrupted: 'interrupted', completed: 'finished' }

function agentName(path) {
  const name = String(path ?? '').split(/[\\/]/).filter(Boolean).pop()
  return name || 'Agent'
}

/** A web search in the extension's words (localConversation.agentActivity.*): searching, opening a page, finding in it. */
function webSearchItem(item, at, live) {
  const a = item.action ?? {}
  const type = a.type === 'open_page' ? 'openPage' : a.type === 'find_in_page' ? 'findInPage' : a.type
  const query = item.query || a.query || (Array.isArray(a.queries) ? a.queries.join(', ') : '')
  let label = live ? 'Searching the web' : 'Searched the web'
  let detail = query || undefined
  if (type === 'openPage') {
    label = live ? 'Opening' : 'Opened'
    detail = hostOf(a.url) ?? (a.url || undefined)
  } else if (type === 'findInPage') {
    label = live ? 'Searching in page' : 'Searched in page'
    detail = a.pattern || hostOf(a.url) || undefined
  }
  return { kind: 'tool', id: item.id, name: 'webSearch', title: `${label}${detail ? ` · ${detail}` : ''}`, status: live ? 'running' : 'done', at, label, detail, view: 'other' }
}

function hostOf(url) {
  try {
    return url ? new URL(url).hostname : undefined
  } catch {
    return undefined
  }
}

const COLLAB_LABELS = {
  spawnAgent: ['Creating agent', 'Created agent'],
  sendInput: ['Messaging agent', 'Messaged agent'],
  sendMessage: ['Messaging agent', 'Messaged agent'],
  followupTask: ['Messaging agent', 'Messaged agent'],
  resumeAgent: ['Resuming agent', 'Resumed agent'],
  wait: ['Waiting for agents', 'Waited for agents'],
  closeAgent: ['Closing agent', 'Closed agent'],
  interruptAgent: ['Interrupting agent', 'Interrupted agent'],
  listAgents: ['Listing agents', 'Listed agents']
}

/** A multi-agent tool call (spawn, message, wait…) as an Agent row: the instructions as IN, each agent's last state as OUT. */
function collabItem(item, at) {
  const running = item.status === 'inProgress'
  const [doing, done] = COLLAB_LABELS[item.tool] ?? ['Using agents', 'Used agents']
  const states = Object.entries(item.agentsStates ?? {}).map(([id, s]) => `${id}: ${s?.status ?? 'unknown'}${s?.message ? ` — ${s.message}` : ''}`)
  const receivers = (item.receiverThreadIds ?? []).map(String)
  const n = receivers.length
  // Which agents the call touched and how each stood, for the agents panel's cards.
  const collab = {
    tool: String(item.tool ?? ''), receivers,
    states: Object.fromEntries(Object.entries(item.agentsStates ?? {}).map(([id, s]) => [id, { status: String(s?.status ?? 'unknown'), ...(s?.message ? { message: String(s.message) } : {}) }])),
    ...(item.model ? { model: String(item.model) } : {})
  }
  return {
    kind: 'tool', id: item.id, name: 'collabAgentToolCall', title: done, status: item.status === 'failed' ? 'failed' : running ? 'running' : 'done', at,
    label: running ? doing : done, detail: [item.model, n > 1 ? `${n} agents` : null].filter(Boolean).join(' · ') || undefined, view: 'agent', collab,
    ...(item.prompt ? { prompt: item.prompt } : {}), ...(states.length ? { output: states.join('\n') } : {})
  }
}

function toolStatus(status, exitCode) {
  if (status === 'inProgress') return 'running'
  if (status === 'declined') return 'declined'
  if (status === 'failed') return 'failed'
  if (typeof exitCode === 'number' && exitCode !== 0) return 'failed'
  return 'done'
}

/**
 * A command row's verb and detail, in the Codex extension's words
 * (toolSummaryForCmd.*): a single read is "Read <file>", a search
 * "Searched for <query>", a listing "Listed files", anything else
 * "Ran <command>" ("Running" while it runs). The IN row shows the command
 * without its shell wrapper.
 */
function commandView(item, input) {
  const actions = item.commandActions ?? []
  const one = actions.length === 1 ? actions[0] : null
  const running = item.status === 'inProgress'
  if (one?.type === 'read') return { label: running ? 'Reading' : 'Read', detail: one.name || baseName(one.path ?? ''), detailMono: true, view: 'read', ...(one.path ? { path: one.path } : {}) }
  if (one?.type === 'search') {
    const where = one.path ? ` in ${baseName(one.path)}` : ''
    return { label: running ? 'Searching for' : 'Searched for', detail: one.query ? `${one.query}${where}` : `files${where}`, detailMono: !!one.query, view: 'search' }
  }
  if (one?.type === 'listFiles') return { label: running ? 'Listing files' : 'Listed files', detail: one.path ? `in ${one.path}` : undefined, detailMono: !!one.path, view: 'search' }
  const userShell = item.source === 'userShell'
  return { label: userShell ? (running ? 'Running your command' : 'You ran') : running ? 'Running' : 'Ran', detail: firstLineOf(input, 120), detailMono: true, view: 'command' }
}

function commandTitle(item, input) {
  const actions = item.commandActions ?? []
  if (actions.length && actions.every((a) => a.type !== 'unknown')) {
    return actions.map((a) => (a.type === 'read' ? `Read ${a.name}` : a.type === 'listFiles' ? `List ${a.path ?? ''}`.trim() : a.type === 'search' ? `Search ${a.query ?? ''}`.trim() : a.command)).join(' · ')
  }
  return firstLineOf(input)
}

function firstLineOf(s, max = 160) {
  const line = String(s ?? '').split(/\r?\n/).find((l) => l.trim()) ?? ''
  return line.length > max ? `${line.slice(0, max - 1)}…` : line
}

function baseName(p) {
  const m = /[^\\/]+$/.exec(p ?? '')
  return m ? m[0] : p
}

function safeJson(v) {
  try {
    return typeof v === 'string' ? v : JSON.stringify(v, null, 1)
  } catch {
    return String(v)
  }
}

function mcpResultText(result) {
  const content = result?.content
  if (Array.isArray(content)) return content.map((c) => (c.type === 'text' ? c.text : `[${c.type}]`)).join('\n')
  return safeJson(result)
}

/**
 * A stored thread (thread/read with turns, or thread/resume) → a transcript.
 * @param {object} thread the `Thread` from the response
 */
export function threadToTranscript(thread) {
  let t = emptyTranscript('codex', { cwd: thread.cwd ?? '', sessionId: thread.id, model: thread.model ?? null, title: thread.name ?? null })
  // A fork starts where its source left off (localConversation.forkedFromConversation).
  if (thread.forkedFromId) t = appendItem(t, { kind: 'system', id: `fork:${thread.id}`, text: 'Continued from chat', level: 'info', at: msFrom(thread.createdAt), variant: 'fork' })
  for (const turn of thread.turns ?? []) t = foldTurnItems(t, turn)
  return t
}

/** "You stopped after 12s" (localConversation.userStoppedAfter), or the bare word when the time is unknown. */
function stoppedText(durationMs) {
  return typeof durationMs === 'number' ? `You stopped after ${formatElapsed(durationMs)}` : 'You stopped'
}

/** Append a turn's items (history pages come as turns too). */
export function foldTurnItems(t, turn) {
  const at = msFrom(turn.startedAt)
  let users = 0
  for (const item of turn.items ?? []) {
    const chat = itemToChat(item, at)
    if (chat?.kind === 'user') {
      // A prompt keeps its turn (`thread/fork` forks through a turn id); a second one in the same turn was steered in.
      if (turn.id) chat.turnId = turn.id
      if (users++ > 0) chat.steered = true
    }
    if (chat) t = appendItem(t, chat)
  }
  const durationMs = typeof turn.durationMs === 'number' ? turn.durationMs : typeof turn.completedAt === 'number' && typeof turn.startedAt === 'number' ? (turn.completedAt - turn.startedAt) * 1000 : undefined
  if (turn.status === 'failed' && turn.error?.message) t = appendItem(t, { kind: 'system', id: `${turn.id}:error`, text: turn.error.message, level: 'error', at })
  if (turn.status === 'interrupted') t = appendItem(t, { kind: 'system', id: `${turn.id}:interrupted`, text: stoppedText(durationMs), level: 'info', at, variant: 'interrupt' })
  if (turn.status === 'completed' || turn.status === 'interrupted' || turn.status === 'failed') {
    const end = typeof turn.completedAt === 'number' ? turn.completedAt * 1000 : at
    t = closeTurn(t, { at: end, durationMs, id: `turn:${turn.id}`, turnId: turn.id, interrupted: turn.status === 'interrupted' })
  }
  return t
}

/** Merge a sparse rate-limit update into what the pane holds (a null window never clears a known one). */
export function mergeLimits(prev, snap) {
  if (!snap || typeof snap !== 'object') return prev
  const win = (w) => (w && typeof w.usedPercent === 'number' ? { usedPercent: w.usedPercent, windowMins: w.windowDurationMins ?? null, resetsAt: w.resetsAt ?? null } : null)
  return {
    primary: win(snap.primary) ?? prev?.primary ?? null,
    secondary: win(snap.secondary) ?? prev?.secondary ?? null,
    reached: snap.rateLimitReachedType ?? prev?.reached ?? null
  }
}

const PLAN_STATUS = { pending: 'pending', inProgress: 'in_progress', completed: 'completed' }

/**
 * Fold one server notification. Unknown methods leave the transcript as is.
 * @param {import('../shared/chatModel.mjs').Transcript} t
 * @param {{ method: string, params: any, emittedAtMs?: number }} n
 */
export function foldNotification(t, n) {
  const p = n.params ?? {}
  const at = n.emittedAtMs ?? Date.now()
  if (p.threadId && t.sessionId && p.threadId !== t.sessionId) return t
  switch (n.method) {
    case 'thread/started':
      // It names its thread only inside \`thread\`: on a shared server another pane's thread (or a side question's fork)
      // starts too, so only our own thread's start counts. Ours gets its id from the start response anyway.
      return t.sessionId && p.thread?.id === t.sessionId ? { ...t, model: p.thread?.model ?? t.model, cwd: p.thread?.cwd ?? t.cwd } : t
    case 'thread/name/updated':
      return typeof p.name === 'string' ? { ...t, title: p.name } : t
    case 'thread/settings/updated': {
      const s = p.threadSettings ?? {}
      return {
        ...t,
        model: s.model ?? t.model,
        effort: s.effort !== undefined ? s.effort : t.effort,
        permissionMode: codexModeId(s),
        fastMode: s.serviceTier === 'priority' ? 'on' : 'off',
        planMode: s.collaborationMode?.mode === 'plan'
      }
    }
    case 'turn/started':
      // The pane stamps the clock when it sends; a turn another client started gets it here.
      if (t.status === 'running' && t.turnStartedAt) return t
      return { ...setStatus(t, 'running'), turnStartedAt: at, retry: null }
    case 'turn/completed': {
      const turn = p.turn ?? {}
      let next = { ...settleStreams(t), retry: null }
      // A plan step still marked in progress when the turn ends is as done as it will get.
      for (const x of next.items) if (x.kind === 'tool' && x.name === 'update_plan' && x.status === 'running') next = updateItem(next, x.id, { status: 'done' })
      const durationMs = typeof turn.durationMs === 'number' ? turn.durationMs : t.turnStartedAt ? Math.max(0, at - t.turnStartedAt) : undefined
      if (turn.status === 'failed') next = setStatus(appendItem(next, { kind: 'system', id: `${turn.id}:error`, text: turn.error?.message ?? 'The turn failed', level: 'error', at }), 'error', turn.error?.message ?? 'The turn failed')
      else if (turn.status === 'interrupted') next = setStatus(appendItem(next, { kind: 'system', id: `${turn.id}:interrupted`, text: stoppedText(durationMs), level: 'info', at, variant: 'interrupt' }), 'idle')
      else next = setStatus(next, 'idle')
      // In plan mode a turn that ended on a plan asks *Implement this plan?*
      if (turn.status === 'completed' && next.planMode) {
        const plan = [...next.items].reverse().find((x) => x.kind === 'assistant' && x.plan)
        const since = next.items.findLastIndex((x) => x.kind === 'user' && !x.steered)
        if (plan && next.items.indexOf(plan) > since) next = { ...next, pendingPlan: plan.id }
      }
      return closeTurn(next, { at, durationMs, id: `turn:${turn.id ?? at}`, ...(turn.id ? { turnId: turn.id } : {}), interrupted: turn.status === 'interrupted' })
    }
    case 'item/started': {
      const start = p.startedAtMs ?? at
      // Reasoning gets its row at the start even before (or without) a summary, so it can be timed.
      const chat = itemToChat(p.item, start, true) ?? (p.item?.type === 'reasoning' && p.item.id ? { kind: 'thinking', id: p.item.id, text: '', streaming: true, at: start } : null)
      if (!chat) return t
      if (chat.kind === 'assistant' || chat.kind === 'thinking') chat.streaming = true
      if (chat.kind === 'user' && p.turnId) chat.turnId = p.turnId
      return placeItem({ ...t, retry: null }, chat)
    }
    case 'item/completed': {
      const end = p.completedAtMs ?? at
      const chat = itemToChat(p.item, end)
      if (chat?.kind === 'user' && p.turnId) chat.turnId = p.turnId
      const existing = p.item?.id ? t.items.find((x) => x.id === p.item.id) : undefined
      if (existing?.kind === 'thinking') {
        // Keep the start time; the row now says how long the reasoning took.
        return updateItem(t, existing.id, { text: chat?.kind === 'thinking' ? chat.text : existing.text, streaming: false, durationMs: Math.max(0, end - existing.at) })
      }
      if (!chat) return t
      // A compaction the pane did not ask for reads as automatic (localConversation.contextAutomaticallyCompacted).
      if (chat.kind === 'system' && chat.variant === 'compact' && t.activity !== 'compacting') chat.text = 'Context automatically compacted'
      const placed = placeItem(t, chat)
      return chat.kind === 'system' && chat.variant === 'compact' ? { ...placed, activity: null } : placed
    }
    case 'item/agentMessage/delta':
      return appendDelta(t, p.itemId, 'assistant', p.delta, at)
    case 'item/plan/delta': {
      const next = appendDelta(t, p.itemId, 'assistant', p.delta, at)
      return next === t ? t : updateItem(next, p.itemId, { plan: true })
    }
    case 'item/reasoning/summaryTextDelta':
    case 'item/reasoning/textDelta':
      return appendDelta(t, p.itemId, 'thinking', p.delta, at)
    case 'item/commandExecution/outputDelta':
      return updateItem(t, p.itemId, (item) => (item.kind === 'tool' ? { ...item, output: clip((item.output ?? '') + (p.delta ?? ''), MAX_TOOL_OUTPUT) } : item))
    case 'turn/plan/updated': {
      // The update_plan tool's checklist (TurnPlanUpdatedNotification), one row per turn, updated in place.
      const todos = (p.plan ?? []).map((s) => ({ content: String(s.step ?? ''), status: PLAN_STATUS[s.status] ?? 'pending' }))
      const done = todos.filter((x) => x.status === 'completed').length
      const id = `plan:${p.turnId ?? 'turn'}`
      const row = {
        kind: 'tool', id, name: 'update_plan', title: 'Plan', status: done === todos.length ? 'done' : 'running', at,
        label: 'Plan', detail: todos.length ? `${done} of ${todos.length} done` : undefined, view: 'todo', todos, ...(p.explanation ? { output: p.explanation } : {})
      }
      return t.items.some((x) => x.id === id) ? updateItem(t, id, (cur) => ({ ...row, at: cur.at })) : appendItem(t, row)
    }
    case 'thread/tokenUsage/updated': {
      const u = p.tokenUsage ?? {}
      const last = u.last ?? u.lastTokenUsage ?? {}
      // The window holds the last call's tokens; `total` adds up the whole thread and outgrows any window.
      const lastTotal = num(last.totalTokens) ?? (typeof last.inputTokens === 'number' ? last.inputTokens + num(last.outputTokens ?? 0) : undefined)
      return addUsage(t, {
        inputTokens: num(last.inputTokens), outputTokens: num(last.outputTokens),
        contextTokens: lastTotal ?? num(u.contextTokens), contextWindow: num(u.modelContextWindow)
      })
    }
    case 'account/rateLimits/updated':
      return { ...t, limits: mergeLimits(t.limits, p.rateLimits) }
    case 'thread/prediction/updated':
      return p.result?.type === 'completed' && typeof p.result.text === 'string' && p.result.text.trim() && t.status !== 'running' ? { ...t, suggestion: p.result.text.trim() } : t
    case 'model/rerouted':
      return appendItem(t, { kind: 'system', id: `reroute:${p.turnId ?? at}`, text: `Your request was routed to ${p.toModel}.`, level: 'warning', at, variant: 'model', ...(p.reason ? { detail: `From ${p.fromModel}: ${typeof p.reason === 'string' ? p.reason : safeJson(p.reason)}` } : {}) })
    case 'warning':
    case 'guardianWarning':
      return p.message ? noticeOnce(t, `warn:${p.message}`, p.message, at) : t
    case 'configWarning':
      return p.summary ? noticeOnce(t, `config:${p.summary}`, p.summary, at, p.details) : t
    case 'error': {
      if (p.willRetry) {
        // Codex is reconnecting on its own (localConversation.streamError.*): the working line counts the attempts.
        const attempt = (t.retry?.attempt ?? 0) + 1
        return { ...t, retry: { attempt, max: 0 } }
      }
      return setStatus(appendItem({ ...t, retry: null }, { kind: 'system', id: `err:${at}`, text: p.error?.message ?? 'error', level: 'error', at }), 'error', p.error?.message ?? 'error')
    }
    case 'thread/compacted':
      // Older servers report a compaction only here; newer ones send a contextCompaction item too.
      if (t.items.some((x) => x.kind === 'system' && x.variant === 'compact' && at - x.at < 5000)) return { ...t, activity: null }
      return { ...appendItem(t, { kind: 'system', id: `compact:${at}`, text: t.activity === 'compacting' ? 'Context compacted' : 'Context automatically compacted', level: 'info', at, variant: 'compact' }), activity: null }
    case 'serverRequest/resolved': {
      const id = String(p.requestId)
      const next = decideApproval(t, id, 'cancel')
      return next === t ? answerQuestion(t, id, null) : next
    }
    default:
      return t
  }
}

const num = (v) => (typeof v === 'number' ? v : undefined)

function noticeOnce(t, id, text, at, detail) {
  if (t.items.some((x) => x.id === id)) return t
  return appendItem(t, { kind: 'system', id, text, level: 'warning', at, variant: 'notice', ...(detail ? { detail } : {}) })
}

/**
 * Update an item in place by id, else append. The server echoes the user's
 * own message as a `userMessage` item: that lands on the row the client
 * appended when it sent (`local:` id, same text) instead of doubling it. A
 * second prompt in a turn that already has one was steered into it.
 */
function placeItem(t, chat) {
  // An item seen before keeps the time it started; its completion only updates it.
  if (t.items.some((x) => x.id === chat.id)) return updateItem(t, chat.id, (cur) => ({ ...cur, ...chat, at: cur.at, ...(cur.kind === 'user' && cur.steered ? { steered: true } : {}) }))
  if (chat.kind === 'user') {
    const local = [...t.items].reverse().find((x) => x.kind === 'user' && x.id.startsWith('local:') && x.text.trim() === chat.text.trim())
    if (local) return updateItem(t, local.id, { ...local, id: chat.id, ...(chat.turnId ? { turnId: chat.turnId } : {}) })
    if (chat.turnId && t.items.some((x) => x.kind === 'user' && x.turnId === chat.turnId)) chat.steered = true
  }
  return appendItem(t, chat)
}

/**
 * The numbered options of a command prompt, from the request's own ordered
 * `availableDecisions` (or the classic three), in the Codex extension's words
 * (approvalRequestCard.*, execApprovalRequest.*). `cancel` is Escape.
 */
export function commandOptions(p) {
  const decisions = Array.isArray(p.availableDecisions) && p.availableDecisions.length ? p.availableDecisions : ['accept', 'acceptForSession', 'decline']
  const host = p.networkApprovalContext?.host
  const out = []
  for (const d of decisions) {
    if (d === 'accept') out.push({ choice: 'allow', label: 'Allow once' })
    else if (d === 'acceptForSession') out.push({ choice: 'allow-session', label: 'Allow this conversation' })
    else if (d === 'decline') out.push({ choice: 'deny', label: 'Deny' })
    else if (d && typeof d === 'object' && d.acceptWithExecpolicyAmendment) {
      const rule = (d.acceptWithExecpolicyAmendment.execpolicy_amendment ?? p.proposedExecpolicyAmendment ?? []).join(' ')
      out.push({ choice: 'allow-rule', label: 'Allow similar commands', ...(rule ? { hint: 'Allow commands that start with', rule } : {}) })
    } else if (d && typeof d === 'object' && d.applyNetworkPolicyAmendment) {
      const target = d.applyNetworkPolicyAmendment.network_policy_amendment?.host ?? host
      out.push({ choice: 'allow-host', label: 'Always allow', ...(target ? { hint: 'Always allow connections to', rule: target } : {}) })
    }
  }
  if (!out.some((o) => o.choice === 'deny')) out.push({ choice: 'deny', label: 'Deny' })
  return out
}

/** File-edit prompt options (patchApprovalRequest.*). */
export const EDIT_OPTIONS = [
  { choice: 'allow', label: 'Allow once' },
  { choice: 'allow-session', label: 'Allow all edits', hint: 'Allow this and future file edits in this conversation without asking again' },
  { choice: 'deny', label: 'Deny' }
]

/**
 * A server request → an approval item (or a question, or neither).
 * @returns {{ transcript: import('../shared/chatModel.mjs').Transcript, approval: import('../shared/chatModel.mjs').ChatItemApproval | null, question: import('../shared/chatModel.mjs').ChatItemQuestion | null }}
 */
export function foldServerRequest(t, req, at = Date.now()) {
  if (QUESTION_METHODS.has(req.method)) {
    const question = questionFromRequest(req, at)
    if (!question) return { transcript: t, approval: null, question: null }
    return { transcript: setStatus(appendItem(t, question), 'waiting'), approval: null, question }
  }
  if (!APPROVAL_METHODS.has(req.method)) return { transcript: t, approval: null, question: null }
  const p = req.params ?? {}
  const id = String(req.id)
  let approval
  if (req.method === 'item/commandExecution/requestApproval' || req.method === 'execCommandApproval') {
    const raw = Array.isArray(p.command) ? p.command.join(' ') : p.command ?? ''
    const command = innerCommand(raw, p.commandActions)
    const host = p.networkApprovalContext?.host
    const options = req.method === 'execCommandApproval' ? [{ choice: 'allow', label: 'Allow once' }, { choice: 'allow-session', label: 'Allow this conversation' }, { choice: 'deny', label: 'Deny' }] : commandOptions(p)
    approval = {
      kind: 'approval', id, title: host ? `Connect to ${host}` : p.kind === 'writeStdin' ? 'Send input to the running command' : `Run ${firstLineOf(command, 100)}`,
      question: host ? `Allow Codex to connect to ${host}?` : p.kind === 'writeStdin' ? 'Send input to the running command?' : 'Do you want Codex to run this command?',
      ...(command && !host ? { command } : {}),
      ...(host ? { detail: `${host} isn't on the current network allowlist` } : {}),
      ...(p.reason ? { reason: p.reason } : {}),
      options, choices: [...options.map((o) => o.choice), 'cancel'], at
    }
  } else if (req.method === 'item/permissions/requestApproval') {
    const net = p.permissions?.network ? `Network: ${safeJson(p.permissions.network)}` : ''
    const fs = p.permissions?.fileSystem ? `Files: ${safeJson(p.permissions.fileSystem)}` : ''
    const options = [{ choice: 'allow', label: 'Allow once' }, { choice: 'allow-session', label: 'Allow this conversation' }, { choice: 'deny', label: 'Deny' }]
    approval = {
      kind: 'approval', id, title: 'Grant extra permissions', question: 'Allow Codex extra permissions?', detail: [net, fs].filter(Boolean).join('\n') || undefined,
      ...(p.reason ? { reason: p.reason } : {}), options, choices: [...options.map((o) => o.choice), 'cancel'], at
    }
  } else {
    // v2 points at the fileChange item the turn already holds; the legacy request carries the changes itself.
    const item = p.itemId ? t.items.find((x) => x.id === p.itemId && x.kind === 'tool') : undefined
    const edits = item?.edits ?? (p.fileChanges ? Object.entries(p.fileChanges).map(([path, c]) => ({ path, kind: c?.type, diff: typeof c?.unified_diff === 'string' ? c.unified_diff : typeof c?.content === 'string' ? c.content : undefined })) : [])
    const files = edits.map((e) => e.path).filter(Boolean)
    approval = {
      kind: 'approval', id, title: files.length ? `Edit ${files.map(baseName).join(', ')}` : 'Apply file changes',
      question: `Allow Codex to edit ${files.length === 1 ? 'the following file' : 'the following files'}?`,
      ...(edits.some((e) => e.diff) ? { edits } : files.length ? { detail: files.join('\n') } : {}),
      ...(p.reason ? { reason: p.reason } : {}),
      ...(p.grantRoot ? { detail: `Allow writes under ${p.grantRoot} for this session` } : {}),
      options: EDIT_OPTIONS, choices: [...EDIT_OPTIONS.map((o) => o.choice), 'cancel'], at
    }
  }
  return { transcript: setStatus(appendItem(t, approval), 'waiting'), approval, question: null }
}

/**
 * The response body for an approval request, in the method's own vocabulary.
 * `params` is needed for the amendments and the permissions grant, whose
 * answers echo what was asked.
 */
export function approvalResponse(method, choice, params) {
  if (method === 'item/permissions/requestApproval') {
    const granted = choice === 'allow' || choice === 'allow-session'
    const ask = params?.permissions ?? {}
    const permissions = granted ? { ...(ask.network ? { network: ask.network } : {}), ...(ask.fileSystem ? { fileSystem: ask.fileSystem } : {}) } : {}
    return { permissions, scope: choice === 'allow-session' ? 'session' : 'turn' }
  }
  if (method === 'execCommandApproval' || method === 'applyPatchApproval') return { decision: LEGACY_DECISIONS[choice] ?? 'denied' }
  if (choice === 'allow-rule') {
    const listed = (params?.availableDecisions ?? []).find((d) => d && typeof d === 'object' && d.acceptWithExecpolicyAmendment)
    const amendment = listed?.acceptWithExecpolicyAmendment.execpolicy_amendment ?? params?.proposedExecpolicyAmendment
    return Array.isArray(amendment) && amendment.length ? { decision: { acceptWithExecpolicyAmendment: { execpolicy_amendment: amendment } } } : { decision: 'acceptForSession' }
  }
  if (choice === 'allow-host') {
    const listed = (params?.availableDecisions ?? []).find((d) => d && typeof d === 'object' && d.applyNetworkPolicyAmendment)
    const amendment = listed?.applyNetworkPolicyAmendment.network_policy_amendment ?? params?.proposedNetworkPolicyAmendments?.[0] ?? (params?.networkApprovalContext?.host ? { host: params.networkApprovalContext.host, action: 'allow' } : null)
    return amendment ? { decision: { applyNetworkPolicyAmendment: { network_policy_amendment: amendment } } } : { decision: 'accept' }
  }
  return { decision: DECISIONS[choice] ?? 'decline' }
}

/** A question server request → a question item, or null when it cannot be rendered. */
export function questionFromRequest(req, at) {
  const p = req.params ?? {}
  const id = String(req.id)
  if (req.method === 'item/tool/requestUserInput') {
    const questions = (p.questions ?? []).map((q) => ({
      id: String(q.id),
      text: q.question ?? q.header ?? '',
      header: q.header || undefined,
      options: Array.isArray(q.options) && q.options.length ? q.options.map((o) => ({ label: o.label, description: o.description || undefined })) : null,
      multiSelect: false,
      allowOther: q.isOther === true || !Array.isArray(q.options) || q.options.length === 0,
      secret: q.isSecret === true
    }))
    if (!questions.length) return null
    return { kind: 'question', id, title: questions.length === 1 ? 'Codex has a question' : `Codex has ${questions.length} questions`, questions, at }
  }
  // mcpServer/elicitation/request
  const server = p.serverName ?? 'an MCP server'
  if (p.mode === 'url') {
    return {
      kind: 'question', id, title: `${server} needs you in the browser`, detail: [p.message, p.url].filter(Boolean).join('\n'),
      questions: [{ id: 'url', text: `Open ${p.url}?`, options: [{ label: 'Open in browser' }, { label: 'Decline' }], multiSelect: false, allowOther: false }], at
    }
  }
  const questions = schemaQuestions(p.requestedSchema)
  if (!questions.length) return null
  return { kind: 'question', id, title: `${server} requests input`, detail: p.message || undefined, questions, at }
}

/** An MCP elicitation form schema → questions, one per top-level property. */
export function schemaQuestions(schema) {
  const props = schema?.properties
  if (!props || typeof props !== 'object') return []
  const required = new Set(Array.isArray(schema.required) ? schema.required : [])
  return Object.entries(props).map(([key, s]) => {
    const text = s.title ?? s.description ?? key
    const header = required.has(key) ? undefined : 'optional'
    if (s.type === 'boolean') return { id: key, text, header, options: [{ label: 'Yes' }, { label: 'No' }], multiSelect: false, allowOther: false }
    const single = Array.isArray(s.enum) ? s.enum : null
    const multi = s.type === 'array' && Array.isArray(s.items?.enum) ? s.items.enum : null
    const names = Array.isArray(s.enumNames) ? s.enumNames : Array.isArray(s.items?.enumNames) ? s.items.enumNames : null
    const list = single ?? multi
    if (list) return { id: key, text, header, options: list.map((v, i) => ({ label: String(v), description: names?.[i] && names[i] !== v ? String(names[i]) : undefined })), multiSelect: !!multi, allowOther: false }
    return { id: key, text, header, options: null, multiSelect: false, allowOther: true, secret: s.format === 'password' }
  })
}

/**
 * The response body for a question request. `answers` is by question id; a
 * free-text answer is the one element of its list.
 */
export function questionResponse(req, answers) {
  const p = req.params ?? {}
  if (req.method === 'item/tool/requestUserInput') {
    const out = {}
    for (const q of p.questions ?? []) out[String(q.id)] = { answers: answers?.[String(q.id)] ?? [] }
    return { answers: out }
  }
  if (p.mode === 'url') {
    const open = answers?.url?.[0] === 'Open in browser'
    return { action: open ? 'accept' : 'decline', content: null, _meta: null }
  }
  if (!answers) return { action: 'decline', content: null, _meta: null }
  const content = {}
  const props = p.requestedSchema?.properties ?? {}
  for (const [key, list] of Object.entries(answers)) {
    const s = props[key] ?? {}
    const first = list[0]
    if (s.type === 'boolean') content[key] = first === 'Yes'
    else if (s.type === 'number' || s.type === 'integer') content[key] = Number(first)
    else if (s.type === 'array') content[key] = list
    else content[key] = first ?? ''
  }
  return { action: 'accept', content, _meta: null }
}

/**
 * A `Thread` summary from thread/list → the picker's row.
 * @returns {import('../shared/chatModel.mjs').SessionSummary}
 */
export function threadSummary(thread) {
  return {
    provider: /** @type {const} */ ('codex'),
    id: thread.id,
    title: thread.name || firstLineOf(thread.preview ?? '') || '(empty thread)',
    cwd: thread.cwd ?? '',
    updatedAt: msFrom(thread.recencyAt ?? thread.updatedAt),
    createdAt: msFrom(thread.createdAt),
    model: thread.model ?? null,
    branch: thread.gitInfo?.branch ?? null
  }
}
