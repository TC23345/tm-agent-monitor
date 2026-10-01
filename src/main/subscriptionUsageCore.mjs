function number(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function timestamp(value) {
  if (typeof value !== 'string') return null
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : null
}

function severity(value) {
  if (value === 'warning' || value === 'warn') return 'warning'
  if (value === 'critical' || value === 'exhausted' || value === 'blocked') return 'critical'
  return 'normal'
}

function quota(label, window, tone) {
  const utilization = number(window?.utilization)
  if (utilization === undefined) return undefined
  return { label, usedPct: Math.max(0, Math.min(100, utilization)), resetsAt: timestamp(window?.resets_at), tone, severity: 'normal' }
}

export function parseClaudeUsage(label, input) {
  const value = input && typeof input === 'object' ? input : {}
  const session = quota('Session (5hr)', value.five_hour, 'amber')
  const week = quota('Weekly (7 day)', value.seven_day, 'blue')
  const limits = Array.isArray(value.limits) ? value.limits : []
  for (const limit of limits) {
    if (limit?.kind === 'session' && session) session.severity = severity(limit.severity)
    if (limit?.kind === 'weekly_all' && week) week.severity = severity(limit.severity)
  }
  // `is_active` is not "applies to you": on 2026-09-30 the endpoint sent the
  // Fable scope inactive at 13% while a Fable session ran (and the 5-hour
  // session limit inactive at 13% too) — it seems to mark the limit binding
  // right now. So a scope shows when it is active *or* has any usage; only an
  // inactive scope at 0% (a model you have not touched this week) stays hidden.
  const limitQuotas = limits
    .filter((limit) => limit?.kind === 'weekly_scoped' && number(limit.percent) !== undefined && (limit.is_active !== false || number(limit.percent) > 0))
    .map((limit) => ({
      label: `Weekly ${limit.scope?.model?.display_name ?? 'scoped'}`,
      usedPct: Math.max(0, Math.min(100, number(limit.percent))),
      resetsAt: timestamp(limit.resets_at), tone: 'amber', severity: severity(limit.severity)
    }))
  const namedWeekly = Object.entries(value)
    .filter(([key, window]) => key.startsWith('seven_day_') && window && typeof window === 'object')
    .map(([key, window]) => quota(`Weekly ${key.slice(10).split('_').map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ')}`, window, 'amber'))
    .filter(Boolean)
  const seen = new Set()
  const quotas = [...limitQuotas, ...namedWeekly].filter((item) => {
    const key = item.label.toLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  // What the response actually carried, for Settings → diagnostics and
  // `tm status --json`: a model-scoped bar that disappears is then traceable
  // to the endpoint dropping the window rather than to this parser.
  const windows = [
    ...Object.entries(value)
      .filter(([key, window]) => key === 'five_hour' || key.startsWith('seven_day'))
      .map(([key, window]) => (window && typeof window === 'object' ? key : `${key}:null`)),
    ...limits.map((limit) => `limit:${limit?.kind ?? '?'}${limit?.scope?.model?.display_name ? `:${limit.scope.model.display_name}` : ''}${limit?.is_active === false ? ':inactive' : ''}`)
  ]
  return { available: true, label, windows, ...(session ? { session } : {}), ...(week ? { week } : {}), ...(quotas.length ? { quotas } : {}) }
}
