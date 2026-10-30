// Live totals are a temporary overlay. Rollouts remain the restart/history fallback.
// Reconcile cumulative counters, never sum a notification with its transcript copy.
import { readCodexRollouts, aggregateCodexRollouts } from './codexUsage.mjs'
const KEYS = ['inputTokens', 'cachedInputTokens', 'outputTokens', 'reasoningOutputTokens', 'totalTokens']
const zero = () => Object.fromEntries(KEYS.map((k) => [k, 0]))
const counters = (value) => value && KEYS.every((k) => typeof value[k] === 'number' && Number.isFinite(value[k]) && value[k] >= 0)
const day = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }

export function normalizeLiveUsage(params, metadata, now = Date.now()) {
  const usage = params?.tokenUsage
  if (typeof params?.threadId !== 'string' || !params.threadId || !counters(usage?.total) || !counters(usage?.last)) return undefined
  if (!KEYS.every((k) => usage.last[k] <= usage.total[k])) return undefined
  // Unknown/external threads have no reliable project/model attribution on this connection.
  if (typeof metadata?.cwd !== 'string' || !metadata.cwd) return undefined
  return { threadId: params.threadId, at: now, cwd: metadata.cwd, model: typeof metadata.model === 'string' ? metadata.model : 'unknown', total: { ...usage.total }, last: { ...usage.last } }
}

export function reconcileLiveUsage(results, events) {
  const merged = results.map((r) => ({ ...r, usageEvents: [...r.usageEvents] }))
  const sessions = new Map(merged.filter((r) => r.session.id).map((r) => [r.session.id, r]))
  let pendingEvents = 0
  for (const event of events) {
    let result = sessions.get(event.threadId)
    if (!result) {
      // A resumed thread's lifetime total must not become today's usage.
      result = { provider: 'codex', source: 'live', session: { id: event.threadId }, totals: zero(), usageEvents: [], diagnostics: [], schemaDrift: false,
        lastCounters: Object.fromEntries(KEYS.map((k) => [k, event.total[k] - event.last[k]])) }
      sessions.set(event.threadId, result); merged.push(result)
    }
    if (result.schemaDrift) continue
    const previous = result.lastCounters ?? zero()
    // Older/repeated snapshots and resets wait for the authoritative rollout.
    // In particular a reset cannot safely be distinguished from an out-of-order event.
    if (new Date(result.lastTokenAt ?? 0).getTime() > event.at || KEYS.some((k) => event.total[k] < previous[k])) continue
    const delta = Object.fromEntries(KEYS.map((k) => [k, event.total[k] - previous[k]]))
    if (!delta.totalTokens) continue
    result.usageEvents.push({ date: day(event.at), timestamp: new Date(event.at).toISOString(), cwd: event.cwd,
      project: event.cwd.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || 'unknown', model: event.model, tokens: delta })
    result.lastCounters = event.total; result.lastTokenAt = new Date(event.at).toISOString()
    pendingEvents++
  }
  return { results: merged, pendingEvents }
}

export class CodexUsageLedger {
  constructor(options = {}) { this.options = options; this.disk = undefined; this.events = []; this.refreshing = null }
  async refresh() {
    if (!this.refreshing) this.refreshing = readCodexRollouts(this.options).then((disk) => { this.disk = disk }).finally(() => { this.refreshing = null })
    await this.refreshing
    return this.snapshot()
  }
  ingest(value) {
    const event = normalizeLiveUsage({ threadId: value?.threadId, tokenUsage: { total: value?.total, last: value?.last } }, value, value?.at)
    if (!event || !Number.isFinite(event.at) || Math.abs(Date.now() - event.at) > 300_000) return this.snapshot()
    const previous = this.events.findLast((e) => e.threadId === event.threadId)
    if (previous && (event.at < previous.at || KEYS.every((k) => event.total[k] === previous.total[k]))) return this.snapshot()
    this.events.push(event)
    // Bounded, transient buffer; full scan catches up every 30s. No credentials or prompts.
    this.events = this.events.filter((e) => e.at >= Date.now() - 300_000).slice(-2048)
    return this.snapshot()
  }
  snapshot() {
    if (!this.disk) return null // Do not replace a complete ledger with an initial partial live view.
    const live = reconcileLiveUsage(this.disk.results, this.events)
    return { ...aggregateCodexRollouts({ ...this.disk, results: live.results }), pendingLiveEvents: live.pendingEvents }
  }
}
