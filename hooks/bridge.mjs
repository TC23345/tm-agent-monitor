#!/usr/bin/env node
// Provider-neutral lifecycle-hook bridge for TaylorMade Agent Monitor.
//
// Hook commands are on the critical path of Claude Code / Codex. This module
// therefore performs one bounded loopback POST, never retries, never writes to
// stdout, and always resolves successfully. The daemon publishes its current
// authenticated endpoint in a small discovery file so hooks do not depend on
// inheriting the Electron app's environment.

import { closeSync, openSync, readFileSync, readSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Worker } from 'node:worker_threads'

export const BRIDGE_SCHEMA_VERSION = 1
export const OWNER_MARKER = 'tm-agent-monitor-hook-v1'
export const DEFAULT_TIMEOUT_MS = 180

const __dirname = dirname(fileURLToPath(import.meta.url))

export function defaultEndpointPath(env = process.env) {
  if (env.TM_AGENT_MONITOR_ENDPOINT_FILE) return env.TM_AGENT_MONITOR_ENDPOINT_FILE
  const appData = env.APPDATA || join(homedir(), 'AppData', 'Roaming')
  return join(appData, 'taylormade-agent-monitor', 'hook-endpoint.json')
}

export function readEndpoint(path = defaultEndpointPath()) {
  try {
    const value = JSON.parse(readFileSync(path, 'utf8'))
    const port = Number(value?.port)
    if (
      value?.schemaVersion !== BRIDGE_SCHEMA_VERSION ||
      !Number.isInteger(port) || port < 1 || port > 65_535 ||
      typeof value?.token !== 'string' || value.token.length < 16
    ) return null
    return { schemaVersion: BRIDGE_SCHEMA_VERSION, port, token: value.token }
  } catch {
    return null
  }
}

function readStdin() {
  try { return readFileSync(0, 'utf8') } catch { return '' }
}

const oneLine = (s) => String(s ?? '').replace(/\s+/g, ' ').trim()
const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)
const base = (p) => (p ? String(p).replace(/[\\/]+$/, '').split(/[\\/]/).pop() : '')

function activityFor(tool, input) {
  if (!tool) return undefined
  const t = String(tool).toLowerCase()
  try {
    if (t.includes('bash') || t.includes('shell') || t.includes('command')) {
      return input?.command ? `$ ${clip(oneLine(input.command), 72)}` : undefined
    }
    if (t.includes('edit') || t.includes('write') || t.includes('apply_patch')) {
      const fp = input?.file_path || input?.notebook_path || input?.path
      return fp ? `editing ${base(fp)}` : undefined
    }
    if (t.includes('read') || t.includes('view')) {
      const fp = input?.file_path || input?.path
      return fp ? `reading ${base(fp)}` : undefined
    }
    if (t.includes('grep') || t.includes('glob') || t.includes('search') || t.includes('find')) {
      return input?.pattern ? `searching ${clip(oneLine(input.pattern), 48)}` : 'searching the codebase'
    }
    if (t.includes('web') || t.includes('fetch')) return 'fetching from the web'
    if (t.includes('task') || t.includes('agent')) return 'running a subagent'
  } catch {
    // Activity is cosmetic; never fail a hook over it.
  }
  return undefined
}

function contextWindowFor(model, env = process.env) {
  const override = Number(env.CLAUDE_WATCH_CONTEXT_WINDOW)
  if (override > 0) return override
  if (model && /haiku/i.test(model)) return 200_000
  return 1_000_000
}

