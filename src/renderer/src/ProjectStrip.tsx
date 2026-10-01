import { useEffect, useLayoutEffect, useRef, useState, type DragEvent, type MouseEvent, type ReactNode } from 'react'
import { ChevronLeft, ChevronRight, Folder, FolderPlus, Globe, Rss, SquareTerminal } from 'lucide-react'
import type { TerminalLaunch } from '@shared/types'
import { launchKey } from '@shared/panes.mjs'
import { packRows } from '@shared/projectStrip.mjs'
import { ProviderBadge } from './ProviderBadge'
import { MenuCheckItem, MenuItem, MenuPop } from './Menu'
import { shortDuration } from './format'
import { useNow } from './useNow'
import { tid } from './testid'

/** Where launches land. `cwd` undefined means the home folder. */
export interface LaunchTarget {
  cwd?: string
  label?: string
}

/** One badge: a folder with activity in the last four hours. */
export interface StripProject {
  cwd: string
  label: string
  /** Last activity; 0 when the folder is only here because it is the launch target. */
  at: number
  /** Live sessions there, and how many of them wait on you / are working. */
  sessions: number
  waiting: number
  running: number
}

/** The badge menu. It lives in App's single `openMenu` state, so only one
 * menu in the window is ever open and Escape closes it at the documented
 * point in the chain instead of falling through to hiding the workspace. */
export type NavMenu = 'project'

/** Space between badges, both ways — must match `.projrow`'s gap in styles.css. */
const GAP = 6

/** Web apps the badge menu opens in the default browser, under the starts.
 * Not per project: the same links in every badge's menu (and the palette).
 * Each opens in a web pane (WebPane.tsx); Shift-click for the browser. */
export const WEB_LINKS: { label: string; url: string }[] = [
  { label: 'TaylorMade Content', url: 'https://taylormade-content-production.up.railway.app/' }
]

const LAUNCHES: { kind: TerminalLaunch; label: string; icon: ReactNode; what: string; keys?: string }[] = [
  { kind: 'claude', label: 'New Claude Code', icon: <ProviderBadge provider="claude" />, what: 'Claude Code' },
  { kind: 'codex', label: 'New Codex', icon: <ProviderBadge provider="codex" />, what: 'Codex' },
  { kind: 'shell', label: 'New terminal', icon: <SquareTerminal strokeWidth={2} />, what: 'a PowerShell terminal', keys: 'Ctrl+Shift+`' }
]

interface Props {
  projects: StripProject[]
  /** The launch target's folder — the selected badge. */
  selected?: string
  openMenu: NavMenu | null
  onOpenMenu: (menu: NavMenu | null) => void
  /** A badge click: that folder becomes the launch target. */
  onSelect: (target: LaunchTarget) => void
  onLaunch: (launch: TerminalLaunch, target: LaunchTarget, external: boolean) => void
  /** The folder's usual launch (tm.launch.v2) — checked in its menu. */
  launchKindFor: (cwd: string) => TerminalLaunch
  onNewProject: () => void
  /** A `WEB_LINKS` site: a web pane, or the browser on Shift-click. */
  onOpenWeb: (link: { url: string; label: string }, external: boolean) => void
  /** A folder dropped from Explorer becomes the launch target. */
  onDropFolder: (path: string) => void
}

/**
 * The head of the sidebar: every project folder with activity in the last
 * four hours, newest first, as badges in two rows. Past two rows the strip
 * scrolls sideways (the arrows, or Shift+wheel). A badge click makes that
 * folder the launch target and opens its menu — Claude Code, Codex, or a
 * terminal *there*; nothing else.
 *
 * The order is frozen while the pointer is over the strip or the menu is
 * open, so a badge never slides out from under a click; a folder that turns
 * up meanwhile joins at the end until the pointer leaves.
 *
 * Dropping a folder from Explorer on it retargets launches at that folder
 * (the path comes from `webUtils.getPathForFile` in the preload — `File.path`
 * was removed in Electron 32).
 */
