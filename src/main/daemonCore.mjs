const LEGACY_EVENTS = new Set([
  'SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse',
  'Notification', 'Stop', 'SubagentStart', 'SubagentStop', 'SessionEnd'
])

const PROVIDERS = new Set(['claude', 'codex'])
const EVENT_KINDS = new Set([
  'session_started', 'prompt_submitted', 'tool_started', 'tool_finished',
  'attention_required', 'turn_completed', 'session_ended',
  'subagent_started', 'subagent_completed', 'context_compacting', 'context_compacted'
])

const MAX_TOKEN_COUNT = 1_000_000_000_000_000
const EARLIEST_TIMESTAMP = Date.UTC(2000, 0, 1)
const MAX_FUTURE_MS = 5 * 60_000

function record(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value
    : null
}

function onlyKeys(value, allowed) {
  return Object.keys(value).every((key) => allowed.has(key))
}

function text(value, max, { required = false, pattern } = {}) {
  if (value === undefined && !required) return undefined
  if (typeof value !== 'string' || value.length < (required ? 1 : 0) || value.length > max) return null
  if (/[\u0000\r\n]/.test(value) || (pattern && !pattern.test(value))) return null
  return value
}

function multilineText(value, max) {
  if (value === undefined) return undefined
  if (typeof value !== 'string' || value.length > max || value.includes('\u0000')) return null
  return value
}

function finite(value, min, max, integer = false) {
  if (value === undefined) return undefined
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) return null
  if (integer && !Number.isInteger(value)) return null
  return value
}

function boolean(value) {
  if (value === undefined) return undefined
  return typeof value === 'boolean' ? value : null
}

function timestamp(value, now) {
  return finite(value, EARLIEST_TIMESTAMP, now + MAX_FUTURE_MS)
}

function validateFocus(value) {
  if (value === undefined) return undefined
  const obj = record(value)
  if (!obj || !onlyKeys(obj, new Set(['hwnd', 'pid']))) return null
  const hwnd = text(obj.hwnd, 32, { pattern: /^[1-9]\d*$/ })
  const pid = finite(obj.pid, 1, 0xffffffff, true)
  if (hwnd === null || pid === null || (hwnd === undefined && pid === undefined)) return null
  return { ...(hwnd !== undefined && { hwnd }), ...(pid !== undefined && { pid }) }
}

/** Return a sanitized legacy Claude report, or null when the request violates the contract. */
export function validateLegacyReport(value, now = Date.now()) {
  const obj = record(value)
  if (!obj || !onlyKeys(obj, new Set([
    'event', 'sessionId', 'cwd', 'toolName', 'activity', 'message', 'contextPct',
    'contextRising', 'tokensOut', 'tokensIn', 'cacheRead', 'cacheWrite', 'msgId',
    'model', 'permissionMode', 'actorId', 'focusHwnd', 'focusPid', 'ts'
  ]))) return null
  if (!LEGACY_EVENTS.has(obj.event)) return null

  const sessionId = text(obj.sessionId, 256, { required: true })
  const cwd = text(obj.cwd, 4096)
  const toolName = text(obj.toolName, 256)
  const activity = multilineText(obj.activity, 4096)
  const message = multilineText(obj.message, 8192)
  const contextPct = finite(obj.contextPct, 0, 100)
  const contextRising = boolean(obj.contextRising)
  const tokensOut = finite(obj.tokensOut, 0, MAX_TOKEN_COUNT, true)
  const tokensIn = finite(obj.tokensIn, 0, MAX_TOKEN_COUNT, true)
  const cacheRead = finite(obj.cacheRead, 0, MAX_TOKEN_COUNT, true)
  const cacheWrite = finite(obj.cacheWrite, 0, MAX_TOKEN_COUNT, true)
  const msgId = text(obj.msgId, 512)
  const model = text(obj.model, 256)
  const permissionMode = text(obj.permissionMode, 128)
  const actorId = text(obj.actorId, 256)
  const focusHwnd = text(obj.focusHwnd, 32, { pattern: /^[1-9]\d*$/ })
  const focusPid = finite(obj.focusPid, 1, 0xffffffff, true)
  const ts = obj.ts === undefined ? undefined : timestamp(obj.ts, now)
  if ([sessionId, cwd, toolName, activity, message, contextPct, contextRising, tokensOut, tokensIn,
    cacheRead, cacheWrite, msgId, model, permissionMode, actorId, focusHwnd, focusPid, ts].includes(null)) return null

  return compact({
    event: obj.event, sessionId, cwd, toolName, activity, message, contextPct,
    contextRising, tokensOut, tokensIn, cacheRead, cacheWrite, msgId, model,
    permissionMode, actorId, focusHwnd, focusPid, ts
  })
}

