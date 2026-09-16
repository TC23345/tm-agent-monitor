/**
 * The session field: what the WebGPU glow behind the sidebar draws, decided
 * here as data so the renderer only measures rows and uploads a buffer.
 *
 * One glow per session row. Colour is identity or attention — the provider's
 * saturated colour, or `--st-question` red only when the session waits on a
 * person (the app's one meaning for red). Intensity, motion, and pulse come
 * from the state: a running session drifts and breathes, an idle one sits
 * still and dim, a waiting one pulses. A flare is the 0→waiting edge: a burst
 * that decays over `FLARE_MS`, so the eye is pulled to the row that just asked.
 *
 * `packField` lays the glows out exactly as `field.wgsl` declares its uniform
 * (`Field { head: vec4f, glows: array<Glow, MAX_GLOWS> }`, each Glow three
 * vec4f), so the two must move together.
 */

export const MAX_GLOWS = 24
export const FLOATS_PER_GLOW = 12
export const HEADER_FLOATS = 4
export const FIELD_FLOATS = HEADER_FLOATS + MAX_GLOWS * FLOATS_PER_GLOW
export const FIELD_BYTES = FIELD_FLOATS * 4
/** How long the burst on the edge into `waiting` lasts. */
export const FLARE_MS = 1400

/** The provider dots' colours (styles.css `.prov-dot--*`), as linear-ish 0..1 RGB. */
export const PROVIDER_RGB = Object.freeze({
  claude: Object.freeze([0.91, 0.565, 0.42]),
  codex: Object.freeze([0.416, 0.69, 0.91]),
  cursor: Object.freeze([0.71, 0.549, 1.0])
})
/** `--st-question`: red means a human must act, and nothing else uses it. */
export const ATTENTION_RGB = Object.freeze([0.949, 0.396, 0.357])

/** A stable 0..1 per session id, so glows never breathe in unison. FNV-1a. */
export function seedFor(id) {
  let h = 0x811c9dc5
  const s = String(id ?? '')
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h / 0x100000000
}

/** Colour and character of one session's glow, from its state alone. */
export function glowFor(agent) {
  const provider = PROVIDER_RGB[agent?.provider] ?? PROVIDER_RGB.claude
  switch (agent?.state) {
    case 'waiting':
      return { color: ATTENTION_RGB, intensity: 0.72, motion: 0, pulse: 1 }
    case 'running':
      return { color: provider, intensity: 0.5, motion: 1, pulse: 0.35 }
    default:
      return { color: provider, intensity: 0.18, motion: 0, pulse: 0 }
  }
}

/** 1 at the moment of the flare, easing to 0 by `duration`; 0 outside that window. */
export function flareStrength(now, flareAt, duration = FLARE_MS) {
  if (!Number.isFinite(flareAt) || !Number.isFinite(now)) return 0
  const t = (now - flareAt) / duration
  if (t < 0 || t >= 1) return 0
  return (1 - t) * (1 - t)
}

/**
 * Carry the flare bookkeeping forward one snapshot: a session that turned
 * `waiting` since last time starts a flare now (a session first seen waiting
 * counts — it is news to the person too), a session that left `waiting` and
 * came back gets another, and anything gone or burnt out is dropped.
 */
export function trackFlares(prev, agents, now) {
  const states = new Map()
  const flares = new Map()
  const before = prev?.states ?? new Map()
  const old = prev?.flares ?? new Map()
  for (const a of agents ?? []) {
    if (!a || typeof a.id !== 'string') continue
    states.set(a.id, a.state)
    const was = before.get(a.id)
    if (a.state === 'waiting' && was !== 'waiting') flares.set(a.id, now)
    else if (old.has(a.id) && flareStrength(now, old.get(a.id)) > 0) flares.set(a.id, old.get(a.id))
  }
  return { states, flares }
}

/**
 * The glows to draw this frame. `rects` maps a session id to its row's box in
 * canvas pixels (a row without a box — filtered out, scrolled away — draws
 * nothing). Waiting sessions come first so the cap never drops one of them.
 */
export function fieldGlows(agents, rects, flares, now) {
  const out = []
  const list = [...(agents ?? [])].filter((a) => a && rects?.has(a.id))
  list.sort((a, b) => Number(b.state === 'waiting') - Number(a.state === 'waiting'))
  for (const a of list) {
    if (out.length >= MAX_GLOWS) break
    const r = rects.get(a.id)
    const g = glowFor(a)
    out.push({
      id: a.id,
      x: r.x + r.w / 2,
      y: r.y + r.h / 2,
      rx: Math.max(r.w * 0.45, 24),
      ry: Math.max(r.h * 1.1, 20),
      color: g.color,
      intensity: g.intensity,
      motion: g.motion,
      pulse: g.pulse,
      flare: flareStrength(now, flares?.get(a.id)),
      seed: seedFor(a.id)
    })
  }
  return out
}

/**
 * Serialise for the shader: head = (time s, css px per canvas px x, same y,
 * count), then per glow (x, y, rx, ry) (r, g, b, intensity) (motion, pulse,
 * flare, seed). Writes into `out` when given so a frame allocates nothing.
 */
export function packField(glows, head, out) {
  const data = out && out.length === FIELD_FLOATS ? out : new Float32Array(FIELD_FLOATS)
  data.fill(0)
  const n = Math.min(glows?.length ?? 0, MAX_GLOWS)
  data[0] = head?.time ?? 0
  data[1] = head?.sx ?? 1
  data[2] = head?.sy ?? 1
  data[3] = n
  for (let i = 0; i < n; i++) {
    const g = glows[i]
    const o = HEADER_FLOATS + i * FLOATS_PER_GLOW
    data[o] = g.x
    data[o + 1] = g.y
    data[o + 2] = g.rx
    data[o + 3] = g.ry
    data[o + 4] = g.color[0]
    data[o + 5] = g.color[1]
    data[o + 6] = g.color[2]
    data[o + 7] = g.intensity
    data[o + 8] = g.motion
    data[o + 9] = g.pulse
    data[o + 10] = g.flare
    data[o + 11] = g.seed
  }
  return data
}
