// Best-effort parser for local Codex rollout JSONL.
//
// Codex lifecycle hooks are the supported live-state source. Rollout files are
// explicitly not a stable public interface, so all schema knowledge stays in
// this isolated module, failures produce diagnostics, and callers always get a
// usable partial result rather than an exception.

import { promises as fs } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'

const COUNTERS = [
  ['input_tokens', 'inputTokens'],
  ['cached_input_tokens', 'cachedInputTokens'],
  ['output_tokens', 'outputTokens'],
  ['reasoning_output_tokens', 'reasoningOutputTokens'],
  ['total_tokens', 'totalTokens']
]

const zeroTokens = () => ({
  inputTokens: 0,
  cachedInputTokens: 0,
  outputTokens: 0,
  reasoningOutputTokens: 0,
  totalTokens: 0
})

function addTokens(target, value) {
  for (const [, key] of COUNTERS) target[key] += value[key] || 0
  return target
}
function localDay(timestamp) {
  const d = new Date(timestamp)
  if (Number.isNaN(d.getTime())) return undefined
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function projectName(cwd) {
  return cwd ? basename(String(cwd).replace(/[\\/]+$/, '')) || String(cwd) : 'unknown'
}

function finiteNonnegative(value) {
  const n = Number(value)
  return Number.isFinite(n) && n >= 0 ? n : undefined
}

function normalizeWindow(window, diag, line, label) {
  if (window == null) return undefined
  if (typeof window !== 'object' || Array.isArray(window)) {
    diag('rate_limit_schema', line, `${label} rate-limit window is not an object`)
    return undefined
  }
  const usedPct = finiteNonnegative(window.used_percent)
  const windowMinutes = finiteNonnegative(window.window_minutes)
  const resetsAtSeconds = finiteNonnegative(window.resets_at)
  if (usedPct === undefined && windowMinutes === undefined && resetsAtSeconds === undefined) {
    diag('rate_limit_schema', line, `${label} rate-limit keys are unsupported`)
    return undefined
  }
  return {
    ...(usedPct !== undefined ? { usedPct: Math.min(100, usedPct) } : {}),
    ...(windowMinutes !== undefined ? { windowMinutes } : {}),
    ...(resetsAtSeconds !== undefined ? { resetsAt: resetsAtSeconds * 1000 } : {})
  }
}

function normalizeRateLimits(raw, diag, line, timestamp) {
  if (raw == null) return undefined
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    diag('rate_limit_schema', line, 'rate_limits is not an object')
    return undefined
  }
  const primary = normalizeWindow(raw.primary, diag, line, 'primary')
  const secondary = normalizeWindow(raw.secondary, diag, line, 'secondary')
  if (!primary && !secondary && !raw.limit_id && !raw.limit_name && !raw.plan_type) {
    diag('rate_limit_schema', line, 'rate_limits has no recognized keys')
    return undefined
  }
  return {
    ...(raw.limit_id ? { limitId: String(raw.limit_id) } : {}),
    ...(raw.limit_name ? { limitName: String(raw.limit_name) } : {}),
    ...(raw.plan_type ? { planType: String(raw.plan_type) } : {}),
    ...(primary ? { primary } : {}),
    ...(secondary ? { secondary } : {}),
    observedAt: new Date(timestamp).getTime() || Date.now()
  }
}

function readCounters(raw, diag, line) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    diag('unsupported_token_schema', line, 'total_token_usage is missing or not an object')
    return undefined
  }
  const out = zeroTokens()
  let recognized = 0
  for (const [rawKey, key] of COUNTERS) {
    if (!(rawKey in raw)) continue
    const value = finiteNonnegative(raw[rawKey])
    if (value === undefined) {
      diag('invalid_counter', line, `${rawKey} is not a finite nonnegative number`)
      continue
    }
    out[key] = value
    recognized++
  }
  if (recognized === 0) {
    diag('unsupported_token_schema', line, 'total_token_usage has no recognized counters')
    return undefined
  }
  return out
}

