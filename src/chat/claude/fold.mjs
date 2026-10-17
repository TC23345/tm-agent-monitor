// Folds Claude Code Agent SDK messages (`--output-format stream-json`) and
// stored session messages into the shared transcript. Pure; shapes are the
// SDK 0.3.302 types (`SDKMessage`, `SessionMessage`, `SDKSessionInfo`) —
// the same stream the Cursor extension consumes (docs/rea-findings.md).
import { addUsage, appendDelta, appendItem, clip, emptyTranscript, MAX_TOOL_OUTPUT, setStatus, settleStreams, updateItem } from '../shared/chatModel.mjs'

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

/**
 * Fold the content blocks of a complete assistant message. Items streamed
 * earlier (ids `${messageId}:${index}` for text/thinking, the tool_use id for
 * tools) are finalised; unseen ones are appended.
 */
function foldAssistantBlocks(t, messageId, content, at, parentToolUseId) {
  for (const [index, block] of (content ?? []).entries()) {
    if (!block || typeof block !== 'object') continue
    if (block.type === 'text') {
      if (!block.text) continue
      const id = `${messageId}:${index}`
      t = t.items.some((x) => x.id === id) ? updateItem(t, id, { text: block.text, streaming: false }) : appendItem(t, { kind: 'assistant', id, text: block.text, streaming: false, at })
    } else if (block.type === 'thinking' || block.type === 'redacted_thinking') {
      const text = block.type === 'thinking' ? block.thinking ?? '' : '[redacted]'
      if (!text) continue
      const id = `${messageId}:${index}`
      t = t.items.some((x) => x.id === id) ? updateItem(t, id, { text, streaming: false }) : appendItem(t, { kind: 'thinking', id, text, streaming: false, at })
    } else if (block.type === 'tool_use') {
      const row = { kind: 'tool', id: block.id, name: block.name, title: toolTitle(block.name, block.input), input: toolInput(block.name, block.input), status: 'running', at, parent: parentToolUseId ?? undefined }
      t = t.items.some((x) => x.id === block.id) ? updateItem(t, block.id, (item) => ({ ...item, name: row.name, title: row.title, input: row.input })) : appendItem(t, row)
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
        t = { ...t, sessionId: msg.session_id ?? t.sessionId, model: msg.model ?? t.model, cwd: msg.cwd ?? t.cwd }
        return { transcript: t, stream }
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
          t = appendItem(t, { kind: 'tool', id: b.id, name: b.name, title: toolTitle(b.name, b.input), input: '', status: 'running', at })
          stream = { messageId, blocks: { ...stream.blocks, [ev.index]: b.id } }
        } else {
          stream = { messageId, blocks: { ...stream.blocks, [ev.index]: `${messageId}:${ev.index}` } }
        }
        return { transcript: t, stream }
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
      if (msg.error) t = appendItem(t, { kind: 'system', id: `aerr:${msg.uuid ?? at}`, text: String(msg.error), level: 'error', at })
      return { transcript: t, stream: { messageId: null, blocks: {} } }
    }
    case 'user': {
      const content = msg.message?.content
      t = foldToolResults(t, content, at)
      return { transcript: t, stream }
    }
    case 'result': {
      t = settleStreams(t)
      const u = msg.usage ?? {}
      const context = num(u.input_tokens, 0) + num(u.cache_read_input_tokens, 0) + num(u.cache_creation_input_tokens, 0)
      t = addUsage(t, { inputTokens: num(u.input_tokens), outputTokens: 0, contextTokens: context || undefined, costUsd: num(msg.total_cost_usd) })
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
      if (text && !m.isSynthetic && !m.isMeta) t = appendItem(t, { kind: 'user', id: m.uuid, text, at })
    } else if (m.type === 'assistant') {
      t = foldAssistantBlocks(t, inner.id ?? m.uuid, inner.content, at, m.parent_tool_use_id)
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
