import { useEffect, useMemo, useRef, useState } from 'react'
import { AppWindow, Bot, Files, Globe, Image, Pencil, Search, Star, Terminal } from 'lucide-react'
import type { ClipSummary, ClipsListing } from '@shared/types'
import { appLabel, fromSource, inGroup, orderFavorites, sizeLabel, sourceLabel } from '@shared/clips.mjs'
import { fuzzyScore } from '@shared/palette.mjs'
import { tid } from '../testid'

/** How many rows the enter animation staggers (Beautiful UI: 20 ms each, at most 8). */
const STAGGER_ROWS = 8

function ago(at: number, now: number): string {
  const s = Math.max(0, Math.round((now - at) / 1000))
  if (s < 60) return 'now'
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.round(m / 60)
  if (h < 48) return `${h}h`
  return `${Math.round(h / 24)}d`
}

function Glyph({ clip }: { clip: ClipSummary }) {
  const cls = 'picker-ic'
  if (clip.kind === 'image') return <Image className={cls} strokeWidth={2} />
  if (clip.kind === 'files') return <Files className={cls} strokeWidth={2} />
  switch (clip.source.kind) {
    case 'chrome': return <Globe className={cls} strokeWidth={2} />
    case 'terminal': return <Terminal className={cls} strokeWidth={2} />
    case 'agent': return <Bot className={cls} strokeWidth={2} />
    case 'manual': return <Pencil className={cls} strokeWidth={2} />
    default: return <AppWindow className={cls} strokeWidth={2} />
  }
}

type Chip = { id: string; label: string; count: number; dot?: string }

/**
 * The quick picker (PRD §5.3, design note § Quick picker): Bencho's command
 * bar shape — a 28px panel with a pill search — over Beautiful UI's search
 * results: favorites pinned first, then recent, filter chips, one gliding
 * highlight, a kbd footer. Enter pastes into the window the picker opened
 * over, Shift+Enter copies only, Alt+1–3 take a favorite, Escape closes.
 * It reads the same list as the Clipboard pane through IPC and re-reads on
 * `clips:changed`; nothing is held per window.
 */
