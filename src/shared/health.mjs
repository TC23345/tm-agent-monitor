/**
 * Provider health, read for people: the connection chip and the Settings hook
 * rows both derive from here, so they never disagree. Pure and tested.
 *
 * Inputs are the `ProviderHealth` records the daemon already keeps — installed,
 * reporting, awaitingTrust, needsRepair, lastReportAt, error, bridgeVersion —
 * most of which the UI used to ignore.
 */

/** A provider that was reporting and then went quiet this long is suspect. */
export const SILENT_AFTER_MS = 10 * 60 * 1000

const LABEL = { claude: 'Claude Code', codex: 'Codex', cursor: 'Cursor' }

export function providerLabel(provider) {
  return LABEL[provider] ?? String(provider)
}

/** "3m", "2h", "1d" — coarse, for "silent 12m" / "last report 3m ago". */
export function ago(ms) {
  if (!Number.isFinite(ms) || ms < 0) return 'just now'
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.round(m / 60)
  if (h < 48) return `${h}h`
  return `${Math.round(h / 24)}d`
}

/**
 * One provider's status: tone is what the chip colours, reason is the text a
 * tooltip or Settings row shows. Ordered by what the user should act on first.
 */
export function providerStatus(health, now, appVersion, options = {}) {
  const silentAfter = options.silentAfterMs ?? SILENT_AFTER_MS
  const h = health ?? {}
  if (!h.installed) return { tone: 'off', reason: 'not installed' }
  if (h.needsRepair) return { tone: 'warn', reason: 'hooks need repair' }
  if (h.awaitingTrust) return { tone: 'warn', reason: 'awaiting trust review in /hooks' }
  if (typeof h.error === 'string' && h.error.trim()) return { tone: 'warn', reason: `hook error: ${h.error.trim()}` }
  if (h.bridgeVersion && appVersion && h.bridgeVersion !== appVersion) {
    return { tone: 'warn', reason: `bridge v${h.bridgeVersion} — app is v${appVersion}, repair the hooks` }
  }
  const last = typeof h.lastReportAt === 'number' ? h.lastReportAt : null
  if (h.reporting) {
    if (last !== null && now - last > silentAfter) return { tone: 'warn', reason: `silent for ${ago(now - last)}` }
    return { tone: 'on', reason: last !== null ? `reporting · last ${ago(now - last)} ago` : 'reporting' }
  }
  return { tone: 'idle', reason: last !== null ? `installed · last report ${ago(now - last)} ago` : 'installed, no reports yet' }
}

/**
 * The title-bar chip: state, short label, and a multi-line tooltip. `mock`
 * short-circuits to sample data. Silence and version drift surface as `warn`
 * even when every provider is otherwise reporting.
 */
export function overallStatus(providers, now, appVersion, mock = false, options = {}) {
  if (mock) return { state: 'on', label: 'mock data', title: 'Showing sample (mock) data — change in Settings' }
  const entries = Object.entries(providers ?? {})
  const statuses = entries.map(([id, h]) => [id, providerStatus(h, now, appVersion, options)])
  const reporting = statuses.filter(([, s]) => s.tone === 'on' || s.tone === 'warn').length
  const installed = entries.filter(([, h]) => h && h.installed).length
  const warn = statuses.filter(([, s]) => s.tone === 'warn')
  const title = statuses.map(([id, s]) => `${providerLabel(id)}: ${s.reason}`).join('\n')
  if (installed === 0) return { state: 'off', label: 'no hooks', title: title || 'No provider hooks installed — Settings → Provider hooks' }
  if (reporting === 0) return { state: 'off', label: 'no reports', title }
  if (warn.length > 0) {
    const first = warn[0]
    const short = first[1].reason.startsWith('silent') ? `${providerLabel(first[0])} ${first[1].reason}` : `${providerLabel(first[0])} · attention`
    return { state: 'warn', label: short, title }
  }
  return { state: 'on', label: `${reporting}/${entries.length} providers`, title }
}
