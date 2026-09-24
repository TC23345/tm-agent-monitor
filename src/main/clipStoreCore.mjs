// Clipboard history on disk (PRD §3.2): `userData/clips/clips.jsonl`, one
// clip per line, its body (text, file list, title) sealed through the
// adapter's safeStorage pair — DPAPI, bound to the Windows account — and
// images as sealed PNGs (full + thumbnail) beside it. The whole list lives
// decrypted in memory; every change rewrites the file through one chained,
// debounced, atomic (tmp + rename) writer, like the notes order file. A
// clip's sealed body is cached by id + body, so a flush re-encrypts only what
// changed — at 2 000 clips one copy would otherwise cost 2 000 DPAPI calls on
// main. Bounded by clips.mjs (MAX_CLIPS, retention), and never throws into a
// caller: a failed write is logged and retried on the next change.
//
// Plain ESM (no Electron) so node --test can drive it with a fake crypto and
// a temp dir; main passes the real safeStorage pair from clipboardIo.ts.
import { createHash, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, promises as fsp } from 'node:fs'
import { join } from 'node:path'
import { applyRetention, sanitizeClip, sanitizeGroups, upsertClip, MAX_CLIPS, RETENTION_DAYS, groupNameOk, mergeText } from '../shared/clips.mjs'

const DEFAULT_META = Object.freeze({
  groups: [], favoritesOrder: [], pausedUntil: 0, blockedExes: [], redactSecrets: true, captureImages: true,
  maxItems: MAX_CLIPS, maxAgeDays: RETENTION_DAYS
})

const SAVE_AFTER_MS = 400
const CLIPS_FILE = 'clips.jsonl'
const META_FILE = 'meta.json'
const IMG_DIR = 'img'
const MAX_PAUSE_MINUTES = 24 * 60

