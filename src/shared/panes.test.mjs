import test from 'node:test'
import assert from 'node:assert/strict'
import { emptySizes, launchFor, migratePanesV3, readAllSizes, readLaunch, readLaunchPrefs, readPaneCols, sanitizeCollapsed, sanitizePanes, sanitizeSidebarViews, withLaunch } from './panes.mjs'

const KINDS = ['agents', 'terminal', 'usage', 'activity']
const opts = { kinds: KINDS, isUnique: (k) => k !== 'terminal', maxPanes: 6 }

test('panes: unknown kinds drop, unique kinds dedupe, terminals keep only known fields, the cap holds', () => {
  const raw = [
    { id: 'a', kind: 'agents' },
    { id: 'b', kind: 'spend' },                       // retired kind
    { id: 'c', kind: 'terminal', term: { launch: 'zsh', cwd: 'C:\\p', label: 5, sessionId: 's1', initialCommand: 'npm test', extra: 1 } },
    { id: 'd', kind: 'agents' },                      // duplicate unique
    { id: 'e', kind: 'terminal' },
    null, 'junk', { kind: 'usage' },                  // malformed
    { id: 'f', kind: 'usage' },
    { id: 'g', kind: 'terminal' }, { id: 'h', kind: 'terminal' }, { id: 'i', kind: 'terminal' }, { id: 'j', kind: 'terminal' }
  ]
  const panes = sanitizePanes(raw, opts)
  assert.deepEqual(panes.map((p) => p.id), ['a', 'c', 'e', 'f', 'g', 'h'])
  assert.deepEqual(panes[1].term, { launch: 'shell', cwd: 'C:\\p', label: undefined, sessionId: 's1', initialCommand: 'npm test', resumeId: undefined })
  assert.deepEqual(panes[2].term, { launch: 'shell', cwd: undefined, label: undefined, sessionId: undefined, initialCommand: undefined, resumeId: undefined })
  assert.deepEqual(sanitizePanes('nope', opts), [])
})

test('the v3 migration puts an Agents pane first, once, and respects the cap', () => {
  const v2 = [{ id: 't', kind: 'terminal' }, { id: 'u', kind: 'usage' }]
  assert.deepEqual(migratePanesV3(v2, { ...opts, newId: 'new' }).map((p) => p.kind), ['agents', 'terminal', 'usage'])
  // Already migrated (or hand-made): left alone.
  const withAgents = [{ id: 'a', kind: 'agents' }, { id: 't', kind: 'terminal' }]
  assert.deepEqual(migratePanesV3(withAgents, { ...opts, newId: 'new' }).map((p) => p.id), ['a', 't'])
  // A full layout drops its last pane rather than exceeding MAX_PANES.
  const full = Array.from({ length: 6 }, (_, i) => ({ id: `t${i}`, kind: 'terminal' }))
  const migrated = migratePanesV3(full, { ...opts, newId: 'new' })
  assert.equal(migrated.length, 6)
  assert.deepEqual(migrated.map((p) => p.id), ['new', 't0', 't1', 't2', 't3', 't4'])
  // Nothing stored: just the Agents pane.
  assert.deepEqual(migratePanesV3(null, { ...opts, newId: 'new' }).map((p) => p.kind), ['agents'])
})

test('the v3 migration puts an Agents pane first, once, and respects the cap', () => {
  const v2 = [{ id: 't', kind: 'terminal' }, { id: 'u', kind: 'usage' }]
  assert.deepEqual(migratePanesV3(v2, { ...opts, newId: 'new' }).map((p) => p.kind), ['agents', 'terminal', 'usage'])
  // Already migrated (or hand-made): left alone.
  const withAgents = [{ id: 'a', kind: 'agents' }, { id: 't', kind: 'terminal' }]
  assert.deepEqual(migratePanesV3(withAgents, { ...opts, newId: 'new' }).map((p) => p.id), ['a', 't'])
  // A full layout drops its last pane rather than exceeding MAX_PANES.
  const full = Array.from({ length: 6 }, (_, i) => ({ id: `t${i}`, kind: 'terminal' }))
  const migrated = migratePanesV3(full, { ...opts, newId: 'new' })
  assert.equal(migrated.length, 6)
  assert.deepEqual(migrated.map((p) => p.id), ['new', 't0', 't1', 't2', 't3', 't4'])
  // Nothing stored: just the Agents pane.
  assert.deepEqual(migratePanesV3(null, { ...opts, newId: 'new' }).map((p) => p.kind), ['agents'])
})

