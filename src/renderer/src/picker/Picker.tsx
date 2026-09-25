import { useEffect, useMemo, useRef, useState } from 'react'
import { AppWindow, Bot, Check, ClipboardPaste, Copy, Download, Files, Globe, Image, Layers, Pencil, Search, Star, Terminal, Trash2, Type } from 'lucide-react'
import type { ClipSummary, ClipsListing } from '@shared/types'
import { fromSource, inGroup, orderFavorites, sizeLabel } from '@shared/clips.mjs'
import { fuzzyScore } from '@shared/palette.mjs'
import { isPickerFavoriteModifier, modifierLabel } from '@shared/hotkeys.mjs'
import { ContextMenu, tidyEntries, type ContextEntry } from '../ContextMenu'
import { FilterChips } from '../clipboard/FilterChips'
import { SourceCell } from '../clipboard/SourceCell'
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

/** A group's dot colour, the same hue the Clipboard pane gives it. */
function groupDot(name: string): string {
  return `hsl(${[...name].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 0) % 7 * 51 + 18} 60% 62%)`
}

type Chip = { id: string; label: string; count: number; dot?: string; star?: boolean }

/**
 * The quick picker (PRD §5.3, design note § Quick picker): Bencho's command
 * bar shape — a 28px panel with a pill search — over Beautiful UI's search
 * results laid out as a table (star · kind · clip · source · when · key),
 * newest first in every view, filter chips with count badges and a search
 * that opens from a circle at the end of the chip row, one gliding
 * highlight, no hint footer. A click selects a row; Enter or a double-click
 * pastes into the window the picker opened over, Shift+Enter copies only,
 * Alt+1–3 (or Ctrl+1–3, Settings → Keyboard shortcuts) take a favorite,
 * Escape collapses an open search, then closes. Each row has a star and
 * the shared right-click menu; F2 renames a row in place, Edit text opens an
 * editor inside the card. It reads the same list as the Clipboard pane
 * through IPC and re-reads on `clips:changed`; nothing is held per window.
 */