export function ProjectStrip({ projects, selected, openMenu, onOpenMenu, onSelect, onLaunch, launchKindFor, onNewProject, onOpenWeb, onDropFolder }: Props) {
  const now = useNow()
  const [dropHot, setDropHot] = useState(false)
  const [hover, setHover] = useState(false)
  const menuOpen = openMenu === 'project'
  const selectedKey = launchKey(selected)

  // ---- order: newest first, frozen under the pointer ----
  const shownOrder = useRef<string[]>([])
  const byKey = new Map(projects.map((p) => [launchKey(p.cwd), p]))
  let order = projects.map((p) => launchKey(p.cwd))
  if (hover || menuOpen) {
    const kept = shownOrder.current.filter((k) => byKey.has(k))
    order = [...kept, ...order.filter((k) => !kept.includes(k))]
  }
  shownOrder.current = order
  const shown = order.map((k) => byKey.get(k)!)

  // ---- packing: measure each badge, then two rows (see packRows) ----
  const stripRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const chips = useRef(new Map<string, HTMLButtonElement>())
  const [width, setWidth] = useState(0)
  const [pack, setPack] = useState<{ sig: string; rows: string[][]; overflow: boolean } | null>(null)
  const [edges, setEdges] = useState({ left: false, right: false })
  // What changes a badge's width: its label and whether it carries a dot.
  const sig = shown.map((p) => `${launchKey(p.cwd)}\u0001${p.label}\u0001${p.waiting > 0 || p.running > 0 ? 1 : 0}`).join('\u0002') + `@${width}`

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    // The sidebar is dragged wider and narrower; the strip re-packs to fit.
    const ro = new ResizeObserver(() => setWidth(el.clientWidth))
    ro.observe(el)
    setWidth(el.clientWidth)
    return () => ro.disconnect()
  }, [])

  useLayoutEffect(() => {
    if (!width) return
    const widths = order.map((k) => chips.current.get(k)?.offsetWidth ?? 0)
    // -1: offsetWidth rounds, and a badge 0.4px too wide would wrap.
    const next = packRows(widths, width - 1, GAP)
    setPack({ sig, rows: next.rows.map((row) => row.map((i) => order[i])), overflow: next.overflow })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sig captures order and widths
  }, [sig])

  // Until measured (first paint, or a badge that just appeared), one row of
  // everything — which is what the layout effect measures from.
  const rows = pack && pack.sig === sig ? pack.rows : [order]

  const syncEdges = () => {
    const el = scrollRef.current
    if (!el) return
    const next = { left: el.scrollLeft > 1, right: el.scrollLeft + el.clientWidth < el.scrollWidth - 1 }
    setEdges((cur) => (cur.left === next.left && cur.right === next.right ? cur : next))
  }
  useLayoutEffect(syncEdges, [pack, width])

  // Shift+wheel scrolls the badges sideways. Non-passive, so the vertical
  // scroll it would otherwise be never reaches the sidebar.
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const onWheel = (event: WheelEvent) => {
      if (!event.shiftKey || el.scrollWidth <= el.clientWidth) return
      event.preventDefault()
      el.scrollLeft += event.deltaX !== 0 ? event.deltaX : event.deltaY
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  const page = (dir: 1 | -1) => {
    const el = scrollRef.current
    if (!el) return
    el.scrollBy({ left: dir * Math.max(80, el.clientWidth * 0.7), behavior: 'smooth' })
  }

  // ---- the menu, anchored under the selected badge ----
  const [anchor, setAnchor] = useState<{ left: number; top: number } | null>(null)
  useLayoutEffect(() => {
    if (!menuOpen) { setAnchor(null); return }
    const chip = chips.current.get(selectedKey)
    const strip = stripRef.current
    if (!chip || !strip) { setAnchor(null); return }
    const c = chip.getBoundingClientRect()
    const s = strip.getBoundingClientRect()
    // Keep the menu inside the sidebar: it is wider than most badges.
    const left = Math.round(Math.max(0, Math.min(c.left - s.left, s.width - 260)))
    const top = Math.round(c.bottom - s.top)
    setAnchor((cur) => (cur && cur.left === left && cur.top === top ? cur : { left, top }))
  }, [menuOpen, selectedKey, rows])

  const current = byKey.get(selectedKey)
  const start = (kind: TerminalLaunch) => (event: MouseEvent<HTMLButtonElement>) => {
    if (!current) return
    onOpenMenu(null)
    onLaunch(kind, { cwd: current.cwd, label: current.label }, event.shiftKey)
  }

  const onDrop = (event: DragEvent) => {
    event.preventDefault()
    setDropHot(false)
    const file = event.dataTransfer.files?.[0]
    if (!file) return
    const path = window.watch.pathForFile(file)
    if (path) onDropFolder(path)
  }

  const chip = (p: StripProject) => {
    const key = launchKey(p.cwd)
    const isSelected = key === selectedKey
    const dot = p.waiting > 0 ? 'is-waiting' : p.running > 0 ? 'is-running' : null
    const status = [
      p.sessions ? `${p.sessions} live session${p.sessions === 1 ? '' : 's'}` : 'no live session',
      p.waiting ? `${p.waiting} waiting on you` : null,
      p.running ? `${p.running} working` : null
    ].filter(Boolean).join(' · ')
    const when = p.at > 0 ? `active ${shortDuration(p.at, now)} ago` : 'not active in the last 4 hours'
    return (
      <button
        key={key}
        ref={(el) => { if (el) chips.current.set(key, el); else chips.current.delete(key) }}
        className={`projchip ${isSelected ? 'is-selected' : ''}`}
        aria-pressed={isSelected}
        aria-haspopup="menu"
        aria-expanded={isSelected && menuOpen}
        title={`${p.cwd}\n${status} · ${when}\nClick to start Claude Code, Codex, or a terminal here`}
        data-testid={tid('project', p.label)}
        onClick={() => {
          if (isSelected && menuOpen) { onOpenMenu(null); return }
          onSelect({ cwd: p.cwd, label: p.label })
          onOpenMenu('project')
        }}
      >
        {dot && <span className={`projchip-dot ${dot}`} aria-hidden />}
        <span className="projchip-name">{p.label}</span>
      </button>
    )
  }

  return (
    <section
      className={`projects ${dropHot ? 'is-drop' : ''}`}
      data-testid="project-strip"
      onDragOver={(event) => {
        if (!event.dataTransfer.types.includes('Files')) return
        event.preventDefault()
        event.dataTransfer.dropEffect = 'copy'
        if (!dropHot) setDropHot(true)
      }}
      onDragLeave={(event) => {
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) return
        setDropHot(false)
      }}
      onDrop={onDrop}
    >
      <div className="pane-head projects-head">
        <span className="projects-title" title="Project folders with activity in the last 4 hours, newest first">
          <Rss className="gpane-ic" strokeWidth={2} />
          <span className="pane-title">Activity</span>
        </span>
        <span className="gpane-actions">
          <button className="iconbtn iconbtn--sm" onClick={onNewProject} title="New project — create a project folder and open it in Cursor" aria-label="New project" data-testid="launch-new-project">
            <FolderPlus className="gear gear--sm" strokeWidth={2} />
          </button>
        </span>
      </div>

      <div
        className={`projstrip ${edges.left ? 'can-left' : ''} ${edges.right ? 'can-right' : ''}`}
        ref={stripRef}
        onPointerEnter={() => setHover(true)}
        onPointerLeave={() => setHover(false)}
      >
        {/* Always mounted, even empty: the ResizeObserver lives on it. */}
        <div
          className="projstrip-scroll"
          ref={scrollRef}
          onScroll={() => { syncEdges(); if (menuOpen) onOpenMenu(null) }}
        >
          {shown.length === 0 ? (
            <div className="projstrip-empty">No project activity in the last 4 hours. Start a session from the Terminal menu, or drop a folder here.</div>
          ) : (
            <div className="projrows">
              {rows.map((row, i) => (
                <div className="projrow" key={i}>
                  {row.map((k) => byKey.get(k)).filter((p): p is StripProject => !!p).map(chip)}
                </div>
              ))}
            </div>
          )}
        </div>
        {edges.left && (
          <button className="projstrip-arrow is-left" onClick={() => page(-1)} title="Newer projects (Shift+scroll)" aria-label="Scroll projects left" tabIndex={-1}>
            <ChevronLeft strokeWidth={2.25} />
          </button>
        )}
        {edges.right && (
          <button className="projstrip-arrow is-right" onClick={() => page(1)} title="More projects (Shift+scroll)" aria-label="Scroll projects right" data-testid="projects-more" tabIndex={-1}>
            <ChevronRight strokeWidth={2.25} />
          </button>
        )}

        {menuOpen && current && anchor && (
          <div className="projmenu-anchor" style={{ left: anchor.left, top: anchor.top }}>
            {/* The badges toggle it themselves; clicks inside it are its own. */}
            <MenuPop onAway={() => onOpenMenu(null)} ignoreSelector=".projchip, .projmenu-anchor">
              <div className="projmenu-head">
                <Folder className="projmenu-ic" strokeWidth={2} />
                <span className="projmenu-text">
                  <span className="projmenu-name">{current.label}</span>
                  <span className="projmenu-path" title={current.cwd}>{current.cwd}</span>
                </span>
              </div>
              <div className="menu-sep" />
              {LAUNCHES.map((l) => (
                <MenuCheckItem
                  key={l.kind}
                  icon={l.icon}
                  label={l.label}
                  hint={`Start ${l.what} in ${current.label}${l.keys ? ` (${l.keys})` : ''}\nShift-click for a separate window`}
                  checked={l.kind === launchKindFor(current.cwd)}
                  testId={tid('menu', l.label)}
                  onClick={start(l.kind)}
                />
              ))}
              <div className="menu-sep" />
              {WEB_LINKS.map((w) => (
                <MenuItem
                  key={w.url}
                  icon={<Globe strokeWidth={2} />}
                  label={w.label}
                  hint={`Open ${w.url} in a pane\nShift-click for your browser`}
                  onClick={(event) => { onOpenMenu(null); onOpenWeb(w, event.shiftKey) }}
                />
              ))}
            </MenuPop>
          </div>
        )}
      </div>
    </section>
  )
}
