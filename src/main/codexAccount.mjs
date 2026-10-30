// Documented account RPCs only. Authentication remains inside the installed CLI.
import { parseCodexUsage } from './codexSubscriptionUsageCore.mjs'

const number = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0
export function parseAccountLimits(raw) {
  const buckets = raw?.rateLimitsByLimitId
  const base = buckets?.codex ?? raw?.rateLimits
  const convert = (limit) => ({
    primary_window: window(limit?.primary), secondary_window: window(limit?.secondary)
  })
  function window(w) {
    if (!number(w?.usedPercent)) return undefined
    return { used_percent: w.usedPercent, limit_window_seconds: number(w.windowDurationMins) ? w.windowDurationMins * 60 : undefined, reset_at: w.resetsAt }
  }
  const result = parseCodexUsage('Codex', {
    plan_type: base?.planType, rate_limit: convert(base),
    additional_rate_limits: Object.entries(buckets ?? {}).filter(([id, value]) => id !== 'codex' && value !== base).map(([id, value]) => ({
      limit_name: value?.limitName || id, rate_limit: convert(value)
    }))
  })
  if (!result.session && !result.week && !result.quotas?.length) return { available: false, label: 'Codex', note: 'No account limit windows reported.' }
  return result
}

export function parseAccountUsage(raw, now = Date.now()) {
  const keys = ['lifetimeTokens', 'peakDailyTokens', 'longestRunningTurnSec', 'currentStreakDays', 'longestStreakDays']
  if (!keys.every((key) => number(raw?.summary?.[key]))) throw new Error('unsupported account usage response')
  return {
    available: true, updatedAt: now,
    summary: Object.fromEntries(keys.map((key) => [key, raw.summary[key]])),
    dailyUsageBuckets: (Array.isArray(raw.dailyUsageBuckets) ? raw.dailyUsageBuckets : []).filter((b) =>
      typeof b?.startDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(b.startDate) && number(b.tokens)
    ).map(({ startDate, tokens }) => ({ startDate, tokens })).sort((a, b) => a.startDate.localeCompare(b.startDate))
  }
}

/** Coalesced requests, bounded refresh and explicit stale/unavailable states. */
export class CodexAccount {
  constructor(read, { now = Date.now } = {}) { this.read = read; this.now = now; this.cache = new Map(); this.pending = new Map(); this.epoch = 0 }
  clear() { this.epoch++; this.cache.clear(); this.pending.clear() }
  async get(kind) {
    const cached = this.cache.get(kind)
    if (cached && this.now() < cached.expires) return cached.value
    if (this.pending.has(kind)) return this.pending.get(kind)
    const epoch = this.epoch
    const request = (async () => {
      let value, ttl
      try {
        const raw = await this.read(kind === 'limits' ? 'account/rateLimits/read' : 'account/usage/read')
        value = kind === 'limits' ? parseAccountLimits(raw) : parseAccountUsage(raw, this.now())
        ttl = kind === 'limits' ? 60_000 : 300_000
      } catch {
        // Never propagate raw RPC errors (which can contain account details) to the UI.
        value = cached?.value.available ? { ...cached.value, stale: true, note: 'Refresh unavailable; showing the last successful read.' }
          : { available: false, ...(kind === 'limits' ? { label: 'Codex' } : {}), note: 'Codex account data unavailable. A supported CLI and ChatGPT sign-in are required.' }
        ttl = 30_000
      }
      if (epoch !== this.epoch) return { available: false, label: 'Codex', note: 'Codex account changed; refreshing.' }
      this.cache.set(kind, { value, expires: this.now() + ttl })
      return value
    })().finally(() => { if (epoch === this.epoch) this.pending.delete(kind) })
    this.pending.set(kind, request)
    return request
  }
  notification(message) {
    if (message.method === 'account/updated') this.clear()
    if (message.method === 'account/rateLimits/updated') {
      const value = parseAccountLimits(message.params)
      if (value.available) this.cache.set('limits', { value, expires: this.now() + 60_000 })
    }
  }
}
