import { Fragment, useCallback, useEffect, useState, type ReactNode } from 'react'
import { AppWindow, Bot, ChevronRight, Clipboard, Globe, Image, Layers, Pencil, Star, Terminal } from 'lucide-react'
import type { ClipGroupInfo, ClipSummary } from '@shared/types'
import { appDisplayName } from '@shared/clips.mjs'
import { Collapse } from '../Collapse'
import { tid } from '../testid'

/** Expanded sections (`groups`, `sources`), shared by the pane and the picker. */
const OPEN_KEY = 'tm.clips.open.v1'

function readOpen(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(OPEN_KEY) ?? 'null')
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : ['groups', 'sources']
  } catch { return ['groups', 'sources'] }
}
function writeOpen(list: string[]) {
  try { localStorage.setItem(OPEN_KEY, JSON.stringify(list)) } catch { /* layout nicety only */ }
}

/**
 * Which sections are open, remembered in `tm.clips.open.v1`. The pane and the
 * picker are two windows on one origin, so a `storage` event carries a change
 * made in one to the other.
 */
export function useNavSections() {
  const [open, setOpen] = useState<string[]>(readOpen)
  useEffect(() => {
    const onStorage = (e: StorageEvent) => { if (e.key === OPEN_KEY) setOpen(readOpen()) }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])
  const toggle = useCallback((id: string, on: boolean) => setOpen((prev) => {
    const next = on ? [...new Set([...prev, id])] : prev.filter((p) => p !== id)
    writeOpen(next)
    return next
  }), [])
  const collapseAll = useCallback(() => { setOpen([]); writeOpen([]) }, [])
  return { open, toggle, collapseAll }
}

/** A small dot colour per group, from its name — never a filled row. The same hue in both windows. */
const GROUP_HUES = [18, 42, 140, 185, 215, 280, 330]
export function groupDot(name: string): string {
  let h = 0
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return `hsl(${GROUP_HUES[h % GROUP_HUES.length]} 60% 62%)`
}

export interface ClipSourceEntry { id: string; label: string; icon: ReactNode; count: number }

/** Provenance filters with something behind them (PRD §4.3): the kinds, then the busiest projects and apps. */
export function clipSources(clips: readonly ClipSummary[]): ClipSourceEntry[] {
  const out: ClipSourceEntry[] = []
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
  for (const [e, n] of [...exes].sort((a, b) => b[1] - a[1]).slice(0, 8)) out.push({ id: `exe:${e}`, label: appDisplayName(e) || e, icon: <AppWindow strokeWidth={2} />, count: n })
  return out
}

interface Props {
  counts: { all: number; favorites: number; images: number; group: (name: string) => number }
  groups: readonly string[]
  groupInfo: Record<string, ClipGroupInfo>
  sources: readonly ClipSourceEntry[]
  /** The view on screen: `all`, `favorites`, `images` or a group ('' when a source alone filters). */
  group: string
  /** The source filter (`terminal`, `project:x`, `exe:y`), '' for none. */
  source: string
  onGroup: (id: string) => void
  onSource: (id: string) => void
  open: readonly string[]
  onSection: (id: string, open: boolean) => void
  /** The pane: a group row's right-click menu, F2 to rename it, and the menu on empty space. */
  onGroupMenu?: (e: React.MouseEvent, name: string) => void
  onGroupKey?: (e: React.KeyboardEvent, name: string) => void
  onRootMenu?: (e: React.MouseEvent) => void
  /** The pane's rename field: in place of the group it renames, or after the list for a new one. */
  renaming?: { name: string | null } | null
  renameField?: ReactNode
  emptyHint: string
  /** The picker: a press keeps focus in the search field, where its keys live. */
  holdFocus?: boolean
  testIds: { list: string; row: string; source: string; section: string }
}

/**
 * The clipboard's left column, in both windows: All · Favorites · Images,
 * then the groups (a section that folds) and the sources. A view replaces
 * the view; a source toggles on top of it in the pane, and is the whole
 * filter in the picker — the caller decides through `onGroup` / `onSource`.
 */
export function ClipNav(p: Props) {
  const keep = p.holdFocus ? (e: React.MouseEvent) => e.preventDefault() : undefined
  const row = (id: string, label: string, icon: ReactNode, count: number, extra: { group?: boolean; source?: boolean; hint?: string; testId: string }) => {
    const active = extra.source ? p.source === id : p.group === id
    return (
      <div
        key={`${extra.source ? 'src' : 'view'}:${id}`}
        className={`clip-nav-row ${active ? 'is-active' : ''}`}
        onContextMenu={extra.group && p.onGroupMenu ? (e) => p.onGroupMenu!(e, id) : undefined}
      >
        <button
          className="clip-nav"
          title={extra.hint}
          onMouseDown={keep}
          onClick={() => (extra.source ? p.onSource(id) : p.onGroup(id))}
          onKeyDown={extra.group && p.onGroupKey ? (e) => p.onGroupKey!(e, id) : undefined}
          aria-pressed={active}
          data-testid={extra.testId}
        >
          <span className="clip-nav-ic">{icon}</span>
          <span className="clip-nav-name">{label}</span>
          <span className="notes-gcount">{count || ''}</span>
        </button>
      </div>
    )
  }
  const head = (id: string, label: string) => {
    const isOpen = p.open.includes(id)
    return (
      <button className={`clip-section ${isOpen ? 'is-open' : ''}`} onMouseDown={keep} onClick={() => p.onSection(id, !isOpen)} aria-expanded={isOpen} data-testid={tid(p.testIds.section, id)}>
        <ChevronRight className="notes-chev" strokeWidth={2} />
        <span>{label}</span>
      </button>
    )
  }
  return (
    <div className="notes-list clip-nav-list" onContextMenu={p.onRootMenu} data-testid={p.testIds.list}>
      {row('all', 'All', <Clipboard strokeWidth={2} />, p.counts.all, { testId: tid(p.testIds.row, 'all') })}
      {row('favorites', 'Favorites', <Star strokeWidth={2} />, p.counts.favorites, { testId: tid(p.testIds.row, 'favorites') })}
      {row('images', 'Images', <Image strokeWidth={2} />, p.counts.images, { testId: tid(p.testIds.row, 'images') })}
      {head('groups', 'Groups')}
      <Collapse open={p.open.includes('groups')}>
        {p.groups.map((g) => (p.renaming && p.renaming.name === g
          ? <Fragment key={`rename:${g}`}>{p.renameField}</Fragment>
          : row(g, g, <span className="clip-dot" style={{ background: groupDot(g) }} />, p.counts.group(g), { group: true, hint: p.groupInfo[g]?.description, testId: tid(p.testIds.row, g) })))}
        {p.renaming?.name === null && p.renameField}
        {!p.groups.length && p.renaming?.name !== null && <div className="notes-folder-empty">{p.emptyHint}</div>}
      </Collapse>
      {p.sources.length > 0 && head('sources', 'Sources')}
      <Collapse open={p.open.includes('sources')}>
        {p.sources.map((s) => row(s.id, s.label, s.icon, s.count, { source: true, testId: tid(p.testIds.source, s.id) }))}
      </Collapse>
    </div>
  )
}
