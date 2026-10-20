// The provider-neutral transcript both chat panes render.
//
// Claude Code (Agent SDK stream-json messages) and Codex (app-server JSON-RPC
// notifications) fold into this one shape — `src/claude/fold.mjs` and
// `src/codex/fold.mjs` own the provider vocabularies; this file owns the
// shape and the pure operations on it, so the React pane never sees a
// provider message. Everything here is pure and tested.
import { changeLines, countChanges, splitLines } from './diff.mjs'

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
 * @property {string} [uuid] the provider's id for this message: Claude's message uuid (what `rewindFiles` and a fork take)
 * @property {string} [turnId] Codex: the turn this message started (what `thread/fork` takes)
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
 * @property {number} [tokens] the CLI's live estimate of the thinking tokens so far
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
 * @property {string} [path] the file a Read, Edit or Write touched, in full (the host can open it)
 * @property {TodoEntry[]} [todos] for `todo` rows: the list as TodoWrite left it
 * @property {string} [prompt] for `agent` rows: the subagent's prompt
 * @property {string} [parent] the Agent row this step ran under (a subagent's step)
 * @property {string} [taskId] the CLI's task id while this command or agent is a task (what `stopTask` takes)
 * @property {boolean} [background] the command or agent now runs in the background
 * @property {string} [agentType] an Agent row's subagent type (Explore, general-purpose)
 * @property {'completed' | 'failed' | 'stopped'} [outcome] how a background task ended (its row closed when it was launched)
 * @property {number} [endedAt] when it ended
 * @property {string} [summary] what the finished background task reported
 * @property {{ tool: string, receivers: string[], states: Record<string, { status: string, message?: string }>, model?: string }} [collab] Codex: a multi-agent call — the agent threads it named and each one's last state
 */
/**
 * `command`: IN (the command) and OUT (its output), open. `edit`: a summary and
 * the diff. `write`: a line count and the content. `read`: the line alone.
 * `search`: a match count, OUT on click. `todo`: the checklist. `agent`: the
 * prompt, the subagent's own steps and its result. `other`: IN/OUT on click.
 * @typedef {'command' | 'edit' | 'write' | 'read' | 'search' | 'todo' | 'agent' | 'other'} ToolView
 */
/** @typedef {{ content: string, status: 'pending' | 'in_progress' | 'completed', activeForm?: string }} TodoEntry */
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
 * @property {string} [toolName] the tool asking (Bash, Edit, ExitPlanMode…)
 * @property {'tool' | 'plan'} [variant] `plan`: ExitPlanMode — the plan, then approve it or keep planning
 * @property {string} [question] the tool's own question ("Allow fetching this url?"); else "Do you want to proceed with <tool>?"
 * @property {string} [command] a shell command to show as IN
 * @property {FileChange[]} [edits] an edit to show as a diff
 * @property {string} [plan] the plan, Markdown
 * @property {string} [rule] what "don't ask again" saves, in words ("Bash(npm test:*) in this project")
 * @property {string} [message] what the user told the agent with a refusal
 * @property {string} [toolUseId] the tool call it asks about, when the card stands in for that step (ExitPlanMode)
 */
/**
 * `plan-auto` / `plan-manual` approve a plan and leave plan mode for
 * *Bypass* (`acceptEdits`) or *Manual*.
 * @typedef {'allow' | 'allow-session' | 'deny' | 'cancel' | 'plan-auto' | 'plan-manual'} ApprovalChoice
 */
/**
 * @typedef {Object} ChatItemSystem
 * @property {'system'} kind
 * @property {string} id
 * @property {string} text
 * @property {'info' | 'warning' | 'error'} level
 * @property {number} at
 * @property {'interrupt' | 'compact' | 'command' | 'cleared' | 'task' | 'limit' | 'notice'} [variant]
 * @property {string} [detail] the compaction's summary, a command's output, a task's summary
 * @property {number} [tokens] a compaction: the context it started from
 * @property {{ id: string, name: string, kind: string }} [agent] Codex: a subagent's activity — its thread, its name, what happened
 */
/**
 * The end of a turn: how long it took, what it produced, and the files it
 * changed — a footer under the reply, not a step on the rail.
 * @typedef {Object} ChatItemTurn
 * @property {'turn'} kind
 * @property {string} id
 * @property {number} at
 * @property {number} [durationMs]
 * @property {number} [outputTokens]
 * @property {TurnFile[]} files
 */
/** @typedef {{ path: string, added: number, removed: number }} TurnFile */
/**
 * One question the agent asks (Claude's AskUserQuestion, Codex's
 * item/tool/requestUserInput, an MCP form elicitation). `options` null means
 * free text; `allowOther` adds a free-text choice beside the options.
 * @typedef {Object} Question
 * @property {string} id the provider's question id (Codex) or the question text (Claude)
 * @property {string} text
 * @property {string} [header]
 * @property {{ label: string, description?: string, preview?: string }[] | null} options `preview`: Markdown shown while the option is focused (Claude's previewFormat "markdown")
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
 * @property {string} [toolUseId] the AskUserQuestion call it stands in for
 */
/** @typedef {ChatItemUser | ChatItemAssistant | ChatItemThinking | ChatItemTool | ChatItemApproval | ChatItemQuestion | ChatItemSystem | ChatItemTurn} ChatItem */

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
 * @property {'compacting' | null} activity what the agent is doing besides a turn's steps
 * @property {{ attempt: number, max: number } | null} retry the API call is being retried (the working line says so)
 * @property {BackgroundTask[]} background what runs in the background now
 * @property {string | null} suggestion the CLI's guess at the next prompt, until the user types or sends
 * @property {boolean} checkpoints file checkpoints exist, so code can be rewound (Claude)
 * @property {string | null} outputStyle the session's output style
 * @property {'off' | 'on' | 'cooldown' | null} fastMode
 * @property {ChatItemUser[]} queue prompts sent while a turn ran, not yet read by the agent; each joins `items` where the agent reads it
 */
/** @typedef {{ id: string, description: string, type: string, toolUseId?: string }} BackgroundTask */

/**
 * What the composer's menus offer, fetched on demand (`ChatBridge.options`).
 * `id` is what `configure` takes (an alias such as `opus` on Claude); `model` the canonical id it resolves to.
 * @typedef {{ id: string, label: string, description?: string, efforts: string[], defaultEffort?: string | null, model?: string }} ModelOption
 * @typedef {{ id: string, label: string, description: string }} ModeOption
 * @typedef {{ name: string, description: string, argumentHint?: string }} CommandOption
 * `outputStyles` and `fastMode` (whether the current model offers it) are Claude's.
 * @typedef {{ models: ModelOption[], modes: ModeOption[], commands: CommandOption[], outputStyles?: string[], fastMode?: boolean }} ChatOptions
 */
/** @typedef {{ model?: string | null, effort?: string | null, permissionMode?: string | null, fastMode?: boolean, outputStyle?: string }} ChatConfigPatch */

/**
 * What a rewind would change (a dry run) or did change.
 * @typedef {{ canRewind: boolean, files: string[], insertions: number, deletions: number, error?: string }} RewindResult
 */
/**
 * The context window by category (Claude's `getContextUsage`).
 * @typedef {{ total: number, max: number, percent: number, categories: { name: string, tokens: number, kind: string }[], memoryFiles: { path: string, tokens: number }[] }} ContextUsage
 */
/**
 * One MCP server as the session sees it.
 * @typedef {{ name: string, status: 'connected' | 'failed' | 'needs-auth' | 'pending' | 'disabled', error?: string, tools: number, scope?: string }} McpServer
 */
/** @typedef {{ op: 'list' } | { op: 'toggle', name: string, enabled: boolean } | { op: 'reconnect', name: string }} McpRequest */

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
    turnStartedAt: null,
    activity: null,
    retry: null,
    background: [],
    suggestion: null,
    checkpoints: false,
    outputStyle: null,
    fastMode: null,
    queue: [],
    limits: null,
    planMode: false,
    queuePaused: false,
    pendingPlan: null
  }
}

