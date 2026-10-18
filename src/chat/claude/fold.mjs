// Folds Claude Code Agent SDK messages (`--output-format stream-json`) and
// stored session messages into the shared transcript. Pure; shapes are the
// SDK 0.3.302 types (`SDKMessage`, `SessionMessage`, `SDKSessionInfo`) —
// the same stream the Cursor extension consumes (docs/rea-findings.md).
import { addUsage, appendDelta, appendItem, clip, emptyTranscript, MAX_TOOL_OUTPUT, setStatus, settleStreams, updateItem } from '../shared/chatModel.mjs'
import { argDetail, imageSize, mcpTitle, splitMcpName } from '../shared/present.mjs'

/**
 * Live fold state: the transcript plus the stream cursor — which API message
 * is streaming and which content-block index maps to which item. The pane
 * holds one of these per session.
 * @typedef {{ transcript: import('../shared/chatModel.mjs').Transcript, stream: { messageId: string | null, blocks: Record<number, string> } }} ClaudeFold
 */

/** @returns {ClaudeFold} */
export function startFold(transcript) {
  return { transcript, stream: { messageId: null, blocks: {} } }
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
      return 'Update tasks'
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
      return { label: 'Read', detail: path ? `${baseName(path)}${range}` : undefined, detailMono: true, view: 'read' }
    }
    case 'Edit':
      return { label: 'Edit', detail: path || undefined, detailMono: true, view: 'edit', edits: [{ path, before: clip(String(i.old_string ?? ''), MAX_TOOL_OUTPUT), after: clip(String(i.new_string ?? ''), MAX_TOOL_OUTPUT) }] }
    case 'MultiEdit': {
      const edits = (Array.isArray(i.edits) ? i.edits : []).map((e) => ({ path, before: clip(String(e?.old_string ?? ''), MAX_TOOL_OUTPUT), after: clip(String(e?.new_string ?? ''), MAX_TOOL_OUTPUT) }))
      return { label: 'Edit', detail: path || undefined, detailMono: true, view: 'edit', edits }
    }
    case 'Write':
      return { label: 'Write', detail: path || undefined, detailMono: true, view: 'write', content: clip(typeof i.content === 'string' ? i.content : JSON.stringify(i.content ?? '', null, 2), MAX_TOOL_OUTPUT) }
    case 'NotebookEdit':
      return { label: 'Edit', detail: path || undefined, detailMono: true, view: 'edit', edits: [{ path, before: '', after: clip(String(i.new_source ?? ''), MAX_TOOL_OUTPUT) }] }
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
      return { label: 'Agent', detail: firstLineOf(String(i.description ?? i.prompt ?? ''), 120) || undefined, view: 'other' }
    case 'Skill':
      return { label: String(i.skill ?? i.name ?? 'Skill'), detail: 'skill', view: 'other' }
    case 'TodoWrite':
      return { label: 'Update tasks', view: 'other' }
    case 'AskUserQuestion':
      return { label: 'Question', view: 'other' }
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
function foldAssistantBlocks(t, messageId, content, at, parentToolUseId) {
  for (const block of content ?? []) {
    if (!block || typeof block !== 'object') continue
    if (block.type === 'text' || block.type === 'thinking' || block.type === 'redacted_thinking') {
      const kind = block.type === 'text' ? 'assistant' : 'thinking'
      const text = block.type === 'text' ? block.text ?? '' : block.type === 'thinking' ? block.thinking ?? '' : '[redacted]'
      if (!text) continue
      const id = blockTarget(t, messageId, kind, text)
      t = t.items.some((x) => x.id === id) ? updateItem(t, id, { text, streaming: false }) : appendItem(t, { kind, id, text, streaming: false, at })
    } else if (block.type === 'tool_use') {
      const view = toolView(block.name, block.input)
      const row = { kind: 'tool', id: block.id, name: block.name, title: toolTitle(block.name, block.input), input: toolInput(block.name, block.input), status: 'running', at, parent: parentToolUseId ?? undefined, ...view }
      t = t.items.some((x) => x.id === block.id) ? updateItem(t, block.id, (item) => ({ ...item, name: row.name, title: row.title, input: row.input, ...view })) : appendItem(t, row)
    }
  }
  return t
}

/** tool_result blocks in a user message close their tool rows. */
function foldToolResults(t, content, at) {
  if (!Array.isArray(content)) return t
  for (const block of content) {
    if (block?.type !== 'tool_result') continue
    const output = clip(resultText(block.content), MAX_TOOL_OUTPUT)
    t = updateItem(t, block.tool_use_id, (item) => (item.kind === 'tool' ? { ...item, output: output || item.output, status: block.is_error ? 'failed' : 'done' } : item))
  }
  return t
}

/**
 * Fold one live SDK message.
 * @param {ClaudeFold} f
 * @param {any} msg an `SDKMessage`
 * @returns {ClaudeFold}
 */
