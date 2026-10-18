// The provider-neutral transcript both chat panes render.
//
// Claude Code (Agent SDK stream-json messages) and Codex (app-server JSON-RPC
// notifications) fold into this one shape — `src/claude/fold.mjs` and
// `src/codex/fold.mjs` own the provider vocabularies; this file owns the
// shape and the pure operations on it, so the React pane never sees a
// provider message. Everything here is pure and tested.

/** @typedef {'claude' | 'codex'} Provider */

/**
 * @typedef {'idle' | 'running' | 'waiting' | 'error' | 'closed'} SessionStatus
 * idle: no turn in flight. running: the agent is working. waiting: a request
 * needs the user (an approval, a question). error: the last turn failed.
 * closed: the process is gone — the pane can only read history or restart.
 */

/**
 * What a user turn may carry besides text. An image is inline base64 (a
 * paste, a picked file); a file is a reference the CLI resolves itself
 * (Claude's `@path`, Codex's `mention`).
 * `width`/`height` are the image's pixel size when the pane could read it.
 * @typedef {{ kind: 'image', name: string, mime: string, data: string, path?: string, width?: number, height?: number } | { kind: 'file', path: string, name?: string }} Attachment
 */
/** What a transcript row keeps of an attachment (never the bytes). */
/** @typedef {{ kind: 'image' | 'file', name: string, width?: number, height?: number, path?: string }} AttachmentSummary */

/**
 * @typedef {Object} ChatItemUser
 * @property {'user'} kind
 * @property {string} id
 * @property {string} text
 * @property {AttachmentSummary[]} [attachments]
 * @property {number} at epoch ms
 */
/**
 * @typedef {Object} ChatItemAssistant
 * @property {'assistant'} kind
 * @property {string} id
 * @property {string} text
 * @property {boolean} streaming still receiving deltas
 * @property {number} at
 */
/**
 * @typedef {Object} ChatItemThinking
 * @property {'thinking'} kind
 * @property {string} id
 * @property {string} text empty when the provider omits the thinking text (the row still says how long it took)
 * @property {boolean} streaming
 * @property {number} at
 * @property {number} [durationMs] from the block's start to its end, once it ended ("Thought for 2s")
 */
/**
 * @typedef {Object} ChatItemTool
 * @property {'tool'} kind
 * @property {string} id
 * @property {string} name provider tool name (Bash, Edit, commandExecution…)
 * @property {string} title one line for the row: the command, the file, the query
 * @property {string} [input] the full input, shown expanded
 * @property {string} [output] what came back, bounded by MAX_TOOL_OUTPUT
 * @property {'running' | 'done' | 'failed' | 'declined'} status
 * @property {number} at
 * @property {string} [label] the row's bold name ("Bash", "Edit", "browser_batch (Claude in Chrome)")
 * @property {string} [detail] the muted rest of the line: a command's description, a path, a pattern
 * @property {boolean} [detailMono] the detail is a path or a pattern (monospace), not prose
 * @property {ToolView} [view] which body the row gets
 * @property {FileChange[]} [edits] for `edit` rows: what changed, file by file
 * @property {string} [content] for `write` rows: the written text
 */
/**
 * `command`: IN (the command) and OUT (its output), open. `edit`: a summary and
 * the diff. `write`: a line count and the content. `read`: the line alone.
 * `search`: a match count, OUT on click. `other`: IN/OUT on click.
 * @typedef {'command' | 'edit' | 'write' | 'read' | 'search' | 'other'} ToolView
 */
/**
 * One file's change: a before/after pair (Claude's Edit) or a unified diff /
 * whole content (Codex's fileChange).
 * @typedef {{ path: string, before?: string, after?: string, diff?: string, kind?: 'add' | 'delete' | 'update' }} FileChange
 */
/**
 * @typedef {Object} ChatItemApproval
 * @property {'approval'} kind
 * @property {string} id the provider's request id — the answer goes back under it
 * @property {string} title what is being asked ("Run `npm test`", "Edit App.tsx")
 * @property {string} [detail] the command, the diff summary, the reason
 * @property {ApprovalChoice[]} choices what the pane may answer
 * @property {ApprovalChoice} [decided] once answered
 * @property {number} at
 */
/** @typedef {'allow' | 'allow-session' | 'deny' | 'cancel'} ApprovalChoice */
/**
 * @typedef {Object} ChatItemSystem
 * @property {'system'} kind
 * @property {string} id
 * @property {string} text
 * @property {'info' | 'error'} level
 * @property {number} at
 */
/**
 * One question the agent asks (Claude's AskUserQuestion, Codex's
 * item/tool/requestUserInput, an MCP form elicitation). `options` null means
 * free text; `allowOther` adds a free-text choice beside the options.
 * @typedef {Object} Question
 * @property {string} id the provider's question id (Codex) or the question text (Claude)
 * @property {string} text
 * @property {string} [header]
 * @property {{ label: string, description?: string }[] | null} options
 * @property {boolean} multiSelect
 * @property {boolean} allowOther
 * @property {boolean} [secret]
 */