/** Parse an iterable of rollout lines into a provider-local usage result. */
export function parseCodexRolloutLines(lines, { source = '<memory>' } = {}) {
  const diagnostics = []
  const diagnosticKeys = new Set()
  const diag = (code, line, message) => {
    // Schema drift repeats on every token event. One diagnostic per code/message
    // is enough for Settings while preserving its first line location.
    const key = `${code}:${message}`
    if (diagnosticKeys.has(key) || diagnostics.length >= 100) return
    diagnosticKeys.add(key)
    diagnostics.push({ code, source, line, message })
  }

  const session = {}
  const totals = zeroTokens()
  const usageEvents = []
  let previous = zeroTokens()
  let havePrevious = false
  let currentCwd
  let currentModel
  let rateLimits
  let lineNumber = 0

  for (const text of lines) {
    lineNumber++
    if (!text || !String(text).trim()) continue
    let row
    try {
      row = JSON.parse(String(text))
    } catch {
      diag('malformed_json', lineNumber, 'line is not valid JSON (possibly a partial tail row)')
      continue
    }
    const payload = row?.payload
    if (!payload || typeof payload !== 'object') continue

    if (row.type === 'session_meta') {
      const id = payload.session_id || payload.id
      if (id) session.id = String(id)
      if (payload.cwd) session.cwd = currentCwd = String(payload.cwd)
      if (payload.model_provider) session.modelProvider = String(payload.model_provider)
      continue
    }
    if (row.type === 'turn_context') {
      if (payload.cwd) currentCwd = session.cwd = String(payload.cwd)
      if (payload.model) currentModel = session.model = String(payload.model)
      continue
    }
    if (row.type !== 'event_msg' || payload.type !== 'token_count') continue

    if (!payload.info || typeof payload.info !== 'object') {
      // Codex can emit an initial token_count with info:null. This is expected,
      // not drift; only diagnose non-null unexpected values.
      if (payload.info != null) diag('missing_token_info', lineNumber, 'token_count info is not an object')
      const normalized = normalizeRateLimits(payload.rate_limits, diag, lineNumber, row.timestamp)
      if (normalized) rateLimits = normalized
      continue
    }

    const current = readCounters(payload.info.total_token_usage, diag, lineNumber)
    const normalized = normalizeRateLimits(payload.rate_limits, diag, lineNumber, row.timestamp)
    if (normalized) rateLimits = normalized
    if (!current) continue

    let reset = false
    if (havePrevious) {
      for (const [, key] of COUNTERS) {
        if (current[key] < previous[key]) { reset = true; break }
      }
    }
    if (reset) diag('counter_reset', lineNumber, 'cumulative token counters decreased; starting a new segment')

    const delta = zeroTokens()
    for (const [, key] of COUNTERS) delta[key] = reset || !havePrevious ? current[key] : current[key] - previous[key]
    previous = current
    havePrevious = true
    addTokens(totals, delta)

    if (Object.values(delta).some((n) => n > 0)) {
      const date = localDay(row.timestamp)
      if (!date) diag('invalid_timestamp', lineNumber, 'token_count has no valid timestamp')
      usageEvents.push({
        ...(date ? { date } : {}),
        timestamp: row.timestamp,
        cwd: currentCwd,
        project: projectName(currentCwd),
        model: currentModel || 'unknown',
        tokens: delta
      })
    }
  }

  return {
    provider: 'codex',
    source,
    session,
    totals,
    usageEvents,
    rateLimits,
    diagnostics,
    schemaDrift: diagnostics.some((d) =>
      d.code === 'unsupported_token_schema' || d.code === 'invalid_counter' || d.code === 'rate_limit_schema')
  }
}

export function parseCodexRolloutText(text, options) {
  return parseCodexRolloutLines(String(text).split(/\r?\n/), options)
}

export async function parseCodexRolloutFile(path) {
  try {
    return parseCodexRolloutText(await fs.readFile(path, 'utf8'), { source: path })
  } catch (error) {
    return {
      provider: 'codex',
      source: path,
      session: {},
      totals: zeroTokens(),
      usageEvents: [],
      diagnostics: [{ code: 'file_read_error', source: path, line: 0, message: error.message }],
      schemaDrift: false
    }
  }
}

