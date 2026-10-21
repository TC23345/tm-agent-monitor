// Folds Claude Code Agent SDK messages (`--output-format stream-json`) and
// stored session messages into the shared transcript. Pure; shapes are the
// SDK 0.3.302 types (`SDKMessage`, `SessionMessage`, `SDKSessionInfo`) —
// the same stream the Cursor extension consumes (docs/rea-findings.md).
import { addUsage, appendDelta, appendItem, clip, closeTurn, dequeue, emptyTranscript, MAX_TOOL_OUTPUT, setStatus, settleStreams, updateItem } from '../shared/chatModel.mjs'
import { argDetail, clockTime, imageSize, mcpTitle, splitMcpName } from '../shared/present.mjs'

/**
 * Live fold state: the transcript plus a stream cursor per thread — which API
 * message is streaming and which content-block index maps to which item — and
 * the compaction row still waiting for its summary. The pane holds one of
 * these per session.
 * `streams` is keyed by `parent_tool_use_id` ('' for the session itself): a
 * background agent streams while the session does, and with one shared cursor
 * each thread's `message_start` cut the other's blocks loose (thinking rows
 * never learnt how long they took, deltas landed on fresh rows).
 * @typedef {{ messageId: string | null, blocks: Record<number, string> }} StreamCursor
 * @typedef {{ transcript: import('../shared/chatModel.mjs').Transcript, streams: Record<string, StreamCursor>, compactId?: string | null }} ClaudeFold
 */

/** @returns {ClaudeFold} */
export function startFold(transcript) {
  return { transcript, streams: {}, compactId: null, wire: {} }
}

const NO_STREAM = { messageId: null, blocks: {} }

/** The text Claude Code records when the user interrupts a turn. */
const INTERRUPT_TEXT = /^\[Request interrupted by user(?: for tool use)?\]$/

/**
 * A stored slash command (`<command-name>/compact</command-name>…<command-args>x</command-args>`)
 * → the line the user typed (`/compact x`); null for any other text.
 */
export function storedCommand(text) {
  const name = /<command-name>\s*\/?([^<\s]+)\s*<\/command-name>/.exec(text ?? '')
  if (!name) return null
  const args = /<command-args>([\s\S]*?)<\/command-args>/.exec(text)?.[1]?.trim()
  return `/${name[1]}${args ? ` ${args}` : ''}`
}

