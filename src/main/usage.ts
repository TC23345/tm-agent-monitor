import type { Quota, UsageSummary } from '../shared/types.js'

/**
 * Live usage via the Anthropic Admin API (Usage & Cost reports).
 * Requires an Admin key (sk-ant-admin...). These are org reporting endpoints,
 * not the Messages API, so we call them over raw HTTP (per the SDK guidance:
 * raw HTTP is correct when there's no first-class SDK binding).
 *
 * The subscription "Session (5h)" and "Week" rate-limits are NOT exposed by the
 * API, so we present token-based proxies against configurable caps. They read
 * from real usage data; tune the caps to your plan via env vars.
 */

const BASE = 'https://api.anthropic.com/v1/organizations'
const VERSION = '2023-06-01'

const num = (v: string | undefined, d: number) => {
  const n = v ? Number(v) : NaN
  return Number.isFinite(n) ? n : d
}

const SESSION_CAP = num(process.env.CLAUDE_WATCH_SESSION_CAP, 5_000_000) // output tokens / 5h
const WEEK_CAP = num(process.env.CLAUDE_WATCH_WEEK_CAP, 50_000_000) // output tokens / 7d
const SESSION_MS = 5 * 60 * 60 * 1000
const WEEK_MS = 7 * 24 * 60 * 60 * 1000

/** Recursively sum every `output_tokens` field — robust against schema drift. */
function sumOutputTokens(node: unknown): number {
  if (node == null || typeof node !== 'object') return 0
  let total = 0
  if (Array.isArray(node)) {
    for (const item of node) total += sumOutputTokens(item)
    return total
  }
  for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
    if (k === 'output_tokens' && typeof v === 'number') total += v
    else if (typeof v === 'object') total += sumOutputTokens(v)
  }
  return total
}

interface Bucket {
  starting_at: string
  ending_at?: string
  results?: unknown
}

async function fetchBuckets(
  key: string,
  startingAt: Date,
  bucketWidth: '1m' | '1h' | '1d'
): Promise<Bucket[]> {
  const params = new URLSearchParams({
    starting_at: startingAt.toISOString(),
    bucket_width: bucketWidth,
    limit: '168'
  })
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 8000)
  try {
    const res = await fetch(`${BASE}/usage_report/messages?${params}`, {
      headers: { 'x-api-key': key, 'anthropic-version': VERSION },
      signal: ctrl.signal
    })
    if (!res.ok) throw new Error(`usage_report ${res.status}`)
    const body = (await res.json()) as { data?: Bucket[] }
    return body.data ?? []
  } finally {
    clearTimeout(timer)
  }
}

function quota(label: string, used: number, cap: number, resetsAt: number, tone: Quota['tone']): Quota {
  return { label, usedPct: Math.max(0, Math.min(100, (used / cap) * 100)), resetsAt, tone }
}

export async function fetchUsage(adminKey: string | undefined): Promise<UsageSummary> {
  if (!adminKey) return { source: 'none' }
  const now = Date.now()
  try {
    const [hourly, minutely] = await Promise.all([
      fetchBuckets(adminKey, new Date(now - WEEK_MS), '1h'),
      fetchBuckets(adminKey, new Date(now - 20 * 60 * 1000), '1m')
    ])

    const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0)
    let today = 0, session = 0, week = 0
    for (const b of hourly) {
      const t = Date.parse(b.starting_at)
      const out = sumOutputTokens(b.results)
      week += out
      if (now - t <= SESSION_MS) session += out
      if (t >= startOfDay.getTime()) today += out
    }

    // Burn rate: output tokens over the minute buckets we sampled.
    let recent = 0, minutes = 0
    for (const b of minutely) { recent += sumOutputTokens(b.results); minutes += 1 }
    const burnPerMin = minutes > 0 ? recent / minutes : 0
    const remaining = Math.max(0, SESSION_CAP - session)
    const etaToLimitMin = burnPerMin > 0 ? Math.round(remaining / burnPerMin) : undefined

    return {
      session: quota('Session', session, SESSION_CAP, now + SESSION_MS, 'amber'),
      week: quota('Week', week, WEEK_CAP, startOfWeekReset(now), 'blue'),
      todayTokensOut: today,
      burnPerMin: Math.round(burnPerMin),
      etaToLimitMin,
      source: 'api'
    }
  } catch (err) {
    console.error(`[usage] ${(err as Error).message}`)
    return { source: 'none' }
  }
}

/** Token-based usage from hook-reported per-agent tokens, when no Admin key. */
export function usageFromAgents(tokensOutToday: number): UsageSummary {
  if (tokensOutToday <= 0) return { source: 'none' }
  return { todayTokensOut: tokensOutToday, source: 'hooks' }
}

function startOfWeekReset(now: number): number {
  const d = new Date(now)
  const day = d.getDay() // 0 Sun
  const daysUntilMon = (8 - day) % 7 || 7
  const reset = new Date(d)
  reset.setHours(0, 0, 0, 0)
  reset.setDate(d.getDate() + daysUntilMon)
  return reset.getTime()
}