function isRecord(v) {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** Capture and retention preferences as loaded: every field bounded, defaults for the rest. */
export function sanitizeMeta(raw) {
  const r = isRecord(raw) ? raw : {}
  const num = (v, lo, hi, d) => (typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? Math.floor(v) : d)
  const strs = (v, max) => (Array.isArray(v) ? [...new Set(v.filter((s) => typeof s === 'string' && s.length > 0 && s.length <= 128))].slice(0, max) : [])
  return {
    groups: sanitizeGroups(r.groups),
    favoritesOrder: strs(r.favoritesOrder, 500),
    pausedUntil: typeof r.pausedUntil === 'number' && (r.pausedUntil === -1 || r.pausedUntil >= 0) ? Math.floor(r.pausedUntil) : 0,
    blockedExes: strs(r.blockedExes, 100).map((e) => e.toLowerCase()),
    redactSecrets: r.redactSecrets !== false,
    captureImages: r.captureImages !== false,
    maxItems: num(r.maxItems, 50, 10_000, MAX_CLIPS),
    maxAgeDays: num(r.maxAgeDays, 1, 3650, RETENTION_DAYS)
  }
}

/** The body a line seals: what must never be readable from the file alone. */
function bodyOf(clip) {
  return JSON.stringify({ text: clip.text, files: clip.files, title: clip.title })
}

export class ClipStore {
  /**
   * @param {string} dir
   * @param {{ available: () => boolean, protect: (text: string) => Promise<Buffer>, unprotect: (buffer: Buffer) => Promise<string> }} crypto
   * @param {(line: string) => void} [log]
   * @param {{ now?: () => number }} [opts]
   */
  constructor(dir, crypto, log = () => {}, opts = {}) {
    this.dir = dir
    this.crypto = crypto
    this.log = log
    this.now = opts.now ?? (() => Date.now())
    /** @type {import('../shared/clips.mjs').Clip[]} */
    this.clips = []
    this.meta = { ...DEFAULT_META }
    this.loaded = false
    this.chain = Promise.resolve()
    this.saveTimer = null
    this.dirty = false
    this.metaDirty = false
    this.listeners = new Set()
    this.thumbCache = new Map()
    /** Sealed bodies by clip id: reused on flush while the body is unchanged. */
    this.sealed = new Map()
    /** Plaintext fallback was used because DPAPI was unavailable — the pane's footer says so. */
    this.unprotected = false
  }

  onChange(listener) {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  emit() {
    for (const l of this.listeners) {
      try { l() } catch { /* a listener's failure is its own */ }
    }
  }

  ensureDir() {
    if (!existsSync(this.dir)) mkdirSync(this.dir, { recursive: true })
    const img = join(this.dir, IMG_DIR)
    if (!existsSync(img)) mkdirSync(img, { recursive: true })
  }

  /** Read everything once. Lines this account cannot decrypt, or that fail validation, are dropped and counted. */
  async load() {
    if (this.loaded) return
    this.loaded = true
    this.ensureDir()
    try {
      this.meta = sanitizeMeta(JSON.parse(await fsp.readFile(join(this.dir, META_FILE), 'utf8')))
    } catch {
      this.meta = { ...DEFAULT_META }
    }
    let raw = ''
    try {
      raw = await fsp.readFile(join(this.dir, CLIPS_FILE), 'utf8')
    } catch {
      raw = '' // first run: nothing on disk yet
    }
    const clips = []
    let dropped = 0
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue
      try {
        const stored = JSON.parse(line)
        if (!isRecord(stored) || stored.v !== 1 || !isRecord(stored.clip)) { dropped++; continue }
        let body
        if (typeof stored.enc === 'string') body = JSON.parse(await this.crypto.unprotect(Buffer.from(stored.enc, 'base64')))
        else if (isRecord(stored.plain)) body = stored.plain
        const clip = sanitizeClip({ ...stored.clip, ...(body ?? {}) })
        if (clip) {
          clips.push(clip)
          // What was read back sealed is still sealed correctly: reuse it on the next flush.
          if (typeof stored.enc === 'string') this.sealed.set(clip.id, { body: bodyOf(clip), enc: stored.enc })
        } else dropped++
      } catch {
        dropped++
      }
      if (clips.length >= MAX_CLIPS) break
    }
    this.clips = applyRetention(clips, this.retention())
    if (dropped) this.log(`[clipboard] store: ${dropped} unreadable line${dropped === 1 ? '' : 's'} skipped`)
    this.log(`[clipboard] store: ${this.clips.length} clip${this.clips.length === 1 ? '' : 's'} loaded${this.crypto.available() ? '' : ' (DPAPI unavailable — stored in plain text)'}`)
  }

  retention() {
    return { maxItems: this.meta.maxItems, maxAgeMs: this.meta.maxAgeDays * 86_400_000, now: this.now() }
  }

  list() {
    return this.clips
  }

  get(id) {
    return this.clips.find((c) => c.id === id)
  }

  settings() {
    return { ...this.meta, groups: [...this.meta.groups], favoritesOrder: [...this.meta.favoritesOrder], blockedExes: [...this.meta.blockedExes] }
  }

  /** Capturing is off right now (a timed pause that has elapsed counts as on). */
  isPaused(now = this.now()) {
    const p = this.meta.pausedUntil
    return p === -1 || (p > 0 && p > now)
  }

  /** `minutes` > 0 pauses for that long, 0 or undefined pauses until resumed, null resumes. */
  pause(minutes) {
    this.meta.pausedUntil = minutes === null ? 0 : minutes && minutes > 0 ? this.now() + Math.min(minutes, MAX_PAUSE_MINUTES) * 60_000 : -1
    this.metaDirty = true
    this.schedule()
    this.emit()
  }

  /** The capture preferences (blocklist, redaction, images, retention); groups and pause have their own routes. */
  updateSettings(patch) {
    const p = isRecord(patch) ? patch : {}
    const next = { ...this.meta }
    for (const key of ['blockedExes', 'redactSecrets', 'captureImages', 'maxItems', 'maxAgeDays']) if (key in p) next[key] = p[key]
    this.meta = sanitizeMeta(next)
    this.clips = applyRetention(this.clips, this.retention())
    this.metaDirty = true
    this.dirty = true
    this.schedule()
    this.emit()
  }

  /**
   * A captured or manually added clip. `png` is the image's bytes (kind
   * `image`) and `thumb` a small PNG for the row. Answers the stored clip
   * (which may be an older one moved to the top) or null when it was refused.
   */
  async add(incoming, opts = {}) {
    const now = this.now()
    const clip = sanitizeClip({ ...incoming, createdAt: incoming.createdAt ?? now, copiedAt: now, copies: incoming.copies ?? 1, groups: incoming.groups ?? [], favorite: incoming.favorite ?? false })
    if (!clip) return null
    if (clip.kind === 'image') {
      if (!opts.png) return null
      const hash = createHash('sha1').update(opts.png).digest('hex')
      clip.image = { ...clip.image, hash, bytes: opts.png.length }
      clip.bytes = opts.png.length
    }
    const { clips, clip: stored, existed, burst } = upsertClip(this.clips, clip, now, { keepSource: opts.keepSource })
    if (burst) return stored
    this.clips = applyRetention(clips, this.retention())
    if (!existed && clip.kind === 'image' && opts.png) await this.writeImage(stored.id, opts.png, opts.thumb)
    this.dirty = true
    this.schedule()
    this.emit()
    return stored
  }

  /** Title, text (text clips only — marks it edited), groups (existing names only), star. */
  update(id, patch) {
    const idx = this.clips.findIndex((c) => c.id === id)
    if (idx === -1 || !isRecord(patch)) return null
    const prev = this.clips[idx]
    const next = { ...prev }
    if (patch.title === null) delete next.title
    else if (typeof patch.title === 'string') next.title = patch.title
    if (typeof patch.text === 'string' && prev.kind === 'text' && patch.text !== prev.text) { next.text = patch.text; next.edited = true; next.bytes = Buffer.byteLength(patch.text, 'utf8') }
    if (Array.isArray(patch.groups)) next.groups = [...new Set(patch.groups.filter((g) => groupNameOk(g) && this.meta.groups.includes(g)))]
    if (typeof patch.favorite === 'boolean') next.favorite = patch.favorite
    const clean = sanitizeClip(next)
    if (!clean) return null
    this.clips = [...this.clips.slice(0, idx), clean, ...this.clips.slice(idx + 1)]
    // The seal covers the body only; a star or group change keeps it.
    if (bodyOf(clean) !== bodyOf(prev)) this.sealed.delete(id)
    if (!clean.favorite) this.meta.favoritesOrder = this.meta.favoritesOrder.filter((f) => f !== id)
    this.dirty = true
    this.metaDirty = true
    this.schedule()
    this.emit()
    return clean
  }

  remove(ids) {
    const gone = new Set(Array.isArray(ids) ? ids : [])
    const before = this.clips.length
    const removed = this.clips.filter((c) => gone.has(c.id))
    this.clips = this.clips.filter((c) => !gone.has(c.id))
    if (this.clips.length === before) return 0
    this.meta.favoritesOrder = this.meta.favoritesOrder.filter((f) => !gone.has(f))
    for (const c of removed) {
      this.sealed.delete(c.id)
      if (c.kind === 'image') void this.deleteImage(c.id)
    }
    this.dirty = true
    this.metaDirty = true
    this.schedule()
    this.emit()
    return before - this.clips.length
  }

  /** Everything but favorites and grouped clips, or everything when `all`. */
  clear(all = false) {
    const keep = all ? new Set() : new Set(this.clips.filter((c) => c.favorite || c.groups.length > 0).map((c) => c.id))
    return this.remove(this.clips.filter((c) => !keep.has(c.id)).map((c) => c.id))
  }

  /** A new text clip from several, in the order given; the originals stay. */
  async merge(ids, source) {
    const parts = (Array.isArray(ids) ? ids : []).map((id) => this.get(id)).filter((c) => !!c && c.kind !== 'image')
    if (parts.length < 2) return null
    const text = mergeText(parts)
    if (!text.trim()) return null
    return this.add({ id: randomUUID(), kind: 'text', text, source, bytes: Buffer.byteLength(text, 'utf8'), merged: true })
  }

  setGroups(names) {
    const groups = sanitizeGroups(names)
    const gone = new Set(this.meta.groups.filter((g) => !groups.includes(g)))
    this.meta.groups = groups
    if (gone.size) {
      this.clips = this.clips.map((c) => (c.groups.some((g) => gone.has(g)) ? { ...c, groups: c.groups.filter((g) => !gone.has(g)) } : c))
      this.dirty = true
    }
    this.metaDirty = true
    this.schedule()
    this.emit()
    return groups
  }

  setFavoritesOrder(ids) {
    const favs = new Set(this.clips.filter((c) => c.favorite).map((c) => c.id))
    this.meta.favoritesOrder = [...new Set((Array.isArray(ids) ? ids : []).filter((id) => favs.has(id)))]
    this.metaDirty = true
    this.schedule()
    this.emit()
  }

  imagePath(id, thumb) {
    return join(this.dir, IMG_DIR, `${id}${thumb ? '.thumb' : ''}.png.enc`)
  }

  async writeImage(id, png, thumb) {
    try {
      await fsp.writeFile(this.imagePath(id, false), await this.seal(png.toString('base64')))
      if (thumb) await fsp.writeFile(this.imagePath(id, true), await this.seal(thumb.toString('base64')))
    } catch (error) {
      this.log(`[clipboard] image write failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  async deleteImage(id) {
    this.thumbCache.delete(id)
    for (const thumb of [false, true]) await fsp.rm(this.imagePath(id, thumb), { force: true }).catch(() => {})
  }

  /** A `data:image/png;base64,…` URL for the renderer, or null. Thumbnails are cached in memory. */
  async imageDataUrl(id, thumb) {
    if (thumb && this.thumbCache.has(id)) return this.thumbCache.get(id)
    const clip = this.get(id)
    if (!clip || clip.kind !== 'image') return null
    try {
      let raw = await fsp.readFile(this.imagePath(id, thumb)).catch(() => null)
      if (!raw && thumb) raw = await fsp.readFile(this.imagePath(id, false)).catch(() => null)
      if (!raw) return null
      const url = `data:image/png;base64,${await this.open(raw)}`
      if (thumb) {
        this.thumbCache.set(id, url)
        if (this.thumbCache.size > 300) this.thumbCache.delete(this.thumbCache.keys().next().value)
      }
      return url
    } catch {
      return null
    }
  }

  /** The full PNG of an image clip (to put it back on the clipboard). */
  async imageBytes(id) {
    const clip = this.get(id)
    if (!clip || clip.kind !== 'image') return null
    try {
      const raw = await fsp.readFile(this.imagePath(id, false))
      return Buffer.from(await this.open(raw), 'base64')
    } catch {
      return null
    }
  }

  // ---- persistence ----

  /** Encrypt when we can; a marker byte says which it is. */
  async seal(text) {
    if (this.crypto.available()) {
      try {
        return Buffer.concat([Buffer.from([1]), await this.crypto.protect(text)])
      } catch (error) {
        this.log(`[clipboard] encrypt failed, storing plain: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    this.unprotected = true
    return Buffer.concat([Buffer.from([0]), Buffer.from(text, 'utf8')])
  }

  async open(sealed) {
    if (!sealed.length) return ''
    return sealed[0] === 1 ? this.crypto.unprotect(sealed.subarray(1)) : sealed.subarray(1).toString('utf8')
  }

  schedule() {
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = setTimeout(() => { this.saveTimer = null; void this.flush() }, SAVE_AFTER_MS)
  }

  /** One stored line: the record minus its body, plus the body sealed (reused from the cache when unchanged). */
  async lineFor(clip) {
    const { text, files, title, ...rest } = clip
    const line = { v: 1, clip: rest }
    if (!this.crypto.available()) {
      line.plain = { text, files, title }
      this.unprotected = true
      return line
    }
    const body = bodyOf(clip)
    const cached = this.sealed.get(clip.id)
    if (cached && cached.body === body) {
      line.enc = cached.enc
      return line
    }
    try {
      line.enc = (await this.crypto.protect(body)).toString('base64')
      this.sealed.set(clip.id, { body, enc: line.enc })
    } catch {
      line.plain = { text, files, title }
      this.unprotected = true
    }
    return line
  }

  /** Write whatever is pending, now. Chained, so two flushes never interleave. */
  flush() {
    if (this.saveTimer) { clearTimeout(this.saveTimer); this.saveTimer = null }
    const run = this.chain.then(async () => {
      if (this.metaDirty) {
        this.metaDirty = false
        await this.writeAtomic(join(this.dir, META_FILE), JSON.stringify(this.meta, null, 2))
      }
      if (this.dirty) {
        this.dirty = false
        const lines = []
        const live = new Set()
        for (const clip of this.clips) {
          lines.push(JSON.stringify(await this.lineFor(clip)))
          live.add(clip.id)
        }
        for (const id of this.sealed.keys()) if (!live.has(id)) this.sealed.delete(id)
        await this.writeAtomic(join(this.dir, CLIPS_FILE), lines.length ? `${lines.join('\n')}\n` : '')
      }
    }).catch((error) => {
      this.dirty = true
      this.log(`[clipboard] store write failed: ${error instanceof Error ? error.message : String(error)}`)
    })
    this.chain = run
    return run
  }

  async writeAtomic(file, content) {
    this.ensureDir()
    const tmp = `${file}.${process.pid}.tmp`
    await fsp.writeFile(tmp, content, 'utf8')
    await fsp.rename(tmp, file)
  }
}