/** A stored command's output (`<local-command-stdout>…</local-command-stdout>`), or null. */
export function storedCommandOutput(text) {
  const m = /<local-command-(?:stdout|stderr)>([\s\S]*?)<\/local-command-(?:stdout|stderr)>/.exec(text ?? '')
  return m ? m[1].replace(/\x1b\[[0-9;]*m/g, '').trim() : null
}

/** A tool_use block → the row's one-line title. */
export function toolTitle(name, input) {
  const i = input && typeof input === 'object' ? input : {}
  switch (name) {
    case 'Bash':
    case 'PowerShell':
      return firstLineOf(String(i.command ?? i.description ?? name))
    case 'Read':
    case 'Edit':
    case 'Write':
    case 'MultiEdit':
    case 'NotebookEdit':
      return `${name} ${baseName(String(i.file_path ?? i.notebook_path ?? ''))}`.trim()
    case 'Glob':
    case 'Grep':
      return `${name} ${String(i.pattern ?? '')}`.trim()
    case 'WebFetch':
      return `Fetch ${String(i.url ?? '')}`.trim()
    case 'WebSearch':
      return `Search ${String(i.query ?? '')}`.trim()
    case 'Task':
    case 'Agent':
      return `Agent · ${firstLineOf(String(i.description ?? i.prompt ?? ''), 80)}`
    case 'Skill':
      return `Skill ${String(i.skill ?? i.name ?? '')}`.trim()
    case 'TodoWrite':
      return 'Update Todos'
    case 'AskUserQuestion':
      return 'Question'
    default:
      return name
  }
}

/**
 * How a tool row reads, after the Claude Code extension's own tool renderers
 * (docs/rea-findings.md, webview pass): a bold name, a muted detail —
 * monospace for a path or a pattern, prose for a command's description — and
 * which body the row gets. Edits carry their before/after text for the diff.
 * @returns {Pick<import('../shared/chatModel.mjs').ChatItemTool, 'label' | 'detail' | 'detailMono' | 'view' | 'edits' | 'content'>}
 */
export function toolView(name, input) {
  const i = input && typeof input === 'object' ? input : {}
  const path = String(i.file_path ?? i.notebook_path ?? '')
  switch (name) {
    case 'Bash':
    case 'PowerShell':
      return { label: name, detail: typeof i.description === 'string' && i.description ? i.description : undefined, view: 'command' }
    case 'Read': {
      const from = typeof i.offset === 'number' ? i.offset + 1 : null
      const range = from !== null && typeof i.limit === 'number' ? ` (lines ${from}-${from + i.limit - 1})` : from !== null ? ` (from line ${from})` : ''
      return { label: 'Read', detail: path ? `${baseName(path)}${range}` : undefined, detailMono: true, view: 'read', ...(path ? { path } : {}) }
    }
    case 'Edit':
      return { label: 'Edit', detail: path || undefined, detailMono: true, view: 'edit', ...(path ? { path } : {}), edits: [{ path, before: clip(String(i.old_string ?? ''), MAX_TOOL_OUTPUT), after: clip(String(i.new_string ?? ''), MAX_TOOL_OUTPUT) }] }
    case 'MultiEdit': {
      const edits = (Array.isArray(i.edits) ? i.edits : []).map((e) => ({ path, before: clip(String(e?.old_string ?? ''), MAX_TOOL_OUTPUT), after: clip(String(e?.new_string ?? ''), MAX_TOOL_OUTPUT) }))
      return { label: 'Edit', detail: path || undefined, detailMono: true, view: 'edit', ...(path ? { path } : {}), edits }
    }
    case 'Write':
      return { label: 'Write', detail: path || undefined, detailMono: true, view: 'write', ...(path ? { path } : {}), content: clip(typeof i.content === 'string' ? i.content : JSON.stringify(i.content ?? '', null, 2), MAX_TOOL_OUTPUT) }
    case 'NotebookEdit':
      return { label: 'Edit', detail: path || undefined, detailMono: true, view: 'edit', ...(path ? { path } : {}), edits: [{ path, before: '', after: clip(String(i.new_source ?? ''), MAX_TOOL_OUTPUT) }] }
    case 'Glob':
      return { label: 'Glob', detail: `pattern: "${String(i.pattern ?? '')}"`, detailMono: true, view: 'search' }
    case 'Grep':
      return { label: 'Grep', detail: `pattern: "${String(i.pattern ?? '')}"${i.path ? ` in ${baseName(String(i.path))}` : ''}`, detailMono: true, view: 'search' }
    case 'WebFetch':
      return { label: 'Fetch', detail: String(i.url ?? '') || undefined, detailMono: true, view: 'other' }
    case 'WebSearch':
      return { label: 'Search', detail: String(i.query ?? '') || undefined, view: 'other' }
    case 'Task':
    case 'Agent':
      return {
        label: 'Agent', detail: firstLineOf(String(i.description ?? i.prompt ?? ''), 120) || undefined, view: 'agent',
        ...(typeof i.prompt === 'string' && i.prompt ? { prompt: clip(i.prompt, MAX_TOOL_OUTPUT) } : {}),
        ...(typeof i.subagent_type === 'string' && i.subagent_type ? { agentType: i.subagent_type } : {})
      }
    case 'Skill':
      return { label: String(i.skill ?? i.name ?? 'Skill'), detail: 'skill', view: 'other' }
    case 'TodoWrite': {
      const todos = (Array.isArray(i.todos) ? i.todos : []).flatMap((x) => (x && typeof x.content === 'string'
        ? [{ content: x.content, status: x.status === 'completed' || x.status === 'in_progress' ? x.status : 'pending', ...(typeof x.activeForm === 'string' ? { activeForm: x.activeForm } : {}) }]
        : []))
      const done = todos.filter((x) => x.status === 'completed').length
      return { label: 'Update Todos', detail: todos.length ? `${done} of ${todos.length} done` : undefined, view: 'todo', todos }
    }
    case 'AskUserQuestion':
      return { label: 'Question', view: 'other' }
    case 'ExitPlanMode':
      // The extension's header for this step; the plan itself is the approval card under it.
      return { label: 'Claude’s plan', view: 'other' }
    default: {
      const mcp = splitMcpName(name)
      if (mcp) return { label: mcpTitle(mcp.server, mcp.tool), detail: argDetail(i), view: 'other' }
      return { label: name, view: 'other' }
    }
  }
}

function toolInput(name, input) {
  if (name === 'Bash' || name === 'PowerShell') return String(input?.command ?? '')
  try {
    return JSON.stringify(input ?? {}, null, 1)
  } catch {
    return ''
  }
}

function firstLineOf(s, max = 160) {
  const line = (s.split(/\r?\n/).find((l) => l.trim()) ?? '').trim()
  return line.length > max ? `${line.slice(0, max - 1)}…` : line
}

function baseName(p) {
  const m = /[^\\/]+$/.exec(p ?? '')
  return m ? m[0] : p
}

/** Text of a tool_result's content (a string, or text blocks). */
export function resultText(content) {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) return content.map((c) => (c?.type === 'text' ? c.text : c?.type === 'image' ? '[image]' : '')).join('\n')
  return ''
}

/** Text of a user message's content, ignoring tool results. */
function userText(content) {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) return content.filter((c) => c?.type === 'text').map((c) => c.text).join('\n')
  return ''
}

const IMAGE_EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' }

/** The image chips of a stored user message, sized from each image's header (the bytes stay out of the transcript). */
function userImages(content) {
  if (!Array.isArray(content)) return []
  return content.filter((c) => c?.type === 'image').map((c, n) => {
    const src = c.source ?? {}
    const size = src.type === 'base64' ? imageSize(String(src.data ?? '')) : null
    return { kind: 'image', name: `image${n ? `-${n + 1}` : ''}.${IMAGE_EXT[src.media_type] ?? 'png'}`, ...(size ?? {}) }
  })
}

