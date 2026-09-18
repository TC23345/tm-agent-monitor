/**
 * What the attention layer (AttentionLayer.tsx) draws, decided here as data
 * so the renderer only measures elements and uploads a buffer: soft lights
 * ("glows") for a burst over a pane and a beam from a row to its pane.
 *
 * Colour is identity or attention — the provider's saturated colour, or
 * `--st-question` red only for a session waiting on a person (the app's one
 * meaning for red). A flare is the 0→waiting edge: a burst that decays over
 * `FLARE_MS`. There was once an always-on wash behind the sidebar built on
 * this (0.4.8); the user removed it as wrong for this app — ambient,
 * full-surface effects belong to other projects. Keep this on-demand only.
 *
 * `packField` lays the glows out exactly as `field.wgsl` declares its uniform
 * (`Field { head: vec4f, glows: array<Glow, MAX_GLOWS> }`, each Glow three
 * vec4f), so the two must move together.
 */

export const MAX_GLOWS = 40
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

/* ---- The attention layer over the grid (AttentionLayer.tsx) draws with the
   same shader and the same packing: a burst over the pane whose session just
   asked, and a beam from a hovered row to its pane. Both are on-demand; the
   layer parks whenever this returns nothing. ---- */

/** 0→1 over `ms` from `since`: the beam's fade-in. */
export function rampStrength(now, since, ms = 180) {
  if (!Number.isFinite(since) || !Number.isFinite(now) || ms <= 0) return 0
  return Math.max(0, Math.min(1, (now - since) / ms))
}

/** The burst over a pane whose session just asked: red, wide, gone in FLARE_MS. */
export function flareGlow({ id, x, y, w, strength }) {
  if (!(strength > 0)) return null
  return {
    id: String(id),
    x, y,
    rx: Math.max(w ?? 0, 120) * 0.6,
    ry: 110,
    color: ATTENTION_RGB,
    intensity: 0.35 * strength,
    motion: 0, pulse: 0,
    flare: strength,
    seed: seedFor(id)
  }
}

/**
 * A soft beam from a sidebar row (`from`, its right edge) to the pane that
 * runs the session (`to`, its header centre; `to.w` the header width): a
 * quadratic curve that leaves the row horizontally, drawn as a chain of small
 * lights closer together than their radius, then a wider pool where it lands.
 */
export function beamGlows({ from, to, color, strength = 1, points, radius }) {
  const out = []
  if (!from || !to || !(strength > 0)) return out
  // Enough lights that a long beam stays a line: spacing under the radius.
  const dist = Math.hypot(to.x - from.x, to.y - from.y)
  const n = points ?? Math.max(8, Math.min(34, Math.round(dist / 28)))
  const r = radius ?? Math.max(22, (dist / n) * 0.8)
  const cx = (from.x + to.x) / 2
  const cy = from.y
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n
    const a = (1 - t) * (1 - t)
    const b = 2 * (1 - t) * t
    const c = t * t
    out.push({
      id: `beam:${i}`,
      x: a * from.x + b * cx + c * to.x,
      y: a * from.y + b * cy + c * to.y,
      rx: r, ry: r,
      color,
      intensity: 0.15 * strength,
      motion: 0, pulse: 0, flare: 0,
      seed: i / n
    })
  }
  out.push({
    id: 'beam:end',
    x: to.x, y: to.y,
    rx: Math.min(280, Math.max(to.w ?? 0, 80) * 0.5),
    ry: 48,
    color,
    intensity: 0.18 * strength,
    motion: 0, pulse: 0, flare: 0,
    seed: 0.5
  })
  return out
}

/** Everything the layer draws this frame, capped. Flares first: they are the point. */
export function layerGlows({ flares = [], beam = null } = {}) {
  const out = []
  for (const f of flares) {
    const g = flareGlow(f)
    if (g) out.push(g)
  }
  if (beam) out.push(...beamGlows(beam))
  return out.slice(0, MAX_GLOWS)
}
