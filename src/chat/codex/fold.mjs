// Folds Codex app-server notifications, server requests and stored threads
// into the shared transcript. Pure; the vocabulary is the one
// `codex app-server generate-ts` emitted for 0.162.1 (docs/rea/codex-app-server-ts/v2)
// and the shapes the probes observed (docs/rea/codex-samples).
import { addUsage, answerQuestion, appendDelta, appendItem, clip, decideApproval, emptyTranscript, MAX_TOOL_OUTPUT, setStatus, settleStreams, updateItem } from '../shared/chatModel.mjs'
import { argDetail, mcpTitle } from '../shared/present.mjs'

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

/** Our four choices in Codex's words (CommandExecutionApprovalDecision / FileChangeApprovalDecision). */
export const DECISIONS = { allow: 'accept', 'allow-session': 'acceptForSession', deny: 'decline', cancel: 'cancel' }

/** The legacy pair (`execCommandApproval`, `applyPatchApproval`) answers with ReviewDecision. */
export const LEGACY_DECISIONS = { allow: 'approved', 'allow-session': 'approved_for_session', deny: 'denied', cancel: 'abort' }

const msFrom = (sec) => (typeof sec === 'number' ? sec * 1000 : Date.now())

/** One ThreadItem → one or none ChatItem. `at` is epoch ms. */
export function itemToChat(item, at) {
  if (!item || typeof item !== 'object') return null
  switch (item.type) {
    case 'userMessage': {
      const text = (item.content ?? []).map((c) => (c.type === 'text' ? c.text : c.type === 'mention' || c.type === 'skill' ? `@${c.name}` : `[${c.type}]`)).join('')
      return { kind: 'user', id: item.id, text, at }
    }
    case 'agentMessage':
      return { kind: 'assistant', id: item.id, text: item.text ?? '', streaming: false, at }
    case 'reasoning': {
      const text = [...(item.summary ?? []), ...(item.content ?? [])].join('\n\n')
      return text ? { kind: 'thinking', id: item.id, text, streaming: false, at } : null
    }
    case 'plan':
      return { kind: 'assistant', id: item.id, text: item.text ?? '', streaming: false, at }
    case 'commandExecution':
      return {
        kind: 'tool', id: item.id, name: 'commandExecution', title: commandTitle(item), input: item.command ?? '',
        output: item.aggregatedOutput ? clip(item.aggregatedOutput, MAX_TOOL_OUTPUT) : undefined,
        status: toolStatus(item.status, item.exitCode), at, ...commandView(item)
      }
    case 'fileChange': {
      const changes = item.changes ?? []
      const files = changes.map((c) => c.path).filter(Boolean)
      const edits = changes.map((c) => ({ path: c.path ?? '', kind: c.kind?.type, diff: clip(String(c.diff ?? ''), MAX_TOOL_OUTPUT) }))
      return {
        kind: 'tool', id: item.id, name: 'fileChange', title: files.length ? `Edit ${files.map(baseName).join(', ')}` : 'Edit files', input: files.join('\n'), status: toolStatus(item.status), at,
        label: changes.length && changes.every((c) => c.kind?.type === 'add') ? 'Create' : 'Edit', detail: files.join(', ') || undefined, detailMono: true, view: 'edit', edits
      }
    }
    case 'mcpToolCall':
      return {
        kind: 'tool', id: item.id, name: `${item.server}.${item.tool}`, title: `${item.server} · ${item.tool}`, input: safeJson(item.arguments),
        output: item.result ? clip(mcpResultText(item.result), MAX_TOOL_OUTPUT) : item.error ? clip(String(item.error.message ?? safeJson(item.error)), MAX_TOOL_OUTPUT) : undefined,
        status: toolStatus(item.status), at, label: mcpTitle(item.server ?? '', item.tool ?? ''), detail: argDetail(item.arguments), view: 'other'
      }
    case 'dynamicToolCall':
      return { kind: 'tool', id: item.id, name: item.tool, title: item.tool, input: safeJson(item.arguments), status: item.success === false ? 'failed' : toolStatus(item.status), at, label: item.tool, view: 'other' }
    case 'webSearch':
      return { kind: 'tool', id: item.id, name: 'webSearch', title: `Search · ${item.query ?? ''}`, status: 'done', at, label: 'Search', detail: item.query || undefined, view: 'other' }
    case 'error':
      return { kind: 'system', id: item.id, text: item.message ?? 'error', level: 'error', at }
    case 'contextCompaction':
      return { kind: 'system', id: item.id, text: 'Context compacted', level: 'info', at }
    default:
      return null
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
 * A command row's name and detail. Codex parses what a command does
 * (`commandActions`); a single read, search or listing reads as that, any
 * other command as "Shell" — the IN row shows it either way.
 */
function commandView(item) {
  const actions = item.commandActions ?? []
  const one = actions.length === 1 ? actions[0] : null
  if (one?.type === 'read') return { label: 'Read', detail: one.name || baseName(one.path ?? ''), detailMono: true, view: 'command' }
  if (one?.type === 'search') return { label: 'Search', detail: one.query ? `pattern: "${one.query}"` : undefined, detailMono: true, view: 'command' }
  if (one?.type === 'listFiles') return { label: 'List', detail: one.path || undefined, detailMono: true, view: 'command' }
  return { label: 'Shell', view: 'command' }
}

function commandTitle(item) {
  const actions = item.commandActions ?? []
  if (actions.length && actions.every((a) => a.type !== 'unknown')) {
    return actions.map((a) => (a.type === 'read' ? `Read ${a.name}` : a.type === 'listFiles' ? `List ${a.path ?? ''}`.trim() : a.type === 'search' ? `Search ${a.query ?? ''}`.trim() : a.command)).join(' · ')
  }
  return firstLineOf(item.command ?? '')
}

function firstLineOf(s, max = 160) {
  const line = s.split(/\r?\n/).find((l) => l.trim()) ?? ''
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
  for (const turn of thread.turns ?? []) t = foldTurnItems(t, turn)
  return t
}

/** Append a turn's items (history pages come as turns too). */
export function foldTurnItems(t, turn) {
  const at = msFrom(turn.startedAt)
  for (const item of turn.items ?? []) {
    const chat = itemToChat(item, at)
    if (chat) t = appendItem(t, chat)
  }
  if (turn.status === 'failed' && turn.error?.message) t = appendItem(t, { kind: 'system', id: `${turn.id}:error`, text: turn.error.message, level: 'error', at })
  if (turn.status === 'interrupted') t = appendItem(t, { kind: 'system', id: `${turn.id}:interrupted`, text: 'Interrupted', level: 'info', at })
  return t
}

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
      return { ...t, sessionId: p.thread?.id ?? t.sessionId, model: p.thread?.model ?? t.model, cwd: p.thread?.cwd ?? t.cwd }
    case 'thread/name/updated':
      return typeof p.name === 'string' ? { ...t, title: p.name } : t
    case 'turn/started':
      // The pane stamps the clock when it sends; a turn another client started gets it here.
      if (t.status === 'running' && t.turnStartedAt) return t
      return { ...setStatus(t, 'running'), turnStartedAt: at }
    case 'turn/completed': {
      const turn = p.turn ?? {}
      let next = settleStreams(t)
      if (turn.status === 'failed') next = setStatus(appendItem(next, { kind: 'system', id: `${turn.id}:error`, text: turn.error?.message ?? 'The turn failed', level: 'error', at }), 'error', turn.error?.message ?? 'The turn failed')
      else if (turn.status === 'interrupted') next = setStatus(appendItem(next, { kind: 'system', id: `${turn.id}:interrupted`, text: 'Interrupted', level: 'info', at }), 'idle')
      else next = setStatus(next, 'idle')
      return next
    }
    case 'item/started': {
      const start = p.startedAtMs ?? at
      // Reasoning gets its row at the start even before (or without) a summary, so it can be timed.
      const chat = itemToChat(p.item, start) ?? (p.item?.type === 'reasoning' && p.item.id ? { kind: 'thinking', id: p.item.id, text: '', streaming: true, at: start } : null)
      if (!chat) return t
      if (chat.kind === 'assistant' || chat.kind === 'thinking') chat.streaming = true
      return placeItem(t, chat)
    }
    case 'item/completed': {
      const end = p.completedAtMs ?? at
      const chat = itemToChat(p.item, end)
      const existing = p.item?.id ? t.items.find((x) => x.id === p.item.id) : undefined
      if (existing?.kind === 'thinking') {
        // Keep the start time; the row now says how long the reasoning took.
        return updateItem(t, existing.id, { text: chat?.kind === 'thinking' ? chat.text : existing.text, streaming: false, durationMs: Math.max(0, end - existing.at) })
      }
      if (!chat) return t
      return placeItem(t, chat)
    }
    case 'item/agentMessage/delta':
      return appendDelta(t, p.itemId, 'assistant', p.delta, at)
    case 'item/reasoning/summaryTextDelta':
    case 'item/reasoning/textDelta':
      return appendDelta(t, p.itemId, 'thinking', p.delta, at)
    case 'item/commandExecution/outputDelta':
      return updateItem(t, p.itemId, (item) => (item.kind === 'tool' ? { ...item, output: clip((item.output ?? '') + (p.delta ?? ''), MAX_TOOL_OUTPUT) } : item))
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
    case 'error':
      return p.willRetry ? t : setStatus(appendItem(t, { kind: 'system', id: `err:${at}`, text: p.error?.message ?? 'error', level: 'error', at }), 'error', p.error?.message ?? 'error')
    case 'thread/compacted':
      return appendItem(t, { kind: 'system', id: `compact:${at}`, text: 'Context compacted', level: 'info', at })
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

/**
 * Update an item in place by id, else append. The server echoes the user's
 * own message as a `userMessage` item: that lands on the row the client
 * appended when it sent (`local:` id, same text) instead of doubling it.
 */
function placeItem(t, chat) {
  // An item seen before keeps the time it started; its completion only updates it.
  if (t.items.some((x) => x.id === chat.id)) return updateItem(t, chat.id, (cur) => ({ ...cur, ...chat, at: cur.at }))
  if (chat.kind === 'user') {
    const local = [...t.items].reverse().find((x) => x.kind === 'user' && x.id.startsWith('local:') && x.text.trim() === chat.text.trim())
    if (local) return updateItem(t, local.id, { ...local, id: chat.id })
  }
  return appendItem(t, chat)
}

/**
 * A server request → an approval item (or null when it is not one we answer
 * here; `item/tool/requestUserInput` and MCP elicitations are the pane's
 * question flow, a later milestone).
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
  let title
  let detail
  if (req.method === 'item/commandExecution/requestApproval' || req.method === 'execCommandApproval') {
    const cmd = Array.isArray(p.command) ? p.command.join(' ') : p.command ?? ''
    title = p.kind === 'stdin' ? 'Send input to the running command' : `Run ${firstLineOf(cmd, 100)}`
    detail = [cmd, p.reason].filter(Boolean).join('\n')
  } else if (req.method === 'item/permissions/requestApproval') {
    title = 'Grant extra permissions'
    const net = p.permissions?.network ? `Network: ${safeJson(p.permissions.network)}` : ''
    const fs = p.permissions?.fileSystem ? `Files: ${safeJson(p.permissions.fileSystem)}` : ''
    detail = [p.reason, net, fs].filter(Boolean).join('\n')
  } else {
    const files = p.fileChanges ? Object.keys(p.fileChanges) : []
    title = files.length ? `Edit ${files.map(baseName).join(', ')}` : 'Apply file changes'
    detail = [files.join('\n'), p.reason, p.grantRoot ? `Allow writes under ${p.grantRoot} for this session` : ''].filter(Boolean).join('\n')
  }
  const approval = { kind: 'approval', id, title, detail: detail || undefined, choices: ['allow', 'allow-session', 'deny', 'cancel'], at }
  return { transcript: setStatus(appendItem(t, approval), 'waiting'), approval, question: null }
}

/**
 * The response body for an approval request, in the method's own vocabulary.
 * `params` is needed for the permissions grant, whose answer echoes the ask.
 */
export function approvalResponse(method, choice, params) {
  if (method === 'item/permissions/requestApproval') {
    const granted = choice === 'allow' || choice === 'allow-session'
    const ask = params?.permissions ?? {}
    const permissions = granted ? { ...(ask.network ? { network: ask.network } : {}), ...(ask.fileSystem ? { fileSystem: ask.fileSystem } : {}) } : {}
    return { permissions, scope: choice === 'allow-session' ? 'session' : 'turn' }
  }
  const legacy = method === 'execCommandApproval' || method === 'applyPatchApproval'
  return { decision: (legacy ? LEGACY_DECISIONS : DECISIONS)[choice] ?? (legacy ? 'denied' : 'decline') }
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
    return { kind: 'question', id, title: 'Codex needs input', questions, at }
  }
  // mcpServer/elicitation/request
  const server = p.serverName ?? 'an MCP server'
  if (p.mode === 'url') {
    return {
      kind: 'question', id, title: `Codex · ${server} needs you in the browser`, detail: [p.message, p.url].filter(Boolean).join('\n'),
      questions: [{ id: 'url', text: `Open ${p.url}?`, options: [{ label: 'Open in browser' }, { label: 'Decline' }], multiSelect: false, allowOther: false }], at
    }
  }
  const questions = schemaQuestions(p.requestedSchema)
  if (!questions.length) return null
  return { kind: 'question', id, title: `Codex · ${server} needs input`, detail: p.message || undefined, questions, at }
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