test('sidebar views: current key wins, the legacy key migrates once and surfaces new views, else defaults; retired ids vanish', () => {
  const o = { ids: ['limits', 'agents'], defaults: ['limits', 'agents'], surface: ['agents'] }
  assert.deepEqual(sanitizeSidebarViews(['limits', 'spend', 'limits', 'windows'], null, o), ['limits'])
  assert.deepEqual(sanitizeSidebarViews(null, ['limits', 'windows'], o), ['limits', 'agents'])
  assert.deepEqual(sanitizeSidebarViews(null, ['windows'], o), ['agents'])
  assert.deepEqual(sanitizeSidebarViews(null, ['agents', 'limits'], o), ['agents', 'limits'])
  assert.deepEqual(sanitizeSidebarViews(undefined, undefined, o), ['limits', 'agents'])
  assert.deepEqual(sanitizeSidebarViews([], null, o), [])
  assert.deepEqual(sanitizeCollapsed(['spend', 'windows', 'limits', 'limits'], o), ['limits'])
  assert.deepEqual(sanitizeCollapsed('x', { ...o, defaults: [] }), [])
})

test('launch prefs: v1 string migrates to a default, folders override it, junk falls out, the map is bounded', () => {
  const L = ['claude', 'codex', 'shell']
  assert.deepEqual(readLaunchPrefs(undefined, 'codex', L), { default: 'codex', byCwd: {} })
  assert.deepEqual(readLaunchPrefs(undefined, undefined, L), { default: 'claude', byCwd: {} })
  const prefs = readLaunchPrefs({ default: 'shell', byCwd: { 'C:\\Proj\\A': 'codex', 'c:/proj/b/': 'bash', 7: 'claude' } }, 'codex', L)
  assert.deepEqual(prefs, { default: 'shell', byCwd: { 'c:/proj/a': 'codex', '7': 'claude' } })
  assert.equal(launchFor(prefs, 'c:/Proj/A'), 'codex')
  assert.equal(launchFor(prefs, 'C:/proj/b'), 'shell')
  assert.equal(launchFor(prefs, undefined), 'shell')
  const next = withLaunch(prefs, 'C:\\Proj\\B', 'claude')
  assert.equal(next.default, 'claude')
  assert.equal(next.byCwd['c:/proj/b'], 'claude')
  assert.equal(launchFor(withLaunch(prefs, undefined, 'codex'), 'x:/nowhere'), 'codex')
  const many = {}
  for (let i = 0; i < 60; i++) many[`c:/p${i}`] = 'codex'
  assert.equal(Object.keys(readLaunchPrefs({ default: 'claude', byCwd: many }, null, L).byCwd).length, 50)
  assert.equal(Object.keys(withLaunch({ default: 'claude', byCwd: many }, 'c:/new', 'shell').byCwd).length, 50)
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

test('the remembered launch falls back to the first entry rather than starting the wrong thing', () => {
  const launches = ['claude', 'codex', 'shell']
  assert.equal(readLaunch('codex', launches), 'codex')
  assert.equal(readLaunch('shell', launches), 'shell')
  assert.equal(readLaunch('bash', launches), 'claude')   // retired / hand-edited
  assert.equal(readLaunch(null, launches), 'claude')     // never picked
  assert.equal(readLaunch(3, launches), 'claude')
})

test('a retired pane kind comes back as its alias, deduped against the real thing', () => {
  const opts = { kinds: ['agents', 'spend', 'insights'], isUnique: () => true, maxPanes: 6, aliases: { usage: 'spend' } }
  assert.deepEqual(sanitizePanes([{ id: 'a', kind: 'usage' }, { id: 'b', kind: 'insights' }], opts), [{ id: 'a', kind: 'spend' }, { id: 'b', kind: 'insights' }])
  assert.deepEqual(sanitizePanes([{ id: 'a', kind: 'usage' }, { id: 'b', kind: 'spend' }], opts), [{ id: 'a', kind: 'spend' }])
  assert.deepEqual(sanitizePanes([{ id: 'a', kind: 'usage' }], { ...opts, aliases: {} }), [])
})

test('a terminal pane keeps a well-formed resumeId and drops a malformed one', () => {
  const opts = { kinds: ['terminal'], isUnique: () => false, maxPanes: 6 }
  const [ok] = sanitizePanes([{ id: 'a', kind: 'terminal', term: { launch: 'claude', resumeId: 'bb878513-17c2-4671-aa0f-65ff1f1f1b89' } }], opts)
  assert.equal(ok.term.resumeId, 'bb878513-17c2-4671-aa0f-65ff1f1f1b89')
  const [bad] = sanitizePanes([{ id: 'b', kind: 'terminal', term: { launch: 'claude', resumeId: 'nope; rm -rf' } }], opts)
  assert.equal(bad.term.resumeId, undefined)
})
