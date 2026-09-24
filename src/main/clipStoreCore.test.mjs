import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ClipStore, sanitizeMeta } from './clipStoreCore.mjs'

/** A counting stand-in for safeStorage: reversible, so a reload can check the round trip. */
function fakeCrypto() {
  const counts = { protect: 0, unprotect: 0 }
  return {
    counts,
    available: () => true,
    protect: async (text) => { counts.protect++; return Buffer.from(`sealed:${text}`, 'utf8') },
    unprotect: async (buf) => { counts.unprotect++; const s = buf.toString('utf8'); assert.ok(s.startsWith('sealed:')); return s.slice(7) }
  }
}

function makeStore(dir, clock, crypto = fakeCrypto()) {
  const store = new ClipStore(dir, crypto, () => {}, { now: () => clock.t })
  return { store, crypto }
}

const src = { kind: 'app', exe: 'notepad.exe' }
const text = (id, body) => ({ id, kind: 'text', text: body, source: src, bytes: Buffer.byteLength(body) })

test('a flush seals each body once; a re-copy or reorder re-seals nothing; an edit re-seals that clip only', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tm-clips-'))
  try {
    const clock = { t: 1_000_000 }
    const { store, crypto } = makeStore(dir, clock)
    await store.load()
    assert.equal(await store.add(text('a', 'alpha')) !== null, true)
    clock.t += 5_000
    await store.add(text('b', 'beta'))
    await store.flush()
    assert.equal(crypto.counts.protect, 2, 'two clips, two seals')
    const first = readFileSync(join(dir, 'clips.jsonl'), 'utf8')
    assert.ok(!first.includes('alpha') && !first.includes('beta'), 'bodies are never in the clear')
    assert.ok(first.includes('"id":"a"'), 'metadata stays readable')

    // A re-copy of alpha (past the burst window) moves it up with copies=2 — and costs no DPAPI call.
    clock.t += 5_000
    const again = await store.add(text('zzz', 'alpha'))
    assert.equal(again.id, 'a')
    assert.equal(again.copies, 2)
    await store.flush()
    assert.equal(crypto.counts.protect, 2, 'a second flush after a re-copy calls protect zero times')
    assert.deepEqual(store.list().map((c) => c.id), ['a', 'b'])

    // Editing one title re-seals that clip and nothing else.
    store.update('b', { title: 'Beta!' })
    await store.flush()
    assert.equal(crypto.counts.protect, 3)
    store.update('a', { favorite: true })
    await store.flush()
    assert.equal(crypto.counts.protect, 3, 'a metadata-only change re-seals nothing')

    // Reload from disk: bodies round-trip, one unprotect per line, and the reloaded seals are reused too.
    const reload = makeStore(dir, clock)
    await reload.store.load()
    assert.equal(reload.crypto.counts.unprotect, 2)
    assert.deepEqual(reload.store.list().map((c) => [c.id, c.text, c.copies, c.title ?? null, c.favorite]), [['a', 'alpha', 2, null, true], ['b', 'beta', 1, 'Beta!', false]])
    reload.store.update('a', { favorite: false })
    await reload.store.flush()
    assert.equal(reload.crypto.counts.protect, 0, 'nothing re-sealed after a reload when bodies are unchanged')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('remove drops the clip, its seal and its favorites slot; clear keeps pinned clips unless told otherwise', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tm-clips-'))
  try {
    const clock = { t: 1 }
    const { store, crypto } = makeStore(dir, clock)
    await store.load()
    for (const [id, body] of [['a', 'one'], ['b', 'two'], ['c', 'three']]) { clock.t += 2_000; await store.add(text(id, body)) }
    store.update('a', { favorite: true })
    store.setGroups(['Keep'])
    store.update('b', { groups: ['Keep', 'Nope'] })
    assert.deepEqual(store.get('b').groups, ['Keep'], 'only existing groups stick')
    store.setFavoritesOrder(['a', 'c'])
    assert.deepEqual(store.settings().favoritesOrder, ['a'], 'only favorites can be ordered')
    assert.equal(store.remove(['a', 'nope']), 1)
    assert.deepEqual(store.settings().favoritesOrder, [])
    await store.flush()
    const before = crypto.counts.protect
    assert.equal(store.clear(), 1, 'only the unpinned clip goes')
    assert.deepEqual(store.list().map((c) => c.id), ['b'])
    assert.equal(store.clear(true), 1)
    assert.deepEqual(store.list(), [])
    await store.flush()
    assert.equal(crypto.counts.protect, before)
    assert.equal(readFileSync(join(dir, 'clips.jsonl'), 'utf8'), '')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('pause, settings and meta survive a reload; unreadable lines are skipped', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tm-clips-'))
  try {
    const clock = { t: 10_000 }
    const { store } = makeStore(dir, clock)
    await store.load()
    assert.equal(store.isPaused(), false)
    store.pause(5)
    assert.equal(store.isPaused(), true)
    clock.t += 5 * 60_000 + 1
    assert.equal(store.isPaused(), false, 'a timed pause lapses')
    store.pause(undefined)
    assert.equal(store.isPaused(), true, 'an open pause holds')
    store.updateSettings({ blockedExes: ['Slack.exe'], redactSecrets: false, maxItems: 5, maxAgeDays: 0, junk: 1 })
    await store.flush()
    assert.ok(existsSync(join(dir, 'meta.json')))
    const reload = makeStore(dir, clock)
    await reload.store.load()
    const meta = reload.store.settings()
    assert.equal(meta.pausedUntil, -1)
    assert.deepEqual(meta.blockedExes, ['slack.exe'])
    assert.equal(meta.redactSecrets, false)
    assert.equal(meta.maxItems, 2000, 'below the floor → default')
    assert.equal(meta.maxAgeDays, 30, 'out of range → default')
    reload.store.pause(null)
    assert.equal(reload.store.isPaused(), false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a store without encryption writes plain bodies and says so; a garbage line is dropped', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tm-clips-'))
  try {
    const crypto = { available: () => false, protect: async () => { throw new Error('no') }, unprotect: async () => { throw new Error('no') } }
    const clock = { t: 5 }
    const { store } = makeStore(dir, clock, crypto)
    await store.load()
    await store.add(text('p', 'plain body'))
    await store.flush()
    assert.equal(store.unprotected, true)
    const file = join(dir, 'clips.jsonl')
    assert.ok(readFileSync(file, 'utf8').includes('plain body'))
    const { appendFileSync } = await import('node:fs')
    appendFileSync(file, 'not json\n{"v":1,"clip":{"id":"bad"},"enc":"zzz"}\n')
    const reload = makeStore(dir, clock, crypto)
    await reload.store.load()
    assert.deepEqual(reload.store.list().map((c) => c.id), ['p'])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('importClips adds new text, skips content already in history without touching it, and creates the groups it names', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tm-clips-'))
  try {
    const clock = { t: 50_000 }
    const { store } = makeStore(dir, clock)
    await store.load()
    await store.add(text('a', 'alpha'))
    const res = await store.importClips([
      { text: 'alpha', title: 'Dup', favorite: true },
      { text: 'beta', title: 'Beta', favorite: true, groups: ['Prompts', 'All'], createdAt: 1_000 },
      { text: '   ' },
      { text: 'gamma', groups: ['Prompts'] }
    ])
    assert.deepEqual(res, { added: 2, skipped: 2 })
    const a = store.get('a')
    assert.equal(a.copies, 1, 'a duplicate never bumps the existing clip')
    assert.equal(a.title, undefined)
    assert.deepEqual(store.settings().groups, ['Prompts'])
    const beta = store.list().find((c) => c.text === 'beta')
    assert.equal(beta.title, 'Beta')
    assert.equal(beta.favorite, true)
    assert.deepEqual(beta.groups, ['Prompts'])
    assert.equal(beta.createdAt, 1_000)
    assert.equal(beta.manual, true)
    assert.equal(beta.source.kind, 'manual')
    assert.deepEqual(store.list().map((c) => c.text), ['gamma', 'alpha', 'beta'], 'newest copied first; imported clips keep their own time')
    const exported = store.exportData()
    assert.equal(exported.app, 'taylormade-agent-monitor')
    assert.equal(exported.clips.length, 3)
    assert.ok(exported.clips.every((c) => typeof c.text === 'string'), 'an export carries the bodies in the clear')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('sanitizeMeta bounds everything and defaults the rest', () => {
  assert.deepEqual(sanitizeMeta(null), { groups: [], favoritesOrder: [], pausedUntil: 0, blockedExes: [], redactSecrets: true, captureImages: true, maxItems: 2000, maxAgeDays: 30 })
  const m = sanitizeMeta({ groups: ['A', 'A', 'favorites'], favoritesOrder: ['x', 3], pausedUntil: -1, blockedExes: ['ONE.exe'], captureImages: false, maxItems: 99999, maxAgeDays: 7 })
  assert.deepEqual(m, { groups: ['A'], favoritesOrder: ['x'], pausedUntil: -1, blockedExes: ['one.exe'], redactSecrets: true, captureImages: false, maxItems: 2000, maxAgeDays: 7 })
})
