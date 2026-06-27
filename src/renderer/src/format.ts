/** "17s", "6m", "2h", matching the design's compact duration column. */
export function shortDuration(sinceMs: number, now = Date.now()): string {
  const s = Math.max(0, Math.floor((now - sinceMs) / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h`
  return `${Math.floor(h / 24)}d`
}

/** "resets in 2h 39m", "resets in 5d". */
export function resetsIn(resetsAt: number | null, now = Date.now()): string {
  if (resetsAt == null) return ''
  let s = Math.max(0, Math.floor((resetsAt - now) / 1000))
  const d = Math.floor(s / 86400); s -= d * 86400
  const h = Math.floor(s / 3600); s -= h * 3600
  const m = Math.floor(s / 60)
  if (d > 0) return `resets in ${d}d`
  if (h > 0) return `resets in ${h}h ${m}m`
  return `resets in ${m}m`
}

/** 1_200_000 -> "1.2M", 31_000 -> "31K", 540 -> "540". */
export function compactNumber(n: number): string {
  if (n >= 1_000_000) return `${trim(n / 1_000_000)}M`
  if (n >= 1_000) return `${trim(n / 1_000)}K`
  return `${Math.round(n)}`
}

function trim(n: number): string {
  return (Math.round(n * 10) / 10).toString()
}

/** Color tone for the context-fill percentage. */
export function contextTone(pct?: number): 'normal' | 'high' | 'critical' {
  if (pct === undefined) return 'normal'
  if (pct >= 90) return 'critical'
  if (pct >= 85) return 'high'
  return 'normal'
}