export function foldSdkMessage(f, msg) {
  if (!msg || typeof msg !== 'object') return f
  const at = Date.now()
  let t = f.transcript
  let stream = f.stream
  switch (msg.type) {
    case 'system': {
      if (msg.subtype === 'init') {
        t = {
          ...t, sessionId: msg.session_id ?? t.sessionId, model: msg.model ?? t.model, cwd: msg.cwd ?? t.cwd,
          permissionMode: typeof msg.permissionMode === 'string' ? msg.permissionMode : t.permissionMode,
          effort: msg.effort !== undefined ? msg.effort ?? null : t.effort
        }
        return { transcript: t, stream }
      }
      if (msg.subtype === 'status' && typeof msg.permissionMode === 'string' && msg.permissionMode !== t.permissionMode) {
        return { transcript: { ...t, permissionMode: msg.permissionMode }, stream }
      }
      if (msg.subtype === 'compact_boundary') return { transcript: appendItem(t, { kind: 'system', id: `compact:${msg.uuid ?? at}`, text: 'Context compacted', level: 'info', at }), stream }
      if (msg.subtype === 'permission_denied') return { transcript: appendItem(t, { kind: 'system', id: `denied:${msg.tool_use_id ?? at}`, text: msg.message ?? `${msg.tool_name} was denied`, level: 'error', at }), stream }
      return f
    }
    case 'stream_event': {
      const ev = msg.event ?? {}
      if (ev.type === 'message_start') {
        stream = { messageId: ev.message?.id ?? msg.uuid ?? `m${at}`, blocks: {} }
        return { transcript: t, stream }
      }
      const messageId = stream.messageId ?? msg.uuid ?? `m${at}`
      if (ev.type === 'content_block_start') {
        const b = ev.content_block ?? {}
        if (b.type === 'tool_use') {
          t = appendItem(t, { kind: 'tool', id: b.id, name: b.name, title: toolTitle(b.name, b.input), input: '', status: 'running', at, ...toolView(b.name, b.input) })
          stream = { messageId, blocks: { ...stream.blocks, [ev.index]: b.id } }
        } else {
          const id = `${messageId}:${ev.index}`
          // A thinking row exists from the block's start, so it can say how long it took
          // even when the provider omits the thinking text itself.
          if ((b.type === 'thinking' || b.type === 'redacted_thinking') && !t.items.some((x) => x.id === id)) t = appendItem(t, { kind: 'thinking', id, text: '', streaming: true, at })
          stream = { messageId, blocks: { ...stream.blocks, [ev.index]: id } }
        }
        return { transcript: t, stream }
      }
      if (ev.type === 'content_block_stop') {
        const id = stream.blocks[ev.index]
        if (!id) return f
        const next = updateItem(t, id, (item) => (item.kind === 'thinking' && item.durationMs === undefined ? { ...item, durationMs: Math.max(0, at - item.at) } : item))
        return next === t ? f : { transcript: next, stream }
      }
      if (ev.type === 'content_block_delta') {
        const d = ev.delta ?? {}
        const id = stream.blocks[ev.index] ?? `${messageId}:${ev.index}`
        if (d.type === 'text_delta') t = appendDelta(t, id, 'assistant', d.text, at)
        else if (d.type === 'thinking_delta') t = appendDelta(t, id, 'thinking', d.thinking, at)
        return { transcript: t, stream }
      }
      if (ev.type === 'message_delta' && ev.usage) {
        return { transcript: addUsage(t, { outputTokens: num(ev.usage.output_tokens) }), stream }
      }
      return f
    }
    case 'assistant': {
      const m = msg.message ?? {}
      const messageId = m.id ?? stream.messageId ?? msg.uuid
      t = foldAssistantBlocks(t, messageId, m.content, at, msg.parent_tool_use_id)
      // Each API call's own usage is what the window holds now; a subagent's calls fill its own window, not this one.
      const context = msg.parent_tool_use_id ? undefined : contextOf(m.usage)
      if (context) t = addUsage(t, { contextTokens: context })
      if (msg.error) t = appendItem(t, { kind: 'system', id: `aerr:${msg.uuid ?? at}`, text: String(msg.error), level: 'error', at })
      // The stream cursor stays: this may be one block of a message still
      // streaming its next block. `message_start` and `result` reset it.
      return { transcript: t, stream }
    }
    case 'user': {
      const content = msg.message?.content
      t = foldToolResults(t, content, at)
      return { transcript: t, stream }
    }
    case 'result': {
      t = settleStreams(t)
      const u = msg.usage ?? {}
      // The result's usage adds up every API call of the turn — a cost, not a context size (17 calls at
      // 66k each read as "1136k"). The context comes from each assistant message; the window from modelUsage.
      t = addUsage(t, { inputTokens: num(u.input_tokens), outputTokens: 0, costUsd: num(msg.total_cost_usd), contextWindow: contextWindowOf(msg.modelUsage, t.model) })
      if (msg.is_error || msg.subtype !== 'success') {
        const text = msg.result || msg.errors?.join?.('\n') || msg.subtype || 'The turn failed'
        t = setStatus(appendItem(t, { kind: 'system', id: `result:${msg.uuid ?? at}`, text: String(text), level: 'error', at }), 'error', String(text))
      } else t = setStatus(t, 'idle')
      return { transcript: t, stream: { messageId: null, blocks: {} } }
    }
    default:
      return f
  }
}

const num = (v, fallback) => (typeof v === 'number' ? v : fallback)

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
  for (const m of messages ?? []) {
    const at = typeof m.timestamp === 'string' ? Date.parse(m.timestamp) || Date.now() : Date.now()
    const inner = m.message ?? {}
    if (m.type === 'user') {
      const content = inner.content
      t = foldToolResults(t, content, at)
      const text = userText(content)
      const images = userImages(content)
      if ((text || images.length) && !m.isSynthetic && !m.isMeta) t = appendItem(t, { kind: 'user', id: m.uuid, text, at, ...(images.length ? { attachments: images } : {}) })
    } else if (m.type === 'assistant') {
      t = foldAssistantBlocks(t, inner.id ?? m.uuid, inner.content, at, m.parent_tool_use_id)
      const context = m.parent_tool_use_id ? undefined : contextOf(inner.usage)
      if (context) t = addUsage(t, { contextTokens: context })
    } else if (m.type === 'system' && inner?.subtype === 'compact_boundary') {
      t = appendItem(t, { kind: 'system', id: `compact:${m.uuid}`, text: 'Context compacted', level: 'info', at })
    }
  }
  return t
}

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