/** What the context window holds after one API call: its whole input (cached or not) plus what it wrote. */
function contextOf(usage) {
  if (!usage || typeof usage !== 'object') return undefined
  const n = num(usage.input_tokens, 0) + num(usage.cache_read_input_tokens, 0) + num(usage.cache_creation_input_tokens, 0) + num(usage.output_tokens, 0)
  return n || undefined
}

/**
 * The row a complete text or thinking block belongs to. Claude Code sends each
 * block of an API message as its own `assistant` message (and stores each as
 * its own JSONL line), every one at content index 0 — so the index cannot name
 * the row the stream built (`${messageId}:${streamIndex}`), and two blocks of
 * one message must not share an id. A block finalises the earliest
 * still-streaming row of its kind from the same message (the one whose text it
 * matches, when one does), else reuses an identical finished row, else gets a
 * fresh `${messageId}:${kind}:${n}`.
 */
function blockTarget(t, messageId, kind, text) {
  const prefix = `${messageId}:`
  const mine = t.items.filter((x) => x.kind === kind && x.id.startsWith(prefix))
  const live = mine.filter((x) => x.streaming)
  const hit = live.find((x) => x.text === text) ?? live.find((x) => text.startsWith(x.text)) ?? live[0] ?? mine.find((x) => x.text === text)
  if (hit) return hit.id
  let n = 0
  while (t.items.some((x) => x.id === `${prefix}${kind}:${n}`)) n++
  return `${prefix}${kind}:${n}`
}

/**
 * Fold the content blocks of a complete assistant message: streamed text and
 * thinking rows are finalised (`blockTarget`), tool rows matched by the
 * tool_use id, unseen blocks appended.
 */
function foldAssistantBlocks(t, messageId, content, at, parentToolUseId, touched) {
  for (const block of content ?? []) {
    if (!block || typeof block !== 'object') continue
    if (block.type === 'text' || block.type === 'thinking' || block.type === 'redacted_thinking') {
      const kind = block.type === 'text' ? 'assistant' : 'thinking'
      const text = block.type === 'text' ? block.text ?? '' : block.type === 'thinking' ? block.thinking ?? '' : '[redacted]'
      if (!text) continue
      const id = blockTarget(t, messageId, kind, text)
      touched?.push(id)
      // A subagent's text and thinking nest under its Agent row, like its tools; without the parent they ran down the session's own timeline.
      t = t.items.some((x) => x.id === id) ? updateItem(t, id, { text, streaming: false }) : appendItem(t, { kind, id, text, streaming: false, at, ...(parentToolUseId ? { parent: parentToolUseId } : {}) })
    } else if (block.type === 'tool_use') {
      const view = toolView(block.name, block.input)
      touched?.push(block.id)
      const row = { kind: 'tool', id: block.id, name: block.name, title: toolTitle(block.name, block.input), input: toolInput(block.name, block.input), status: 'running', at, parent: parentToolUseId ?? undefined, ...view }
      t = t.items.some((x) => x.id === block.id) ? updateItem(t, block.id, (item) => ({ ...item, name: row.name, title: row.title, input: row.input, ...view })) : appendItem(t, row)
    }
  }
  return t
}

/** How the CLI words a refused tool call, with or without the user's reason (the extension reads the same prefix). */
const REJECTION = "The user doesn't want to proceed with this tool use."
const REJECTION_REASON = 'The user provided the following reason for the rejection: '

/**
 * A tool_result's outcome: done, failed, or declined when the user refused
 * it — then the output is only the reason they gave, if any (the extension
 * shows it as "Reason: …").
 * @returns {{ status: 'done' | 'failed' | 'declined', output: string }}
 */
export function toolOutcome(text, isError) {
  if (!isError) return { status: 'done', output: text }
  if (!text.startsWith(REJECTION)) return { status: 'failed', output: text }
  const at = text.indexOf(REJECTION_REASON)
  return { status: 'declined', output: at >= 0 ? text.slice(at + REJECTION_REASON.length).trim() : '' }
}

/** tool_result blocks in a user message close their tool rows. */
function foldToolResults(t, content, at) {
  if (!Array.isArray(content)) return t
  for (const block of content) {
    if (block?.type !== 'tool_result') continue
    const { status, output } = toolOutcome(clip(resultText(block.content), MAX_TOOL_OUTPUT), !!block.is_error)
    t = updateItem(t, block.tool_use_id, (item) => (item.kind === 'tool' ? { ...item, output: status === 'declined' ? output || undefined : output || item.output, status } : item))
  }
  return t
}

/** A compaction's row: the extension's foldable summary, with the context it started from. */
function compactItem(id, meta, at) {
  // The stream says `pre_tokens`; the stored JSONL says `preTokens`.
  const pre = meta?.pre_tokens ?? meta?.preTokens
  const tokens = typeof pre === 'number' ? pre : undefined
  return { kind: 'system', id, text: meta?.trigger === 'auto' ? 'Context compacted automatically' : 'Context compacted', level: 'info', at, variant: 'compact', ...(tokens ? { tokens } : {}) }
}

const TASK_WORDS = { completed: 'finished', failed: 'failed', stopped: 'was stopped' }

