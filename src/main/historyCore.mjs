import { createHash } from 'node:crypto'
import { hostname, userInfo } from 'node:os'

const round4 = (n) => Math.round(n * 10_000) / 10_000
export const machineId = () => createHash('sha256').update(`${hostname()}|${userInfo().username}`).digest('hex').slice(0, 16)
const emptyTotals = (day) => ({ day, tokensOut: 0, costUsd: 0, byProject: [], byModel: [], valueComplete: true })
const providerTotals = (day) => ({
  tokensOut: day.tokensOut, costUsd: round4(day.costUsd), valueComplete: day.valueComplete,
  byProject: day.byProject.map((p) => ({ ...p, costUsd: round4(p.costUsd) })),
  byModel: day.byModel.map((m) => ({ ...m, costUsd: round4(m.costUsd) }))
})

function merge(items, key) {
  const merged = new Map()
  for (const item of items) {
    const current = merged.get(item[key])
    if (current) {
      current.tokensOut += item.tokensOut
      current.costUsd = round4(current.costUsd + item.costUsd)
      current.valueComplete = current.valueComplete !== false && item.valueComplete !== false
    } else merged.set(item[key], { ...item })
  }
  return [...merged.values()].sort((a, b) => b.costUsd - a.costUsd)
}

export function hasFlushPayload(days, api, additional = {}) {
  return days.length > 0 || !!api || Object.values(additional).some((providerDays) => (providerDays?.length ?? 0) > 0)
}

export function dailyDocuments(days, api, additional = {}) {
  const apiHasMetrics = api && (Number.isFinite(api.tokensOut) || Number.isFinite(api.costUsd))
  const apiDay = apiHasMetrics ? api : undefined
  const byDate = new Map()
  for (const day of days) byDate.set(day.day, { ...(byDate.get(day.day) ?? {}), claude: day })
  for (const [provider, providerDays] of Object.entries(additional)) {
    for (const day of providerDays ?? []) byDate.set(day.day, { ...(byDate.get(day.day) ?? {}), [provider]: day })
  }
  if (apiDay && !byDate.has(apiDay.date)) byDate.set(apiDay.date, { claude: emptyTotals(apiDay.date) })
  const id = machineId()
  return [...byDate.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, providerDays]) => {
    const byProvider = Object.fromEntries(Object.entries(providerDays).map(([provider, day]) => [provider, providerTotals(day)]))
    const providers = Object.values(byProvider)
    const matchesApi = apiDay?.date === date
    return {
      _id: `${id}:${date}`, schemaVersion: 2, machineId: id, date,
      tokensOut: providers.reduce((sum, value) => sum + value.tokensOut, 0),
      costUsd: round4(providers.reduce((sum, value) => sum + value.costUsd, 0)),
      valueComplete: providers.every((value) => value.valueComplete !== false),
      byProject: merge(providers.flatMap((value) => value.byProject ?? []), 'project'),
      byModel: merge(providers.flatMap((value) => value.byModel ?? []), 'model'),
      byProvider,
      ...(matchesApi && apiDay?.tokensOut !== undefined ? { apiTokensOut: apiDay.tokensOut } : {}),
      ...(matchesApi && apiDay?.costUsd !== undefined ? { apiCostUsd: round4(apiDay.costUsd) } : {})
    }
  })
}

export function normalizeDailyDocument(doc) {
  const totals = {
    tokensOut: Number(doc.tokensOut) || 0,
    costUsd: Number(doc.costUsd) || 0,
    valueComplete: typeof doc.valueComplete === 'boolean' ? doc.valueComplete : true,
    byProject: Array.isArray(doc.byProject) ? doc.byProject : [],
    byModel: Array.isArray(doc.byModel) ? doc.byModel : []
  }
  const raw = doc.byProvider && typeof doc.byProvider === 'object' ? doc.byProvider : undefined
  return {
    date: String(doc.date), ...totals,
    byProvider: raw ? { ...(raw.claude ? { claude: raw.claude } : {}), ...(raw.codex ? { codex: raw.codex } : {}) } : { claude: totals },
    apiTokensOut: Number.isFinite(Number(doc.apiTokensOut)) ? Number(doc.apiTokensOut) : undefined,
    apiCostUsd: Number.isFinite(Number(doc.apiCostUsd)) ? Number(doc.apiCostUsd) : undefined
  }
}
