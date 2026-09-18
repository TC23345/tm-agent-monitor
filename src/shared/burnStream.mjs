/**
 * The burn-rate stream on a quota bar (QuotaStream.tsx): a bar shows level,
 * this shows speed. Main projects when the session window hits its limit
 * (`projectedLimitAt`, a regression over the last 45 minutes of samples), so
 * the rate the renderer needs is just the remaining headroom over the time
 * left. No projection, no stream — the bar is static exactly when the app
 * has nothing to say about pace.
 *
 * `packStream` lays the parameters out as `stream.wgsl` declares its uniform
 * (`Stream { head: vec4f, a: vec4f, color: vec4f }`), so the two move together.
 */

export const STREAM_FLOATS = 12
export const STREAM_BYTES = STREAM_FLOATS * 4
export const MAX_STREAKS = 40

/** Streak tints per bar tone, lightened in the shader; critical goes hot. */
export const STREAM_RGB = Object.freeze({
  amber: Object.freeze([0.91, 0.565, 0.42]),
  blue: Object.freeze([0.5, 0.69, 1.0]),
  green: Object.freeze([0.37, 0.82, 0.58]),
  critical: Object.freeze([1.0, 0.75, 0.38])
})

/** Percentage points of the window consumed per hour, or 0 when unknown. */
export function burnRate(usedPct, projectedLimitAt, now) {
  if (!Number.isFinite(usedPct) || !Number.isFinite(projectedLimitAt) || !Number.isFinite(now)) return 0
  if (usedPct >= 100 || projectedLimitAt <= now) return 0
  const hours = (projectedLimitAt - now) / 3_600_000
  return (100 - usedPct) / hours
}

/**
 * How many streaks, how fast (css px per second), and how far along the bar
 * they may travel (the filled fraction). Null when there is nothing to show.
 */
export function streamParams(usedPct, projectedLimitAt, now) {
  const rate = burnRate(usedPct, projectedLimitAt, now)
  if (!(rate > 0)) return null
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))
  return {
    rate,
    count: clamp(Math.round(3 + rate * 0.9), 3, MAX_STREAKS),
    speed: clamp(12 + rate * 2.5, 12, 90),
    fill: clamp(usedPct / 100, 0, 1)
  }
}

/** The tint for a bar: its tone's colour, or hot when the bar itself is critical. */
export function streamColor(tone, severity) {
  if (severity === 'critical') return STREAM_RGB.critical
  return STREAM_RGB[tone] ?? STREAM_RGB.amber
}

/**
 * Serialise for the shader: head = (time s, css width, css height, count),
 * a = (speed px/s, fill 0..1, css px per canvas px x, same y), color = (r, g,
 * b, 1). Writes into `out` when given so a frame allocates nothing.
 */
export function packStream(params, head, out) {
  const data = out && out.length === STREAM_FLOATS ? out : new Float32Array(STREAM_FLOATS)
  data.fill(0)
  if (!params) return data
  data[0] = head?.time ?? 0
  data[1] = head?.w ?? 0
  data[2] = head?.h ?? 0
  data[3] = Math.min(params.count, MAX_STREAKS)
  data[4] = params.speed
  data[5] = params.fill
  data[6] = head?.sx ?? 1
  data[7] = head?.sy ?? 1
  const c = head?.color ?? STREAM_RGB.amber
  data[8] = c[0]
  data[9] = c[1]
  data[10] = c[2]
  data[11] = 1
  return data
}
