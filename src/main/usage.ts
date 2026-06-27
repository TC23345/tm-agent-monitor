import type { ApiUsage, Quota } from '../shared/types.js'

/**
 * Team-org usage via the Anthropic Admin API (Usage + Cost reports).
 * Requires an Admin key (sk-ant-admin...). This is a DIFFERENT account than the
 * personal plan your Claude Code sessions run on — it tracks API-key tooling
 * spend for the org tied to the key. Shown as its own meter so the two never mix.
 *
 * Org reporting endpoints aren't in the Messages SDK, so we use raw HTTP (per the
 * SDK guidance: raw HTTP is correct when there's no first-class binding).
 */

const BASE = 'https://api.anthropic.com/v1/organizations'
const VERSION = '2023-06-01'

const num = (v: string | undefined, d: number) => {
  const n = v ? Number(v) : NaN
  return Number.isFinite(n) ? n : d
}

const ORG_NAME = process.env.CLAUDE_WATCH_ORG_NAME || 'Growth Saloon'
const DAILY_BUDGET_USD = num(process.env.CLAUDE_WATCH_ORG_DAILY_BUDGET_USD, 0)

/** Recursively sum every numeric field named `key`. Robust to schema drift. */
function sumField(node: unknown, key: string): number {
  if (node == null || typeof node !== 'object') return 0
  if (Array.isArray(node)) return node.reduce((s, x) => s + sumField(x, key), 0)
  let total = 0
  for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
    if (k === key && typeof v === 'number') total += v
    else if (typeof v === 'object') total += sumField(v, key)
  }
  return total
}

async function getJson(url: string, key: string): Promise<unknown> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 8000)
  try {
    const res = await fetch(url, {
      headers: { 'x-api-key': key, 'anthropic-version': VERSION },
      signal: ctrl.signal
    })
    if (!res.ok) throw new Error(`${url.split('?')[0]} -> ${res.status}`)
    return res.json()
  } finally {
    clearTimeout(timer)
  }
}

export async function fetchApiUsage(adminKey: string | undefined): Promise<ApiUsage> {
  if (!adminKey) return { available: false, label: ORG_NAME }
  const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0)
  const start = startOfDay.toISOString()
  try {
    const [usage, cost] = await Promise.all([
      getJson(`${BASE}/usage_report/messages?starting_at=${start}&bucket_width=1h&limit=24`, adminKey),
      getJson(`${BASE}/cost_report?starting_at=${start}&bucket_width=1d&limit=1`, adminKey).catch(() => null)
    ])

    const todayTokensOut = sumField((usage as { data?: unknown }).data, 'output_tokens')
    const todayCostUsd = cost ? sumField((cost as { data?: unknown }).data, 'amount') : undefined

    let budget: Quota | undefined
    if (DAILY_BUDGET_USD > 0 && todayCostUsd !== undefined) {
      budget = {
        label: 'Budget',
        usedPct: Math.max(0, Math.min(100, (todayCostUsd / DAILY_BUDGET_USD) * 100)),
        resetsAt: startOfDay.getTime() + 24 * 60 * 60 * 1000,
        tone: 'green'
      }
    }

    return { available: true, label: ORG_NAME, todayTokensOut, todayCostUsd, budget }
  } catch (err) {
    console.error(`[usage] ${(err as Error).message}`)
    return { available: false, label: ORG_NAME }
  }
}
