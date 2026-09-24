// Clipboard history on disk (PRD §3.2): `userData/clips/clips.jsonl`, one
// clip per line, its body (text, file list, title) encrypted through the
// adapter's safeStorage pair — DPAPI, bound to the Windows account — and
// images as encrypted PNGs (full + thumbnail) beside it. The whole list lives
// decrypted in memory; every change rewrites the file through one chained,
// debounced, atomic (tmp + rename) writer, like the notes order file. Bounded
// by clips.mjs (MAX_CLIPS, retention), and never throws into a caller: a
// failed write is logged and retried on the next change.
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, promises as fsp } from 'node:fs'
import { join } from 'node:path'
import {
  applyRetention, sanitizeClip, sanitizeGroups, upsertClip, MAX_CLIPS, RETENTION_DAYS, groupNameOk, mergeText,
  type Clip, type ClipSource
} from '../shared/clips.mjs'

export interface ClipStoreCrypto {
  available: () => boolean
  protect: (text: string) => Promise<Buffer>
  unprotect: (buffer: Buffer) => Promise<string>
}

/** Capture and retention preferences, stored beside the clips (not in settings.json). */
export interface ClipMeta {
  groups: string[]
  favoritesOrder: string[]
  /** 0 = capturing; -1 = paused until resumed; else a timestamp the pause ends at. */
  pausedUntil: number
  blockedExes: string[]
  redactSecrets: boolean
  captureImages: boolean
  maxItems: number
  maxAgeDays: number
}

const DEFAULT_META: ClipMeta = {
  groups: [], favoritesOrder: [], pausedUntil: 0, blockedExes: [], redactSecrets: true, captureImages: true,
  maxItems: MAX_CLIPS, maxAgeDays: RETENTION_DAYS
}

const SAVE_AFTER_MS = 400
const CLIPS_FILE = 'clips.jsonl'
const META_FILE = 'meta.json'
const IMG_DIR = 'img'

