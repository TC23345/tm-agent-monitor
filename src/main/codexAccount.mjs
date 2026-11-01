// Documented account RPCs only. Authentication remains inside the installed CLI.
import { codexPlanName, parseCodexUsage } from './codexSubscriptionUsageCore.mjs'

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

/**
 * Who the CLI says is signed in, wherever it keeps the credential (file, keyring
 * or CODEX_HOME). Only the method and plan are kept: the email never enters the app.
 */
export function parseAccountStatus(raw) {
  const account = raw?.account
  if (account !== null && typeof account?.type !== 'string') throw new Error('unsupported account response')
  return {
    available: true,
    signedIn: !!account,
    requiresAuth: raw.requiresOpenaiAuth !== false,
    ...(account ? { method: account.type } : {}),
    ...(typeof account?.planType === 'string' ? { plan: account.planType } : {})
  }
}

const METHOD_LABEL = { apiKey: 'API key', amazonBedrock: 'Amazon Bedrock' }

/** The one wording for Settings' row and the system check, so they cannot disagree. */
export function accountStatusLine(status) {
  if (!status) return { connected: false, value: 'not checked yet', detail: 'The Codex CLI has not answered yet' }
  if (!status.available) return { connected: false, value: 'unavailable', detail: status.note ?? 'The Codex CLI did not answer' }
  const stale = status.stale ? ' · last known' : ''
  if (!status.signedIn) {
    return status.requiresAuth
      ? { connected: false, value: `not signed in${stale}`, detail: 'Reported by the Codex CLI. Run `codex login` to sign in.' }
      : { connected: true, value: `no sign-in needed${stale}`, detail: 'Reported by the Codex CLI: this configuration does not use an OpenAI account' }
  }
  const how = status.method === 'chatgpt' ? codexPlanName(status.plan) ?? 'ChatGPT' : METHOD_LABEL[status.method] ?? status.method
  return { connected: true, value: `connected · ${how}${stale}`, detail: 'Reported by the Codex CLI · rate limits and account usage' }
}

const READS = {
  limits: { method: 'account/rateLimits/read', parse: parseAccountLimits, ttl: 60_000 },
  usage: { method: 'account/usage/read', parse: parseAccountUsage, ttl: 300_000 },
  status: { method: 'account/read', parse: parseAccountStatus, ttl: 60_000 }
}

/** Coalesced requests, bounded refresh and explicit stale/unavailable states. */
export class CodexAccount {
  constructor(read, { now = Date.now } = {}) { this.read = read; this.now = now; this.cache = new Map(); this.pending = new Map(); this.epoch = 0 }
  clear() { this.epoch++; this.cache.clear(); this.pending.clear() }
  async get(kind, rereads = 2) {
    const cached = this.cache.get(kind)
    if (cached && this.now() < cached.expires) return cached.value
    if (this.pending.has(kind)) return this.pending.get(kind)
    const epoch = this.epoch
    let request
    const forget = () => { if (this.pending.get(kind) === request) this.pending.delete(kind) }
    request = (async () => {
      let value, ttl
      try {
        const raw = await this.read(READS[kind].method)
        value = READS[kind].parse(raw, this.now())
        ttl = READS[kind].ttl
      } catch {
        // Never propagate raw RPC errors (which can contain account details) to the UI.
        value = cached?.value.available ? { ...cached.value, stale: true, note: 'Refresh unavailable; showing the last successful read.' }
          : { available: false, ...(kind === 'limits' ? { label: 'Codex' } : {}), note: 'Codex account data unavailable. A supported CLI and ChatGPT sign-in are required.' }
        ttl = 30_000
      }
      // The account changed mid-read, which the CLI also announces once at startup.
      // Drop the old answer and read again, or the first read would be lost until the next poll.
      if (epoch !== this.epoch) {
        forget() // Or the reread would find this request still pending and wait on itself.
        return rereads > 0 ? this.get(kind, rereads - 1) : { available: false, ...(kind === 'limits' ? { label: 'Codex' } : {}), note: 'Codex account changed; refreshing.' }
      }
      this.cache.set(kind, { value, expires: this.now() + ttl })
      return value
    })().finally(forget)
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