/**
 * @typedef {Object} ChatItemQuestion
 * @property {'question'} kind
 * @property {string} id the request id — the answer goes back under it
 * @property {string} title who is asking and why ("Claude needs a decision", "Codex · <server> needs input")
 * @property {string} [detail]
 * @property {Question[]} questions
 * @property {Record<string, string[]>} [answers] once answered, by question id
 * @property {boolean} [cancelled]
 * @property {number} at
 */
/** @typedef {ChatItemUser | ChatItemAssistant | ChatItemThinking | ChatItemTool | ChatItemApproval | ChatItemQuestion | ChatItemSystem} ChatItem */

/**
 * @typedef {Object} Usage
 * @property {number} inputTokens
 * @property {number} outputTokens
 * @property {number} [contextTokens] what the live context window holds now
 * @property {number} [contextWindow]
 * @property {number} [costUsd]
 */

/**
 * @typedef {Object} Transcript
 * @property {Provider} provider
 * @property {string | null} sessionId the provider's own id (Claude session id, Codex thread id)
 * @property {string} cwd
 * @property {string | null} model
 * @property {string | null} title
 * @property {SessionStatus} status
 * @property {ChatItem[]} items
 * @property {Usage} usage
 * @property {string | null} error the last fatal message, for the pane's banner
 * @property {string | null} effort the reasoning effort the next request uses; null is the model's default
 * @property {string | null} permissionMode Claude's PermissionMode, or the Codex preset id
 * @property {number | null} turnStartedAt when the turn in flight started (epoch ms)
 */

/**
 * What the composer's menus offer, fetched on demand (`ChatBridge.options`).
 * `id` is what `configure` takes (an alias such as `opus` on Claude); `model` the canonical id it resolves to.
 * @typedef {{ id: string, label: string, description?: string, efforts: string[], defaultEffort?: string | null, model?: string }} ModelOption
 * @typedef {{ id: string, label: string, description: string }} ModeOption
 * @typedef {{ name: string, description: string, argumentHint?: string }} CommandOption
 * @typedef {{ models: ModelOption[], modes: ModeOption[], commands: CommandOption[] }} ChatOptions
 */
/** @typedef {{ model?: string | null, effort?: string | null, permissionMode?: string | null }} ChatConfigPatch */

export const MAX_ITEMS = 2000
export const MAX_TOOL_OUTPUT = 64 * 1024
export const MAX_TEXT = 512 * 1024

/**
 * @param {Provider} provider
 * @param {{ cwd: string, sessionId?: string | null, model?: string | null, title?: string | null, effort?: string | null, permissionMode?: string | null }} init
 * @returns {Transcript}
 */
export function emptyTranscript(provider, init) {
  return {
    provider,
    sessionId: init.sessionId ?? null,
    cwd: init.cwd,
    model: init.model ?? null,
    title: init.title ?? null,
    status: 'idle',
    items: [],
    usage: { inputTokens: 0, outputTokens: 0 },
    error: null,
    effort: init.effort ?? null,
    permissionMode: init.permissionMode ?? null,
    turnStartedAt: null
  }
}

/** Bound a text to `max` characters, keeping the head (a command's first
 * lines) and the tail (its exit), with a marker between. */
export function clip(text, max) {
  if (typeof text !== 'string') return ''
  if (text.length <= max) return text
  const head = Math.floor(max * 0.7)
  const tail = max - head
  return `${text.slice(0, head)}\n… [${text.length - max} characters omitted] …\n${text.slice(text.length - tail)}`
}

/**
 * Append an item, dropping the oldest past MAX_ITEMS. Returns a new transcript;
 * the input is never mutated (the pane diffs by identity).
 * @param {Transcript} t
 * @param {ChatItem} item
 * @returns {Transcript}
 */
export function appendItem(t, item) {
  const items = t.items.length >= MAX_ITEMS ? [...t.items.slice(t.items.length - MAX_ITEMS + 1), item] : [...t.items, item]
  return { ...t, items }
}

/**
 * Replace the item with `id` through `update` (a patch object or a function).
 * Unknown ids leave the transcript untouched — a late delta for an item the
 * ring already dropped is not an error.
 * @param {Transcript} t
 * @param {string} id
 * @param {Partial<ChatItem> | ((item: ChatItem) => ChatItem)} update
 * @returns {Transcript}
 */
export function updateItem(t, id, update) {
  const i = t.items.findIndex((x) => x.id === id)
  if (i < 0) return t
  const current = t.items[i]
  const next = typeof update === 'function' ? update(current) : { ...current, ...update }
  if (next === current) return t
  const items = t.items.slice()
  items[i] = next
  return { ...t, items }
}