/** Best-effort Claude JSONL usage extraction. Codex has an isolated parser. */
export function readClaudeTail(transcriptPath, env = process.env) {
  if (!transcriptPath) return undefined
  let fd
  try {
    const size = statSync(transcriptPath).size
    const want = Math.min(size, 96 * 1024)
    fd = openSync(transcriptPath, 'r')
    const buf = Buffer.alloc(want)
    readSync(fd, buf, 0, want, size - want)
    const lines = buf.toString('utf8').split('\n').filter(Boolean)
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const row = JSON.parse(lines[i])
        const u = row?.message?.usage || row?.usage
        if (!u) continue
        const model = row?.message?.model || row?.model
        const contextTokens =
          Number(u.input_tokens || 0) +
          Number(u.cache_read_input_tokens || 0) +
          Number(u.cache_creation_input_tokens || 0)
        return {
          model,
          messageId: row?.message?.id || row?.uuid,
          contextPct: contextTokens > 0
            ? Math.min(100, Math.round((contextTokens / contextWindowFor(model, env)) * 100))
            : undefined,
          usage: {
            kind: 'delta',
            inputTokens: Number(u.input_tokens) || 0,
            outputTokens: Number(u.output_tokens) || 0,
            cachedInputTokens: Number(u.cache_read_input_tokens) || 0,
            cacheWriteTokens: Number(u.cache_creation_input_tokens) || 0,
            messageId: row?.message?.id || row?.uuid,
            source: 'transcript'
          }
        }
      } catch {
        // The first/last tail row can be partial.
      }
    }
  } catch {
    return undefined
  } finally {
    if (fd !== undefined) try { closeSync(fd) } catch { /* noop */ }
  }
  return undefined
}

const EVENT_MAP = {
  claude: {
    SessionStart: 'session_started',
    UserPromptSubmit: 'prompt_submitted',
    PreToolUse: 'tool_started',
    PermissionRequest: 'attention_required',
    PostToolUse: 'tool_finished',
    Notification: 'attention_required',
    Stop: 'turn_completed',
    SubagentStart: 'subagent_started',
    SubagentStop: 'subagent_completed',
    PreCompact: 'context_compacting',
    PostCompact: 'context_compacted',
    SessionEnd: 'session_ended'
  },
  codex: {
    SessionStart: 'session_started',
    UserPromptSubmit: 'prompt_submitted',
    PreToolUse: 'tool_started',
    PermissionRequest: 'attention_required',
    PostToolUse: 'tool_finished',
    Stop: 'turn_completed',
    SubagentStart: 'subagent_started',
    SubagentStop: 'subagent_completed',
    PreCompact: 'context_compacting',
    PostCompact: 'context_compacted'
  }
}

/** Normalize either provider's hook JSON into the daemon's v1 event envelope. */
export function mapHookInput(provider, hook, { env = process.env, now = Date.now() } = {}) {
  if (provider !== 'claude' && provider !== 'codex') return null
  const providerEvent = hook?.hook_event_name
  const event = EVENT_MAP[provider][providerEvent]
  const sessionId = hook?.session_id
  if (!event || typeof sessionId !== 'string' || !sessionId) return null

  const tail = provider === 'claude' ? readClaudeTail(hook.transcript_path, env) : undefined
  const prompt = hook.prompt || hook.user_prompt
  const activity = providerEvent === 'UserPromptSubmit' && prompt
    ? `» ${clip(oneLine(prompt), 64)}`
    : activityFor(hook.tool_name, hook.tool_input)
  const message = hook.message || hook.notification || hook.reason ||
    (providerEvent === 'PermissionRequest' ? `permission requested for ${hook.tool_name || 'a tool'}` : undefined)
  const timestamp = Number.isFinite(Number(hook.timestamp_ms)) ? Number(hook.timestamp_ms) : now
  const actor = event === 'subagent_started' || event === 'subagent_completed'
    ? { kind: 'subagent', ...(hook.agent_id ? { id: String(hook.agent_id) } : {}) }
    : { kind: 'root' }
  const rawEventId = hook.uuid || hook.event_id
  const dedupePart = hook.tool_use_id || hook.agent_id || hook.turn_id || tail?.messageId || timestamp

  return {
    schemaVersion: BRIDGE_SCHEMA_VERSION,
    provider,
    eventId: rawEventId
      ? `${provider}:${String(rawEventId)}`
      : `${provider}:${sessionId}:${providerEvent}:${String(dedupePart)}`,
    sessionId,
    ...(hook.turn_id ? { turnId: String(hook.turn_id) } : {}),
    actor,
    kind: event,
    timestamp,
    ...(hook.cwd ? { cwd: String(hook.cwd) } : {}),
    ...(hook.tool_name ? { toolName: String(hook.tool_name) } : {}),
    ...(activity ? { activity } : {}),
    ...(event === 'attention_required' ? {
      attention: {
        reason: providerEvent === 'PermissionRequest' || /permission|approve|allow|wants to|use the/i.test(String(message || ''))
          ? 'permission'
          : 'question',
        ...(message ? { message: clip(oneLine(message), 1_000) } : {})
      }
    } : {}),
    ...(hook.permission_mode ? { permissionMode: String(hook.permission_mode) } : {}),
    ...(hook.model || tail?.model ? { model: String(hook.model || tail.model) } : {}),
    ...(tail?.usage ? {
      usage: {
        ...tail.usage,
        ...(tail.contextPct !== undefined ? { contextPct: tail.contextPct } : {})
      }
    } : {}),
    ...(hook.transcript_path ? { transcript: { path: String(hook.transcript_path) } } : {})
  }
}

