import { useEffect, useMemo, useRef, useState } from 'react'
import { AppWindow, Bot, Check, Clipboard, ClipboardPaste, Copy, Download, Files, Globe, Image, Keyboard, Layers, MousePointerClick, Pencil, Scaling, Search, SquarePen, Star, Terminal, Trash2, X } from 'lucide-react'
import type { ClipSummary, ClipsListing } from '@shared/types'
import { chordLabel, fromSource, inGroup, orderFavorites, sizeLabel } from '@shared/clips.mjs'
import { fuzzyScore } from '@shared/palette.mjs'
import { isPickerFavoriteModifier, modifierLabel } from '@shared/hotkeys.mjs'
import { ContextMenu, tidyEntries, type ContextEntry } from '../ContextMenu'
import { FilterChips } from '../clipboard/FilterChips'
import { SourceCell } from '../clipboard/SourceCell'
import { ClipEditCard } from '../clipboard/ClipEditCard'
import { gripAt, useClipColumns } from '../clipboard/ClipColumns'
import { tid } from '../testid'
import { MenuItem, MenuPop } from '../Menu'
import mark from '../assets/icon.png'

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

type Chip = { id: string; label: string; count: number; dot?: string; star?: boolean; icon?: React.ReactNode }

/**
 * A resize grip on the card's right edge, bottom edge or corner (a
 * transparent frameless window has no OS border — the workspace's EdgeGrip
 * rule). It reports the pointer's travel since pointer-down, at most once
 * per animation frame; main clamps it and moves the window, and remembers
 * the size on release. The card follows the window, so nothing here sizes it.
 */
function ResizeGrip({ edge, onEnd }: { edge: 'right' | 'bottom' | 'corner'; onEnd: () => void }) {
  const drag = useRef<{ x: number; y: number; frame: number; dw: number; dh: number } | null>(null)
  const flush = () => {
    const d = drag.current
    if (!d) return
    d.frame = 0
    window.picker.resize(edge === 'bottom' ? 0 : d.dw, edge === 'right' ? 0 : d.dh)
  }
  const end = () => {
    const d = drag.current
    if (!d) return
    if (d.frame) { cancelAnimationFrame(d.frame); flush() }
    drag.current = null
    window.picker.resizeEnd()
    onEnd()
  }
  return (
    <div
      className={`picker-grip picker-grip--${edge}`}
      aria-hidden
      title="Drag to resize — Keys → Reset size puts it back"
      data-testid={`picker-grip-${edge}`}
      onPointerDown={(e) => {
        if (e.button !== 0) return
        e.preventDefault()
        e.stopPropagation()
        drag.current = { x: e.screenX, y: e.screenY, frame: 0, dw: 0, dh: 0 }
        try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* a synthetic pointer has no capture; the move still tracks */ }
      }}
      onPointerMove={(e) => {
        const d = drag.current
        if (!d) return
        d.dw = e.screenX - d.x
        d.dh = e.screenY - d.y
        if (!d.frame) d.frame = requestAnimationFrame(flush)
      }}
      onPointerUp={(e) => {
        if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
        end()
      }}
      onPointerCancel={end}
      onLostPointerCapture={end}
    />
  )
}