/**
 * Fold one live SDK message. `opts.interrupted`: the user asked to stop this
 * turn, so a result that ends it early reads as *Interrupted*, not an error.
 * @param {ClaudeFold} f
 * @param {any} msg an `SDKMessage`
 * @param {{ interrupted?: boolean }} [opts]
 * @returns {ClaudeFold}
 */
export function foldSdkMessage(f, msg, opts = {}) {
  if (!msg || typeof msg !== 'object') return f
  const at = Date.now()
  let t = f.transcript
  const thread = typeof msg.parent_tool_use_id === 'string' ? msg.parent_tool_use_id : ''
  let stream = f.streams[thread] ?? NO_STREAM
  const keep = (transcript) => ({ ...f, transcript, streams: stream === (f.streams[thread] ?? NO_STREAM) ? f.streams : { ...f.streams, [thread]: stream } })
  switch (msg.type) {
    case 'system': {
      if (msg.subtype === 'init') {
        t = {
          ...t, sessionId: msg.session_id ?? t.sessionId, model: msg.model ?? t.model, cwd: msg.cwd ?? t.cwd,
          permissionMode: typeof msg.permissionMode === 'string' ? msg.permissionMode : t.permissionMode,
          effort: msg.effort !== undefined ? msg.effort ?? null : t.effort,
          outputStyle: typeof msg.output_style === 'string' ? msg.output_style : t.outputStyle,
          fastMode: msg.fast_mode_state === 'on' || msg.fast_mode_state === 'off' || msg.fast_mode_state === 'cooldown' ? msg.fast_mode_state : t.fastMode
        }
        return keep(t)
      }
      if (msg.subtype === 'status') {
        const activity = msg.status === 'compacting' ? 'compacting' : null
        const mode = typeof msg.permissionMode === 'string' ? msg.permissionMode : t.permissionMode
        if (activity === t.activity && mode === t.permissionMode) return f
        return keep({ ...t, activity, permissionMode: mode })
      }
      if (msg.subtype === 'compact_boundary') {
        const id = `compact:${msg.uuid ?? at}`
        return { ...keep({ ...appendItem(t, compactItem(id, msg.compact_metadata, at)), activity: null }), compactId: id }
      }
      if (msg.subtype === 'permission_denied') return keep(appendItem(t, { kind: 'system', id: `denied:${msg.tool_use_id ?? at}`, text: msg.message ?? `${msg.tool_name} was denied`, level: 'error', at }))
      if (msg.subtype === 'api_retry') return keep({ ...t, retry: { attempt: num(msg.attempt, 1), max: num(msg.max_retries, 0) } })
      if (msg.subtype === 'thinking_tokens') {
        const live = [...t.items].reverse().find((x) => x.kind === 'thinking' && x.streaming)
        return live && typeof msg.estimated_tokens === 'number' ? keep(updateItem(t, live.id, { tokens: msg.estimated_tokens })) : f
      }
      if (msg.subtype === 'local_command_output' && typeof msg.content === 'string') {
        const output = msg.content.replace(/\x1b\[[0-9;]*m/g, '').trim()
        return output ? keep(appendItem(t, { kind: 'system', id: `cmd:${msg.uuid ?? at}`, text: firstLineOf(output, 120), level: 'info', at, variant: 'command', detail: clip(output, MAX_TOOL_OUTPUT) })) : f
      }
      if (msg.subtype === 'informational' && typeof msg.content === 'string' && msg.level !== 'info') {
        const level = msg.level === 'warning' ? 'warning' : 'info'
        return keep(appendItem(t, { kind: 'system', id: `note:${msg.uuid ?? at}`, text: msg.content, level, at, variant: 'notice' }))
      }
      if (msg.subtype === 'model_refusal_fallback') {
        // The refused reply is retracted: the CLI names its messages (and tombstoned tool results) by wire uuid, after the fact.
        const gone = new Set((Array.isArray(msg.retracted_message_uuids) ? msg.retracted_message_uuids : []).flatMap((u) => f.wire?.[u] ?? []))
        const local = msg.scope === 'local'
        // A reply refused mid-stream never got its assistant message: on the session's thread its live rows are the refused partial.
        const items = t.items.filter((x) => !gone.has(x.id) && !(!local && !x.parent && (x.kind === 'assistant' || x.kind === 'thinking') && x.streaming))
        if (items.length !== t.items.length) t = { ...t, items }
        if (!local && typeof msg.fallback_model === 'string') t = { ...t, model: msg.fallback_model }
        const text = typeof msg.content === 'string' && msg.content.trim() ? msg.content.trim() : `Switched to ${msg.fallback_model} after ${msg.original_model} declined`
        const explanation = typeof msg.api_refusal_explanation === 'string' ? msg.api_refusal_explanation.trim() : ''
        const next = appendItem(t, { kind: 'system', id: `refusal:${msg.uuid ?? at}`, text, level: 'warning', at, variant: 'model', ...(explanation ? { detail: explanation } : {}) })
        return local ? keep(next) : { ...keep(next), streams: omit(f.streams, '') }
      }
      if (msg.subtype === 'model_refusal_no_fallback') {
        const text = typeof msg.content === 'string' && msg.content.trim() ? msg.content.trim() : `${msg.original_model} declined this request`
        const explanation = typeof msg.api_refusal_explanation === 'string' ? msg.api_refusal_explanation.trim() : ''
        return keep(appendItem(t, { kind: 'system', id: `refusal:${msg.uuid ?? at}`, text, level: 'error', at, variant: 'model', ...(explanation ? { detail: explanation } : {}) }))
      }
      if (msg.subtype === 'task_progress') {
        // A running agent's one-line status (agentProgressSummaries), else the tool it is on.
        const row = t.items.find((x) => x.kind === 'tool' && ((msg.tool_use_id && x.id === msg.tool_use_id) || (msg.task_id && x.taskId === msg.task_id)))
        const progress = typeof msg.summary === 'string' && msg.summary.trim() ? firstLineOf(msg.summary.trim(), 160) : typeof msg.last_tool_name === 'string' ? `Using ${msg.last_tool_name}` : ''
        return row && progress && row.progress !== progress ? keep(updateItem(t, row.id, { progress })) : f
      }
      if (msg.subtype === 'memory_recall' && Array.isArray(msg.memories) && msg.memories.length) {
        const n = msg.memories.length
        const names = msg.memories.map((m) => (typeof m?.path === 'string' && !m.path.startsWith('<') ? baseName(m.path) : 'a summary of several memories'))
        return keep(appendItem(t, { kind: 'system', id: `memory:${msg.uuid ?? at}`, text: msg.mode === 'synthesize' ? 'Recalled memories' : `Recalled ${n} ${n === 1 ? 'memory' : 'memories'}`, level: 'info', at, variant: 'notice', detail: names.join('\n') }))
      }
      if (msg.subtype === 'notification' && typeof msg.text === 'string' && msg.text.trim() && msg.priority !== 'low') {
        // One row per key: the CLI re-sends a notification under its key when its text changes.
        const id = `notify:${msg.key ?? msg.text}`
        const row = { kind: 'system', id, text: msg.text.trim(), level: msg.priority === 'high' || msg.priority === 'immediate' ? 'warning' : 'info', at, variant: 'notice' }
        return keep(t.items.some((x) => x.id === id) ? updateItem(t, id, { text: row.text, level: row.level }) : appendItem(t, row))
      }
      if (msg.subtype === 'task_started' && msg.tool_use_id) {
        return keep(updateItem(t, msg.tool_use_id, (x) => (x.kind === 'tool' ? { ...x, taskId: msg.task_id, ...(msg.is_backgrounded ? { background: true } : {}) } : x)))
      }
      if (msg.subtype === 'task_updated' && msg.patch?.is_backgrounded) {
        const row = t.items.find((x) => x.kind === 'tool' && x.taskId === msg.task_id)
        return row ? keep(updateItem(t, row.id, { background: true })) : f
      }
      if (msg.subtype === 'background_tasks_changed' && Array.isArray(msg.tasks)) {
        const background = msg.tasks.filter((x) => x && !x.ambient).map((x) => ({ id: String(x.task_id), description: String(x.description ?? ''), type: String(x.task_type ?? 'task'), ...(x.tool_use_id ? { toolUseId: String(x.tool_use_id) } : {}) }))
        return keep({ ...t, background })
      }
      if (msg.subtype === 'task_notification' && !msg.skip_transcript) {
        const row = t.items.find((x) => x.kind === 'tool' && x.taskId === msg.task_id)
        // A task that ran in the foreground ends with its tool row; only a background one gets a line of its own.
        if (!row?.background && !t.background.some((x) => x.id === msg.task_id)) return f
        const what = row?.label ? `${row.label}${row.detail ? ` · ${row.detail}` : ''}` : 'A background task'
        const summary = typeof msg.summary === 'string' ? msg.summary.trim() : ''
        // The row learns how its task ended, for the agents panel: a background agent's own row closed when it was launched.
        const outcome = msg.status === 'completed' || msg.status === 'failed' || msg.status === 'stopped' ? msg.status : 'stopped'
        if (row) t = updateItem(t, row.id, { outcome, endedAt: at, ...(summary ? { summary: clip(summary, MAX_TOOL_OUTPUT) } : {}) })
        return keep(appendItem(t, {
          kind: 'system', id: `task:${msg.task_id}:${msg.status}`, text: `${what} ${TASK_WORDS[msg.status] ?? msg.status}`, level: msg.status === 'failed' ? 'warning' : 'info', at, variant: 'task',
          ...(summary ? { detail: clip(summary, MAX_TOOL_OUTPUT) } : {})
        }))
      }
      return f
    }
    case 'prompt_suggestion':
      return typeof msg.suggestion === 'string' && msg.suggestion.trim() ? keep({ ...t, suggestion: msg.suggestion.trim() }) : f
    case 'rate_limit_event': {
      const info = msg.rate_limit_info ?? {}
      if (info.status === 'allowed_warning') {
        const id = `limitwarn:${info.rateLimitType ?? ''}:${info.surpassedThreshold ?? info.resetsAt ?? ''}`
        if (t.items.some((x) => x.id === id)) return f
        return keep(appendItem(t, { kind: 'system', id, text: limitWarning(info), level: 'warning', at, variant: 'limit' }))
      }
      if (info.status !== 'rejected') return f
      const resets = typeof info.resetsAt === 'number' ? ` It resets at ${clockTime(info.resetsAt < 1e12 ? info.resetsAt * 1000 : info.resetsAt)}.` : ''
      return keep(appendItem(t, { kind: 'system', id: `limit:${info.rateLimitType ?? ''}:${info.resetsAt ?? at}`, text: `You've reached your usage limit.${resets}`, level: 'warning', at, variant: 'limit' }))
    }
    case 'auth_status': {
      // Claude Code signing in mid-session (an expired login): one row, updated as it goes.
      const output = Array.isArray(msg.output) ? msg.output.filter((x) => typeof x === 'string').join('\n').trim() : ''
      const error = typeof msg.error === 'string' && msg.error.trim() ? msg.error.trim() : ''
      const row = error
        ? { text: `Sign-in failed: ${firstLineOf(error, 140)}`, level: 'error' }
        : msg.isAuthenticating ? { text: 'Signing in to Claude…', level: 'info' } : { text: 'Signed in', level: 'info' }
      const patch = { ...row, ...(output ? { detail: clip(output, MAX_TOOL_OUTPUT) } : {}) }
      return keep(t.items.some((x) => x.id === 'auth') ? updateItem(t, 'auth', patch) : appendItem(t, { kind: 'system', id: 'auth', at, variant: 'notice', ...patch }))
    }
    case 'conversation_reset':
      return keep(appendItem({ ...t, sessionId: msg.new_conversation_id ?? t.sessionId }, { kind: 'system', id: `reset:${msg.uuid ?? at}`, text: 'Conversation cleared', level: 'info', at, variant: 'cleared' }))
    case 'stream_event': {
      const ev = msg.event ?? {}
      if (ev.type === 'message_start') {
        stream = { messageId: ev.message?.id ?? msg.uuid ?? `m${at}`, blocks: {} }
        // The call went through: whatever retry the working line showed is over.
        return keep(t.retry ? { ...t, retry: null } : t)
      }
      const messageId = stream.messageId ?? msg.uuid ?? `m${at}`
      if (ev.type === 'content_block_start') {
        const b = ev.content_block ?? {}
        if (b.type === 'tool_use') {
          t = appendItem(t, { kind: 'tool', id: b.id, name: b.name, title: toolTitle(b.name, b.input), input: '', status: 'running', at, ...(thread ? { parent: thread } : {}), ...toolView(b.name, b.input) })
          stream = { messageId, blocks: { ...stream.blocks, [ev.index]: b.id } }
        } else {
          const id = `${messageId}:${ev.index}`
          // A thinking row exists from the block's start, so it can say how long it took
          // even when the provider omits the thinking text itself.
          if ((b.type === 'thinking' || b.type === 'redacted_thinking') && !t.items.some((x) => x.id === id)) t = appendItem(t, { kind: 'thinking', id, text: '', streaming: true, at, ...(thread ? { parent: thread } : {}) })
          stream = { messageId, blocks: { ...stream.blocks, [ev.index]: id } }
        }
        return keep(t)
      }
      if (ev.type === 'content_block_stop') {
        const id = stream.blocks[ev.index]
        if (!id) return f
        const next = updateItem(t, id, (item) => (item.kind === 'thinking' && item.durationMs === undefined ? { ...item, durationMs: Math.max(0, at - item.at) } : item))
        return next === t ? f : keep(next)
      }
      if (ev.type === 'content_block_delta') {
        const d = ev.delta ?? {}
        const id = stream.blocks[ev.index] ?? `${messageId}:${ev.index}`
        if (d.type === 'text_delta') t = appendDelta(t, id, 'assistant', d.text, at, thread || undefined)
        else if (d.type === 'thinking_delta') t = appendDelta(t, id, 'thinking', d.thinking, at, thread || undefined)
        return keep(t)
      }
      if (ev.type === 'message_delta' && ev.usage) {
        return keep(addUsage(t, { outputTokens: num(ev.usage.output_tokens) }))
      }
      return f
    }
    case 'assistant': {
      const m = msg.message ?? {}
      const messageId = m.id ?? stream.messageId ?? msg.uuid
      const touched = []
      t = foldAssistantBlocks(t, messageId, m.content, at, msg.parent_tool_use_id, touched)
      // Each API call's own usage is what the window holds now; a subagent's calls fill its own window, not this one.
      const context = msg.parent_tool_use_id ? undefined : contextOf(m.usage)
      if (context) t = addUsage(t, { contextTokens: context })
      if (msg.error) t = appendItem(t, { kind: 'system', id: `aerr:${msg.uuid ?? at}`, text: String(msg.error), level: 'error', at })
      // The stream cursor stays: this may be one block of a message still
      // streaming its next block. `message_start` and `result` reset it.
      return msg.uuid && touched.length ? { ...keep(t), wire: remember(f.wire, msg.uuid, touched) } : keep(t)
    }
    case 'user': {
      const content = msg.message?.content
      // The CLI echoes each prompt as it reads it (`--replay-user-messages`): a queued one joins the transcript here.
      if (msg.isReplay && msg.uuid) {
        const next = dequeue(t, msg.uuid, at)
        return next === t ? f : keep(next)
      }
      // The summary a compaction leaves arrives as a synthetic prompt right after its boundary.
      if (f.compactId && msg.isSynthetic && typeof content === 'string') {
        return { ...keep(updateItem(t, f.compactId, { detail: clip(content, MAX_TOOL_OUTPUT) })), compactId: null }
      }
      t = foldToolResults(t, content, at)
      return keep(t)
    }
    case 'result': {
      t = settleStreams({ ...t, retry: null, activity: null })
      const u = msg.usage ?? {}
      // The result's usage adds up every API call of the turn — a cost, not a context size (17 calls at
      // 66k each read as "1136k"). The context comes from each assistant message; the window from modelUsage.
      t = addUsage(t, { inputTokens: num(u.input_tokens), outputTokens: 0, costUsd: num(msg.total_cost_usd), contextWindow: contextWindowOf(msg.modelUsage, t.model) })
      if (opts.interrupted) {
        t = setStatus(appendItem(t, { kind: 'system', id: `interrupt:${msg.uuid ?? at}`, text: 'Interrupted', level: 'info', at, variant: 'interrupt' }), 'idle')
      } else if (msg.is_error || msg.subtype !== 'success') {
        const raw = String(msg.result || msg.errors?.join?.('\n') || msg.subtype || 'The turn failed')
        const reason = END_WORDS[msg.terminal_reason]
        const text = reason ?? raw
        t = setStatus(appendItem(t, { kind: 'system', id: `result:${msg.uuid ?? at}`, text, level: 'error', at, ...(reason && raw !== reason ? { detail: clip(raw, MAX_TOOL_OUTPUT) } : {}) }), 'error', text)
      } else {
        // A turn can end "successfully" because something stopped it; say what.
        const reason = STOPPED_WORDS[msg.terminal_reason]
        if (reason) t = appendItem(t, { kind: 'system', id: `stopped:${msg.uuid ?? at}`, text: reason, level: 'warning', at, variant: 'notice' })
        t = setStatus(t, 'idle')
      }
      t = closeTurn(t, { at, durationMs: num(msg.duration_ms), outputTokens: num(u.output_tokens), id: `turn:${msg.uuid ?? at}` })
      // The session's turn is over; a background agent may still be mid-message, so its cursor stays.
      const { '': _session, ...agents } = f.streams
      return { ...f, transcript: t, streams: agents }
    }
    default:
      return f
  }
}

const num = (v, fallback) => (typeof v === 'number' ? v : fallback)

/** @template T @param {Record<string, T>} o @param {string} key */
const omit = (o, key) => {
  if (!(key in o)) return o
  const { [key]: _gone, ...rest } = o
  return rest
}

/** How many assistant messages' rows the fold remembers for a retraction (a refusal retracts the reply in flight). */
const MAX_WIRE = 200

/** @param {Record<string, string[]> | undefined} wire @param {string} uuid @param {string[]} ids */
function remember(wire, uuid, ids) {
  const next = { ...(wire ?? {}), [uuid]: [...new Set([...(wire?.[uuid] ?? []), ...ids])] }
  const keys = Object.keys(next)
  return keys.length > MAX_WIRE ? Object.fromEntries(keys.slice(-MAX_WIRE).map((k) => [k, next[k]])) : next
}

/** `result.terminal_reason` on a failed turn, in words (the raw error stays as the row's detail). */
const END_WORDS = {
  prompt_too_long: 'The conversation is too long for the model. Compact it or start a new session.',
  image_error: "An image in the conversation couldn't be read.",
  blocking_limit: "You've reached your usage limit.",
  max_turns: 'Claude stopped after the most turns it may take.',
  budget_exhausted: "The turn's budget ran out.",
  malformed_tool_use_exhausted: 'Claude kept sending a tool call it could not finish, so the turn stopped.',
  turn_setup_failed: "The turn couldn't start."
}

/** A turn that ended without an error, but not because Claude was done. */
const STOPPED_WORDS = {
  stop_hook_prevented: 'A hook stopped Claude from finishing.',
  hook_stopped: 'A hook stopped the turn.',
  max_turns: 'Claude stopped after the most turns it may take.',
  budget_exhausted: "The turn's budget ran out."
}

/** The window a rate limit covers, as the extension names it. */
const LIMIT_NAMES = { five_hour: '5-hour', seven_day: 'weekly', seven_day_opus: 'weekly Opus', seven_day_sonnet: 'weekly Sonnet', seven_day_overage_included: 'weekly', overage: 'extra usage' }

/** A warning before the limit: how much is used and when the window resets. */
export function limitWarning(info) {
  const name = LIMIT_NAMES[info?.rateLimitType] ?? ''
  const u = typeof info?.utilization === 'number' ? info.utilization : typeof info?.surpassedThreshold === 'number' ? info.surpassedThreshold : null
  const pct = u === null ? null : Math.round(u <= 1 ? u * 100 : u)
  const resets = typeof info?.resetsAt === 'number' ? ` It resets at ${clockTime(info.resetsAt < 1e12 ? info.resetsAt * 1000 : info.resetsAt)}.` : ''
  const used = pct !== null ? `You've used ${pct}% of your ${name ? `${name} ` : ''}limit.` : `You're close to your ${name ? `${name} ` : ''}usage limit.`
  return used + resets
}

/** The session model's context window from a result's `modelUsage` (the largest one when the model is not named there). */
function contextWindowOf(modelUsage, model) {
  if (!modelUsage || typeof modelUsage !== 'object') return undefined
  const own = model ? modelUsage[model]?.contextWindow : undefined
  if (typeof own === 'number') return own
  const all = Object.values(modelUsage).map((u) => u?.contextWindow).filter((n) => typeof n === 'number')
  return all.length ? Math.max(...all) : undefined
}

/**
 * Stored history (`getSessionMessages`) → transcript.
 * @param {{ sessionId: string, cwd: string, info?: any }} meta `info` is an SDKSessionInfo
 * @param {any[]} messages `SessionMessage[]`
 */
export function sessionMessagesToTranscript(meta, messages) {
  let t = emptyTranscript('claude', { cwd: meta.cwd, sessionId: meta.sessionId, title: meta.info?.customTitle ?? null })
  // Turn footers come from the stored times: from the first step after a prompt to the last.
  let first = null
  let last = null
  let open = null
  const close = () => {
    if (open !== null) t = closeTurn(t, { at: last ?? open, durationMs: first !== null && last !== null ? Math.max(0, last - first) : undefined, id: `turn:${last ?? open}` })
    first = null
    last = null
    open = null
  }
  let known = false
  const step = (at) => {
    open = at
    // A line without a stored time says nothing about how long the turn took.
    if (!known) return
    if (first === null) first = at
    last = at
  }
  for (const m of messages ?? []) {
    known = typeof m.timestamp === 'string' && !Number.isNaN(Date.parse(m.timestamp))
    const at = known ? Date.parse(m.timestamp) : Date.now()
    const inner = m.message ?? {}
    if (m.type === 'user') {
      const content = inner.content
      const hadResults = Array.isArray(content) && content.some((c) => c?.type === 'tool_result')
      t = foldToolResults(t, content, at)
      if (hadResults) step(at)
      const raw = userText(content)
      const images = userImages(content)
      if (COMPACT_SUMMARY.test(raw)) {
        const row = [...t.items].reverse().find((x) => x.kind === 'system' && x.variant === 'compact' && !x.detail)
        t = row ? updateItem(t, row.id, { detail: clip(raw, MAX_TOOL_OUTPUT) }) : appendItem(t, { ...compactItem(`compact:${m.uuid}`, null, at), detail: clip(raw, MAX_TOOL_OUTPUT) })
        continue
      }
      if (INTERRUPT_TEXT.test(raw.trim())) {
        t = appendItem(t, { kind: 'system', id: `interrupt:${m.uuid}`, text: 'Interrupted', level: 'info', at, variant: 'interrupt' })
        step(at)
        continue
      }
      const output = storedCommandOutput(raw)
      if (output !== null) {
        if (output) t = appendItem(t, { kind: 'system', id: `cmd:${m.uuid}`, text: firstLineOf(output, 120), level: 'info', at, variant: 'command', detail: clip(output, MAX_TOOL_OUTPUT) })
        continue
      }
      const text = storedCommand(raw) ?? raw
      if ((text || images.length) && !m.isSynthetic && !m.isMeta) {
        close()
        t = appendItem(t, { kind: 'user', id: m.uuid, uuid: m.uuid, text, at, ...(images.length ? { attachments: images } : {}) })
      }
    } else if (m.type === 'assistant') {
      t = foldAssistantBlocks(t, inner.id ?? m.uuid, inner.content, at, m.parent_tool_use_id)
      const context = m.parent_tool_use_id ? undefined : contextOf(inner.usage)
      if (context) t = addUsage(t, { contextTokens: context })
      step(at)
    } else if (m.type === 'system' && (inner?.subtype ?? m.subtype) === 'compact_boundary') {
      t = appendItem(t, compactItem(`compact:${m.uuid}`, inner.compact_metadata ?? inner.compactMetadata ?? m.compactMetadata, at))
    }
  }
  close()
  return t
}

/** The prompt Claude Code writes after a compaction: the summary the conversation continues from. */
const COMPACT_SUMMARY = /^This session is being continued from a previous conversation/

/**
 * An `SDKSessionInfo` → the picker's row.
 * @returns {import('../shared/chatModel.mjs').SessionSummary}
 */
export function sessionSummary(info) {
  return {
    provider: /** @type {const} */ ('claude'),
    id: info.sessionId,
    title: info.customTitle || firstLineOf(info.firstPrompt ?? info.summary ?? '') || '(empty session)',
    cwd: info.cwd ?? '',
    updatedAt: typeof info.lastModified === 'number' ? info.lastModified : Date.now(),
    createdAt: info.createdAt,
    model: null,
    branch: info.gitBranch ?? null
  }
}
