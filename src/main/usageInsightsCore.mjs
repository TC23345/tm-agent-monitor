import { createReadStream, promises as fs } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join, relative, sep } from 'node:path'
import { createInterface } from 'node:readline'

const DAY_MS = 86_400_000
const LARGE_CONTEXT_TOKENS = 150_000
const LONG_SESSION_MS = 8 * 60 * 60_000

function session(provider, id, project = 'unknown') {
  return {
    provider, id, project, firstAt: Infinity, lastAt: -Infinity,
    messages: new Map(), skills: new Map(), subagents: new Map(), mcpServers: new Map()
  }
}

function finite(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0
}

function timestamp(value) {
  const ms = typeof value === 'number' ? value : Date.parse(value)
  return Number.isFinite(ms) ? ms : undefined
}

function projectName(cwd, fallback = 'unknown') {
  if (!cwd) return fallback
  const parts = String(cwd).split(/[\\/]+/).filter(Boolean)
  return parts[parts.length - 1] || fallback
}

function noteTime(target, raw) {
  const ms = timestamp(raw)
  if (ms === undefined) return undefined
  target.firstAt = Math.min(target.firstAt, ms)
  target.lastAt = Math.max(target.lastAt, ms)
  return ms
}

function mcpServer(tool) {
  if (!String(tool).startsWith('mcp__')) return undefined
  return String(tool).slice(5).split('__')[0].replaceAll('_', ' ')
}

function noteFeature(target, field, name, at) {
  if (!name || at === undefined) return
  const seen = target[field].get(String(name)) ?? new Set()
  seen.add(at)
  target[field].set(String(name), seen)
}

function captureTool(target, name, input, at) {
  if (!name) return
  const server = mcpServer(name)
  if (server) noteFeature(target, 'mcpServers', server, at)
  if (name === 'Skill') {
    const skill = input?.command || input?.skill
    if (typeof skill === 'string') noteFeature(target, 'skills', skill, at)
  }
  if (name === 'Agent' || name === 'Task' || name === 'spawn_agent') {
    let parsed = input
    if (typeof input === 'string') {
      try { parsed = JSON.parse(input) } catch { parsed = {} }
    }
    const kind = parsed?.subagent_type || parsed?.task_name || parsed?.name || (name === 'spawn_agent' ? 'spawn_agent' : 'agent')
    noteFeature(target, 'subagents', String(kind), at)
  }
}