export function Picker() {
  const [listing, setListing] = useState<ClipsListing | null>(null)
  const [query, setQuery] = useState('')
  /** The search field is a circle at the end of the chip row until clicked or typed into. */
  const [searchOpen, setSearchOpen] = useState(false)
  const [filter, setFilter] = useState('all')
  const [active, setActive] = useState(0)
  const [open, setOpen] = useState(false)
  const [origin, setOrigin] = useState('top left')
  const [notice, setNotice] = useState<string | null>(null)
  const [thumbs, setThumbs] = useState<Map<string, string>>(new Map())
  const [now, setNow] = useState(Date.now())
  /** The favorite keys' modifier, as main sent it with the last open. */
  const [favMod, setFavMod] = useState<'Alt' | 'Control'>('Alt')
  /** The row menu, at the right-click point. */
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null)
  /** A row whose title is being renamed in place (F2 or the menu). */
  const [renaming, setRenaming] = useState<{ id: string; value: string; placeholder: string } | null>(null)
  /** Edit text: the full body of one text clip in an editor over the list. */
  const [editing, setEditing] = useState<{ id: string; title: string; text: string; saving?: boolean } | null>(null)
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
    const offPhase = window.picker.onPhase((phase, corner, modifier) => {
      if (phase === 'enter') {
        if (corner) setOrigin(corner)
        if (isPickerFavoriteModifier(modifier)) setFavMod(modifier as 'Alt' | 'Control')
        setQuery('')
        setFilter('all')
        setActive(0)
        setNotice(null)
        setMenu(null)
        setRenaming(null)
        setEditing(null)
        void refresh()
        requestAnimationFrame(() => { setOpen(true); inputRef.current?.focus() })
      } else {
        setOpen(false)
        setMenu(null)
      }
    })
    const offNotice = window.picker.onNotice((text) => setNotice(text))
    return () => { offChanged(); offPhase(); offNotice() }
  }, [])

  const clips = listing?.clips ?? []
  const groups = listing?.groups ?? []
  const favorites = useMemo(() => orderFavorites(clips, listing?.favoritesOrder ?? []), [clips, listing?.favoritesOrder])
  const byId = useMemo(() => new Map(clips.map((c) => [c.id, c])), [clips])

  const chips = useMemo<Chip[]>(() => {
    const out: Chip[] = [{ id: 'all', label: 'All', count: clips.length }]
    if (favorites.length) out.push({ id: 'favorites', label: 'Favorites', count: favorites.length, star: true })
    for (const g of groups) {
      const n = clips.filter((c) => c.groups.includes(g)).length
      if (n) out.push({ id: g, label: g, count: n, dot: groupDot(g) })
    }
    for (const [id, label] of [['src:terminal', 'Panes'], ['src:chrome', 'Browser'], ['src:agent', 'Agents']] as const) {
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
    // All is newest first, favorites included in their place — the ★ chip is where they pin.
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

  // ---- row edits: stay open, the list re-reads on clips:changed ----
  // Back to the search field — unless a rename field or the editor took focus
  // (the menu's close runs right after "Rename title" opened one).
  const refocus = () => requestAnimationFrame(() => { if (!document.querySelector('[data-escape-close]')) inputRef.current?.focus() })
  const star = (clip: ClipSummary) => {
    void window.picker.updateClip(clip.id, { favorite: !clip.favorite }).then((ok) => { if (!ok) setNotice('That clip is gone') })
  }
  const toggleGroup = (clip: ClipSummary, name: string) => {
    const next = clip.groups.includes(name) ? clip.groups.filter((g) => g !== name) : [...clip.groups, name]
    void window.picker.updateClip(clip.id, { groups: next })
  }
  const remove = (clip: ClipSummary) => {
    void window.picker.deleteClips([clip.id]).then((n) => { if (!n) setNotice('Nothing was deleted') })
    refocus()
  }
  const startRename = (clip: ClipSummary | undefined) => {
    if (!clip) return
    setMenu(null)
    setRenaming({ id: clip.id, value: clip.custom ? clip.title : '', placeholder: clip.title })
  }
  const commitRename = () => {
    const r = renaming
    if (!r) return
    setRenaming(null)
    const clip = byId.get(r.id)
    const title = r.value.trim()
    // An emptied title goes back to the automatic one; an unchanged one is not written.
    if (clip && (title ? title !== clip.title || !clip.custom : clip.custom)) void window.picker.updateClip(r.id, { title: title || null })
    refocus()
  }
  const startEdit = async (clip: ClipSummary | undefined) => {
    if (!clip || clip.kind !== 'text') return
    setMenu(null)
    const body = await window.picker.clipText(clip.id)
    if (!body) { setNotice('That clip is gone'); return }
    setEditing({ id: clip.id, title: clip.title, text: body.text })
  }
  const saveEdit = async () => {
    const ed = editing
    if (!ed || ed.saving) return
    if (!ed.text.trim()) { setNotice('A clip cannot be empty — delete it instead'); return }
    setEditing({ ...ed, saving: true })
    const ok = await window.picker.updateClip(ed.id, { text: ed.text })
    if (!ok) { setNotice('Could not save the edit'); setEditing({ ...ed, saving: false }); return }
    setEditing(null)
    refocus()
  }
  const cancelEdit = () => { setEditing(null); refocus() }

  const menuEntries = (clip: ClipSummary): ContextEntry[] => tidyEntries([
    { kind: 'item', id: 'paste', label: 'Paste', icon: <ClipboardPaste />, keys: ['↵'], onSelect: () => pick(clip, 'paste') },
    { kind: 'item', id: 'copy', label: 'Copy', icon: <Copy />, keys: ['⇧', '↵'], onSelect: () => pick(clip, 'copy') },
    { kind: 'item', id: 'star', label: clip.favorite ? 'Unstar' : 'Star', icon: <Star />, onSelect: () => { star(clip); refocus() } },
    { kind: 'sep' },
    { kind: 'item', id: 'rename', label: clip.custom ? 'Rename title' : 'Give it a title', icon: <Pencil />, keys: ['F2'], onSelect: () => startRename(clip) },
    clip.kind === 'text' && { kind: 'item', id: 'edit', label: 'Edit text', icon: <Type />, onSelect: () => void startEdit(clip) },
    {
      kind: 'submenu', id: 'groups', label: 'Add to group', icon: <Layers />,
      disabled: !groups.length, hint: groups.length ? undefined : 'Make groups in the Clipboard pane',
      entries: groups.map((g): ContextEntry => ({
        kind: 'item', id: `group:${g}`, label: g, keepOpen: true,
        icon: clip.groups.includes(g) ? <Check /> : <span className="clip-dot" style={{ background: groupDot(g) }} />,
        onSelect: () => toggleGroup(clip, g)
      }))
    },
    { kind: 'sep' },
    { kind: 'item', id: 'delete', label: 'Delete', icon: <Trash2 />, onSelect: () => remove(clip) }
  ])

  /** 1–3 when the key is the favorite modifier plus a digit (and nothing else), else 0. By code: Digit1 on any layout. */
  const favoriteKey = (e: React.KeyboardEvent): number => {
    const held = favMod === 'Alt' ? e.altKey && !e.ctrlKey : e.ctrlKey && !e.altKey
    const digit = /^Digit([1-3])$/.exec(e.code)
    return held && !e.shiftKey && !e.metaKey && digit ? Number(digit[1]) : 0
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    // A menu, the rename field or the text editor owns the keyboard while it
    // is open — Escape closes *it*, not the picker (App's rule, in this window).
    const owner = document.querySelector('[data-escape-close]')
    if (owner) {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        owner.dispatchEvent(new CustomEvent('tm-escape'))
      }
      return
    }
    if (e.key === 'ArrowDown') setActive((i) => Math.min(i + 1, Math.max(0, rows.length - 1)))
    else if (e.key === 'ArrowUp') setActive((i) => Math.max(i - 1, 0))
    else if (e.key === 'Enter') pick(rows[active], e.shiftKey ? 'copy' : 'paste')
    else if (e.key === 'Escape') {
      // An open search collapses first (clearing what was typed); the next Escape closes the picker.
      if (query || searchOpen) { setQuery(''); setSearchOpen(false) } else window.picker.close()
    }
    else if (e.key === 'F2') startRename(rows[active])
    else if (favoriteKey(e)) pick(favorites[favoriteKey(e) - 1], 'paste')
    else if (e.key === 'Tab') {
      const at = chips.findIndex((c) => c.id === filter)
      const next = chips[(at + (e.shiftKey ? chips.length - 1 : 1)) % chips.length]
      if (next) setFilter(next.id)
    } else return
    e.preventDefault()
    e.stopPropagation()
  }

  // The rename field and the editor carry data-escape-close; Escape reaches them as tm-escape.
  const renameRef = useRef<HTMLInputElement>(null)
  const editorRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = renameRef.current
    if (!el) return
    const esc = () => { setRenaming(null); refocus() }
    el.addEventListener('tm-escape', esc)
    return () => el.removeEventListener('tm-escape', esc)
  }, [renaming?.id])
  useEffect(() => {
    const el = editorRef.current
    if (!el) return
    const esc = () => cancelEdit()
    el.addEventListener('tm-escape', esc)
    return () => el.removeEventListener('tm-escape', esc)
  }, [editing?.id])

  const menuClip = menu ? byId.get(menu.id) : undefined
  const modKey = modifierLabel(favMod)

  return (
    <div className="picker-root" onPointerDown={(e) => { if (e.target === e.currentTarget) window.picker.close() }} data-testid="picker-root">
      <div
        className={`picker ${open ? 'is-open' : ''}`}
        style={{ transformOrigin: origin }}
        onKeyDown={onKeyDown}
        // A press on a row, a header or the card's padding must not take focus
        // off the search field (the keys live on this card; a focused <body>
        // would leave them dead). Fields and buttons still take it.
        onMouseDown={(e) => { if (!(e.target as HTMLElement).closest('input, textarea, button')) e.preventDefault() }}
        data-menu-host=""
        data-testid="picker"
      >
        <div className="picker-top">
          <FilterChips
            chips={chips.map((c) => ({ ...c, active: filter === c.id }))}
            onPick={(chip) => { setFilter(chip.id); inputRef.current?.focus() }}
            testPrefix="picker-chip"
          />
          {/* The search: a circle after the chips that opens on click, or as soon as you type. */}
          <div className={`picker-search ${searchOpen || query ? 'is-open' : ''}`} data-testid="picker-search-wrap">
            <button
              className="picker-search-btn"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => { setSearchOpen((v) => (v && !query ? false : true)); inputRef.current?.focus() }}
              title="Search"
              aria-label="Search"
              aria-expanded={searchOpen || !!query}
              data-testid="picker-search-toggle"
            >
              <Search strokeWidth={2} />
            </button>
            <input
              ref={inputRef}
              className="picker-input"
              value={query}
              aria-label="Search clips"
              spellCheck={false}
              autoComplete="off"
              onChange={(e) => { setQuery(e.target.value); if (e.target.value) setSearchOpen(true) }}
              data-testid="picker-search"
            />
          </div>
          <button className="picker-keys" onClick={() => window.picker.openKeySettings()} title="Keyboard shortcuts (Settings)" data-testid="picker-keys">keys</button>
        </div>
        <div className="picker-list" ref={listRef} role="listbox" aria-label="Clips" data-testid="picker-list">
          <div className="picker-head">
            <span />
            <span />
            <span>Clip</span>
            <span>Source</span>
            <span className="picker-head-when">When</span>
            <span className="picker-head-key">
              <button
                className="picker-head-btn"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => { void window.picker.exportClips() }}
                title="Save the history as JSON"
                aria-label="Save the history as JSON"
                data-testid="picker-export"
              >
                <Download strokeWidth={2} />
              </button>
            </span>
          </div>
          {glide && <div className="picker-glide" style={{ top: glide.top, height: glide.height }} />}
          {rows.map((c, index) => {
            const favAt = favorites.findIndex((f) => f.id === c.id)
            const thumb = c.kind === 'image' ? thumbs.get(c.id) : undefined
            const isRenaming = renaming?.id === c.id
            return (
              <div
                key={c.id}
                role="option"
                aria-selected={index === active}
                data-index={index}
                className={`picker-row ${index === active ? 'is-active' : ''} ${menu?.id === c.id ? 'is-menu' : ''}`}
                style={{ animationDelay: `${Math.min(index, STAGGER_ROWS) * 20}ms` }}
                onMouseMove={() => { if (index !== active) setActive(index) }}
                // A click only selects the row; Enter, a double-click or the menu paste it.
                onClick={() => { if (!isRenaming) setActive(index) }}
                onDoubleClick={(e) => { if (!isRenaming) pick(c, e.shiftKey ? 'copy' : 'paste') }}
                onContextMenu={(e) => { e.preventDefault(); setActive(index); setMenu({ id: c.id, x: e.clientX, y: e.clientY }) }}
                data-testid={tid('picker-row', c.id)}
              >
                <button
                  className={`picker-star ${c.favorite ? 'is-on' : ''}`}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={(e) => { e.stopPropagation(); star(c) }}
                  onDoubleClick={(e) => e.stopPropagation()}
                  title={c.favorite ? 'Unstar' : 'Star'}
                  aria-label={c.favorite ? 'Unstar' : 'Star'}
                  aria-pressed={c.favorite}
                  tabIndex={-1}
                  data-testid={tid('picker-star', c.id)}
                >
                  <Star strokeWidth={2} />
                </button>
                <span className="picker-cell-ic">{thumb ? <img className="picker-thumb" src={thumb} alt="" draggable={false} /> : <Glyph clip={c} />}</span>
                {isRenaming ? (
                  <input
                    ref={renameRef}
                    autoFocus
                    className="picker-title-input"
                    value={renaming.value}
                    placeholder={renaming.placeholder}
                    spellCheck={false}
                    data-escape-close=""
                    onChange={(e) => setRenaming({ ...renaming, value: e.target.value })}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); commitRename() }
                      else if (e.key !== 'Escape') e.stopPropagation()
                    }}
                    onBlur={commitRename}
                    onClick={(e) => e.stopPropagation()}
                    data-testid="picker-title-input"
                  />
                ) : (
                  <span className={`picker-title ${c.custom ? 'is-custom' : ''}`} title={c.preview || c.title}>{c.title || '(blank)'}</span>
                )}
                <SourceCell clip={c} extras={c.bytes >= 4096 ? [sizeLabel(c.bytes)] : []} className="picker-source" />
                <span className="picker-when">{ago(c.copiedAt, now)}</span>
                <span className="picker-key">{favAt >= 0 && favAt < 3 && <kbd className="picker-favkey">{modKey}+{favAt + 1}</kbd>}</span>
              </div>
            )
          })}
          {rows.length === 0 && (
            <div className="picker-empty">{clips.length === 0 ? 'Nothing copied yet.' : `No clips match “${query.trim()}”`}</div>
          )}
        </div>
        {editing && (
          <div className="picker-editor" ref={editorRef} data-escape-close="" role="dialog" aria-label="Edit text" data-testid="picker-editor">
            <div className="picker-editor-head">
              <Type className="picker-ic" strokeWidth={2} />
              <span className="picker-editor-title">{editing.title || 'Edit text'}</span>
              <span className="picker-editor-n">{editing.text.length.toLocaleString()} chars</span>
            </div>
            <textarea
              autoFocus
              className="picker-editor-text"
              value={editing.text}
              spellCheck={false}
              onChange={(e) => setEditing({ ...editing, text: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && e.ctrlKey) { e.preventDefault(); e.stopPropagation(); void saveEdit() }
                else if (e.key !== 'Escape') e.stopPropagation()
              }}
              data-testid="picker-editor-text"
            />
            <div className="picker-editor-foot">
              <span className="picker-editor-grow" />
              <button className="picker-btn" onClick={cancelEdit} data-testid="picker-editor-cancel">Cancel</button>
              <button className="picker-btn is-primary" disabled={editing.saving} onClick={() => void saveEdit()} data-testid="picker-editor-save">Save</button>
            </div>
          </div>
        )}
        {notice && <div className="picker-notice" role="status" data-testid="picker-notice">{notice}</div>}
        {menu && menuClip && (
          <ContextMenu
            x={menu.x}
            y={menu.y}
            entries={menuEntries(menuClip)}
            onClose={() => { setMenu(null); refocus() }}
            testId="picker-menu"
          />
        )}
      </div>
    </div>
  )
}
