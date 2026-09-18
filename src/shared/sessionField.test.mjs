import test from 'node:test'
import assert from 'node:assert/strict'
import {
  ATTENTION_RGB, FIELD_FLOATS, FLARE_MS, FLOATS_PER_GLOW, HEADER_FLOATS, MAX_GLOWS, PROVIDER_RGB,
  beamGlows, flareGlow, flareStrength, layerGlows, packField, rampStrength, seedFor, trackFlares
} from './sessionField.mjs'

const agent = (id, state, provider = 'claude') => ({ id, provider, state })

test('seedFor is stable, in [0, 1), and differs between ids', () => {
  assert.equal(seedFor('claude:a1'), seedFor('claude:a1'))
  const seeds = ['claude:a1', 'codex:a2', 'cursor:x', ''].map(seedFor)
  for (const s of seeds) assert.ok(s >= 0 && s < 1, String(s))
  assert.equal(new Set(seeds).size, seeds.length)
})

test('flareStrength: 1 at the edge, eased to 0 by the end, 0 outside and for no flare', () => {
  assert.equal(flareStrength(1000, 1000), 1)
  assert.equal(flareStrength(1000 + FLARE_MS / 2, 1000), 0.25)
  assert.equal(flareStrength(1000 + FLARE_MS, 1000), 0)
  assert.equal(flareStrength(999, 1000), 0)
  assert.equal(flareStrength(1000, undefined), 0)
  assert.equal(flareStrength(1000, NaN), 0)
})

test('trackFlares starts a flare on the edge into waiting and drops burnt-out ones', () => {
  const t0 = 10_000
  let track = trackFlares(null, [agent('a', 'running'), agent('b', 'waiting')], t0)
  // First sight of a waiting session is news too.
  assert.deepEqual([...track.flares], [['b', t0]])
  // No new edge: the flare keeps its original start.
  track = trackFlares(track, [agent('a', 'running'), agent('b', 'waiting')], t0 + 100)
  assert.deepEqual([...track.flares], [['b', t0]])
  // a turns waiting: its own flare, at its own time.
  track = trackFlares(track, [agent('a', 'waiting'), agent('b', 'waiting')], t0 + 200)
  assert.deepEqual([...track.flares], [['a', t0 + 200], ['b', t0]])
  // Burnt out and gone.
  track = trackFlares(track, [agent('a', 'waiting')], t0 + 200 + FLARE_MS)
  assert.deepEqual([...track.flares], [])
  assert.deepEqual([...track.states], [['a', 'waiting']])
  // Leaving waiting and coming back flares again.
  track = trackFlares(track, [agent('a', 'running')], t0 + 3000)
  track = trackFlares(track, [agent('a', 'waiting')], t0 + 3100)
  assert.deepEqual([...track.flares], [['a', t0 + 3100]])
})

test('packField lays the header and each glow out as field.wgsl declares them', () => {
  const glow = (id, x, color, intensity) => ({ id, x, y: 40, rx: 30, ry: 20, color, intensity, motion: 1, pulse: 0.35, flare: 0, seed: seedFor(id) })
  const glows = [glow('a', 10.5, ATTENTION_RGB, 0.22), glow('b', 248.3, PROVIDER_RGB.codex, 0.11)]
  const data = packField(glows, { time: 2.5, sx: 2, sy: 2 })
  assert.equal(data.length, FIELD_FLOATS)
  assert.equal(FIELD_FLOATS, HEADER_FLOATS + MAX_GLOWS * FLOATS_PER_GLOW)
  assert.equal((FIELD_FLOATS * 4) % 16, 0, 'uniform buffers are 16-byte multiples')
  assert.deepEqual([...data.slice(0, 4)], [2.5, 2, 2, 2])
  const o = HEADER_FLOATS + FLOATS_PER_GLOW
  const b = glows[1]
  assert.deepEqual([...data.slice(o, o + 4)].map((v) => Math.round(v * 100) / 100), [b.x, b.y, b.rx, b.ry].map((v) => Math.round(v * 100) / 100))
  assert.deepEqual([...data.slice(o + 4, o + 8)].map((v) => Math.round(v * 1000) / 1000), [0.416, 0.69, 0.91, 0.11])
  // Float32 rounds 0.35; compare at the precision the shader sees.
  assert.deepEqual([...data.slice(o + 8, o + 11)].map((v) => Math.round(v * 1000) / 1000), [1, 0.35, 0])
  assert.ok(Math.abs(data[o + 11] - seedFor('b')) < 1e-6)
  // Reuses the buffer it is handed and clears stale glows.
  const again = packField([], { time: 0, sx: 1, sy: 1 }, data)
  assert.equal(again, data)
  assert.equal(data[3], 0)
  assert.equal(data[o], 0)
})

test('rampStrength fades in over the ramp and clamps', () => {
  assert.equal(rampStrength(1000, 1000), 0)
  assert.equal(rampStrength(1090, 1000), 0.5)
  assert.equal(rampStrength(2000, 1000), 1)
  assert.equal(rampStrength(900, 1000), 0)
  assert.equal(rampStrength(1000, undefined), 0)
})

test('flareGlow is red, wide as the pane, and gone at zero strength', () => {
  const g = flareGlow({ id: 'claude:a1', x: 500, y: 40, w: 600, strength: 0.5 })
  assert.deepEqual(g.color, ATTENTION_RGB)
  assert.equal(g.rx, 360)
  assert.equal(g.flare, 0.5)
  assert.ok(Math.abs(g.intensity - 0.175) < 1e-9)
  assert.equal(flareGlow({ id: 'x', x: 0, y: 0, w: 0, strength: 0 }), null)
  assert.equal(flareGlow({ id: 'x', x: 0, y: 0, w: 10, strength: 1 }).rx, 72, 'never narrower than a small pane')
})

test('beamGlows leaves the row horizontally and lands on the pane', () => {
  const from = { x: 400, y: 300 }
  const to = { x: 1000, y: 100, w: 500 }
  const glows = beamGlows({ from, to, color: PROVIDER_RGB.codex, strength: 1, points: 4 })
  assert.equal(glows.length, 5)
  const [first, , , last, end] = glows
  assert.ok(first.x > from.x && first.y < from.y + 1 && first.y > from.y - 40, 'starts near the row, barely rising')
  assert.ok(last.x < to.x && last.y > to.y, 'ends short of the pane, still descending toward it')
  assert.equal(end.id, 'beam:end')
  assert.deepEqual([end.x, end.y, end.rx], [1000, 100, 250])
  assert.ok(glows.every((g) => g.color === PROVIDER_RGB.codex && g.flare === 0))
  assert.deepEqual(beamGlows({ from, to, color: PROVIDER_RGB.codex, strength: 0 }), [])
  assert.deepEqual(beamGlows({ from: null, to, color: PROVIDER_RGB.codex }), [])
})

test('layerGlows puts flares first and stays under the cap', () => {
  const flares = Array.from({ length: 3 }, (_, i) => ({ id: `f${i}`, x: i, y: 0, w: 100, strength: 1 }))
  const beam = { from: { x: 0, y: 0 }, to: { x: 100, y: 0, w: 100 }, color: PROVIDER_RGB.claude, points: 50 }
  const glows = layerGlows({ flares, beam })
  assert.equal(glows.length, MAX_GLOWS)
  assert.deepEqual(glows.slice(0, 3).map((g) => g.id), ['f0', 'f1', 'f2'])
  assert.deepEqual(layerGlows(), [])
  assert.deepEqual(layerGlows({ flares: [{ id: 'z', x: 0, y: 0, w: 1, strength: 0 }] }), [])
})
