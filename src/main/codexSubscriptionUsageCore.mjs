function severity(usedPct) {
  if (usedPct >= 90) return 'critical'
  if (usedPct >= 75) return 'warning'
  return 'normal'
}

function finiteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function durationLabel(seconds, fallback) {
  if (seconds === 18_000) return 'Session (5hr)'
  if (seconds === 604_800) return 'Weekly (7 day)'
  if (seconds && seconds % 86_400 === 0) return `${seconds / 86_400} day`
  if (seconds && seconds % 3_600 === 0) return `${seconds / 3_600} hour`
  return fallback
}

function quota(raw, fallback, tone) {
  const usedPercent = finiteNumber(raw?.used_percent)
  if (usedPercent === undefined) return undefined
  const usedPct = Math.max(0, Math.min(100, usedPercent))
  const resetAt = finiteNumber(raw?.reset_at)
  return {
    label: durationLabel(raw.limit_window_seconds, fallback),
    usedPct,
    resetsAt: resetAt === undefined ? null : resetAt * 1000,
    tone,
    severity: severity(usedPct)
  }
}

function semanticWindows(limit) {
  const windows = [
    quota(limit?.primary_window, 'Primary', 'amber'),
    quota(limit?.secondary_window, 'Secondary', 'blue')
  ].filter(Boolean)
  const session = windows.find((item) => item.label.startsWith('Session'))
  const week = windows.find((item) => item.label.startsWith('Weekly'))
  return { session, week, other: windows.filter((item) => item !== session && item !== week) }
}

export function parseCodexUsage(label, raw) {
  const base = semanticWindows(raw?.rate_limit)
  const extras = [...base.other]
  const additionalLimits = Array.isArray(raw?.additional_rate_limits) ? raw.additional_rate_limits : []
  for (const additional of additionalLimits) {
    const parsed = semanticWindows(additional.rate_limit)
    const prefix = typeof additional.limit_name === 'string'
      ? additional.limit_name
      : typeof additional.metered_feature === 'string' ? additional.metered_feature : 'Additional'
    for (const item of [parsed.session, parsed.week, ...parsed.other].filter(Boolean)) {
      extras.push({ ...item, label: `${prefix} · ${item.label}` })
    }
  }
  const plan = typeof raw?.plan_type === 'string' && raw.plan_type
    ? raw.plan_type.charAt(0).toUpperCase() + raw.plan_type.slice(1) : undefined
  return {
    available: true,
    label: plan ? `${label} · ${plan}` : label,
    session: base.session,
    week: base.week,
    ...(extras.length ? { quotas: extras } : {})
  }
}