/** Add streamed text to an assistant/thinking item; creates it when absent. */
export function appendDelta(t, id, kind, delta, at) {
  if (!delta) return t
  const i = t.items.findIndex((x) => x.id === id)
  if (i < 0) return appendItem(t, { kind, id, text: clip(delta, MAX_TEXT), streaming: true, at })
  const current = t.items[i]
  if (current.kind !== kind) return t
  return updateItem(t, id, { text: clip(current.text + delta, MAX_TEXT), streaming: true })
}

/** Mark every streaming text item finished (a turn ended, however it ended). */
export function settleStreams(t) {
  if (!t.items.some((x) => (x.kind === 'assistant' || x.kind === 'thinking') && x.streaming)) return t
  return { ...t, items: t.items.map((x) => ((x.kind === 'assistant' || x.kind === 'thinking') && x.streaming ? { ...x, streaming: false } : x)) }
}

/** The approvals still waiting for an answer, oldest first. */
export function pendingApprovals(t) {
  return t.items.filter((x) => x.kind === 'approval' && !x.decided)
}

/** The questions still waiting for an answer, oldest first. */
export function pendingQuestions(t) {
  return t.items.filter((x) => x.kind === 'question' && !x.answers && !x.cancelled)
}

/** Anything the agent is waiting on the user for. */
export function pendingRequests(t) {
  return t.items.filter((x) => (x.kind === 'approval' && !x.decided) || (x.kind === 'question' && !x.answers && !x.cancelled))
}

/**
 * Record a question's answers (by question id); the status returns to running
 * unless something else still waits. `null` answers mark it cancelled.
 * @param {Transcript} t
 * @param {string} id
 * @param {Record<string, string[]> | null} answers
 */
export function answerQuestion(t, id, answers) {
  const next = updateItem(t, id, (item) => (item.kind === 'question' && !item.answers && !item.cancelled ? (answers ? { ...item, answers } : { ...item, cancelled: true }) : item))
  if (next === t) return t
  return pendingRequests(next).length ? next : setStatus(next, 'running')
}

/** The user-visible summary of an attachment list. @param {Attachment[]} [list] */
export function summarizeAttachments(list) {
  if (!list?.length) return undefined
  return list.map((a) => (a.kind === 'image'
    ? { kind: 'image', name: a.name, ...(a.width && a.height ? { width: a.width, height: a.height } : {}) }
    : { kind: 'file', name: a.name ?? a.path, path: a.path }))
}

/** A turn starts: the status goes to running and the clock starts. */
export function beginTurn(t, at) {
  return { ...setStatus(t, 'running'), turnStartedAt: at }
}

/**
 * @param {Transcript} t
 * @param {SessionStatus} status
 * @param {string | null} [error]
 */
export function setStatus(t, status, error = null) {
  if (t.status === status && t.error === error) return t
  return { ...t, status, error }
}

/** Record an answered approval; the status returns to running unless another one waits. */
export function decideApproval(t, id, choice) {
  const next = updateItem(t, id, (item) => (item.kind === 'approval' && !item.decided ? { ...item, decided: choice } : item))
  if (next === t) return t
  return pendingRequests(next).length ? next : setStatus(next, 'running')
}

/** Merge usage counters; absent fields keep their previous value. */
export function addUsage(t, delta) {
  const usage = { ...t.usage }
  if (typeof delta.inputTokens === 'number') usage.inputTokens += delta.inputTokens
  if (typeof delta.outputTokens === 'number') usage.outputTokens += delta.outputTokens
  if (typeof delta.contextTokens === 'number') usage.contextTokens = delta.contextTokens
  if (typeof delta.contextWindow === 'number') usage.contextWindow = delta.contextWindow
  if (typeof delta.costUsd === 'number') usage.costUsd = (usage.costUsd ?? 0) + delta.costUsd
  return { ...t, usage }
}

/** The one line a session picker shows for a transcript: its title, else its first prompt. */
export function transcriptSummary(t) {
  if (t.title) return t.title
  const first = t.items.find((x) => x.kind === 'user')
  return first ? firstLine(first.text) : '(empty session)'
}

export function firstLine(text, max = 120) {
  const line = ((text ?? '').split(/\r?\n/).find((l) => l.trim()) ?? '').trim()
  return line.length > max ? `${line.slice(0, max - 1)}…` : line
}

/**
 * A session the picker lists — one shape for both providers' history.
 * @typedef {Object} SessionSummary
 * @property {Provider} provider
 * @property {string} id
 * @property {string} title the custom name, else the first prompt
 * @property {string} cwd
 * @property {number} updatedAt epoch ms
 * @property {number} [createdAt]
 * @property {string | null} [model]
 * @property {string | null} [branch]
 */

/** Newest first, bounded. */
export function sortSessions(list, limit = 200) {
  return [...list].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, limit)
}
