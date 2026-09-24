import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  AppWindow, Bot, Check, ChevronRight, ChevronsDownUp, Clipboard, ClipboardPaste, Copy, Files, FolderPlus, Globe, Image, Layers,
  Merge, Pause, Pencil, Play, Plus, Star, Terminal, Trash2, X
} from 'lucide-react'
import type { ClipSummary, ClipsListing } from '@shared/types'
import { appLabel, fromSource, groupNameOk, inGroup, looksLikeCode, orderFavorites, sizeLabel, sourceLabel } from '@shared/clips.mjs'
import { fuzzyScore } from '@shared/palette.mjs'
import { ContextMenu, tidyEntries, type ContextEntry } from '../ContextMenu'
import { Collapse } from '../Collapse'
import { useTreeDrag, type DragPress } from '../useTreeDrag'
import { tid } from '../testid'

/** Expanded sidebar sections. */
const OPEN_KEY = 'tm.clips.open.v1'
const SIZE_BADGE_FROM = 4 * 1024

function readOpen(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(OPEN_KEY) ?? 'null')
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : ['groups', 'sources']
  } catch { return ['groups', 'sources'] }
}
function writeOpen(list: string[]) {
  try { localStorage.setItem(OPEN_KEY, JSON.stringify(list)) } catch { /* layout nicety only */ }
}

export interface ClipboardPaneHandle {
  focusSearch: () => void
}

/** An open terminal pane a clip can be pasted into. */
export interface PasteTarget {
  id: string
  label: string
  paste: (text: string) => void
}

interface Props {
  /** Open terminal panes, for *Paste into ▸* and Ctrl+Enter. */
  terminals: PasteTarget[]
  /** The focused terminal pane, if any — what Ctrl+Enter pastes into. */
  focusedTerminal?: PasteTarget
}

function ago(at: number, now: number): string {
  const s = Math.max(0, Math.round((now - at) / 1000))
  if (s < 60) return 'now'
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.round(m / 60)
  if (h < 48) return `${h}h`
  return `${Math.round(h / 24)}d`
}

/** A small dot colour per group, from its name — never a filled row. */
const GROUP_HUES = [18, 42, 140, 185, 215, 280, 330]
function groupHue(name: string): number {
  let h = 0
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return GROUP_HUES[h % GROUP_HUES.length]
}

