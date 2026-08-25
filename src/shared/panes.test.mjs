import test from 'node:test'
import assert from 'node:assert/strict'
import { emptySizes, readAllSizes, readPaneCols, sanitizeCollapsed, sanitizePanes, sanitizeSidebarViews } from './panes.mjs'

const KINDS = ['launcher', 'terminal', 'usage', 'activity']
const opts = { kinds: KINDS, isUnique: (k) => k !== 'terminal', maxPanes: 6 }

test('panes: unknown kinds drop, unique kinds dedupe, terminals keep only known fields, the cap holds', () => {
  const raw = [
    { id: 'a', kind: 'launcher' },
    { id: 'b', kind: 'spend' },                       // retired kind
    { id: 'c', kind: 'terminal', term: { launch: 'zsh', cwd: 'C:\\p', label: 5, sessionId: 's1', initialCommand: 'npm test', extra: 1 } },
    { id: 'd', kind: 'launcher' },                    // duplicate unique
    { id: 'e', kind: 'terminal' },
    null, 'junk', { kind: 'usage' },                  // malformed
    { id: 'f', kind: 'usage' },
    { id: 'g', kind: 'terminal' }, { id: 'h', kind: 'terminal' }, { id: 'i', kind: 'terminal' }, { id: 'j', kind: 'terminal' }
  ]
  const panes = sanitizePanes(raw, opts)
  assert.deepEqual(panes.map((p) => p.id), ['a', 'c', 'e', 'f', 'g', 'h'])
  assert.deepEqual(panes[1].term, { launch: 'shell', cwd: 'C:\\p', label: undefined, sessionId: 's1', initialCommand: 'npm test' })
  assert.deepEqual(panes[2].term, { launch: 'shell', cwd: undefined, label: undefined, sessionId: undefined, initialCommand: undefined })
  assert.deepEqual(sanitizePanes('nope', opts), [])
})

test('sidebar views: v2 wins, v1 migrates once and surfaces Open windows, else defaults; retired ids vanish', () => {
  const o = { ids: ['windows', 'limits'], defaults: ['windows', 'limits'] }
  assert.deepEqual(sanitizeSidebarViews(['limits', 'spend', 'limits', 'insights'], null, o), ['limits'])
  assert.deepEqual(sanitizeSidebarViews(null, ['limits', 'spend'], o), ['limits', 'windows'])
  assert.deepEqual(sanitizeSidebarViews(null, ['windows'], o), ['windows'])
  assert.deepEqual(sanitizeSidebarViews(undefined, undefined, o), ['windows', 'limits'])
  assert.deepEqual(sanitizeSidebarViews([], null, o), [])
  assert.deepEqual(sanitizeCollapsed(['spend', 'windows', 'windows'], o), ['windows'])
  assert.deepEqual(sanitizeCollapsed('x', { ...o, defaults: ['windows'] }), ['windows'])
})

test('column choice and sizes read defensively, with the pre-bucket layout seeding both buckets', () => {
  assert.equal(readPaneCols({ cols: 2 }), 2)
  assert.equal(readPaneCols({ cols: 'auto' }), 'auto')
  assert.equal(readPaneCols({ cols: 7 }), 'auto')
  assert.equal(readPaneCols(null), 'auto')
  const bucketed = readAllSizes({ sizes: { full: { sidebar: 420, cols: { 3: [1.5, 0.8, 0.7], x: [1], 2: [1, -1], 4: [] }, rows: { 2: [1.2, 0.8] } }, half: 'junk' } })
  assert.deepEqual(bucketed.full, { sidebar: 420, cols: { 3: [1.5, 0.8, 0.7] }, rows: { 2: [1.2, 0.8] } })
  assert.deepEqual(bucketed.half, emptySizes())
  const legacy = readAllSizes({ cols: 2, sidebar: 500, fracs: { 2: [1.3, 0.7] } })
  assert.deepEqual(legacy.full, { sidebar: 500, cols: { 2: [1.3, 0.7] }, rows: {} })
  assert.deepEqual(legacy.half, { sidebar: 500, cols: { 2: [1.3, 0.7] }, rows: {} })
  assert.notEqual(legacy.full.cols, legacy.half.cols)
  assert.deepEqual(readAllSizes(undefined).full, emptySizes())
})