async function recentRollouts(root, cutoff, out = []) {
  let entries
  try { entries = await fs.readdir(root, { withFileTypes: true }) } catch { return out }
  for (const entry of entries) {
    const path = join(root, entry.name)
    if (entry.isDirectory()) await recentRollouts(path, cutoff, out)
    else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
      try {
        const stat = await fs.stat(path)
        if (stat.mtimeMs >= cutoff) out.push({ path, mtimeMs: stat.mtimeMs })
      } catch { /* vanished between readdir/stat */ }
    }
  }
  return out
}

/**
 * Scan recent local Codex rollouts and aggregate token deltas by day/project/model.
 * Defaults to the start of the oldest local day in the seven-day insights
 * window. This keeps the local week view complete without requiring MongoDB.
 */
export async function scanCodexUsage({
  rootDir = join(process.env.CODEX_HOME || join(homedir(), '.codex'), 'sessions'),
  now = Date.now(),
  lookbackMs
} = {}) {
  const cutoff = lookbackMs === undefined
      ? (() => {
        const start = new Date(now)
        start.setHours(0, 0, 0, 0)
        start.setDate(start.getDate() - 6)
        return start.getTime()
      })()
    : now - lookbackMs
  const files = await recentRollouts(rootDir, cutoff)
  // Parse sequentially: rollouts can be tens of megabytes, and an unbounded
  // Promise.all would retain every file buffer at once on a busy machine.
  const results = []
  for (const file of files) results.push(await parseCodexRolloutFile(file.path))
  const totals = zeroTokens()
  const days = new Map()
  const diagnostics = []
  let latestRateLimits

  for (const result of results) {
    if (diagnostics.length < 200) diagnostics.push(...result.diagnostics.slice(0, 200 - diagnostics.length))
    if (result.rateLimits && (!latestRateLimits || result.rateLimits.observedAt > latestRateLimits.observedAt)) {
      latestRateLimits = result.rateLimits
    }
    for (const event of result.usageEvents) {
      if (!event.date) continue
      const eventMs = new Date(event.timestamp).getTime()
      if (Number.isFinite(eventMs) && eventMs < cutoff) continue
      addTokens(totals, event.tokens)
      let day = days.get(event.date)
      if (!day) {
        day = { date: event.date, tokens: zeroTokens(), byProject: new Map(), byModel: new Map(), byProjectModel: new Map() }
        days.set(event.date, day)
      }
      addTokens(day.tokens, event.tokens)
      const p = day.byProject.get(event.project) || zeroTokens()
      addTokens(p, event.tokens)
      day.byProject.set(event.project, p)
      const m = day.byModel.get(event.model) || zeroTokens()
      addTokens(m, event.tokens)
      day.byModel.set(event.model, m)
      const pmKey = `${event.project}\0${event.model}`
      const pm = day.byProjectModel.get(pmKey) || zeroTokens()
      addTokens(pm, event.tokens)
      day.byProjectModel.set(pmKey, pm)
    }
  }

  const byDay = [...days.values()].sort((a, b) => a.date.localeCompare(b.date)).map((day) => ({
    date: day.date,
    ...day.tokens,
    byProject: [...day.byProject].map(([project, tokens]) => ({ project, ...tokens }))
      .sort((a, b) => b.totalTokens - a.totalTokens),
    byModel: [...day.byModel].map(([model, tokens]) => ({ model, ...tokens }))
      .sort((a, b) => b.totalTokens - a.totalTokens),
    byProjectModel: [...day.byProjectModel].map(([key, tokens]) => {
      const [project, model] = key.split('\0')
      return { project, model, ...tokens }
    }).sort((a, b) => b.totalTokens - a.totalTokens)
  }))

  return {
    provider: 'codex',
    totals,
    byDay,
    rateLimits: latestRateLimits,
    filesScanned: files.length,
    diagnostics,
    schemaDrift: results.some((r) => r.schemaDrift)
  }
}