export function Picker() {
  const [listing, setListing] = useState<ClipsListing | null>(null)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('all')
  const [active, setActive] = useState(0)
  const [open, setOpen] = useState(false)
  const [origin, setOrigin] = useState('top left')
  const [notice, setNotice] = useState<string | null>(null)
  const [thumbs, setThumbs] = useState<Map<string, string>>(new Map())
  const [now, setNow] = useState(Date.now())
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const [glide, setGlide] = useState<{ top: number; height: number } | null>(null)

  const refresh = async () => {
    try {
      setListing(await window.picker.listClips())
      setNow(Date.now())
    } catch { /* main is not there yet */ }
  }

  useEffect(() => {
    void refresh()
    const offChanged = window.picker.onClipsChanged(() => { void refresh() })
    const offPhase = window.picker.onPhase((phase, corner) => {
      if (phase === 'enter') {
        if (corner) setOrigin(corner)
        setQuery('')
        setFilter('all')
        setActive(0)
        setNotice(null)
        void refresh()
        requestAnimationFrame(() => { setOpen(true); inputRef.current?.focus() })
      } else {
        setOpen(false)
      }
    })
    const offNotice = window.picker.onNotice((text) => setNotice(text))
    return () => { offChanged(); offPhase(); offNotice() }
  }, [])

  const clips = listing?.clips ?? []
  const groups = listing?.groups ?? []
  const favorites = useMemo(() => orderFavorites(clips, listing?.favoritesOrder ?? []), [clips, listing?.favoritesOrder])

  const chips = useMemo<Chip[]>(() => {
    const out: Chip[] = [{ id: 'all', label: 'All', count: clips.length }]
    if (favorites.length) out.push({ id: 'favorites', label: '★', count: favorites.length })
    for (const g of groups) {
      const n = clips.filter((c) => c.groups.includes(g)).length
      if (n) out.push({ id: g, label: g, count: n, dot: `hsl(${[...g].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 0) % 7 * 51 + 18} 60% 62%)` })
    }
    for (const [id, label] of [['src:terminal', 'panes'], ['src:chrome', 'browser'], ['src:agent', 'agents']] as const) {
      const n = clips.filter((c) => c.source.kind === id.slice(4)).length
      if (n) out.push({ id, label, count: n })
    }
    return out
  }, [clips, favorites, groups])

  const rows = useMemo(() => {
    let list = clips
    if (filter === 'favorites') list = favorites
    else if (filter.startsWith('src:')) list = list.filter((c) => fromSource(c, filter.slice(4)))
    else if (filter !== 'all') list = list.filter((c) => inGroup(c, filter))
    else {
      // Favorites pinned on top, then everything else newest first.
      const favIds = new Set(favorites.map((c) => c.id))
      list = [...favorites, ...list.filter((c) => !favIds.has(c.id))]
    }
    const q = query.trim()
    if (!q) return list.slice(0, 200)
    const scored: { c: ClipSummary; s: number }[] = []
    for (const c of list) {
      const s = fuzzyScore(q, `${c.title} ${c.preview}`)
      if (s !== null) scored.push({ c, s })
    }
    scored.sort((a, b) => b.s - a.s || b.c.copiedAt - a.c.copiedAt)
    return scored.slice(0, 200).map((x) => x.c)
  }, [clips, favorites, filter, query])

  useEffect(() => { setActive(0) }, [query, filter])
  useEffect(() => {
    const row = listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)
    if (!row) { setGlide(null); return }
    row.scrollIntoView({ block: 'nearest' })
    setGlide({ top: row.offsetTop, height: row.offsetHeight })
  }, [active, rows])

  useEffect(() => {
    const missing = rows.filter((c) => c.kind === 'image' && !thumbs.has(c.id)).slice(0, 30)
    if (!missing.length) return
    let live = true
    void Promise.all(missing.map(async (c) => [c.id, await window.picker.clipImage(c.id)] as const)).then((pairs) => {
      if (!live) return
      setThumbs((prev) => { const next = new Map(prev); for (const [id, url] of pairs) if (url) next.set(id, url); return next })
    })
    return () => { live = false }
  }, [rows, thumbs])

  const pick = (clip: ClipSummary | undefined, mode: 'paste' | 'copy') => {
    if (!clip) return
    setNotice(null)
    window.picker.pick(clip.id, mode)
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') setActive((i) => Math.min(i + 1, Math.max(0, rows.length - 1)))
    else if (e.key === 'ArrowUp') setActive((i) => Math.max(i - 1, 0))
    else if (e.key === 'Enter') pick(rows[active], e.shiftKey ? 'copy' : 'paste')
    else if (e.key === 'Escape') window.picker.close()
    else if (e.altKey && /^[1-3]$/.test(e.key)) pick(favorites[Number(e.key) - 1], 'paste')
    else if (e.key === 'Tab') {
      const at = chips.findIndex((c) => c.id === filter)
      const next = chips[(at + (e.shiftKey ? chips.length - 1 : 1)) % chips.length]
      if (next) setFilter(next.id)
    } else return
    e.preventDefault()
    e.stopPropagation()
  }

  return (
    <div className="picker-root" onPointerDown={(e) => { if (e.target === e.currentTarget) window.picker.close() }} data-testid="picker-root">
      <div className={`picker ${open ? 'is-open' : ''}`} style={{ transformOrigin: origin }} onKeyDown={onKeyDown} data-testid="picker">
        <div className="picker-search">
          <Search className="picker-search-ic" strokeWidth={2} />
          <input
            ref={inputRef}
            className="picker-input"
            value={query}
            placeholder="Paste what?"
            spellCheck={false}
            autoComplete="off"
            onChange={(e) => setQuery(e.target.value)}
            data-testid="picker-search"
          />
          <span className="picker-count">{rows.length}</span>
        </div>
        <div className="picker-chips" role="tablist">
          {chips.map((chip) => (
            <button
              key={chip.id}
              role="tab"
              aria-selected={filter === chip.id}
              className={`picker-chip ${filter === chip.id ? 'is-active' : ''}`}
              onClick={() => { setFilter(chip.id); inputRef.current?.focus() }}
              data-testid={tid('picker-chip', chip.id)}
            >
              {chip.dot && <span className="clip-dot" style={{ background: chip.dot }} />}
              {chip.id === 'favorites' ? <Star className="picker-chip-star" strokeWidth={2} /> : chip.label}
              <span className="picker-chip-n">{chip.count}</span>
            </button>
          ))}
        </div>
        <div className="picker-list" ref={listRef} role="listbox" data-testid="picker-list">
          {glide && <div className="picker-glide" style={{ top: glide.top, height: glide.height }} />}
          {rows.map((c, index) => {
            const favAt = favorites.findIndex((f) => f.id === c.id)
            const thumb = c.kind === 'image' ? thumbs.get(c.id) : undefined
            return (
              <div
                key={c.id}
                role="option"
                aria-selected={index === active}
                data-index={index}
                className={`picker-row ${index === active ? 'is-active' : ''}`}
                style={{ animationDelay: `${Math.min(index, STAGGER_ROWS) * 20}ms` }}
                onMouseMove={() => { if (index !== active) setActive(index) }}
                onClick={(e) => pick(c, e.shiftKey ? 'copy' : 'paste')}
                data-testid={tid('picker-row', c.id)}
              >
                {thumb ? <img className="picker-thumb" src={thumb} alt="" draggable={false} /> : <Glyph clip={c} />}
                <span className="picker-title">{c.title || '(blank)'}</span>
                <span className="picker-meta">{[sourceLabel(c.source) || appLabel(c.source.exe), c.bytes >= 4096 ? sizeLabel(c.bytes) : null].filter(Boolean).join(' · ')}</span>
                <span className="picker-when">{ago(c.copiedAt, now)}</span>
                {favAt >= 0 && favAt < 3 && <kbd className="picker-favkey">Alt+{favAt + 1}</kbd>}
                {c.favorite && favAt >= 3 && <Star className="picker-star" strokeWidth={2} />}
              </div>
            )
          })}
          {rows.length === 0 && (
            <div className="picker-empty">{clips.length === 0 ? 'Nothing copied yet.' : `No clips match “${query.trim()}”`}</div>
          )}
        </div>
        {notice && <div className="picker-notice" role="status" data-testid="picker-notice">{notice}</div>}
        <div className="picker-foot">
          <span><kbd>↵</kbd> paste</span>
          <span><kbd>⇧</kbd><kbd>↵</kbd> copy only</span>
          <span><kbd>Alt</kbd><kbd>1–3</kbd> favorites</span>
          <span><kbd>Tab</kbd> filter</span>
          <span><kbd>Esc</kbd> close</span>
        </div>
      </div>
    </div>
  )
}