async function discoverWindow(providerEvent, deadlineAt) {
  if (providerEvent !== 'SessionStart' && providerEvent !== 'UserPromptSubmit') return null
  const budgetMs = Math.min(75, Math.max(0, Math.floor(deadlineAt - Date.now() - 50)))
  if (budgetMs < 10) return null
  return new Promise((resolve) => {
    let worker
    try {
      worker = new Worker(new URL('./focus-worker.mjs', import.meta.url), {
        workerData: {
          moduleUrls: [
            new URL('../src/native/win32.mjs', import.meta.url).href,
            new URL('../native/win32.mjs', import.meta.url).href
          ]
        }
      })
    } catch {
      resolve(null)
      return
    }
    let settled = false
    let timer
    const finish = (value) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      void worker.terminate()
      resolve(value || null)
    }
    worker.once('message', finish)
    worker.once('error', () => finish(null))
    worker.once('exit', () => finish(null))
    timer = setTimeout(() => finish(null), budgetMs)
  })
}

async function boundedFocus(discover, providerEvent, deadlineAt) {
  const budgetMs = Math.max(0, Math.floor(deadlineAt - Date.now() - 50))
  if (budgetMs < 1) return null
  let timer
  try {
    return await Promise.race([
      Promise.resolve(discover(providerEvent, deadlineAt)).catch(() => null),
      new Promise((resolve) => { timer = setTimeout(() => resolve(null), budgetMs) })
    ])
  } finally {
    clearTimeout(timer)
  }
}

/** Deliver one already-parsed hook. Exposed for focused tests. */
export async function deliverHook(provider, hook, options = {}) {
  try {
    const deadlineAt = Number(options.deadlineAt) || (Date.now() + (Number(options.timeoutMs) || DEFAULT_TIMEOUT_MS))
    const endpoint = options.endpoint || readEndpoint(options.endpointPath)
    if (!endpoint) return false
    const event = mapHookInput(provider, hook, options)
    if (!event) return false
    const focus = options.discoverFocus === false
      ? null
      : await boundedFocus(options.discoverFocusImpl || discoverWindow, hook?.hook_event_name, deadlineAt)
    if (focus) {
      event.focus = { hwnd: focus.hwnd, pid: focus.pid }
    }
    const remainingMs = Math.floor(deadlineAt - Date.now())
    if (remainingMs <= 0) return false

    const ctrl = new AbortController()
    const timeoutMs = Math.max(1, Math.min(Number(options.timeoutMs) || DEFAULT_TIMEOUT_MS, remainingMs, 250))
    const timer = setTimeout(() => ctrl.abort(), timeoutMs)
    try {
      const fetchImpl = options.fetchImpl || fetch
      const res = await fetchImpl(`http://127.0.0.1:${endpoint.port}/v1/events`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${endpoint.token}`
        },
        body: JSON.stringify(event),
        signal: ctrl.signal
      })
      return !!res?.ok
    } catch {
      return false
    } finally {
      clearTimeout(timer)
    }
  } catch {
    return false
  }
}

export async function runBridge({ provider: forcedProvider, stdin = readStdin() } = {}) {
  try {
    const deadlineAt = Date.now() + DEFAULT_TIMEOUT_MS
    const args = process.argv.slice(2)
    const i = args.indexOf('--provider')
    const provider = forcedProvider || (i >= 0 ? args[i + 1] : undefined)
    if (provider !== 'claude' && provider !== 'codex') return false
    let hook
    try { hook = JSON.parse(stdin || '{}') } catch { return false }
    return await deliverHook(provider, hook, { deadlineAt })
  } catch {
    return false
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  // Do not set a failing exit code: monitoring must never break the provider.
  await runBridge()
}
