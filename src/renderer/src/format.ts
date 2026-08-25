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
export function resetsIn(resetsAt: number | null, now = Date.now(), prefix = 'resets in'): string {
  if (resetsAt == null) return ''
  let s = Math.max(0, Math.floor((resetsAt - now) / 1000))
  const d = Math.floor(s / 86400); s -= d * 86400
  const h = Math.floor(s / 3600); s -= h * 3600
  const m = Math.floor(s / 60)
  if (d > 0) return `${prefix} ${d}d`
  if (h > 0) return `${prefix} ${h}h ${m}m`
  if (m > 0) return `${prefix} ${m}m`
  return 'resets soon'
}

/** ms epoch -> "3:40 PM" (user locale). */
export function clockTime(at: number): string {
  return new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

/** "claude-fable-5" -> "fable 5", "claude-opus-4-8" -> "opus 4.8". */
export function modelShort(model?: string): string | undefined {
  if (!model) return undefined
  const m = model.match(/(fable|mythos|opus|sonnet|haiku)[-.]?(\d+(?:[-.]\d+)?)?/i)
  if (!m) return model.replace(/^claude-/, '')
  return m[2] ? `${m[1]} ${m[2].replace(/-/g, '.')}` : m[1]
}

/** 3.238 -> "$3.24", 32.4 -> "$32.40" -> "$32.4", 132 -> "$132". */
export function money(usd: number): string {
  if (usd >= 100) return `$${Math.round(usd)}`
  if (usd >= 10) return `$${(Math.round(usd * 10) / 10).toFixed(1)}`
  return `$${usd.toFixed(2)}`
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
