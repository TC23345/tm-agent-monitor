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
  const limitQuotas = limits
    .filter((limit) => limit?.kind === 'weekly_scoped' && limit.is_active !== false && number(limit.percent) !== undefined)
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
  return { available: true, label, ...(session ? { session } : {}), ...(week ? { week } : {}), ...(quotas.length ? { quotas } : {}) }
}