/** One line of clips.jsonl: the record minus its body, plus the body encrypted (or plain when DPAPI is unavailable). */
interface StoredLine {
  v: 1
  clip: Omit<Clip, 'text' | 'files' | 'title'>
  enc?: string
  plain?: { text: string; files?: string[]; title?: string }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

export function sanitizeMeta(raw: unknown): ClipMeta {
  const r = isRecord(raw) ? raw : {}
  const num = (v: unknown, lo: number, hi: number, d: number) => (typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? Math.floor(v) : d)
  const strs = (v: unknown, max: number) => (Array.isArray(v) ? [...new Set(v.filter((s): s is string => typeof s === 'string' && s.length > 0 && s.length <= 128))].slice(0, max) : [])
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

export class ClipStore {
  private clips: Clip[] = []
  private meta: ClipMeta = { ...DEFAULT_META }
  private loaded = false
  private chain: Promise<unknown> = Promise.resolve()
  private saveTimer: NodeJS.Timeout | null = null
  private dirty = false
  private metaDirty = false
  private listeners = new Set<() => void>()
  private thumbCache = new Map<string, string>()
  /** Plaintext fallback was used because DPAPI was unavailable — the pane's footer says so. */
  unprotected = false

  constructor(private readonly dir: string, private readonly crypto: ClipStoreCrypto, private readonly log: (line: string) => void = () => {}) {}

  onChange(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  private emit(): void {
    for (const l of this.listeners) {
      try { l() } catch { /* a listener's failure is its own */ }
    }
  }

  private ensureDir(): void {
    if (!existsSync(this.dir)) mkdirSync(this.dir, { recursive: true })
    const img = join(this.dir, IMG_DIR)
    if (!existsSync(img)) mkdirSync(img, { recursive: true })
  }

  /** Read everything once. Lines this account cannot decrypt, or that fail validation, are dropped and counted. */
  async load(): Promise<void> {
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
      return
    }
    const clips: Clip[] = []
    let dropped = 0
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue
      try {
        const stored = JSON.parse(line) as StoredLine
        if (!isRecord(stored) || stored.v !== 1 || !isRecord(stored.clip)) { dropped++; continue }
        let body: StoredLine['plain'] | undefined
        if (typeof stored.enc === 'string') body = JSON.parse(await this.crypto.unprotect(Buffer.from(stored.enc, 'base64')))
        else if (isRecord(stored.plain)) body = stored.plain as StoredLine['plain']
        const clip = sanitizeClip({ ...stored.clip, ...(body ?? {}) })
        if (clip) clips.push(clip)
        else dropped++
      } catch {
        dropped++
      }
      if (clips.length >= MAX_CLIPS) break
    }
    this.clips = applyRetention(clips, this.retention())
    if (dropped) this.log(`[clipboard] store: ${dropped} unreadable line${dropped === 1 ? '' : 's'} skipped`)
    this.log(`[clipboard] store: ${this.clips.length} clip${this.clips.length === 1 ? '' : 's'} loaded${this.crypto.available() ? '' : ' (DPAPI unavailable — stored in plain text)'}`)
  }

  private retention() {
    return { maxItems: this.meta.maxItems, maxAgeMs: this.meta.maxAgeDays * 86_400_000 }
  }

  list(): Clip[] {
    return this.clips
  }

  get(id: string): Clip | undefined {
    return this.clips.find((c) => c.id === id)
  }

  settings(): ClipMeta {
    return { ...this.meta, groups: [...this.meta.groups], favoritesOrder: [...this.meta.favoritesOrder], blockedExes: [...this.meta.blockedExes] }
  }

  /** Capturing is off right now (a timed pause that has elapsed counts as on). */
  isPaused(now = Date.now()): boolean {
    const p = this.meta.pausedUntil
    return p === -1 || (p > 0 && p > now)
  }

  /** `minutes` > 0 pauses for that long, 0 or undefined pauses until resumed, null resumes. */
  pause(minutes: number | null | undefined): void {
    this.meta.pausedUntil = minutes === null ? 0 : minutes && minutes > 0 ? Date.now() + Math.min(minutes, 24 * 60) * 60_000 : -1
    this.metaDirty = true
    this.schedule()
    this.emit()
  }

  updateSettings(patch: Partial<Pick<ClipMeta, 'blockedExes' | 'redactSecrets' | 'captureImages' | 'maxItems' | 'maxAgeDays'>>): void {
    this.meta = sanitizeMeta({ ...this.meta, ...patch })
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
  async add(incoming: Omit<Clip, 'createdAt' | 'copiedAt' | 'copies' | 'groups' | 'favorite'> & Partial<Clip>, opts: { png?: Buffer; thumb?: Buffer; keepSource?: boolean } = {}): Promise<Clip | null> {
    const clip = sanitizeClip({ ...incoming, createdAt: incoming.createdAt ?? Date.now(), copiedAt: Date.now(), copies: incoming.copies ?? 1, groups: incoming.groups ?? [], favorite: incoming.favorite ?? false })
    if (!clip) return null
    if (clip.kind === 'image') {
      if (!opts.png) return null
      const hash = createHash('sha1').update(opts.png).digest('hex')
      clip.image = { ...clip.image!, hash, bytes: opts.png.length }
      clip.bytes = opts.png.length
    }
    const { clips, clip: stored, existed } = upsertClip(this.clips, clip, Date.now(), { keepSource: opts.keepSource })
    this.clips = applyRetention(clips, this.retention())
    if (!existed && clip.kind === 'image' && opts.png) {
      await this.writeImage(stored.id, opts.png, opts.thumb)
    }
    this.dirty = true
    this.schedule()
    this.emit()
    return stored
  }

  update(id: string, patch: { title?: string | null; text?: string; groups?: string[]; favorite?: boolean }): Clip | null {
    const idx = this.clips.findIndex((c) => c.id === id)
    if (idx === -1) return null
    const prev = this.clips[idx]
    const next: Clip = { ...prev }
    if (patch.title === null) delete next.title
    else if (typeof patch.title === 'string') next.title = patch.title
    if (typeof patch.text === 'string' && prev.kind === 'text' && patch.text !== prev.text) { next.text = patch.text; next.edited = true; next.bytes = Buffer.byteLength(patch.text, 'utf8') }
    if (Array.isArray(patch.groups)) next.groups = [...new Set(patch.groups.filter((g) => groupNameOk(g) && this.meta.groups.includes(g)))]
    if (typeof patch.favorite === 'boolean') next.favorite = patch.favorite
    const clean = sanitizeClip(next)
    if (!clean) return null
    this.clips = [...this.clips.slice(0, idx), clean, ...this.clips.slice(idx + 1)]
    if (!clean.favorite) this.meta.favoritesOrder = this.meta.favoritesOrder.filter((f) => f !== id)
    this.dirty = true
    this.metaDirty = true
    this.schedule()
    this.emit()
    return clean
  }

  remove(ids: string[]): number {
    const gone = new Set(ids)
    const before = this.clips.length
    const removed = this.clips.filter((c) => gone.has(c.id))
    this.clips = this.clips.filter((c) => !gone.has(c.id))
    if (this.clips.length === before) return 0
    this.meta.favoritesOrder = this.meta.favoritesOrder.filter((f) => !gone.has(f))
    for (const c of removed) if (c.kind === 'image') void this.deleteImage(c.id)
    this.dirty = true
    this.metaDirty = true
    this.schedule()
    this.emit()
    return before - this.clips.length
  }

  /** Everything but favorites and grouped clips, or everything when `all`. */
  clear(all = false): number {
    const keep = all ? [] : this.clips.filter((c) => c.favorite || c.groups.length > 0)
    return this.remove(this.clips.filter((c) => !keep.includes(c)).map((c) => c.id))
  }

  /** A new text clip from several, in the order given; the originals stay. */
  async merge(ids: string[], source: ClipSource): Promise<Clip | null> {
    const parts = ids.map((id) => this.get(id)).filter((c): c is Clip => !!c && c.kind !== 'image')
    if (parts.length < 2) return null
    const text = mergeText(parts)
    if (!text.trim()) return null
    return this.add({ id: crypto.randomUUID(), kind: 'text', text, source, bytes: Buffer.byteLength(text, 'utf8'), merged: true })
  }

  setGroups(names: string[]): string[] {
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

  setFavoritesOrder(ids: string[]): void {
    const favs = new Set(this.clips.filter((c) => c.favorite).map((c) => c.id))
    this.meta.favoritesOrder = [...new Set(ids.filter((id) => favs.has(id)))]
    this.metaDirty = true
    this.schedule()
    this.emit()
  }

  private imagePath(id: string, thumb: boolean): string {
    return join(this.dir, IMG_DIR, `${id}${thumb ? '.thumb' : ''}.png.enc`)
  }

  private async writeImage(id: string, png: Buffer, thumb?: Buffer): Promise<void> {
    try {
      await fsp.writeFile(this.imagePath(id, false), await this.seal(png.toString('base64')))
      if (thumb) await fsp.writeFile(this.imagePath(id, true), await this.seal(thumb.toString('base64')))
    } catch (error) {
      this.log(`[clipboard] image write failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  private async deleteImage(id: string): Promise<void> {
    this.thumbCache.delete(id)
    for (const thumb of [false, true]) await fsp.rm(this.imagePath(id, thumb), { force: true }).catch(() => {})
  }

  /** A `data:image/png;base64,…` URL for the renderer, or null. Thumbnails are cached in memory. */
  async imageDataUrl(id: string, thumb: boolean): Promise<string | null> {
    if (thumb && this.thumbCache.has(id)) return this.thumbCache.get(id)!
    const clip = this.get(id)
    if (!clip || clip.kind !== 'image') return null
    try {
      let raw = await fsp.readFile(this.imagePath(id, thumb)).catch(() => null)
      if (!raw && thumb) raw = await fsp.readFile(this.imagePath(id, false)).catch(() => null)
      if (!raw) return null
      const url = `data:image/png;base64,${await this.open(raw)}`
      if (thumb) {
        this.thumbCache.set(id, url)
        if (this.thumbCache.size > 300) this.thumbCache.delete(this.thumbCache.keys().next().value!)
      }
      return url
    } catch {
      return null
    }
  }

  /** The full PNG of an image clip (to put it back on the clipboard). */
  async imageBytes(id: string): Promise<Buffer | null> {
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
  private async seal(text: string): Promise<Buffer> {
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

  private async open(sealed: Buffer): Promise<string> {
    if (!sealed.length) return ''
    return sealed[0] === 1 ? this.crypto.unprotect(sealed.subarray(1)) : sealed.subarray(1).toString('utf8')
  }

  private schedule(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = setTimeout(() => { this.saveTimer = null; void this.flush() }, SAVE_AFTER_MS)
  }

  /** Write whatever is pending, now. Chained, so two flushes never interleave. */
  flush(): Promise<void> {
    if (this.saveTimer) { clearTimeout(this.saveTimer); this.saveTimer = null }
    const run = this.chain.then(async () => {
      if (this.metaDirty) {
        this.metaDirty = false
        await this.writeAtomic(join(this.dir, META_FILE), JSON.stringify(this.meta, null, 2))
      }
      if (this.dirty) {
        this.dirty = false
        const lines: string[] = []
        for (const clip of this.clips) {
          const { text, files, title, ...rest } = clip
          const body = JSON.stringify({ text, files, title })
          const line: StoredLine = { v: 1, clip: rest }
          if (this.crypto.available()) {
            try {
              line.enc = (await this.crypto.protect(body)).toString('base64')
            } catch {
              line.plain = { text, files, title }
              this.unprotected = true
            }
          } else {
            line.plain = { text, files, title }
            this.unprotected = true
          }
          lines.push(JSON.stringify(line))
        }
        await this.writeAtomic(join(this.dir, CLIPS_FILE), lines.length ? `${lines.join('\n')}\n` : '')
      }
    }).catch((error) => {
      this.dirty = true
      this.log(`[clipboard] store write failed: ${error instanceof Error ? error.message : String(error)}`)
    })
    this.chain = run
    return run
  }

  private async writeAtomic(file: string, content: string): Promise<void> {
    this.ensureDir()
    const tmp = `${file}.${process.pid}.tmp`
    await fsp.writeFile(tmp, content, 'utf8')
    await fsp.rename(tmp, file)
  }
}