/**
 * The quick picker (PRD §5.3, design note § Quick picker): Bencho's command
 * bar shape — a 28px panel with a pill search — over Beautiful UI's search
 * results laid out as a table (star · kind · clip · source · when · key),
 * newest first in every view, filter chips with count badges and a search
 * that opens from a circle at the end of the chip row, one gliding
 * highlight, no hint footer. A click selects a row and copies it (a Copied
 * flash; the picker stays open); Enter or a double-click pastes into the
 * window the picker opened over, Shift+Enter copies only,
 * Alt+1–3 (or Ctrl+1–3, Settings → Keyboard shortcuts) take a favorite,
 * Escape collapses an open search, then closes. Each row has a star and
 * the shared right-click menu (Edit… first); F2 renames a row in place, Edit…
 * opens the edit card (title, text, note, expansion code, keybind) inside the
 * card; the header's grips resize the columns (`tm.clipcols.v1`, picker
 * bucket). It reads the same list as the Clipboard pane through IPC and
 * re-reads on `clips:changed`; nothing is held per window.
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
  /** The card size is a remembered one (resized by its grips): Keys → Reset size is live. */
  const [customSize, setCustomSize] = useState(false)
  /** The menu bar's open dropdown (one at a time, like App's `openMenu`). */
  const [openMenu, setOpenMenu] = useState<'clips' | 'keys' | null>(null)
  /** The row menu, at the right-click point. */
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null)
  /** A row whose title is being renamed in place (F2 or the menu). */
  const [renaming, setRenaming] = useState<{ id: string; value: string; placeholder: string } | null>(null)
  /** Edit…: the edit card for one clip, over the list. */
  const [editing, setEditing] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const headRef = useRef<HTMLDivElement>(null)
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
    const offPhase = window.picker.onPhase((phase, corner, modifier, custom) => {
      if (phase === 'enter') {
        setCustomSize(custom === true)
        if (corner) setOrigin(corner)
        if (isPickerFavoriteModifier(modifier)) setFavMod(modifier as 'Alt' | 'Control')
        setQuery('')
        frozen.current = new Map()
        // The listing on screen is from the last open: freeze only what the re-read below brings.
        staleListing.current = listingRef.current
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
        setOpenMenu(null)
        setFlash(null)
        followId.current = null
        // Unmounting the edit card also ends a Keybind Record (the global chords come back).
        setEditing(null)
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
    // The pane's built-in order: All · Favorites · Images, then groups and sources.
    const images = clips.filter((c) => c.kind === 'image').length
    if (images) out.push({ id: 'images', label: 'Images', count: images, icon: <Image strokeWidth={2} /> })
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

  /**
   * Rows never move under the pointer while the picker is open: each view's
   * order is frozen the first time it is listed on this open (a click copies,
   * which makes that clip the newest — it must stay where it was clicked).
   * A clip that is genuinely new (not in the frozen order) goes on top and
   * joins it. Cleared on every open, so the reorder shows next time.
   */
  const frozen = useRef(new Map<string, string[]>())
  const listingRef = useRef(listing)
  listingRef.current = listing
  const staleListing = useRef<ClipsListing | null>(null)
  const rows = useMemo(() => {
    let list = clips
    if (filter === 'favorites') list = favorites
    else if (filter.startsWith('src:')) list = list.filter((c) => fromSource(c, filter.slice(4)))
    else if (filter !== 'all') list = list.filter((c) => inGroup(c, filter))
    // All is newest first, favorites included in their place — the ★ chip is where they pin.
    const q = query.trim()
    if (!q) {
      if (!listing) return []
      if (listing === staleListing.current) return list.slice(0, 200)
      const was = frozen.current.get(filter)
      if (was) {
        const at = new Map(was.map((id, i) => [id, i]))
        const fresh = list.filter((c) => !at.has(c.id))
        const kept = list.filter((c) => at.has(c.id)).sort((a, b) => at.get(a.id)! - at.get(b.id)!)
        list = [...fresh, ...kept]
      }
      // Recording the order is the point of the memo here, not a side effect to avoid.
      frozen.current.set(filter, list.map((c) => c.id))
      return list.slice(0, 200)
    }
    const scored: { c: ClipSummary; s: number }[] = []
    for (const c of list) {
      const s = fuzzyScore(q, [c.title, c.shortcut, c.note, c.preview].filter(Boolean).join(' '))
      if (s !== null) scored.push({ c, s })
    }
    scored.sort((a, b) => b.s - a.s || b.c.copiedAt - a.c.copiedAt)
    return scored.slice(0, 200).map((x) => x.c)
  }, [clips, favorites, filter, query, listing])

  const cols = useClipColumns('picker', headRef, useMemo(() => rows.flatMap((c) => (c.hotkey ? [chordLabel(c.hotkey)] : [])), [rows]))
  useEffect(() => { setActive(0) }, [query, filter])
  // A click copies, and the copy is the newest clip, so the list re-reads with
  // that row moved to the top: the highlight follows the clip, not the index.
  const followId = useRef<string | null>(null)
  useEffect(() => {
    const id = followId.current
    if (!id) return
    const at = rows.findIndex((c) => c.id === id)
    if (at >= 0) setActive(at)
  }, [rows])
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

  /** A single click: onto the clipboard (the picker stays open, nothing is pasted) and a short Copied flash on the row. */
  const [flash, setFlash] = useState<{ id: string; n: number } | null>(null)
  const flashTimer = useRef(0)
  /** The clip a click copied: a double-click that follows pastes *it*, even if the re-read moved the rows under the pointer. */
  const lastClick = useRef<{ id: string; at: number } | null>(null)
  const clickCopy = (clip: ClipSummary, index: number) => {
    setActive(index)
    followId.current = clip.id
    lastClick.current = { id: clip.id, at: Date.now() }
    setNotice(null)
    void window.picker.copyClip(clip.id).then((ok) => {
      if (!ok) { setNotice('That clip is gone'); return }
      setFlash((f) => ({ id: clip.id, n: (f?.n ?? 0) + 1 }))
      window.clearTimeout(flashTimer.current)
      flashTimer.current = window.setTimeout(() => setFlash(null), 1200)
    })
  }
  useEffect(() => () => window.clearTimeout(flashTimer.current), [])

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
  const startEdit = (clip: ClipSummary | undefined) => {
    if (!clip) return
    setMenu(null)
    setRenaming(null)
    setEditing(clip.id)
  }
  const closeEdit = () => { setEditing(null); refocus() }

  const menuEntries = (clip: ClipSummary): ContextEntry[] => tidyEntries([
    { kind: 'item', id: 'edit', label: 'Edit…', icon: <SquarePen />, onSelect: () => startEdit(clip) },
    { kind: 'sep' },
    { kind: 'item', id: 'paste', label: 'Paste', icon: <ClipboardPaste />, keys: ['↵'], onSelect: () => pick(clip, 'paste') },
    { kind: 'item', id: 'copy', label: 'Copy', icon: <Copy />, keys: ['⇧', '↵'], onSelect: () => pick(clip, 'copy') },
    { kind: 'item', id: 'star', label: clip.favorite ? 'Unstar' : 'Star', icon: <Star />, onSelect: () => { star(clip); refocus() } },
    { kind: 'sep' },
    { kind: 'item', id: 'rename', label: clip.custom ? 'Rename title' : 'Give it a title', icon: <Pencil />, keys: ['F2'], onSelect: () => startRename(clip) },
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

  // The rename field and the edit card carry data-escape-close; Escape reaches them as tm-escape.
  const renameRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    const el = renameRef.current
    if (!el) return
    const esc = () => { setRenaming(null); refocus() }
    el.addEventListener('tm-escape', esc)
    return () => el.removeEventListener('tm-escape', esc)
  }, [renaming?.id])

  // An open menu-bar dropdown carries data-escape-close, so Escape closes it before the picker.
  const menubarRef = useRef<HTMLElement>(null)
  useEffect(() => {
    const el = menubarRef.current
    if (!el || !openMenu) return
    const esc = () => { setOpenMenu(null); refocus() }
    el.addEventListener('tm-escape', esc)
    return () => el.removeEventListener('tm-escape', esc)
  }, [openMenu])
  const runMenu = (action: () => void) => () => { setOpenMenu(null); action(); refocus() }
  const menuButton = (name: 'clips' | 'keys', label: string) => (
    <button
      className={`menu-btn ${openMenu === name ? 'menu-btn--open' : ''}`}
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => setOpenMenu(openMenu === name ? null : name)}
      onMouseEnter={() => { if (openMenu && openMenu !== name) setOpenMenu(name) }}
      aria-expanded={openMenu === name}
      data-testid={tid('menu-btn', name)}
    >
      {label}
    </button>
  )
  const away = { onAway: () => setOpenMenu(null), ignoreSelector: '.picker-menubar' }
  const favLabel = modifierLabel(favMod)

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
        {/* The menu bar: the workspace title bar's brand mark and menus (Menu.tsx), not a restyle. */}
        <header className="titlebar picker-titlebar">
          <nav className="menubar picker-menubar" ref={menubarRef} {...(openMenu ? { 'data-escape-close': '' } : {})} data-testid="picker-menubar">
            <img className="brand-mark" src={mark} alt="" draggable={false} title="TaylorMade Agent Monitor" />
            <div className="menu-wrap">
              {menuButton('clips', 'Clips')}
              {openMenu === 'clips' && (
                <MenuPop {...away}>
                  <MenuItem icon={<Download strokeWidth={2} />} label="Export to JSON…" hint="Writes every clip in the clear to a file you choose" onClick={runMenu(() => { void window.picker.exportClips() })} />
                  <div className="menu-sep" />
                  <MenuItem icon={<Clipboard strokeWidth={2} />} label="Open Clipboard pane" hint="Close the picker and open the workspace on the Clipboard pane" onClick={runMenu(() => window.picker.openClipboardPane())} />
                  <div className="menu-sep" />
                  <MenuItem icon={<X strokeWidth={2} />} label="Close" keys={['Esc']} onClick={runMenu(() => window.picker.close())} />
                </MenuPop>
              )}
            </div>
            <div className="menu-wrap">
              {menuButton('keys', 'Keys')}
              {openMenu === 'keys' && (
                <MenuPop {...away}>
                  <MenuItem icon={<Keyboard strokeWidth={2} />} label="Keyboard shortcuts…" hint="Settings → Keyboard shortcuts: the global chords and the picker's favorite modifier" onClick={runMenu(() => window.picker.openKeySettings())} />
                  <div className="menu-sep" />
                  {/* The picker's own keys, read-only: there is no hint footer. */}
                  <MenuItem icon={<MousePointerClick strokeWidth={2} />} label="Copy" keys={['Click']} disabled onClick={() => {}} />
                  <MenuItem icon={<ClipboardPaste strokeWidth={2} />} label="Paste where you were" keys={['↵']} hint="Also a double-click" disabled onClick={() => {}} />
                  <MenuItem icon={<Copy strokeWidth={2} />} label="Copy and close" keys={['⇧', '↵']} disabled onClick={() => {}} />
                  <MenuItem icon={<Star strokeWidth={2} />} label="Paste a favorite" keys={[favLabel, '1–3']} disabled onClick={() => {}} />
                  <MenuItem icon={<Pencil strokeWidth={2} />} label="Rename" keys={['F2']} disabled onClick={() => {}} />
                  <MenuItem icon={<Layers strokeWidth={2} />} label="Next filter" keys={['Tab']} disabled onClick={() => {}} />
                  <div className="menu-sep" />
                  <MenuItem
                    icon={<Scaling strokeWidth={2} />}
                    label="Reset size"
                    hint={customSize ? 'Back to the default size, now and on the next open' : 'Already the default size — drag an edge or the corner to resize'}
                    disabled={!customSize}
                    onClick={runMenu(() => { window.picker.resetSize(); setCustomSize(false) })}
                  />
                </MenuPop>
              )}
            </div>
          </nav>
        </header>
        <div className="picker-top">
          {/* The search: a circle before the chips that opens on click, or as soon as you type. */}
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
          <FilterChips
            chips={chips.map((c) => ({ ...c, active: filter === c.id }))}
            onPick={(chip) => { setFilter(chip.id); inputRef.current?.focus() }}
            testPrefix="picker-chip"
          />
        </div>
        <div
          className="picker-list"
          ref={listRef}
          role="listbox"
          aria-label="Clips"
          // The header and every row read this one template; the header's grips change it.
          style={{ ['--picker-row-cols' as string]: cols.template }}
          data-testid="picker-list"
        >
          <div className="picker-head" ref={headRef}>
            <span />
            <span />
            <span className="picker-head-cell">Clip{gripAt(cols, 'picker', 2)}</span>
            <span className="picker-head-cell">Source{gripAt(cols, 'picker', 3)}</span>
            <span className="picker-head-cell picker-head-when">When{gripAt(cols, 'picker', 4)}</span>
            <span className="picker-head-key">Key</span>
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
                onMouseMove={() => { if (index !== active) { followId.current = null; setActive(index) } }}
                // A click selects the row and copies it (Copied flash, the picker stays open);
                // Enter, a double-click or the menu paste it back where the picker opened.
                onClick={() => { if (!isRenaming) clickCopy(c, index) }}
                onDoubleClick={(e) => {
                  if (isRenaming) return
                  const last = lastClick.current
                  const clip = last && Date.now() - last.at < 800 ? byId.get(last.id) ?? c : c
                  pick(clip, e.shiftKey ? 'copy' : 'paste')
                }}
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
                  <span className="picker-title-cell">
                    <span className={`picker-title ${c.custom ? 'is-custom' : ''}`} title={[c.preview || c.title, c.note].filter(Boolean).join('\n\n')}>{c.title || '(blank)'}</span>
                    {c.shortcut && <span className="clip-short" title={`Expansion code: type ${c.shortcut} in Chrome`} data-testid={tid('picker-short', c.id)}>{c.shortcut}</span>}
                  </span>
                )}
                <SourceCell clip={c} extras={c.bytes >= 4096 ? [sizeLabel(c.bytes)] : []} className="picker-source" />
                {/* A click's Copied flash takes the when cell's place for 1.2 s. */}
                <span className="picker-when">
                  {flash?.id === c.id
                    ? <span key={flash.n} className="picker-copied" role="status" data-testid="picker-copied"><Check strokeWidth={3} />Copied</span>
                    : ago(c.copiedAt, now)}
                </span>
                <span className="picker-key">
                  {c.hotkey
                    ? <kbd className="clip-chord" title={`Keybind: ${chordLabel(c.hotkey)} pastes this from any app`} data-testid={tid('picker-chord', c.id)}>{chordLabel(c.hotkey)}</kbd>
                    : favAt >= 0 && favAt < 3 && <kbd className="picker-favkey">{modKey}+{favAt + 1}</kbd>}
                </span>
              </div>
            )
          })}
          {rows.length === 0 && (
            <div className="picker-empty">{clips.length === 0 ? 'Nothing copied yet.' : `No clips match “${query.trim()}”`}</div>
          )}
        </div>
        <ResizeGrip edge="right" onEnd={() => setCustomSize(true)} />
        <ResizeGrip edge="bottom" onEnd={() => setCustomSize(true)} />
        <ResizeGrip edge="corner" onEnd={() => setCustomSize(true)} />
        {editing && byId.get(editing) && (
          <ClipEditCard
            key={editing}
            clip={byId.get(editing)!}
            clips={clips}
            loadText={window.picker.clipText}
            save={window.picker.updateClip}
            suspend={window.picker.suspendHotkeys}
            onDone={closeEdit}
            variant="picker"
          />
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
