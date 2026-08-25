/**
 * Shapes `DailyUsageDay[]` (what `history:recent` returns: Mongo days with the
 * live local days overlaid) into what the Usage pane's History section draws.
 * Pure and tested; the component only maps these to bars.
 */

const PROVIDERS = ['claude', 'codex']

function pad(n) {
  return String(n).padStart(2, '0')
}

/** Local calendar key, matching how the ledgers label days. */
export function dayKey(date = new Date()) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function shiftDays(key, delta) {
  const [y, m, d] = key.split('-').map(Number)
  const date = new Date(y, m - 1, d + delta)
  return dayKey(date)
}

function num(v) {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0
}

/** Per-provider totals for a day; legacy rows without `byProvider` are Claude. */
function providerTotals(day) {
  const out = {}
  const split = day && typeof day.byProvider === 'object' && day.byProvider ? day.byProvider : null
  if (split) {
    for (const p of PROVIDERS) {
      const t = split[p]
      if (t) out[p] = { tokens: num(t.tokensOut), value: num(t.costUsd), valueComplete: t.valueComplete !== false }
    }
  } else if (day) {
    out.claude = { tokens: num(day.tokensOut), value: num(day.costUsd), valueComplete: day.valueComplete !== false }
  }
  return out
}

/**
 * The last `count` calendar days ending `today`, each with tokens, estimated
 * value, actual API spend, and a provider split — zeros where nothing was
 * recorded, so bars line up with the calendar rather than with the data.
 */
export function historySeries(days, options = {}) {
  const count = Math.max(1, options.count ?? 30)
  const today = options.today ?? dayKey()
  const byDate = new Map()
  for (const day of Array.isArray(days) ? days : []) {
    if (day && typeof day.date === 'string') byDate.set(day.date, day)
  }
  const series = []
  for (let i = count - 1; i >= 0; i--) {
    const date = shiftDays(today, -i)
    const day = byDate.get(date)
    const providers = providerTotals(day)
    const tokens = day ? num(day.tokensOut) : 0
    const value = day ? num(day.costUsd) : 0
    series.push({
      date,
      label: String(Number(date.slice(8))),
      tokens,
      value,
      valueComplete: !day || day.valueComplete !== false,
      apiValue: day ? num(day.apiCostUsd) : 0,
      providers,
      recorded: !!day
    })
  }
  const totals = { tokens: 0, value: 0, apiValue: 0, byProvider: {}, recordedDays: 0 }
  let maxTokens = 0
  for (const d of series) {
    totals.tokens += d.tokens
    totals.value += d.value
    totals.apiValue += d.apiValue
    if (d.recorded) totals.recordedDays++
    if (d.tokens > maxTokens) maxTokens = d.tokens
    for (const [p, t] of Object.entries(d.providers)) {
      const acc = totals.byProvider[p] ?? (totals.byProvider[p] = { tokens: 0, value: 0 })
      acc.tokens += t.tokens
      acc.value += t.value
    }
  }
  return { days: series, totals, maxTokens }
}

/**
 * Token and value share per model across `days` (optionally only those on or
 * after `since`), largest value first. Reads `byModel` from the provider split
 * when present, else the legacy top-level list. Shares are of estimated value.
 */
export function modelMix(days, options = {}) {
  const since = options.since ?? null
  const acc = new Map()
  for (const day of Array.isArray(days) ? days : []) {
    if (!day || typeof day.date !== 'string') continue
    if (since && day.date < since) continue
    const lists = []
    const split = day.byProvider && typeof day.byProvider === 'object' ? Object.values(day.byProvider) : []
    for (const t of split) if (t && Array.isArray(t.byModel)) lists.push(t.byModel)
    if (lists.length === 0 && Array.isArray(day.byModel)) lists.push(day.byModel)
    for (const list of lists) {
      for (const row of list) {
        if (!row || typeof row.model !== 'string') continue
        const cur = acc.get(row.model) ?? { model: row.model, tokens: 0, value: 0, valueComplete: true }
        cur.tokens += num(row.tokensOut)
        cur.value += num(row.costUsd)
        if (row.valueComplete === false) cur.valueComplete = false
        acc.set(row.model, cur)
      }
    }
  }
  const rows = [...acc.values()].sort((a, b) => b.value - a.value || b.tokens - a.tokens)
  const total = rows.reduce((sum, r) => sum + r.value, 0)
  return rows.map((r) => ({ ...r, share: total > 0 ? r.value / total : 0 }))
}
