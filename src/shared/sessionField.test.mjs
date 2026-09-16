import test from 'node:test'
import assert from 'node:assert/strict'
import {
  ATTENTION_RGB, FIELD_FLOATS, FLARE_MS, FLOATS_PER_GLOW, HEADER_FLOATS, MAX_GLOWS, PROVIDER_RGB,
  fieldGlows, flareStrength, glowFor, packField, seedFor, trackFlares
} from './sessionField.mjs'

const agent = (id, state, provider = 'claude') => ({ id, provider, state })
const rect = (y, h = 40) => ({ x: 8, y, w: 360, h })

test('seedFor is stable, in [0, 1), and differs between ids', () => {
  assert.equal(seedFor('claude:a1'), seedFor('claude:a1'))
  const seeds = ['claude:a1', 'codex:a2', 'cursor:x', ''].map(seedFor)
  for (const s of seeds) assert.ok(s >= 0 && s < 1, String(s))
  assert.equal(new Set(seeds).size, seeds.length)
})

test('glowFor: red only for waiting, provider colour otherwise, idle dim and still', () => {
  assert.deepEqual(glowFor(agent('a', 'waiting', 'codex')).color, ATTENTION_RGB)
  assert.equal(glowFor(agent('a', 'waiting')).pulse, 1)
  assert.equal(glowFor(agent('a', 'waiting')).motion, 0)
  const run = glowFor(agent('a', 'running', 'codex'))
  assert.deepEqual(run.color, PROVIDER_RGB.codex)
  assert.equal(run.motion, 1)
  const idle = glowFor(agent('a', 'idle', 'cursor'))
  assert.deepEqual(idle.color, PROVIDER_RGB.cursor)
  assert.equal(idle.motion, 0)
  assert.equal(idle.pulse, 0)
  assert.ok(idle.intensity < run.intensity && run.intensity < glowFor(agent('a', 'waiting')).intensity)
  // An unknown provider still draws, in a known colour.
  assert.deepEqual(glowFor({ provider: 'other', state: 'complete' }).color, PROVIDER_RGB.claude)
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

test('fieldGlows centres each glow on its row, skips rows without a box, waiting first', () => {
  const agents = [agent('a', 'running'), agent('b', 'waiting', 'codex'), agent('c', 'idle')]
  const rects = new Map([['a', rect(100)], ['b', rect(150)]])
  const flares = new Map([['b', 5000]])
  const glows = fieldGlows(agents, rects, flares, 5000)
  assert.deepEqual(glows.map((g) => g.id), ['b', 'a'])
  const b = glows[0]
  assert.equal(b.x, 8 + 180)
  assert.equal(b.y, 150 + 20)
  assert.equal(b.rx, 360 * 0.45)
  assert.equal(b.ry, 44)
  assert.deepEqual(b.color, ATTENTION_RGB)
  assert.equal(b.flare, 1)
  assert.equal(glows[1].flare, 0)
  assert.equal(glows[1].seed, seedFor('a'))
})

test('fieldGlows caps at MAX_GLOWS without losing a waiting session', () => {
  const agents = []
  const rects = new Map()
  for (let i = 0; i < MAX_GLOWS + 5; i++) {
    agents.push(agent(`s${i}`, i === MAX_GLOWS + 3 ? 'waiting' : 'running'))
    rects.set(`s${i}`, rect(i * 40))
  }
  const glows = fieldGlows(agents, rects, new Map(), 0)
  assert.equal(glows.length, MAX_GLOWS)
  assert.equal(glows[0].id, `s${MAX_GLOWS + 3}`)
})

test('packField lays the header and each glow out as field.wgsl declares them', () => {
  const glows = fieldGlows([agent('a', 'waiting'), agent('b', 'running', 'codex')], new Map([['a', rect(0)], ['b', rect(50)]]), new Map([['a', 100]]), 100)
  const data = packField(glows, { time: 2.5, sx: 2, sy: 2 })
  assert.equal(data.length, FIELD_FLOATS)
  assert.equal(FIELD_FLOATS, HEADER_FLOATS + MAX_GLOWS * FLOATS_PER_GLOW)
  assert.equal((FIELD_FLOATS * 4) % 16, 0, 'uniform buffers are 16-byte multiples')
  assert.deepEqual([...data.slice(0, 4)], [2.5, 2, 2, 2])
  const o = HEADER_FLOATS + FLOATS_PER_GLOW
  const b = glows[1]
  assert.deepEqual([...data.slice(o, o + 4)], [b.x, b.y, b.rx, b.ry])
  assert.deepEqual([...data.slice(o + 4, o + 8)].map((v) => Math.round(v * 1000) / 1000), [0.416, 0.69, 0.91, 0.5])
  // Float32 rounds 0.35; compare at the precision the shader sees.
  assert.deepEqual([...data.slice(o + 8, o + 11)].map((v) => Math.round(v * 1000) / 1000), [1, 0.35, 0])
  assert.ok(Math.abs(data[o + 11] - seedFor('b')) < 1e-6)
  // Reuses the buffer it is handed and clears stale glows.
  const again = packField([], { time: 0, sx: 1, sy: 1 }, data)
  assert.equal(again, data)
  assert.equal(data[3], 0)
  assert.equal(data[o], 0)
})