function validateActor(value) {
  const obj = record(value)
  if (!obj || !onlyKeys(obj, new Set(['kind', 'id']))) return null
  if (obj.kind === 'root' && obj.id === undefined) return { kind: 'root' }
  if (obj.kind === 'subagent') {
    const id = text(obj.id, 256, { required: true })
    return id === null ? null : { kind: 'subagent', id }
  }
  return null
}

function validateAttention(value) {
  if (value === undefined) return undefined
  const obj = record(value)
  if (!obj || !onlyKeys(obj, new Set(['reason', 'message']))) return null
  if (obj.reason !== 'permission' && obj.reason !== 'question') return null
  const message = multilineText(obj.message, 8192)
  return message === null ? null : compact({ reason: obj.reason, message })
}

function validateUsage(value) {
  if (value === undefined) return undefined
  const obj = record(value)
  if (!obj || !onlyKeys(obj, new Set([
    'kind', 'inputTokens', 'outputTokens', 'cachedInputTokens', 'cacheWriteTokens',
    'contextPct', 'messageId', 'source'
  ]))) return null
  if (obj.kind !== 'delta' && obj.kind !== 'cumulative') return null
  const inputTokens = finite(obj.inputTokens, 0, MAX_TOKEN_COUNT, true)
  const outputTokens = finite(obj.outputTokens, 0, MAX_TOKEN_COUNT, true)
  const cachedInputTokens = finite(obj.cachedInputTokens, 0, MAX_TOKEN_COUNT, true)
  const cacheWriteTokens = finite(obj.cacheWriteTokens, 0, MAX_TOKEN_COUNT, true)
  const contextPct = finite(obj.contextPct, 0, 100)
  const messageId = text(obj.messageId, 512)
  const source = text(obj.source, 128)
  if ([inputTokens, outputTokens, cachedInputTokens, cacheWriteTokens, contextPct, messageId, source].includes(null)) return null
  if (obj.kind === 'delta' && messageId === undefined) return null
  return compact({ kind: obj.kind, inputTokens, outputTokens, cachedInputTokens, cacheWriteTokens, contextPct, messageId, source })
}

function validateTranscript(value) {
  if (value === undefined) return undefined
  const obj = record(value)
  if (!obj || !onlyKeys(obj, new Set(['path']))) return null
  const path = text(obj.path, 8192, { required: true })
  return path === null ? null : { path }
}

/** Return a sanitized provider-neutral event, or null when it violates AgentEventV1. */
export function validateAgentEventV1(value, now = Date.now()) {
  const obj = record(value)
  if (!obj || !onlyKeys(obj, new Set([
    'schemaVersion', 'provider', 'eventId', 'sessionId', 'turnId', 'actor', 'kind',
    'timestamp', 'cwd', 'model', 'permissionMode', 'toolName', 'activity',
    'attention', 'usage', 'transcript', 'focus'
  ]))) return null
  if (obj.schemaVersion !== 1 || !PROVIDERS.has(obj.provider) || !EVENT_KINDS.has(obj.kind)) return null
  const eventId = text(obj.eventId, 512, { required: true })
  const sessionId = text(obj.sessionId, 256, { required: true })
  const turnId = text(obj.turnId, 256)
  const actor = validateActor(obj.actor)
  const at = timestamp(obj.timestamp, now)
  const cwd = text(obj.cwd, 4096)
  const model = text(obj.model, 256)
  const permissionMode = text(obj.permissionMode, 128)
  const toolName = text(obj.toolName, 256)
  const activity = multilineText(obj.activity, 4096)
  const attention = validateAttention(obj.attention)
  const usage = validateUsage(obj.usage)
  const transcript = validateTranscript(obj.transcript)
  const focus = validateFocus(obj.focus)
  if ([eventId, sessionId, turnId, actor, at, cwd, model, permissionMode, toolName,
    activity, attention, usage, transcript, focus].includes(null)) return null
  if ((obj.kind === 'subagent_started' || obj.kind === 'subagent_completed') && actor.kind !== 'subagent') return null
  if ((obj.kind === 'session_started' || obj.kind === 'session_ended') && actor.kind !== 'root') return null
  if (obj.kind === 'attention_required' && attention === undefined) return null

  return compact({
    schemaVersion: 1, provider: obj.provider, eventId, sessionId, turnId, actor,
    kind: obj.kind, timestamp: at, cwd, model, permissionMode, toolName, activity,
    attention, usage, transcript, focus
  })
}

function compact(obj) {
  return Object.fromEntries(Object.entries(obj).filter(([, value]) => value !== undefined))
}