/** The source glyph in a row: what kind of thing made the copy. */
function SourceGlyph({ clip }: { clip: ClipSummary }) {
  const cls = 'clip-ic'
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

type MenuSpec =
  | { kind: 'clip'; id: string }
  | { kind: 'group'; name: string }
  | { kind: 'root' }
  | { kind: 'pause' }
  | { kind: 'picked' }
type Menu = MenuSpec & { x: number; y: number }

interface DropTarget { index: number; lineY: number; problem?: string }

/**
 * The Clipboard pane (PRD §5.1): a groups sidebar (All · Favorites · Images ·
 * your groups · Sources), a search box, the list newest first, and a detail
 * card for the selected clip. Right-click for the shared ContextMenu; star a
 * row; drag favorites into the order Shift+Alt+1..3 will send; Ctrl+click to
 * pick several for merge. Bodies are fetched one at a time (`clips:get`);
 * the list is summaries. Refreshes follow `clips:changed`, coalesced, and
 * wait while the document is hidden.
 */
export const ClipboardPane = forwardRef<ClipboardPaneHandle, Props>(function ClipboardPane({ terminals, focusedTerminal }, ref) {
  const [listing, setListing] = useState<ClipsListing | null>(null)
  const [group, setGroup] = useState('all')
  const [source, setSource] = useState('')
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [body, setBody] = useState<{ id: string; text: string } | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [imageUrl, setImageUrl] = useState<{ id: string; url: string } | null>(null)
  const [thumbs, setThumbs] = useState<Map<string, string>>(new Map())
  const [menu, setMenu] = useState<Menu | null>(null)
  const [renaming, setRenaming] = useState<{ name: string | null; value: string; error?: string } | null>(null)
  const [titleEdit, setTitleEdit] = useState<{ id: string; value: string } | null>(null)
  const [confirm, setConfirm] = useState<'clear' | 'clear-all' | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  const [openSections, setOpenSections] = useState<string[]>(readOpen)
  const [now, setNow] = useState(Date.now())
  const [adding, setAdding] = useState<string | null>(null)

  const listRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const noticeTimer = useRef(0)
  const selectedRef = useRef(selected)
  selectedRef.current = selected
  const editingRef = useRef(editing)
  editingRef.current = editing

  const say = (message: string) => {
    setNotice(message)
    window.clearTimeout(noticeTimer.current)
    noticeTimer.current = window.setTimeout(() => setNotice(null), 3500)
  }

  // One refresh at a time; a change that lands mid-refresh queues one more.
  const refreshing = useRef<Promise<void> | null>(null)
  const refreshAgain = useRef(false)
  const stale = useRef(false)
  const refresh = useCallback(async (): Promise<void> => {
    if (refreshing.current) { refreshAgain.current = true; return refreshing.current }
    const run = (async () => {
      do {
        refreshAgain.current = false
        try {
          const res = await window.watch.listClips()
          setListing(res)
          setNow(Date.now())
          const cur = selectedRef.current
          if (cur && !res.clips.some((c) => c.id === cur)) { setSelected(null); setBody(null); setEditing(null) }
        } catch { /* main is not there yet; the empty state says so */ }
      } while (refreshAgain.current)
    })()
    refreshing.current = run
    try { await run } finally { refreshing.current = null }
  }, [])

  useEffect(() => {
    void refresh()
    const off = window.watch.onClipsChanged(() => {
      // A full re-list is not a cheap poll: wait until the window is looked at.
      if (document.hidden) { stale.current = true; return }
      void refresh()
    })
    const onVisible = () => { if (!document.hidden && stale.current) { stale.current = false; void refresh() } }
    document.addEventListener('visibilitychange', onVisible)
    const tick = window.setInterval(() => setNow(Date.now()), 30_000)
    return () => {
      off()
      document.removeEventListener('visibilitychange', onVisible)
      window.clearInterval(tick)
      window.clearTimeout(noticeTimer.current)
    }
  }, [refresh])

  useImperativeHandle(ref, () => ({ focusSearch: () => searchRef.current?.focus() }), [])

  const clips = listing?.clips ?? []
  const groups = listing?.groups ?? []
  const byId = useMemo(() => new Map(clips.map((c) => [c.id, c])), [clips])

  /** The rows on screen: view, source and query applied; favorites in their saved order. */
  const shown = useMemo(() => {
    let list = clips.filter((c) => inGroup(c, group) && fromSource(c, source))
    if (group === 'favorites') list = orderFavorites(list, listing?.favoritesOrder ?? [])
    const q = query.trim()
    if (!q) return list
    const scored: { c: ClipSummary; s: number }[] = []
    for (const c of list) {
      const s = fuzzyScore(q, `${c.title} ${c.preview}`)
      if (s !== null) scored.push({ c, s })
    }
    scored.sort((a, b) => b.s - a.s || b.c.copiedAt - a.c.copiedAt)
    return scored.map((x) => x.c)
  }, [clips, group, source, query, listing?.favoritesOrder])

  const counts = useMemo(() => ({
    all: clips.length,
    favorites: clips.filter((c) => c.favorite).length,
    images: clips.filter((c) => c.kind === 'image').length,
    group: (name: string) => clips.filter((c) => c.groups.includes(name)).length
  }), [clips])

  /** Provenance filters with something behind them (PRD §4.3). */
  const sources = useMemo(() => {
    const out: { id: string; label: string; icon: ReactNode; count: number }[] = []
    const kind = (k: string, label: string, icon: ReactNode) => {
      const n = clips.filter((c) => c.source.kind === k).length
      if (n) out.push({ id: k, label, icon, count: n })
    }
    kind('terminal', 'Terminal panes', <Terminal strokeWidth={2} />)
    kind('chrome', 'Browser', <Globe strokeWidth={2} />)
    kind('agent', 'Agents', <Bot strokeWidth={2} />)
    kind('manual', 'Added by you', <Pencil strokeWidth={2} />)
    const projects = new Map<string, number>()
    const exes = new Map<string, number>()
    for (const c of clips) {
      if (c.source.project) projects.set(c.source.project, (projects.get(c.source.project) ?? 0) + 1)
      if (c.source.exe && c.source.kind === 'app' && c.source.exe !== 'taylormade agents.exe') exes.set(c.source.exe, (exes.get(c.source.exe) ?? 0) + 1)
    }
    for (const [p, n] of [...projects].sort((a, b) => b[1] - a[1]).slice(0, 8)) out.push({ id: `project:${p}`, label: p, icon: <Layers strokeWidth={2} />, count: n })
    for (const [e, n] of [...exes].sort((a, b) => b[1] - a[1]).slice(0, 8)) out.push({ id: `exe:${e}`, label: appLabel(e) || e, icon: <AppWindow strokeWidth={2} />, count: n })
    return out
  }, [clips])

  // ---- the selected clip's body and image ----
  useEffect(() => {
    if (!selected) { setBody(null); setImageUrl(null); return }
    const clip = byId.get(selected)
    if (!clip) return
    let live = true
    if (clip.kind === 'image') {
      setBody({ id: selected, text: '' })
      void window.watch.clipImage(selected, false).then((url) => { if (live && url) setImageUrl({ id: selected, url }) })
    } else if (!editingRef.current) {
      void window.watch.getClip(selected).then((res) => { if (live && res) setBody({ id: selected, text: res.text }) })
    }
    return () => { live = false }
  // The body follows the clip's identity and its last copy/edit, not every listing.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, byId.get(selected ?? '')?.copiedAt, byId.get(selected ?? '')?.edited])

  // Thumbnails for image rows on screen, fetched once each.
  useEffect(() => {
    const missing = shown.filter((c) => c.kind === 'image' && !thumbs.has(c.id)).slice(0, 40)
    if (!missing.length) return
    let live = true
    void Promise.all(missing.map(async (c) => [c.id, await window.watch.clipImage(c.id, true)] as const)).then((pairs) => {
      if (!live) return
      setThumbs((prev) => {
        const next = new Map(prev)
        for (const [id, url] of pairs) if (url) next.set(id, url)
        return next
      })
    })
    return () => { live = false }
  }, [shown, thumbs])

  // ---- actions ----
  const copy = async (id: string) => {
    const ok = await window.watch.copyClip(id)
    if (!ok) { say('Could not copy that clip'); return }
    setCopied(id)
    window.setTimeout(() => setCopied((c) => (c === id ? null : c)), 1200)
  }
  const textOf = async (id: string): Promise<string | null> => {
    const clip = byId.get(id)
    if (!clip || clip.kind === 'image') return null
    const res = await window.watch.getClip(id)
    return res?.text ?? null
  }
  const pasteInto = async (id: string, target: PasteTarget | undefined) => {
    if (!target) { say('No terminal pane to paste into — click one first'); return }
    const text = await textOf(id)
    if (text === null) { say('Only text can be pasted into a pane'); return }
    target.paste(text)
  }
  const star = (id: string, on: boolean) => { void window.watch.updateClip(id, { favorite: on }) }
  const remove = async (ids: string[]) => {
    const n = await window.watch.deleteClips(ids)
    if (!n) say('Nothing was deleted')
    setPicked((p) => { const next = new Set(p); for (const id of ids) next.delete(id); return next })
    if (selected && ids.includes(selected)) setSelected(null)
  }
  const merge = async (ids: string[]) => {
    const id = await window.watch.mergeClips(ids)
    if (!id) { say('Pick two or more text clips to merge'); return }
    setPicked(new Set())
    setSelected(id)
    say('Merged into a new clip')
  }
  const toggleGroup = (id: string, name: string) => {
    const clip = byId.get(id)
    if (!clip) return
    const next = clip.groups.includes(name) ? clip.groups.filter((g) => g !== name) : [...clip.groups, name]
    void window.watch.updateClip(id, { groups: next })
  }
  const saveText = async (id: string, text: string) => {
    if (!(await window.watch.updateClip(id, { text }))) { say('Could not save the edit'); return }
    setEditing(null)
    setBody({ id, text })
  }
  const commitTitle = async () => {
    const t = titleEdit
    if (!t) return
    setTitleEdit(null)
    await window.watch.updateClip(t.id, { title: t.value.trim() ? t.value.trim() : null })
  }
  const commitGroupName = async () => {
    const r = renaming
    if (!r) return
    const name = r.value.trim()
    if (!groupNameOk(name)) { setRenaming({ ...r, error: 'A short name that is not All, Favorites or Images' }); return }
    if (groups.includes(name) && name !== r.name) { setRenaming({ ...r, error: 'That group exists' }); return }
    setRenaming(null)
    if (r.name === null) {
      await window.watch.setClipGroups([...groups, name])
      setGroup(name)
    } else if (name !== r.name) {
      // Rename = add the new name, move every member, drop the old one.
      const members = clips.filter((c) => c.groups.includes(r.name!))
      await window.watch.setClipGroups([...groups.map((g) => (g === r.name ? name : g))])
      for (const c of members) await window.watch.updateClip(c.id, { groups: c.groups.map((g) => (g === r.name ? name : g)) })
      if (group === r.name) setGroup(name)
    }
  }
  const deleteGroup = async (name: string) => {
    await window.watch.setClipGroups(groups.filter((g) => g !== name))
    if (group === name) setGroup('all')
  }
  const clear = async (all: boolean) => {
    const n = await window.watch.clearClips(all)
    setConfirm(null)
    say(n ? `Cleared ${n} clip${n === 1 ? '' : 's'}` : 'Nothing to clear')
  }
  const addText = async () => {
    const text = adding ?? ''
    if (!text.trim()) { setAdding(null); return }
    const id = await window.watch.addClip({ text, groups: group !== 'all' && group !== 'favorites' && group !== 'images' ? [group] : [] })
    setAdding(null)
    if (id) setSelected(id)
    else say('Could not add that')
  }
  const setSectionOpen = (id: string, open: boolean) => setOpenSections((prev) => {
    const next = open ? [...new Set([...prev, id])] : prev.filter((p) => p !== id)
    writeOpen(next)
    return next
  })

  // ---- favorites drag order (the notes tree's plumbing, shared) ----
  const hitTest = (x: number, y: number, press: DragPress): DropTarget | null => {
    const list = listRef.current
    if (!list || group !== 'favorites') return null
    const lr = list.getBoundingClientRect()
    if (x < lr.left || x > lr.right || y < lr.top || y > lr.bottom) return null
    const el = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-drop="clip"]')
    if (!el) return { index: shown.length, lineY: (list.scrollHeight - list.scrollTop) - 4 + list.scrollTop - 24 }
    const id = el.dataset.path ?? ''
    if (id === press.key) return null
    const r = el.getBoundingClientRect()
    const after = (y - r.top) / Math.max(1, r.height) > 0.5
    const at = shown.findIndex((c) => c.id === id)
    return { index: at + (after ? 1 : 0), lineY: (after ? r.bottom : r.top) - lr.top + list.scrollTop }
  }
  const { drag, pressRow, ghostRef, justDragged } = useTreeDrag<DropTarget>({
    listRef,
    hitTest,
    ignoreSelector: '.notes-rowact',
    enabled: group === 'favorites' && !query && !renaming && !titleEdit,
    onDrop: (press, target) => {
      if (!target) return
      const ids = shown.map((c) => c.id).filter((id) => id !== press.key)
      const from = shown.findIndex((c) => c.id === press.key)
      const to = target.index > from ? target.index - 1 : target.index
      ids.splice(Math.max(0, Math.min(ids.length, to)), 0, press.key)
      void window.watch.setFavoritesOrder(ids)
    }
  })

  // ---- keyboard in the search box ----
  const onSearchKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const at = shown.findIndex((c) => c.id === selected)
      const next = shown[Math.max(0, Math.min(shown.length - 1, at + (e.key === 'ArrowDown' ? 1 : -1)))]
      if (next) setSelected(next.id)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const target = (selected && shown.find((c) => c.id === selected)) || shown[0]
      if (!target) return
      if (e.ctrlKey) void pasteInto(target.id, focusedTerminal)
      else void copy(target.id)
    }
  }

  const openMenu = (e: React.MouseEvent, m: MenuSpec) => {
    e.preventDefault()
    e.stopPropagation()
    setMenu({ ...m, x: e.clientX, y: e.clientY })
  }

  if (!listing) return <div className="empty">Opening clipboard…</div>

  const paused = listing.paused
  const selectedClip = selected ? byId.get(selected) : undefined

  // ---- menus ----
  const pasteEntries = (id: string): ContextEntry[] => terminals.map((t) => ({
    kind: 'item', id: `paste:${t.id}`, label: t.label, icon: <Terminal />, onSelect: () => void pasteInto(id, t)
  }))
  const groupEntries = (ids: string[]): ContextEntry[] => {
    const first = byId.get(ids[0])
    return [
      ...groups.map((g): ContextEntry => ({
        kind: 'item', id: `group:${g}`, label: g,
        icon: first?.groups.includes(g) && ids.length === 1 ? <Check /> : <span className="clip-dot" style={{ background: `hsl(${groupHue(g)} 60% 62%)` }} />,
        keepOpen: ids.length === 1,
        onSelect: () => { for (const id of ids) { const c = byId.get(id); if (c && !(ids.length === 1 && c.groups.includes(g))) toggleGroup(id, g); else if (ids.length === 1) toggleGroup(id, g) } }
      })),
      ...(groups.length ? [{ kind: 'sep' } as ContextEntry] : []),
      { kind: 'item', id: 'new-group', label: 'New group…', icon: <FolderPlus />, onSelect: () => setRenaming({ name: null, value: '' }) }
    ]
  }
  const menuEntries = (m: Menu): ContextEntry[] => {
    if (m.kind === 'clip') {
      const c = byId.get(m.id)
      if (!c) return []
      return tidyEntries([
        { kind: 'item', id: 'copy', label: copied === m.id ? 'Copied' : 'Copy', icon: <Copy />, keys: ['↵'], keepOpen: true, onSelect: () => void copy(m.id) },
        c.kind !== 'image' && { kind: 'submenu', id: 'paste', label: 'Paste into', icon: <ClipboardPaste />, disabled: !terminals.length, hint: terminals.length ? undefined : 'Open a terminal pane first', entries: pasteEntries(m.id) },
        { kind: 'item', id: 'star', label: c.favorite ? 'Unstar' : 'Star', icon: <Star />, onSelect: () => star(m.id, !c.favorite) },
        { kind: 'submenu', id: 'groups', label: 'Add to group', icon: <Layers />, entries: groupEntries([m.id]) },
        { kind: 'sep' },
        { kind: 'item', id: 'title', label: c.custom ? 'Rename title' : 'Give it a title', icon: <Pencil />, keys: ['F2'], onSelect: () => setTitleEdit({ id: m.id, value: c.custom ? c.title : '' }) },
        c.kind === 'text' && { kind: 'item', id: 'edit', label: 'Edit text', icon: <Pencil />, onSelect: () => { setSelected(m.id); setEditing(m.id) } },
        picked.size > 1 && picked.has(m.id) && { kind: 'item', id: 'merge', label: `Merge ${picked.size} selected`, icon: <Merge />, onSelect: () => void merge([...picked]) },
        { kind: 'sep' },
        { kind: 'item', id: 'delete', label: picked.size > 1 && picked.has(m.id) ? `Delete ${picked.size} selected` : 'Delete', icon: <Trash2 />, onSelect: () => void remove(picked.size > 1 && picked.has(m.id) ? [...picked] : [m.id]) }
      ])
    }
    if (m.kind === 'group') {
      return tidyEntries([
        { kind: 'item', id: 'rename', label: 'Rename', icon: <Pencil />, keys: ['F2'], onSelect: () => setRenaming({ name: m.name, value: m.name }) },
        { kind: 'item', id: 'delete', label: 'Delete group', icon: <Trash2 />, hint: `Its ${counts.group(m.name)} clip${counts.group(m.name) === 1 ? '' : 's'} stay in history`, onSelect: () => void deleteGroup(m.name) }
      ])
    }
    if (m.kind === 'pause') {
      return tidyEntries([
        paused && { kind: 'item', id: 'resume', label: 'Resume capture', icon: <Play />, onSelect: () => void window.watch.pauseClips(null) },
        { kind: 'item', id: 'pause-5', label: 'Pause for 5 minutes', icon: <Pause />, onSelect: () => void window.watch.pauseClips(5) },
        { kind: 'item', id: 'pause-30', label: 'Pause for 30 minutes', icon: <Pause />, onSelect: () => void window.watch.pauseClips(30) },
        { kind: 'item', id: 'pause', label: 'Pause until resumed', icon: <Pause />, onSelect: () => void window.watch.pauseClips(0) }
      ])
    }
    if (m.kind === 'picked') {
      return tidyEntries([
        { kind: 'item', id: 'merge', label: `Merge ${picked.size}`, icon: <Merge />, onSelect: () => void merge([...picked]) },
        { kind: 'submenu', id: 'groups', label: 'Add to group', icon: <Layers />, entries: groupEntries([...picked]) },
        { kind: 'item', id: 'delete', label: `Delete ${picked.size}`, icon: <Trash2 />, onSelect: () => void remove([...picked]) }
      ])
    }
    return tidyEntries([
      { kind: 'item', id: 'add', label: 'Add text clip…', icon: <Plus />, onSelect: () => setAdding('') },
      { kind: 'item', id: 'new-group', label: 'New group…', icon: <FolderPlus />, onSelect: () => setRenaming({ name: null, value: '' }) },
      { kind: 'sep' },
      { kind: 'item', id: 'clear', label: 'Clear history…', icon: <Trash2 />, hint: 'Favorites and grouped clips stay', onSelect: () => setConfirm('clear') },
      { kind: 'item', id: 'clear-all', label: 'Clear everything…', icon: <Trash2 />, onSelect: () => setConfirm('clear-all') }
    ])
  }

  // ---- sidebar ----
  const navRow = (id: string, label: string, icon: ReactNode, count: number, extra: { kind?: 'group'; testId?: string } = {}) => {
    const active = extra.kind === 'group' ? group === id : id.startsWith('src:') ? source === id.slice(4) : group === id && !id.startsWith('src:')
    return (
      <div
        key={id}
        className={`clip-nav-row ${active ? 'is-active' : ''}`}
        onContextMenu={extra.kind === 'group' ? (e) => openMenu(e, { kind: 'group', name: id }) : undefined}
      >
        <button
          className="clip-nav"
          onClick={() => {
            if (id.startsWith('src:')) setSource(source === id.slice(4) ? '' : id.slice(4))
            else setGroup(id)
            setPicked(new Set())
          }}
          onKeyDown={extra.kind === 'group' ? (e) => { if (e.key === 'F2') { e.preventDefault(); setRenaming({ name: id, value: id }) } } : undefined}
          data-testid={extra.testId ?? tid('clip-group', id)}
        >
          <span className="clip-nav-ic">{icon}</span>
          <span className="clip-nav-name">{label}</span>
          <span className="notes-gcount">{count || ''}</span>
        </button>
      </div>
    )
  }
  const sectionHead = (id: string, label: string) => {
    const open = openSections.includes(id)
    return (
      <button className={`clip-section ${open ? 'is-open' : ''}`} onClick={() => setSectionOpen(id, !open)} aria-expanded={open} data-testid={tid('clip-section', id)}>
        <ChevronRight className="notes-chev" strokeWidth={2} />
        <span>{label}</span>
      </button>
    )
  }
  const groupRow = (g: string) => renaming && renaming.name === g ? renameInput() : navRow(g, g, <span className="clip-dot" style={{ background: `hsl(${groupHue(g)} 60% 62%)` }} />, counts.group(g), { kind: 'group' })
  const renameInput = () => renaming && (
    <div className="notes-rename" key="rename">
      <Layers className="notes-rename-ic" strokeWidth={2} />
      <input
        autoFocus
        className={`notes-rename-input ${renaming.error ? 'is-invalid' : ''}`}
        value={renaming.value}
        placeholder="Group name"
        spellCheck={false}
        data-escape-close=""
        title={renaming.error}
        aria-invalid={!!renaming.error}
        onChange={(e) => setRenaming((r) => (r ? { ...r, value: e.target.value, error: undefined } : r))}
        onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); void commitGroupName() } if (e.key === 'Escape') { e.preventDefault(); setRenaming(null) } }}
        onBlur={() => void commitGroupName()}
        data-testid="clip-group-rename"
      />
    </div>
  )

  const toolbar = (
    <div className="notes-toolbar" data-testid="clip-toolbar">
      <button className="notes-tool" onClick={() => setAdding('')} title="Add a text clip" data-testid="clip-tool:add"><Plus strokeWidth={2} /></button>
      <button className="notes-tool" onClick={() => setRenaming({ name: null, value: '' })} title="New group" data-testid="clip-tool:new-group"><FolderPlus strokeWidth={2} /></button>
      <button
        className={`notes-tool ${paused ? 'is-warn' : ''}`}
        onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setMenu({ kind: 'pause', x: r.left, y: r.bottom + 4 }) }}
        title={paused ? 'Capture is paused — click to resume or extend' : 'Pause capture'}
        aria-pressed={paused}
        data-testid="clip-tool:pause"
      >
        {paused ? <Play strokeWidth={2} /> : <Pause strokeWidth={2} />}
      </button>
      <span className="notes-toolbar-where" data-testid="clip-count">{paused ? 'paused' : `${clips.length} clip${clips.length === 1 ? '' : 's'}`}</span>
      <button className="notes-tool" onClick={() => { setOpenSections([]); writeOpen([]) }} title="Collapse sections" data-testid="clip-tool:collapse"><ChevronsDownUp strokeWidth={2} /></button>
      <button className="notes-tool" onClick={() => setConfirm('clear')} title="Clear history (favorites and grouped clips stay)" data-testid="clip-tool:clear"><Trash2 strokeWidth={2} /></button>
    </div>
  )

  const confirmRow = confirm && (
    <div className="clip-confirm" role="alertdialog" data-testid="clip-confirm">
      <span>{confirm === 'clear-all' ? `Delete all ${clips.length} clips, favorites included?` : `Clear ${clips.filter((c) => !c.favorite && !c.groups.length).length} unpinned clips?`}</span>
      <button className="clip-confirm-yes" onClick={() => void clear(confirm === 'clear-all')} data-testid="clip-confirm-yes">{confirm === 'clear-all' ? 'Delete all' : 'Clear'}</button>
      <button className="clip-confirm-no" onClick={() => setConfirm(null)} data-testid="clip-confirm-no">Keep</button>
    </div>
  )

  // ---- rows ----
  const row = (c: ClipSummary, index: number) => {
    const isSel = selected === c.id
    const isPicked = picked.has(c.id)
    const meta = [sourceLabel(c.source), c.bytes >= SIZE_BADGE_FROM ? sizeLabel(c.bytes) : null, c.copies > 1 ? `×${c.copies}` : null, c.kind === 'image' && c.image ? `${c.image.width}×${c.image.height}` : null].filter(Boolean).join(' · ')
    const thumb = c.kind === 'image' ? thumbs.get(c.id) : undefined
    return (
      <div
        key={c.id}
        className={`clip-row ${isSel ? 'is-active' : ''} ${isPicked ? 'is-picked' : ''} ${drag?.press.key === c.id ? 'is-dragging' : ''}`}
        data-drop="clip"
        data-path={c.id}
        data-testid={tid('clip', c.id)}
        style={{ animationDelay: `${Math.min(index, 8) * 20}ms` }}
        onPointerDown={(e) => pressRow(e, { key: c.id, kind: 'clip', label: c.title })}
        onContextMenu={(e) => { if (!picked.has(c.id)) setPicked(new Set()); openMenu(e, { kind: 'clip', id: c.id }) }}
        onClick={(e) => {
          if (justDragged.current) return
          if (e.ctrlKey || e.metaKey) {
            setPicked((p) => { const next = new Set(p); if (next.has(c.id)) next.delete(c.id); else next.add(c.id); return next })
            return
          }
          setPicked(new Set())
          setSelected(c.id)
          setEditing(null)
        }}
        onDoubleClick={() => void copy(c.id)}
        onKeyDown={(e) => { if (e.key === 'F2') { e.preventDefault(); setTitleEdit({ id: c.id, value: c.custom ? c.title : '' }) } }}
        tabIndex={0}
        role="option"
        aria-selected={isSel}
      >
        {thumb ? <img className="clip-thumb" src={thumb} alt="" draggable={false} /> : <SourceGlyph clip={c} />}
        {titleEdit?.id === c.id ? (
          <input
            autoFocus
            className="clip-title-input"
            value={titleEdit.value}
            placeholder={c.title}
            spellCheck={false}
            data-escape-close=""
            onChange={(e) => setTitleEdit({ id: c.id, value: e.target.value })}
            onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); void commitTitle() } if (e.key === 'Escape') { e.preventDefault(); setTitleEdit(null) } }}
            onBlur={() => void commitTitle()}
            onPointerDown={(e) => e.stopPropagation()}
            data-testid="clip-title-input"
          />
        ) : (
          <span className={`clip-title ${c.custom ? 'is-custom' : ''}`}>{c.title || '(blank)'}</span>
        )}
        <span className="clip-when">{copied === c.id ? <span className="clip-copied">Copied</span> : ago(c.copiedAt, now)}</span>
        <span className="clip-meta">{meta}</span>
        {group === 'favorites' && index < 3 && !query && <kbd className="clip-favkey" title={`Shift+Alt+${index + 1} (M2)`}>{index + 1}</kbd>}
        <button
          className={`notes-rowact clip-star ${c.favorite ? 'is-on' : ''}`}
          onClick={(e) => { e.stopPropagation(); star(c.id, !c.favorite) }}
          title={c.favorite ? 'Unstar' : 'Star'}
          aria-label={c.favorite ? 'Unstar' : 'Star'}
          aria-pressed={c.favorite}
          data-testid={tid('clip-star', c.id)}
        >
          <Star strokeWidth={2} />
        </button>
      </div>
    )
  }

  // ---- detail card ----
  const detail = selectedClip && (
    <div className="clip-detail" data-testid="clip-detail">
      <div className="clip-detail-head">
        <SourceGlyph clip={selectedClip} />
        <span className="clip-detail-title">{selectedClip.title}</span>
        <span className="clip-detail-meta">
          {[sourceLabel(selectedClip.source), body && selectedClip.kind === 'text' ? `${body.text.length.toLocaleString()} chars` : sizeLabel(selectedClip.bytes), selectedClip.copies > 1 ? `copied ${selectedClip.copies}×` : null, selectedClip.edited ? 'edited' : null, selectedClip.merged ? 'merged' : null].filter(Boolean).join(' · ')}
        </span>
        <span className="clip-detail-actions">
          {selectedClip.kind === 'text' && (editing === selectedClip.id
            ? <button className="iconbtn iconbtn--sm" title="Save (Ctrl+S)" onClick={() => { const ta = document.querySelector<HTMLTextAreaElement>('.clip-edit'); if (ta) void saveText(selectedClip.id, ta.value) }} data-testid="clip-detail:save"><Check className="gear gear--sm" strokeWidth={2} /></button>
            : <button className="iconbtn iconbtn--sm" title="Edit text" onClick={() => setEditing(selectedClip.id)} data-testid="clip-detail:edit"><Pencil className="gear gear--sm" strokeWidth={2} /></button>)}
          {selectedClip.kind !== 'image' && <button className="iconbtn iconbtn--sm" title={focusedTerminal ? `Paste into ${focusedTerminal.label} (Ctrl+↵)` : 'Paste into a terminal pane (click one first)'} disabled={!focusedTerminal} onClick={() => void pasteInto(selectedClip.id, focusedTerminal)} data-testid="clip-detail:paste"><ClipboardPaste className="gear gear--sm" strokeWidth={2} /></button>}
          <button className="iconbtn iconbtn--sm" title="Copy (↵)" onClick={() => void copy(selectedClip.id)} data-testid="clip-detail:copy"><Copy className="gear gear--sm" strokeWidth={2} /></button>
          <button className="iconbtn iconbtn--sm" title="Close" onClick={() => { setSelected(null); setEditing(null) }} data-testid="clip-detail:close"><X className="gear gear--sm" strokeWidth={2} /></button>
        </span>
      </div>
      {selectedClip.kind === 'image' ? (
        imageUrl?.id === selectedClip.id ? <img className="clip-detail-img" src={imageUrl.url} alt={selectedClip.title} draggable={false} /> : <div className="clip-detail-text">Loading image…</div>
      ) : editing === selectedClip.id && body ? (
        <textarea
          className="clip-edit"
          defaultValue={body.text}
          spellCheck={false}
          autoFocus
          onKeyDown={(e) => { e.stopPropagation(); if (e.ctrlKey && e.key.toLowerCase() === 's') { e.preventDefault(); void saveText(selectedClip.id, (e.target as HTMLTextAreaElement).value) } if (e.key === 'Escape') { e.preventDefault(); setEditing(null) } }}
          data-testid="clip-edit"
        />
      ) : body?.id === selectedClip.id ? (
        looksLikeCode(body.text) && selectedClip.kind === 'text'
          ? <pre className="clip-code" data-testid="clip-code">{body.text.split('\n').map((line, i) => <span key={i} className="clip-code-line"><span className="clip-ln">{i + 1}</span>{line}{'\n'}</span>)}</pre>
          : <pre className="clip-detail-text" data-testid="clip-text">{body.text}</pre>
      ) : <div className="clip-detail-text">Loading…</div>}
    </div>
  )

  const emptyLine = clips.length === 0
    ? 'Nothing captured yet — copy anything, in any app, and it lands here.'
    : shown.length === 0 && query
      ? `No clips match “${query.trim()}”`
      : shown.length === 0 ? 'Nothing here yet.' : null

  return (
    <div className={`notes clips ${paused ? 'is-paused' : ''}`} data-testid="clips">
      <div className="notes-side">
        {toolbar}
        {confirmRow}
        <div className="notes-list clip-nav-list" onContextMenu={(e) => openMenu(e, { kind: 'root' })} data-testid="clip-nav">
          {navRow('all', 'All', <Clipboard strokeWidth={2} />, counts.all)}
          {navRow('favorites', 'Favorites', <Star strokeWidth={2} />, counts.favorites)}
          {navRow('images', 'Images', <Image strokeWidth={2} />, counts.images)}
          {sectionHead('groups', 'Groups')}
          <Collapse open={openSections.includes('groups')}>
            {groups.map(groupRow)}
            {renaming?.name === null && renameInput()}
            {!groups.length && renaming?.name !== null && <div className="notes-folder-empty">No groups — right-click a clip, or +</div>}
          </Collapse>
          {sources.length > 0 && sectionHead('sources', 'Sources')}
          <Collapse open={openSections.includes('sources')}>
            {sources.map((s) => navRow(`src:${s.id}`, s.label, s.icon, s.count, { testId: tid('clip-source', s.id) }))}
          </Collapse>
        </div>
        {(listing.mode === 'poll' || listing.unprotected || notice) && (
          <div className={`notes-notice ${notice ? '' : 'is-quiet'}`} role="status" data-testid="clip-notice">
            {notice ?? (listing.unprotected ? 'Encryption is unavailable on this account — clips are stored in plain text.' : 'Capture runs on a 500 ms poll here, so a copy lands a moment later.')}
          </div>
        )}
      </div>
      <div className="clip-main">
        <div className="clip-searchrow">
          <input
            ref={searchRef}
            className="clip-search"
            value={query}
            placeholder={group === 'all' ? 'Search clips' : `Search ${group === 'favorites' ? 'favorites' : group === 'images' ? 'images' : group}`}
            spellCheck={false}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onSearchKey}
            data-testid="clip-search"
          />
          <span className="clip-search-hint"><kbd>↵</kbd> copy · <kbd>Ctrl</kbd><kbd>↵</kbd> paste into pane</span>
        </div>
        {adding !== null && (
          <div className="clip-add" data-testid="clip-add">
            <textarea autoFocus className="clip-add-text" value={adding} placeholder="Text to keep on the clipboard history" spellCheck={false} onChange={(e) => setAdding(e.target.value)} onKeyDown={(e) => { e.stopPropagation(); if (e.ctrlKey && e.key === 'Enter') { e.preventDefault(); void addText() } if (e.key === 'Escape') { e.preventDefault(); setAdding(null) } }} data-escape-close="" />
            <div className="clip-add-row">
              <button className="clip-confirm-yes" onClick={() => void addText()} data-testid="clip-add-save">Add</button>
              <button className="clip-confirm-no" onClick={() => setAdding(null)}>Cancel</button>
              <span className="clip-search-hint"><kbd>Ctrl</kbd><kbd>↵</kbd></span>
            </div>
          </div>
        )}
        <div ref={listRef} className="clip-list" role="listbox" onContextMenu={(e) => { if (e.target === e.currentTarget) openMenu(e, { kind: 'root' }) }} data-testid="clip-list">
          {shown.map(row)}
          {drag?.target && <div className="notes-dropline" style={{ top: drag.target.lineY - 1, left: 8 }} />}
          {emptyLine && (
            <div className="clip-empty">
              <span>{emptyLine}</span>
              {shown.length === 0 && query && (group !== 'all' || source) && <button className="clip-link" onClick={() => { setGroup('all'); setSource('') }}>Search all clips</button>}
            </div>
          )}
        </div>
        {picked.size > 1 && (
          <div className="clip-pickbar" data-testid="clip-pickbar">
            <span>{picked.size} selected</span>
            <button onClick={() => void merge([...picked])}><Merge strokeWidth={2} />Merge</button>
            <button onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setMenu({ kind: 'picked', x: r.left, y: r.top - 4 }) }}><Layers strokeWidth={2} />More</button>
            <button onClick={() => void remove([...picked])}><Trash2 strokeWidth={2} />Delete</button>
            <button className="clip-pickbar-x" onClick={() => setPicked(new Set())} title="Clear selection"><X strokeWidth={2} /></button>
          </div>
        )}
        {detail}
      </div>
      {drag && (
        <div ref={ghostRef} className="notes-ghost" style={{ left: drag.x + 12, top: drag.y + 10 }} data-escape-close="" data-testid="clip-ghost">
          <Star strokeWidth={2} />
          <span>{drag.press.label}</span>
        </div>
      )}
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          entries={menuEntries(menu)}
          onClose={() => setMenu(null)}
          testId="clip-menu"
          header={menu.kind === 'clip' && byId.get(menu.id) ? (
            <><div className="ctxmenu-head-title"><SourceGlyph clip={byId.get(menu.id)!} /><span>{byId.get(menu.id)!.title}</span></div>
              <div className="ctxmenu-head-detail"><bdi>{sourceLabel(byId.get(menu.id)!.source)} · {ago(byId.get(menu.id)!.copiedAt, now)}</bdi></div></>
          ) : menu.kind === 'group' ? (
            <div className="ctxmenu-head-title"><Layers className="ctxmenu-head-ic" strokeWidth={2} /><span>{menu.name}</span></div>
          ) : undefined}
        />
      )}
    </div>
  )
})