/** Hold a prompt sent mid-turn until the agent reads it. */
export function enqueue(t, item) {
  return { ...t, queue: [...t.queue, item] }
}

/**
 * The agent read a queued prompt (`id`): it joins the transcript here, and
 * starts a turn when none is running. Unknown ids leave the transcript as is.
 */
export function dequeue(t, id, at) {
  const item = t.queue.find((x) => x.id === id)
  if (!item) return t
  const next = appendItem({ ...t, queue: t.queue.filter((x) => x.id !== id) }, item)
  return next.status === 'running' || next.status === 'waiting' ? next : beginTurn(next, at)
}

/** Take a queued prompt back before the agent reads it. */
export function unqueue(t, id) {
  return t.queue.some((x) => x.id === id) ? { ...t, queue: t.queue.filter((x) => x.id !== id) } : t
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

/** Drop the item with `id` (a queued prompt the user took back). Unknown ids leave the transcript untouched. */
export function removeItem(t, id) {
  const items = t.items.filter((x) => x.id !== id)
  return items.length === t.items.length ? t : { ...t, items }
}

/**
 * The files a run of items changed, in first-touched order, with the lines
 * each added and removed: Edit rows by their diffs, Write rows by the lines
 * they wrote (a write replaces a file, so its old lines are not known here).
 * A subagent's edits count too; failed and declined steps do not.
 * @param {ChatItem[]} items
 * @returns {TurnFile[]}
 */
export function turnFiles(items) {
  const files = new Map()
  const add = (path, added, removed) => {
    if (!path) return
    const f = files.get(path) ?? { path, added: 0, removed: 0 }
    files.set(path, { path, added: f.added + added, removed: f.removed + removed })
  }
  for (const x of items) {
    if (x.kind !== 'tool' || x.status === 'failed' || x.status === 'declined') continue
    if (x.view === 'edit') {
      for (const e of x.edits ?? []) {
        const c = countChanges(changeLines(e))
        add(e.path || x.path, c.added, c.removed)
      }
    } else if (x.view === 'write') add(x.path, splitLines(x.content ?? '').length, 0)
  }
  return [...files.values()]
}

/**
 * Close a turn: a footer item with its duration, the output it produced and
 * the files changed since the turn's prompt. Items after the last user
 * message are the turn's.
 * @param {Transcript} t
 * @param {{ at: number, durationMs?: number, outputTokens?: number, id?: string }} info
 */
export function closeTurn(t, info) {
  let start = t.items.length
  // A message steered into the running turn is part of it, not its start.
  while (start > 0 && (t.items[start - 1].kind !== 'user' || t.items[start - 1].steered)) start--
  const steps = t.items.slice(start)
  if (!steps.some((x) => x.kind !== 'turn' && x.kind !== 'system')) return t
  if (steps.some((x) => x.kind === 'turn')) return t
  const item = {
    kind: 'turn', id: info.id ?? `turn:${info.at}`, at: info.at, files: turnFiles(steps),
    ...(info.turnId ? { turnId: info.turnId } : {}),
    ...(info.interrupted ? { interrupted: true } : {}),
    ...(typeof info.durationMs === 'number' ? { durationMs: info.durationMs } : {}),
    ...(typeof info.outputTokens === 'number' && info.outputTokens > 0 ? { outputTokens: info.outputTokens } : {})
  }
  return appendItem(t, item)
}

/** Add streamed text to an assistant/thinking item; creates it when absent (under `parent`, a subagent's Agent row, when given). */
export function appendDelta(t, id, kind, delta, at, parent) {
  if (!delta) return t
  const i = t.items.findIndex((x) => x.id === id)
  if (i < 0) return appendItem(t, { kind, id, text: clip(delta, MAX_TEXT), streaming: true, at, ...(parent ? { parent } : {}) })
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

/** A turn starts: the status goes to running, the clock starts, and the last guess at a prompt is spent. */
export function beginTurn(t, at) {
  return { ...setStatus(t, 'running'), turnStartedAt: at, suggestion: null, retry: null }
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

/** Record an answered approval (with what the user told the agent, if anything); the status returns to running unless another one waits. */
export function decideApproval(t, id, choice, message) {
  const next = updateItem(t, id, (item) => (item.kind === 'approval' && !item.decided ? { ...item, decided: choice, ...(message ? { message } : {}) } : item))
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