function captureCodexSource(target, source, at) {
  if (typeof source !== 'string') return
  for (const match of source.matchAll(/tools\.([A-Za-z0-9_]+)/g)) captureTool(target, match[1], undefined, at)
  for (const match of source.matchAll(/(?:skills?)[\\/]+([^\\/'"\s]+)[\\/]+SKILL\.md/gi)) noteFeature(target, 'skills', match[1], at)
}

function claudeTranscriptParser(options = {}) {
  const out = session('claude', options.sessionId || options.source || 'claude', options.project)
  let line = 0
  const consume = (text) => {
    line++
    if (!text || !String(text).trim()) return
    let row
    try { row = JSON.parse(String(text)) } catch { return }
    const at = noteTime(out, row.timestamp)
    if (row.cwd) out.project = projectName(row.cwd, out.project)
    if (row.type !== 'assistant' || !row.message) return
    for (const content of Array.isArray(row.message.content) ? row.message.content : []) {
      if (content?.type === 'tool_use') captureTool(out, content.name, content.input, at)
    }
    const usage = row.message.usage
    if (!usage || at === undefined) return
    const input = finite(usage.input_tokens)
    const cacheRead = finite(usage.cache_read_input_tokens)
    const cacheWrite = finite(usage.cache_creation_input_tokens)
    const output = finite(usage.output_tokens)
    const tokens = input + cacheRead + cacheWrite + output
    if (tokens <= 0) return
    const key = row.message.id || row.uuid || `${options.source || 'claude'}:${line}`
    out.messages.set(String(key), { at, tokens, contextTokens: input + cacheRead + cacheWrite, subagent: options.isSubagent === true })
  }
  return { out, consume }
}

export function parseClaudeTranscriptLines(lines, options = {}) {
  const parser = claudeTranscriptParser(options)
  for (const line of lines) parser.consume(line)
  return parser.out
}

function codexRolloutParser(options = {}) {
  const out = session('codex', options.sessionId || options.source || 'codex', options.project)
  let previous
  let line = 0
  const consume = (text) => {
    line++
    if (!text || !String(text).trim()) return
    let row
    try { row = JSON.parse(String(text)) } catch { return }
    const payload = row?.payload
    const at = noteTime(out, row.timestamp)
    if (row.type === 'session_meta') {
      if (payload?.id || payload?.session_id) out.id = String(payload.id || payload.session_id)
      if (payload?.cwd) out.project = projectName(payload.cwd, out.project)
      return
    }
    if (row.type === 'turn_context' && payload?.cwd) out.project = projectName(payload.cwd, out.project)
    if (row.type === 'response_item' && (payload?.type === 'function_call' || payload?.type === 'custom_tool_call')) {
      const rawInput = payload.arguments ?? payload.input
      captureTool(out, payload.name, rawInput, at)
      if (payload.name === 'exec' || payload.name === 'js') captureCodexSource(out, rawInput, at)
    }
    if (row.type !== 'event_msg' || payload?.type !== 'token_count' || !payload.info || at === undefined) return
    const totals = payload.info.total_token_usage
    const last = payload.info.last_token_usage
    let input
    let output
    let tokens
    if (last && typeof last === 'object') {
      input = finite(last.input_tokens)
      output = finite(last.output_tokens)
      tokens = finite(last.total_tokens) || input + output
    } else if (totals && typeof totals === 'object') {
      const current = {
        input: finite(totals.input_tokens), output: finite(totals.output_tokens), total: finite(totals.total_tokens)
      }
      const reset = previous && (current.input < previous.input || current.output < previous.output || current.total < previous.total)
      input = reset || !previous ? current.input : current.input - previous.input
      output = reset || !previous ? current.output : current.output - previous.output
      tokens = reset || !previous ? current.total : current.total - previous.total
      previous = current
    }
    if (!tokens || tokens <= 0) return
    out.messages.set(`${options.source || 'codex'}:${line}`, { at, tokens, contextTokens: input ?? 0, subagent: false })
  }
  return { out, consume }
}

export function parseCodexRolloutLines(lines, options = {}) {
  const parser = codexRolloutParser(options)
  for (const line of lines) parser.consume(line)
  return parser.out
}

function mergeSession(target, incoming) {
  target.project = target.project === 'unknown' ? incoming.project : target.project
  target.firstAt = Math.min(target.firstAt, incoming.firstAt)
  target.lastAt = Math.max(target.lastAt, incoming.lastAt)
  for (const [key, value] of incoming.messages) target.messages.set(key, value)
  for (const field of ['skills', 'subagents', 'mcpServers']) {
    for (const [name, times] of incoming[field]) {
      const merged = target[field].get(name) ?? new Set()
      for (const at of times) merged.add(at)
      target[field].set(name, merged)
    }
  }
  return target
}

function pct(tokens, total) {
  return total > 0 ? Math.min(100, (tokens / total) * 100) : 0
}

function usedInPeriod(times, cutoff, now) {
  for (const at of times ?? []) if (at >= cutoff && at <= now + 5 * 60_000) return true
  return false
}

function period(sessions, cutoff, now) {
  const active = []
  let totalTokens = 0
  const byProvider = {}
  let largeContext = 0
  let subagentHeavy = 0
  let longRunning = 0
  for (const item of sessions) {
    const events = [...item.messages.values()].filter((event) => event.at >= cutoff && event.at <= now + 5 * 60_000)
    const tokens = events.reduce((sum, event) => sum + event.tokens, 0)
    if (tokens <= 0) continue
    const large = events.filter((event) => event.contextTokens > LARGE_CONTEXT_TOKENS).reduce((sum, event) => sum + event.tokens, 0)
    active.push({ item, tokens })
    totalTokens += tokens
    byProvider[item.provider] = (byProvider[item.provider] ?? 0) + tokens
    largeContext += large
    if (events.some((event) => event.subagent) || [...item.subagents.values()].some((times) => usedInPeriod(times, cutoff, now))) subagentHeavy += tokens
    if (item.lastAt - item.firstAt >= LONG_SESSION_MS) longRunning += tokens
  }

  const rows = (field) => {
    const buckets = new Map()
    for (const { item, tokens } of active) {
      for (const [name, times] of item[field]) {
        if (!usedInPeriod(times, cutoff, now)) continue
        const key = String(name).toLowerCase()
        const bucket = buckets.get(key) ?? { name: String(name), tokens: 0, providers: new Set() }
        bucket.tokens += tokens
        bucket.providers.add(item.provider)
        buckets.set(key, bucket)
      }
    }
    return [...buckets.values()]
      .map((bucket) => ({ name: bucket.name, tokens: bucket.tokens, usedPct: pct(bucket.tokens, totalTokens), providers: [...bucket.providers].sort() }))
      .sort((a, b) => b.tokens - a.tokens || a.name.localeCompare(b.name))
      .slice(0, 12)
  }

  return {
    totalTokens,
    sessions: active.length,
    byProvider,
    metrics: [
      { id: 'large-context', tokens: largeContext, usedPct: pct(largeContext, totalTokens) },
      { id: 'subagent-heavy', tokens: subagentHeavy, usedPct: pct(subagentHeavy, totalTokens) },
      { id: 'long-running', tokens: longRunning, usedPct: pct(longRunning, totalTokens) }
    ],
    skills: rows('skills'),
    subagents: rows('subagents'),
    mcpServers: rows('mcpServers')
  }
}

export function buildUsageInsights(sessions, now = Date.now(), options = {}) {
  const day = new Date(now)
  const dayCutoff = new Date(day.getFullYear(), day.getMonth(), day.getDate()).getTime()
  const weekCutoff = new Date(day.getFullYear(), day.getMonth(), day.getDate() - 6).getTime()
  return {
    generatedAt: now,
    available: options.available ?? true,
    ...(options.note ? { note: options.note } : {}),
    day: period(sessions, dayCutoff, now),
    week: period(sessions, weekCutoff, now)
  }
}

async function recentFiles(root, cutoff, out = []) {
  let entries
  try { entries = await fs.readdir(root, { withFileTypes: true }) } catch { return out }
  for (const entry of entries) {
    const path = join(root, entry.name)
    if (entry.isDirectory()) await recentFiles(path, cutoff, out)
    else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
      try {
        const stat = await fs.stat(path)
        if (stat.mtimeMs >= cutoff) out.push(path)
      } catch { /* file vanished during enumeration */ }
    }
  }
  return out
}

async function parseJsonlFile(path, parser) {
  const input = createReadStream(path, { encoding: 'utf8' })
  const lines = createInterface({ input, crlfDelay: Infinity })
  for await (const line of lines) parser.consume(line)
  return parser.out
}

export async function scanUsageInsights({
  claudeRoot = join(homedir(), '.claude', 'projects'),
  codexRoot = join(process.env.CODEX_HOME || join(homedir(), '.codex'), 'sessions'),
  now = Date.now()
} = {}) {
  const cutoffDate = new Date(now)
  const cutoff = new Date(cutoffDate.getFullYear(), cutoffDate.getMonth(), cutoffDate.getDate() - 6).getTime()
  const [claudeFiles, codexFiles] = await Promise.all([recentFiles(claudeRoot, cutoff), recentFiles(codexRoot, cutoff)])
  const sessions = new Map()

  for (const path of claudeFiles) {
    try {
      const parts = relative(claudeRoot, path).split(sep)
      const subagentsAt = parts.indexOf('subagents')
      const sessionId = subagentsAt > 0 ? parts[subagentsAt - 1] : basename(path, '.jsonl')
      const parsed = await parseJsonlFile(path, claudeTranscriptParser({
        source: path, sessionId, project: parts[0], isSubagent: subagentsAt > 0
      }))
      const key = `claude:${sessionId}`
      sessions.set(key, mergeSession(sessions.get(key) ?? session('claude', sessionId, parts[0]), parsed))
    } catch { /* one unreadable transcript must not disable the whole view */ }
  }
  for (const path of codexFiles) {
    try {
      const parsed = await parseJsonlFile(path, codexRolloutParser({ source: path, sessionId: basename(path, '.jsonl') }))
      const key = `codex:${parsed.id}`
      sessions.set(key, mergeSession(sessions.get(key) ?? session('codex', parsed.id, parsed.project), parsed))
    } catch { /* one unreadable rollout must not disable the whole view */ }
  }
  const available = claudeFiles.length > 0 || codexFiles.length > 0
  return buildUsageInsights([...sessions.values()], now, {
    available,
    note: available ? undefined : 'No local Claude or Codex sessions were found in the last 7 days.'
  })
}

export const INSIGHT_THRESHOLDS = { largeContextTokens: LARGE_CONTEXT_TOKENS, longSessionMs: LONG_SESSION_MS }
