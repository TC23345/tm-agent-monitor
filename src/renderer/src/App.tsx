import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { SizeMode, StatusSnapshot, TerminalLaunch } from '@shared/types'
import { UsageDashboard } from './UsageDashboard'
import { ProjectGroup } from './ProjectGroup'
import { AgentContextMenu, type MenuState } from './AgentContextMenu'
import { NewProject } from './NewProject'
import { groupByProject } from './group'
import { applyOrder, useGroupOrder } from './useGroupOrder'
import { SettingsPanel } from './SettingsPanel'
import { COLLAPSE_ALL_EVENT } from './useCollapse'
import { UsagePane } from './UsagePane'
import { TopBar, type MenuName } from './TopBar'
import { Pane } from './Pane'
import { TerminalPane, type TerminalPaneHandle } from './TerminalPane'
import { MenuCheckItem, MenuItem, MenuPop } from './Menu'
import { SNIPPETS } from './snippets'
import { NameDialog } from './NameDialog'
import { LAYOUT_NAME_MAX, loadLayouts, panesFromLayout, saveLayouts, snapshotLayout, type LayoutMap } from './layouts'
import { tid } from './testid'
import { nextWaiting, paneForAgent, waitingAgents, waitingFirst } from '@shared/attention.mjs'
import { CommandPalette, type PaletteItem } from './CommandPalette'
import { ProviderBadge } from './ProviderBadge'
import { Settings as SettingsIcon } from './Icons'
import {
  MAX_PANES, PANE_KINDS, SIDEBAR_VIEWS, defaultPanes, emptySizes, isTopSidebarView, isUniqueKind, loadPaneCols,
  loadPanes, loadSidebarCollapsed, loadSidebarViews, loadSizes, newPane, savePaneCols, savePanes,
  saveSidebarCollapsed, saveSidebarViews, saveSizes,
  type AllSizes, type PaneCols, type PaneInstance, type PaneKind, type PaneSizes, type SidebarView,
  type TerminalPaneConfig
} from './panes'
import { Splitter } from './Splitter'
import {
  PANE_MIN, PANE_MIN_ROW, clampSidebarWidth, columnTemplate, normalizeFractions, resizeFractions,
  trackWidths, viewportBucket, type SizeBucket
} from '@shared/layout.mjs'
import {
  LaunchContextChip, LauncherPane, WindowsPane, WindowsRefreshButton, useDesktopWindows,
  type LaunchContext
} from './WorkspacePanes'
import {
  AppWindow, ChevronDown, ChevronsDownUp, ChevronsUpDown, Code2, Coins, Columns3, Eraser, ExternalLink, Filter,
  BellRing, Code2 as CursorIcon, Copy, Folder, FolderPlus, Globe, LayoutTemplate, Maximize2, Minimize2, Minus, Monitor,
  PanelLeft, PanelRight, Power, RotateCcw, Ruler, Save, Shrink, SquareSlash, SquareSplitHorizontal, SquareTerminal,
  Terminal, Trash2, X
} from 'lucide-react'
import type { DesktopWindow } from '@shared/types'

/** Most columns the viewport can hold before panes get crushed — the former
 * CSS breakpoints (styles.css), moved here so an explicit column choice and
 * the cap compose instead of the media query silently winning. */
function colCap(): number {
  return window.innerWidth >= 1400 ? 3 : window.innerWidth >= 1040 ? 2 : 1
}

/** Width of the gutter track a column splitter lives in. It replaces the grid's
 * column gap (styles.css `.grid`), so the spacing looks unchanged. */
const GRID_GUTTER = 10

export function App() {
  const [snap, setSnap] = useState<StatusSnapshot | null>(null)
  // Read once: the app version (bridge drift) and the CDP port, if any.
  const [appInfo, setAppInfo] = useState<{ version?: string; debugPort?: number }>({})
  // The pane the keyboard owns (Ctrl+1…6, Ctrl+Shift+←/→, or a click), and
  // the terminal pane whose snippet menu is open.
  const [focusedPane, setFocusedPane] = useState<string | null>(null)
  const [snippetsFor, setSnippetsFor] = useState<string | null>(null)
  // Ctrl+Shift+W cycles waiting sessions; remember where the cycle is.
  const lastRouted = useRef<string | null>(null)
  // Named layouts and the save-as prompt; a project group dragged over the grid.
  const [layouts, setLayouts] = useState<LayoutMap>(loadLayouts)
  const [layoutDialog, setLayoutDialog] = useState(false)
  const [gridDropHot, setGridDropHot] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [newProjectOpen, setNewProjectOpen] = useState(false)
  const [menu, setMenu] = useState<MenuState | null>(null)
  const [openMenu, setOpenMenu] = useState<MenuName | 'sidebar' | null>(null)
  const [waitingOnly, setWaitingOnly] = useState(false)
  const [allCollapsed, setAllCollapsed] = useState(false)
  const { order, save: saveOrder, clear: clearOrder } = useGroupOrder()
  const [dragKey, setDragKey] = useState<string | null>(null)
  const [drop, setDrop] = useState<{ key: string; after: boolean } | null>(null)
  // Main-frame layout: the launcher plus embedded terminal panes, drag-
  // reorderable, up to six. Persisted locally so a summoned workspace comes
  // back as you left it.
  const [panes, setPanes] = useState<PaneInstance[]>(loadPanes)
  const [paneDrag, setPaneDrag] = useState<string | null>(null)
  const [paneDrop, setPaneDrop] = useState<{ id: string; after: boolean } | null>(null)
  // Grid column preference (View menu). The viewport still caps the count so a
  // half-width window or narrow display never crushes panes.
  const [paneCols, setPaneCols] = useState<PaneCols>(loadPaneCols)
  const [viewportCap, setViewportCap] = useState(() => colCap())
  // Draggable sizes, held for every view bucket at once so switching between
  // the full and half workspace swaps splits instead of overwriting them.
  const [allSizes, setAllSizes] = useState<AllSizes>(loadSizes)
  const [bucket, setBucket] = useState<SizeBucket>(() => viewportBucket(window.innerWidth, window.screen.availWidth))
  // Zoom: one pane fills the grid while the rest stay mounted but hidden.
  const [zoom, setZoom] = useState<string | null>(null)
  // The command palette, and a one-shot window list for it (the sidebar's
  // poll only runs while its section is open; the palette wants the list now).
  const [palette, setPalette] = useState(false)
  const [paletteWindows, setPaletteWindows] = useState<DesktopWindow[]>([])
  // Live handles to the terminal panes, for the header tools (clear/restart).
  const termRefs = useRef(new Map<string, TerminalPaneHandle>())
  const [frameW, setFrameW] = useState(() => window.innerWidth)
  const frameRef = useRef<HTMLDivElement>(null)
  const gridRef = useRef<HTMLElement>(null)
  // Drag baselines: every splitter reports a delta from its own pointer-down,
  // so the geometry it started from is captured once instead of accumulated.
  const sidebarDrag = useRef(0)
  const trackDrag = useRef<{ axis: 'cols' | 'rows'; fracs: number[]; before: number; after: number } | null>(null)
  // The persisted workspace size (full / left half / right half). Main owns the
  // truth; the View menu radio reflects the configured default, not a transient
  // Alt+Q flip.
  const [sizeMode, setSizeMode] = useState<SizeMode>('full')
  // Data views stacked in the sidebar, toggled from the sidebar menu. Each
  // section can also roll up to just its header.
  const [sidebarViews, setSidebarViews] = useState<SidebarView[]>(loadSidebarViews)
  const [sidebarCollapsed, setSidebarCollapsed] = useState<SidebarView[]>(loadSidebarCollapsed)
  // Launch actions start in the active project by default; the header chip toggles
  // back to the home folder so a launch target is never a surprise.
  const [useProjectContext, setUseProjectContext] = useState(true)
  // Drives the slide-up / slide-down transition. Starts closed so the very first
  // painted frame is already off-screen and the card rises into place.
  const [open, setOpen] = useState(false)
  // Only enumerate windows while the sidebar section is actually showing them —
  // a collapsed section stops the polling just like a hidden one.
  const desktop = useDesktopWindows(sidebarViews.includes('windows') && !sidebarCollapsed.includes('windows'))

  useEffect(() => {
    window.watch.getStatus().then(setSnap)
    const off = window.watch.onStatus(setSnap)
    return off
  }, [])

  useEffect(() => savePanes(panes), [panes])
  useEffect(() => saveSidebarViews(sidebarViews), [sidebarViews])
  useEffect(() => saveSidebarCollapsed(sidebarCollapsed), [sidebarCollapsed])
  useEffect(() => savePaneCols(paneCols), [paneCols])
  useEffect(() => saveLayouts(layouts), [layouts])
  // Sizes change on every splitter pointermove; a synchronous localStorage
  // write per mouse event is the wrong price. Trailing 200ms, flushed on unmount.
  const pendingSizes = useRef<AllSizes | null>(null)
  useEffect(() => {
    pendingSizes.current = allSizes
    const t = window.setTimeout(() => {
      saveSizes(allSizes)
      pendingSizes.current = null
    }, 200)
    return () => window.clearTimeout(t)
  }, [allSizes])
  useEffect(() => () => { if (pendingSizes.current) saveSizes(pendingSizes.current) }, [])

  // Re-cap the columns when the window bounds change (size-mode switch, other
  // display). The window never resizes with content, so this only fires on real
  // bounds changes.
  useEffect(() => {
    const on = () => {
      setViewportCap(colCap())
      // One measurement per bounds change — the sidebar ceiling follows the
      // frame it shares. Deliberately not a ResizeObserver: bounds never track
      // content (CLAUDE.md), so `resize` is the whole story.
      setFrameW(frameRef.current?.clientWidth ?? window.innerWidth)
      // Half view or full? Read from the live viewport, since the transient
      // Alt+Q flip never touches the persisted sizeMode setting.
      setBucket(viewportBucket(window.innerWidth, window.screen.availWidth))
    }
    on()
    window.addEventListener('resize', on)
    return () => window.removeEventListener('resize', on)
  }, [])

  // Main owns sizeMode; hydrate the menu radio (and the app info) from settings once.
  useEffect(() => {
    window.watch.getSettings().then((s) => {
      setSizeMode(s.sizeMode)
      setAppInfo({ version: s.version, debugPort: s.debugPort })
    }).catch(() => {})
  }, [])
  const applySizeMode = (mode: SizeMode) => {
    setSizeMode(mode) // optimistic — the window re-sizes in the same beat
    window.watch.setSettings({ sizeMode: mode }).then((s) => setSizeMode(s.sizeMode)).catch(() => {})
  }

  // Main sequences the animation: it shows the window then sends 'enter', and on
  // hide sends 'exit' and waits for the slide-down before the window disappears.
  // The mount frame covers the very first show, whose event predates this listener.
  useEffect(() => {
    const raf = requestAnimationFrame(() => setOpen(true))
    const off = window.watch.onWindowPhase((phase) => {
      if (phase === 'exit') setOpen(false)
      else requestAnimationFrame(() => setOpen(true))
    })
    return () => {
      cancelAnimationFrame(raf)
      off()
    }
  }, [])

  // Escape closes an open menu, the palette, or a dialog, then un-zooms, and
  // otherwise dismisses the workspace (it no longer auto-hides on blur, so this
  // is the fast keyboard way out). Keys inside an embedded terminal belong to
  // the shell — Escape there interrupts the CLI, it must never also hide the
  // workspace, and Ctrl+P is the shell's too. Only the Ctrl+Shift chords reach
  // past a focused terminal, which is why the palette's canonical shortcut is
  // Ctrl+Shift+P rather than Ctrl+P alone.
  const onKeyRef = useRef<(e: KeyboardEvent) => void>(() => {})
  onKeyRef.current = (e: KeyboardEvent) => {
      const inTerminal = !!(e.target as HTMLElement)?.closest?.('.termpane')
      const ctrl = e.ctrlKey && !e.altKey && !e.metaKey
      if (ctrl && e.shiftKey && (e.key === 'P' || e.key === 'p')) {
        e.preventDefault()
        setPalette((v) => !v)
        return
      }
      if (ctrl && e.shiftKey && e.key === '`') {
        e.preventDefault()
        newTerminal('shell')
        return
      }
      if (ctrl && e.shiftKey && (e.key === 'W' || e.key === 'w')) {
        e.preventDefault()
        routeToWaiting()
        return
      }
      if (ctrl && e.shiftKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
        e.preventDefault()
        stepFocus(e.key === 'ArrowRight' ? 1 : -1)
        return
      }
      if (ctrl && !e.shiftKey && /^[1-6]$/.test(e.key)) {
        const target = panes[Number(e.key) - 1]
        if (target) {
          e.preventDefault()
          focusPane(target.id)
        }
        return
      }
      if (inTerminal) return
      if (ctrl && !e.shiftKey && (e.key === 'p' || e.key === 'P')) {
        e.preventDefault()
        setPalette((v) => !v)
        return
      }
      if (ctrl && !e.shiftKey && e.key === ',') {
        e.preventDefault()
        setSettingsOpen(true)
        return
      }
      if (e.key !== 'Escape') return
      if (menu) setMenu(null)
      else if (snippetsFor) setSnippetsFor(null)
      else if (openMenu) setOpenMenu(null)
      else if (palette) setPalette(false)
      else if (layoutDialog) setLayoutDialog(false)
      else if (newProjectOpen) setNewProjectOpen(false)
      else if (zoom) setZoom(null)
      else if (!settingsOpen) window.watch.hide()
  }
  // Capture phase: xterm stops propagation of keys it handles, and a chord
  // meant for the app must win before the shell sees it. Subscribed once; the
  // ref above carries the latest closure.
  useEffect(() => {
    const listener = (e: KeyboardEvent) => onKeyRef.current(e)
    window.addEventListener('keydown', listener, true)
    return () => window.removeEventListener('keydown', listener, true)
  }, [])

  // The palette lists open windows: refresh once per open rather than polling.
  useEffect(() => {
    if (!palette) return
    let live = true
    window.watch.listWindows().then((list) => { if (live) setPaletteWindows(list) }).catch(() => {})
    return () => { live = false }
  }, [palette])

  const agents = snap?.agents ?? []
  const waitingParents = new Set(agents.filter((a) => a.state === 'waiting' && a.parentId).map((a) => a.parentId!))
  const visibleAgents = useMemo(
    () => (waitingOnly ? agents.filter((a) => a.state === 'waiting' || waitingParents.has(a.id)) : agents),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- waitingParents derives from agents
    [agents, waitingOnly]
  )
  // Grouping is the priciest pure step on the render path; only agents, the
  // dragged order, and the filter change it.
  const groups = useMemo(() => applyOrder(groupByProject(visibleAgents), order), [visibleAgents, order])
  const waiting = snap?.waitingCount ?? 0

  // The root session touched most recently — the default folder for launches.
  const recent = [...agents]
    .filter((a) => a.cwd && !a.parentId)
    .sort((a, b) => b.updatedAt - a.updatedAt)[0]
  const context: LaunchContext = {
    cwd: useProjectContext ? recent?.cwd : undefined,
    label: useProjectContext ? recent?.project : undefined,
    onToggle: recent?.cwd ? () => setUseProjectContext((v) => !v) : undefined
  }

  // When the last waiting session resolves, drop the filter so the list never
  // strands empty with no chip left to click.
  useEffect(() => {
    if (waitingOnly && waiting === 0) setWaitingOnly(false)
  }, [waitingOnly, waiting])

  const commitDrop = () => {
    if (dragKey && drop && dragKey !== drop.key) {
      const keys = groups.map((group) => group.key).filter((key) => key !== dragKey)
      const at = keys.indexOf(drop.key)
      keys.splice(at + (drop.after ? 1 : 0), 0, dragKey)
      saveOrder([...keys, ...order.filter((key) => !keys.includes(key))])
    }
    setDragKey(null)
    setDrop(null)
  }

  const collapseAll = () => {
    const next = !allCollapsed
    setAllCollapsed(next)
    window.dispatchEvent(new CustomEvent(COLLAPSE_ALL_EVENT, { detail: next }))
  }
  const health = { providers: snap?.providers, mock: !!snap?.mock, version: appInfo.version }
  const noHooks = !!snap && !snap.mock && Object.values(snap.providers).every((h) => !h.reporting)

  const agentList = !snap ? (
    <div className="empty">Connecting…</div>
  ) : groups.length === 0 ? (
    <div className="empty">
      {noHooks
        ? 'No provider reports yet. Install hooks and review Codex trust in /hooks.'
        : 'No active agents. Start Claude Code, Codex, or Cursor in a project.'}
    </div>
  ) : (
    groups.map((group) => (
      <div
        key={group.key}
        className={`group-slot ${dragKey === group.key ? 'is-dragging' : ''} ${
          drop?.key === group.key && dragKey && dragKey !== group.key ? (drop.after ? 'drop-after' : 'drop-before') : ''
        }`}
        onDragOver={(event) => {
          if (!dragKey) return
          event.preventDefault()
          event.dataTransfer.dropEffect = 'move'
          const rect = event.currentTarget.getBoundingClientRect()
          const after = event.clientY > rect.top + rect.height / 2
          setDrop((current) => current?.key === group.key && current.after === after ? current : { key: group.key, after })
        }}
        onDrop={(event) => {
          event.preventDefault()
          commitDrop()
        }}
      >
        <ProjectGroup
          group={group}
          onRowMenu={setMenu}
          forceWaitingOpen={waitingOnly}
          dragHandle={{
            draggable: true,
            onDragStart: (event) => {
              event.dataTransfer.effectAllowed = 'move'
              event.dataTransfer.setData('text/plain', group.key)
              setDragKey(group.key)
            },
            onDragEnd: () => {
              setDragKey(null)
              setDrop(null)
            }
          }}
        />
      </div>
    ))
  )

  /** Add a pane of `kind` if the layout allows it. Terminals repeat; others don't. */
  const addPane = (kind: PaneKind, term?: TerminalPaneConfig) => {
    if (panes.length >= MAX_PANES) return
    if (isUniqueKind(kind) && panes.some((p) => p.kind === kind)) return
    const pane = newPane(kind, term)
    setPanes([...panes, pane])
    setFocusedPane(pane.id)
  }

  /** Give a pane the keyboard: a terminal takes real focus, anything else the slot. */
  const focusPane = (paneId: string) => {
    setFocusedPane(paneId)
    const handle = termRefs.current.get(paneId)
    if (handle) handle.focus()
    else document.querySelector<HTMLElement>(`[data-pane="${paneId}"]`)?.focus()
  }

  const stepFocus = (delta: 1 | -1) => {
    if (panes.length === 0) return
    const at = panes.findIndex((p) => p.id === focusedPane)
    const next = panes[(at + delta + panes.length) % panes.length]
    focusPane(next.id)
  }

  /** Ctrl+Shift+W: the next waiting session — its own pane if it has one
   * (zoomed into view if something else is zoomed), else its real window. */
  const routeToWaiting = () => {
    const target = nextWaiting(snap?.agents, lastRouted.current)
    if (!target) return
    lastRouted.current = target.id
    const pane = paneForAgent(panes, target)
    if (pane) {
      if (zoom && zoom !== pane.id) setZoom(pane.id)
      focusPane(pane.id)
    } else {
      window.watch.focusAgent(target.id)
    }
  }

  /** User → Usage: open the pane, or bring the open one forward. `addPane`
   * already refuses a full grid; a lone pane has nothing to zoom over. */
  const openUsage = () => {
    const existing = panes.find((p) => p.kind === 'usage')
    if (!existing) {
      addPane('usage')
      return
    }
    if (panes.length > 1) setZoom(existing.id)
  }

  /** Layouts: a named snapshot of panes, sizes, sidebar views, and columns.
   * Applying one replaces the grid — open shells are disposed first so nothing
   * keeps running unseen — and restores terminals as fresh shells. */
  const saveLayoutAs = (name: string) => {
    setLayouts((current) => ({
      ...current,
      [name]: snapshotLayout({ panes, sizes: allSizes, sidebar: sidebarViews, collapsed: sidebarCollapsed, cols: paneCols })
    }))
    setLayoutDialog(false)
  }
  const applyLayout = (name: string) => {
    const layout = layouts[name]
    if (!layout) return
    for (const p of panes) if (p.term?.sessionId) window.watch.disposeTerminal(p.term.sessionId)
    const next = panesFromLayout(layout)
    setPanes(next.length ? next : defaultPanes())
    setAllSizes(layout.sizes)
    setSidebarViews(layout.sidebar)
    setSidebarCollapsed(layout.collapsed)
    setPaneCols(layout.cols)
    setZoom(null)
    setFocusedPane(null)
  }
  const deleteLayout = (name: string) =>
    setLayouts((current) => {
      const next = { ...current }
      delete next[name]
      return next
    })
  const layoutNames = Object.keys(layouts).sort((a, b) => a.localeCompare(b))

  /** Root sessions near their context limit and still climbing — the title
   * bar chip, the notification in main, and the Compact tool all key off this. */
  const hotAgents = agents.filter((a) => !a.parentId && a.contextRising && (a.contextPct ?? 0) >= 85)
  const hot = hotAgents.map((a) => ({ id: a.id, project: a.project, pct: Math.round(a.contextPct ?? 0) }))

  /** A project group dropped on the grid: a shell there (Shift for Claude Code). */
  const dropProject = (key: string, claude: boolean) => {
    const group = groups.find((g) => g.key === key)
    if (!group?.cwd) return
    addPane('terminal', { launch: claude ? 'claude' : 'shell', cwd: group.cwd, label: group.project })
  }

  /** Embedded launch: a terminal pane in the current context. When the grid is
   * full it degrades to the old behavior — an external window. */
  const newTerminal = (launch: TerminalLaunch) => {
    if (panes.length >= MAX_PANES) {
      window.watch.openTerminal(context.cwd, launch)
      return
    }
    addPane('terminal', { launch, cwd: context.cwd, label: context.label })
  }

  const updateTerm = (paneId: string, patch: Partial<TerminalPaneConfig>) =>
    setPanes((current) => current.map((p) =>
      p.id === paneId && p.term ? { ...p, term: { ...p.term, ...patch } } : p
    ))

  const closePane = (paneId: string) => {
    const closing = panes.find((p) => p.id === paneId)
    if (closing?.term?.sessionId) window.watch.disposeTerminal(closing.term.sessionId)
    const next = panes.filter((p) => p.id !== paneId)
    setPanes(next.length ? next : defaultPanes())
    if (focusedPane === paneId) setFocusedPane(null)
    if (snippetsFor === paneId) setSnippetsFor(null)
  }

  const commitPaneDrop = () => {
    if (paneDrag && paneDrop && paneDrag !== paneDrop.id) {
      const moving = panes.find((p) => p.id === paneDrag)
      if (moving) {
        const rest = panes.filter((p) => p.id !== paneDrag)
        const at = rest.findIndex((p) => p.id === paneDrop.id)
        rest.splice(at + (paneDrop.after ? 1 : 0), 0, moving)
        setPanes(rest)
      }
    }
    setPaneDrag(null)
    setPaneDrop(null)
  }

  const paneBody = (pane: PaneInstance) => {
    switch (pane.kind) {
      case 'launcher':
        return <LauncherPane context={context} onNewProject={() => setNewProjectOpen(true)} onEmbedTerminal={newTerminal} />
      case 'usage':
        return <UsagePane usage={snap?.usage} />
      case 'terminal':
        return (
          <TerminalPane
            ref={(handle) => {
              if (handle) termRefs.current.set(pane.id, handle)
              else termRefs.current.delete(pane.id)
            }}
            config={pane.term!}
            onConfig={(patch) => updateTerm(pane.id, patch)}
          />
        )
    }
  }

  /** What sits after the title: the launcher's folder chip, a terminal's
   * launch + folder label. */
  const paneContext = (pane: PaneInstance) => {
    if (pane.kind === 'launcher') return <LaunchContextChip context={context} />
    if (pane.kind === 'terminal' && pane.term) {
      const label = pane.term.launch === 'shell' ? null : pane.term.launch === 'codex' ? 'Codex' : 'Claude Code'
      const where = pane.term.label ?? (pane.term.cwd ? pane.term.cwd.split(/[\\/]/).pop() : null)
      if (!label && !where) return null
      return <span className="pane-context is-project" title={pane.term.cwd ?? 'Home folder'}>{[label, where].filter(Boolean).join(' · ')}</span>
    }
    return null
  }

  const tool = (title: string, icon: ReactNode, onClick: () => void, disabled = false) => (
    <button className="iconbtn iconbtn--sm" onClick={onClick} title={title} aria-label={title} disabled={disabled} data-testid={tid('pane-tool', title)}>
      {icon}
    </button>
  )
  const ic = (Icon: typeof Folder) => <Icon className="gear gear--sm" strokeWidth={2} />

  /** The header tool strip, per kind — an editor title bar's actions. */
  const paneTools = (pane: PaneInstance) => {
    if (pane.kind === 'launcher') {
      return (
        <>
          {tool('New project', ic(FolderPlus), () => setNewProjectOpen(true))}
          {tool('Open the Projects folder', ic(Folder), () => window.watch.openProjectsDir())}
        </>
      )
    }
    if (pane.kind === 'terminal' && pane.term) {
      const term = pane.term
      const handle = () => termRefs.current.get(pane.id)
      const hotHere = term.launch === 'claude' ? hotAgents.find((a) => paneForAgent([pane], a)?.id === pane.id) : undefined
      return (
        <>
          {hotHere && tool(
            `Compact now — ${Math.round(hotHere.contextPct ?? 0)}% of context used and rising`,
            ic(Shrink),
            () => { if (term.sessionId) window.watch.termInput(term.sessionId, '/compact\r'); handle()?.focus() }
          )}
          {tool(
            panes.length >= MAX_PANES ? 'All six panes are open' : 'Split: another terminal in this folder',
            ic(SquareSplitHorizontal),
            () => addPane('terminal', { launch: 'shell', cwd: term.cwd, label: term.label }),
            panes.length >= MAX_PANES
          )}
          <span className="menu-wrap">
            {tool('Snippets: type a command into this terminal', ic(SquareSlash), () => setSnippetsFor((cur) => (cur === pane.id ? null : pane.id)))}
            {snippetsFor === pane.id && (
              <MenuPop onAway={() => setSnippetsFor(null)} ignoreSelector=".gpane-tools .menu-wrap">
                {SNIPPETS[term.launch].map((snip) => (
                  <MenuItem
                    key={snip.text}
                    label={snip.label}
                    hint={snip.hint}
                    onClick={() => {
                      setSnippetsFor(null)
                      const sid = term.sessionId
                      if (sid) window.watch.termInput(sid, `${snip.text}\r`)
                      handle()?.focus()
                    }}
                  />
                ))}
              </MenuPop>
            )}
          </span>
          {tool('Clear the terminal', ic(Eraser), () => handle()?.clear())}
          {tool('Restart the shell', ic(RotateCcw), () => handle()?.restart())}
          {tool('Open an external terminal here', ic(ExternalLink), () => window.watch.openTerminal(term.cwd, term.launch === 'shell' ? 'shell' : term.launch))}
          {term.cwd && tool('Open this folder in Explorer', ic(Folder), () => window.watch.openPath(term.cwd!))}
        </>
      )
    }
    return null
  }

  const toggleSidebarView = (view: SidebarView) =>
    setSidebarViews((current) => current.includes(view)
      ? current.filter((v) => v !== view)
      : [...current, view]
    )

  const toggleSidebarCollapsed = (view: SidebarView) =>
    setSidebarCollapsed((current) => current.includes(view)
      ? current.filter((v) => v !== view)
      : [...current, view]
    )

  const sidebarBody = (view: SidebarView) => {
    switch (view) {
      case 'limits':
        return snap ? <UsageDashboard usage={snap.usage} /> : <div className="empty">Connecting…</div>
      case 'windows':
        return <WindowsPane windows={desktop.windows} />
    }
  }

  const sideSection = (v: (typeof SIDEBAR_VIEWS)[number], top = false) => {
    const rolled = sidebarCollapsed.includes(v.id)
    return (
      <section className={`sideview ${top ? 'sideview--top' : ''} ${rolled ? 'is-collapsed' : ''}`} key={v.id}>
        <div className="pane-head sideview-head">
          <button
            className="sidebar-title"
            data-testid={tid('sideview', v.id)}
            onClick={() => toggleSidebarCollapsed(v.id)}
            aria-expanded={!rolled}
            title={rolled ? `Show ${v.label}` : `Collapse ${v.label}`}
          >
            <v.icon className="gpane-ic" strokeWidth={2} />
            <span className="pane-title">{v.label}</span>
            <ChevronDown className={`sidebar-caret ${rolled ? 'is-closed' : ''}`} strokeWidth={2} />
          </button>
          <span className="gpane-actions">
            {v.id === 'windows' && !rolled && <WindowsRefreshButton refreshing={desktop.refreshing} refresh={desktop.refresh} />}
            <button className="iconbtn iconbtn--sm" onClick={() => toggleSidebarView(v.id)} title="Hide this view" aria-label={`Hide ${v.label}`}>
              <X className="gear gear--sm" strokeWidth={2} />
            </button>
          </span>
        </div>
        {!rolled && <div className="sideview-body">{sidebarBody(v.id)}</div>}
      </section>
    )
  }

  // Sections render in the fixed catalog order so toggling never reshuffles.
  // Open windows and Limits pin above the agent list; the rest stack below it.
  const activeViews = SIDEBAR_VIEWS.filter((v) => sidebarViews.includes(v.id))
  const topViews = activeViews.filter((v) => isTopSidebarView(v.id))
  const belowViews = activeViews.filter((v) => !isTopSidebarView(v.id))

  // Live geometry for this bucket. The column count still composes choice, pane
  // count and the viewport cap; the fractions only re-split what that leaves.
  const sizes = allSizes[bucket]
  const sidebarWidth = clampSidebarWidth(sizes.sidebar, frameW)
  const cols = Math.max(1, Math.min(paneCols === 'auto' ? 3 : paneCols, panes.length, viewportCap))
  const rows = Math.ceil(panes.length / cols)
  const colFracs = normalizeFractions(sizes.cols[String(cols)], cols)
  const rowFracs = normalizeFractions(sizes.rows[String(rows)], rows)
  // A pane closed while zoomed leaves a stale id; the grid falls back to the
  // full layout rather than rendering nothing.
  const zoomed = zoom && panes.some((p) => p.id === zoom) ? zoom : null
  const sized = Object.values(allSizes).some(
    (s: PaneSizes) => s.sidebar !== null || Object.keys(s.cols).length > 0 || Object.keys(s.rows).length > 0
  )

  const patchSizes = (patch: (current: PaneSizes) => PaneSizes) =>
    setAllSizes((current) => ({ ...current, [bucket]: patch(current[bucket]) }))

  /** Every splitter back to its default, in both views — the escape hatch for a
   * layout dragged somewhere useless on a display that no longer exists. */
  const resetSizes = () => setAllSizes({ full: emptySizes(), half: emptySizes() })

  const beginTrackDrag = (axis: 'cols' | 'rows', index: number) => {
    // Measure the *used* track sizes rather than assuming the padding and gap:
    // the computed template is already in pixels, so nothing here can drift out
    // of sync with styles.css.
    const computed = gridRef.current ? getComputedStyle(gridRef.current) : null
    const tracks = trackWidths(computed && (axis === 'cols' ? computed.gridTemplateColumns : computed.gridTemplateRows))
    trackDrag.current = {
      axis,
      fracs: axis === 'cols' ? colFracs : rowFracs,
      before: tracks[index * 2] ?? 0,
      after: tracks[index * 2 + 2] ?? 0
    }
  }

  const dragTrack = (index: number, delta: number) => {
    const start = trackDrag.current
    if (!start) return
    const min = start.axis === 'cols' ? PANE_MIN : PANE_MIN_ROW
    const next = resizeFractions(start.fracs, index, delta, start.before, start.after, min)
    const count = String(start.axis === 'cols' ? cols : rows)
    patchSizes((current) => ({ ...current, [start.axis]: { ...current[start.axis], [count]: next } }))
  }

  const resetTrack = (axis: 'cols' | 'rows') =>
    patchSizes((current) => {
      const next = { ...current[axis] }
      delete next[String(axis === 'cols' ? cols : rows)]
      return { ...current, [axis]: next }
    })

  /** Everything the palette can run. Commands mirror the menus (so a menu and
   * the palette never disagree), then live agents, then open windows. */
  const paletteItems = (): PaletteItem[] => {
    const items: PaletteItem[] = []
    const cmd = (id: string, label: string, run: () => void, extra: Partial<PaletteItem> = {}) =>
      items.push({ id: `cmd:${id}`, section: 'command', label, run, ...extra })
    const full = panes.length >= MAX_PANES
    cmd('new-terminal', 'New terminal', () => newTerminal('shell'), { icon: <Terminal strokeWidth={2} />, keywords: ['shell', 'powershell'], keys: ['Ctrl', 'Shift', '`'], detail: full ? 'opens a window — all six panes are open' : undefined })
    cmd('new-claude', 'New Claude Code', () => newTerminal('claude'), { icon: <ProviderBadge provider="claude" />, keywords: ['agent'] })
    cmd('new-codex', 'New Codex', () => newTerminal('codex'), { icon: <ProviderBadge provider="codex" />, keywords: ['agent'] })
    cmd('ext-terminal', 'Open external terminal', () => window.watch.openTerminal(context.cwd, 'shell'), { icon: <SquareTerminal strokeWidth={2} />, detail: context.label ?? 'home folder' })
    cmd('cursor', 'Open Cursor', () => window.watch.openCursor(context.cwd), { icon: <Code2 strokeWidth={2} />, detail: context.label, keywords: ['editor'] })
    cmd('chrome', 'Open Chrome', () => window.watch.openChrome(), { icon: <Globe strokeWidth={2} />, keywords: ['browser'] })
    cmd('new-project', 'New project…', () => setNewProjectOpen(true), { icon: <FolderPlus strokeWidth={2} /> })
    cmd('projects-dir', 'Open Projects folder', () => window.watch.openProjectsDir(), { icon: <Folder strokeWidth={2} />, keywords: ['explorer'] })
    const hasUsage = panes.some((p) => p.kind === 'usage')
    cmd('usage', 'Usage: spend & insights', openUsage, {
      icon: <Coins strokeWidth={2} />,
      keywords: ['spend', 'insights', 'tokens', 'cost', 'value', 'report'],
      detail: hasUsage ? 'zoom the open pane' : full ? 'all six panes are open' : undefined
    })
    if (!full) {
      for (const k of PANE_KINDS) {
        if (isUniqueKind(k.id) && !panes.some((p) => p.kind === k.id)) {
          cmd(`add-${k.id}`, `Add pane: ${k.label}`, () => addPane(k.id), { icon: <k.icon strokeWidth={2} />, keywords: ['pane', 'view'] })
        }
      }
    }
    for (const pane of panes) {
      const kindLabel = pane.kind === 'terminal'
        ? `Terminal${pane.term?.label ? ` · ${pane.term.label}` : ''}`
        : PANE_KINDS.find((k) => k.id === pane.kind)!.label
      if (panes.length > 1) {
        cmd(`zoom:${pane.id}`, zoomed === pane.id ? `Restore grid` : `Zoom pane: ${kindLabel}`, () => setZoom(zoomed === pane.id ? null : pane.id), { icon: zoomed === pane.id ? <Minimize2 strokeWidth={2} /> : <Maximize2 strokeWidth={2} />, keywords: ['maximize', 'focus'] })
      }
      cmd(`close:${pane.id}`, `Close pane: ${kindLabel}`, () => closePane(pane.id), { icon: <X strokeWidth={2} /> })
    }
    for (const v of SIDEBAR_VIEWS) {
      const on = sidebarViews.includes(v.id)
      cmd(`view:${v.id}`, `${on ? 'Hide' : 'Show'} ${v.label}`, () => toggleSidebarView(v.id), { icon: <v.icon strokeWidth={2} />, detail: 'sidebar', keywords: ['sidebar', 'toggle'] })
    }
    cmd('collapse', allCollapsed ? 'Expand all projects' : 'Collapse all projects', collapseAll, { icon: allCollapsed ? <ChevronsUpDown strokeWidth={2} /> : <ChevronsDownUp strokeWidth={2} /> })
    cmd('waiting', waitingOnly ? 'Show all sessions' : 'Show waiting only', () => setWaitingOnly((v) => !v), { icon: <Filter strokeWidth={2} /> })
    cmd('size-full', 'Workspace size: Full screen', () => applySizeMode('full'), { icon: <Monitor strokeWidth={2} />, detail: sizeMode === 'full' ? 'current' : undefined })
    cmd('size-left', 'Workspace size: Left half', () => applySizeMode('left'), { icon: <PanelLeft strokeWidth={2} />, detail: sizeMode === 'left' ? 'current' : undefined })
    cmd('size-right', 'Workspace size: Right half', () => applySizeMode('right'), { icon: <PanelRight strokeWidth={2} />, detail: sizeMode === 'right' ? 'current' : undefined })
    for (const c of ['auto', 1, 2, 3] as const) {
      cmd(`cols-${c}`, `Columns: ${c === 'auto' ? 'Auto' : c}`, () => setPaneCols(c), { icon: <Columns3 strokeWidth={2} />, detail: paneCols === c ? 'current' : undefined, keywords: ['grid', 'layout'] })
    }
    if (sized) cmd('reset-sizes', 'Reset pane sizes', resetSizes, { icon: <Ruler strokeWidth={2} />, keywords: ['layout', 'splitter'] })
    cmd('save-layout', 'Save current layout…', () => setLayoutDialog(true), { icon: <Save strokeWidth={2} />, keywords: ['workspace', 'preset'] })
    for (const name of layoutNames) {
      cmd(`layout:${name}`, `Layout: ${name}`, () => applyLayout(name), { icon: <LayoutTemplate strokeWidth={2} />, keywords: ['workspace', 'preset', 'apply'] })
    }
    for (const name of layoutNames) {
      cmd(`layout-delete:${name}`, `Delete layout: ${name}`, () => deleteLayout(name), { icon: <Trash2 strokeWidth={2} />, keywords: ['workspace', 'preset'] })
    }
    if (order.length > 0) cmd('reset-order', 'Reset project order', clearOrder, { icon: <ChevronsUpDown strokeWidth={2} /> })
    if (waitingAgents(agents).length > 0) cmd('route-waiting', 'Go to next waiting session', routeToWaiting, { icon: <BellRing strokeWidth={2} />, keys: ['Ctrl', 'Shift', 'W'], keywords: ['attention', 'question', 'input'] })
    cmd('settings', 'Settings…', () => setSettingsOpen(true), { icon: <SettingsIcon strokeWidth={2} />, keys: ['Ctrl', ','], keywords: ['hotkey', 'hooks', 'updates', 'preferences'] })
    cmd('hide', 'Hide to tray', () => window.watch.hide(), { icon: <Minus strokeWidth={2} />, keys: ['Esc'] })
    cmd('quit', 'Quit', () => window.watch.quit(), { icon: <Power strokeWidth={2} />, keywords: ['exit'] })

    for (const a of waitingFirst(agents.filter((x) => !x.parentId))) {
      items.push({
        id: `agent:${a.id}`,
        section: 'agent',
        label: a.project,
        detail: a.state === 'waiting'
          ? `waiting · ${a.question ?? a.activity ?? 'needs input'}`
          : [a.state, a.activity].filter(Boolean).join(' · '),
        keywords: [a.provider, a.cwd ?? '', a.model ?? ''],
        icon: <ProviderBadge provider={a.provider} />,
        run: () => window.watch.focusAgent(a.id)
      })
    }
    // Per-session actions, after the focus rows so `@` still leads with sessions.
    for (const a of agents.filter((x) => !x.parentId && x.cwd)) {
      const cwd = a.cwd!
      const sub = (id: string, label: string, icon: ReactNode, run: () => void) =>
        items.push({ id: `agent:${a.id}:${id}`, section: 'agent', label: `${a.project} — ${label}`, detail: cwd, keywords: [a.provider, label], icon, run })
      if (!full) sub('terminal', 'terminal here', <Terminal strokeWidth={2} />, () => addPane('terminal', { launch: 'shell', cwd, label: a.project }))
      sub('folder', 'open folder', <Folder strokeWidth={2} />, () => window.watch.openPath(cwd))
      sub('cursor', 'open in Cursor', <CursorIcon strokeWidth={2} />, () => window.watch.openCursor(cwd))
      sub('copy', 'copy path', <Copy strokeWidth={2} />, () => window.watch.copyText(cwd))
    }
    for (const w of paletteWindows) {
      items.push({
        id: `win:${w.hwnd}`,
        section: 'window',
        label: w.title,
        detail: w.app,
        keywords: [w.kind],
        icon: w.agentProvider ? <ProviderBadge provider={w.agentProvider} /> : <AppWindow strokeWidth={2} />,
        run: () => window.watch.focusWindow(w.hwnd, w.pid)
      })
    }
    return items
  }

  // Which pane each waiting session lives in, for the header badge.
  const paneAttention = new Map<string, string>()
  for (const a of waitingAgents(agents)) {
    const pane = paneForAgent(panes, a)
    if (pane && !paneAttention.has(pane.id)) paneAttention.set(pane.id, a.question ?? a.activity ?? 'needs input')
  }

  return (
    <div className={`app ${open ? 'is-open' : ''}`}>
      <TopBar
        waiting={waiting}
        waitingOnly={waitingOnly}
        onWaitingOnly={() => setWaitingOnly((v) => !v)}
        canCollapse={groups.length > 1}
        allCollapsed={allCollapsed}
        onCollapseAll={collapseAll}
        health={health}
        debugPort={appInfo.debugPort}
        panes={panes}
        onAddPane={addPane}
        onNewTerminal={newTerminal}
        onNewProject={() => setNewProjectOpen(true)}
        canResetOrder={order.length > 0}
        onResetOrder={clearOrder}
        onSettings={() => setSettingsOpen(true)}
        sizeMode={sizeMode}
        onSizeMode={applySizeMode}
        paneCols={paneCols}
        onPaneCols={setPaneCols}
        canResetSizes={sized}
        onResetSizes={resetSizes}
        openMenu={openMenu === 'sidebar' ? null : openMenu}
        onOpenMenu={setOpenMenu}
        onPalette={() => setPalette((v) => !v)}
        onUsage={openUsage}
        layouts={layoutNames}
        onSaveLayout={() => setLayoutDialog(true)}
        onApplyLayout={applyLayout}
        onDeleteLayout={deleteLayout}
        hot={hot}
        onFocusAgent={(id) => {
          const agent = agents.find((a) => a.id === id)
          const pane = agent ? paneForAgent(panes, agent) : null
          if (pane) focusPane(pane.id)
          else window.watch.focusAgent(id)
        }}
      />

      <div className="frame" ref={frameRef}>
        <aside className="sidebar" style={{ flexBasis: sidebarWidth }}>
          {topViews.map((v) => sideSection(v, true))}
          <div className="pane-head sidebar-head">
            <button
              className="sidebar-title"
              data-testid="sidebar-menu"
              onClick={() => setOpenMenu(openMenu === 'sidebar' ? null : 'sidebar')}
              aria-expanded={openMenu === 'sidebar'}
              title="Choose which views stack below the agent list"
            >
              <span className="pane-title">Coding agents</span>
              <ChevronDown className="sidebar-caret" strokeWidth={2} />
            </button>
            {agents.length > 0 && <span className="pane-count">{agents.filter((a) => !a.parentId).length}</span>}
            {openMenu === 'sidebar' && (
              <MenuPop onAway={() => setOpenMenu(null)} ignoreSelector=".sidebar-head">
                {SIDEBAR_VIEWS.map((v) => (
                  <MenuCheckItem
                    key={v.id}
                    icon={<v.icon strokeWidth={2} />}
                    label={v.label}
                    hint={v.hint}
                    checked={sidebarViews.includes(v.id)}
                    onClick={() => toggleSidebarView(v.id)}
                  />
                ))}
              </MenuPop>
            )}
          </div>
          <div className="pane-scroll">
            <div className="agents-inner">{agentList}</div>
          </div>
          {belowViews.map((v) => sideSection(v))}
        </aside>

        <Splitter
          className="splitter--frame"
          testId="splitter-sidebar"
          label="Sidebar width"
          onStart={() => { sidebarDrag.current = sidebarWidth }}
          onMove={(delta) => patchSizes((current) => ({ ...current, sidebar: clampSidebarWidth(sidebarDrag.current + delta, frameW) }))}
          onReset={() => patchSizes((current) => ({ ...current, sidebar: null }))}
        />

        {/* The gutter tracks between columns and rows are where the splitters
            live, so panes are placed explicitly instead of auto-flowing. A
            zoomed grid is one track — its splitters have nothing to split. */}
        <main
          className={`grid ${zoomed ? 'is-zoomed' : ''} ${gridDropHot ? 'is-drop-target' : ''}`}
          ref={gridRef}
          onDragOver={(event) => {
            if (!dragKey) return
            event.preventDefault()
            event.dataTransfer.dropEffect = 'copy'
            if (!gridDropHot) setGridDropHot(true)
          }}
          onDragLeave={(event) => {
            if (event.currentTarget.contains(event.relatedTarget as Node | null)) return
            setGridDropHot(false)
          }}
          onDrop={(event) => {
            if (!dragKey) return
            event.preventDefault()
            dropProject(dragKey, event.shiftKey)
            setGridDropHot(false)
            setDragKey(null)
            setDrop(null)
          }}
          style={{
            gridTemplateColumns: zoomed ? '1fr' : columnTemplate(colFracs, GRID_GUTTER),
            gridTemplateRows: zoomed ? '1fr' : columnTemplate(rowFracs, GRID_GUTTER),
            columnGap: 0,
            rowGap: 0
          }}
        >
          {panes.map((pane, index) => (
            <div
              key={pane.id}
              className={`pane-slot ${paneDrag === pane.id ? 'is-dragging' : ''} ${focusedPane === pane.id ? 'is-focused' : ''} ${
                paneDrop?.id === pane.id && paneDrag && paneDrag !== pane.id ? (paneDrop.after ? 'pane-drop-after' : 'pane-drop-before') : ''
              }`}
              data-pane={pane.id}
              data-testid={tid('pane', pane.kind, index)}
              tabIndex={-1}
              onPointerDownCapture={() => { if (focusedPane !== pane.id) setFocusedPane(pane.id) }}
              style={zoomed
                ? (pane.id === zoomed ? { gridColumn: 1, gridRow: 1 } : { display: 'none' })
                : { gridColumn: (index % cols) * 2 + 1, gridRow: Math.floor(index / cols) * 2 + 1 }}
              onDragOver={(event) => {
                if (!paneDrag) return
                event.preventDefault()
                event.dataTransfer.dropEffect = 'move'
                const rect = event.currentTarget.getBoundingClientRect()
                const after = event.clientX > rect.left + rect.width / 2
                setPaneDrop((current) => current?.id === pane.id && current.after === after ? current : { id: pane.id, after })
              }}
              onDrop={(event) => {
                event.preventDefault()
                commitPaneDrop()
              }}
            >
              <Pane
                kind={pane.kind}
                onClose={() => closePane(pane.id)}
                context={paneContext(pane)}
                tools={paneTools(pane)}
                attention={paneAttention.get(pane.id)}
                zoomed={zoomed === pane.id}
                onZoom={panes.length > 1 ? () => setZoom((current) => (current === pane.id ? null : pane.id)) : undefined}
                dragHandle={{
                  draggable: true,
                  onDragStart: (event) => {
                    event.dataTransfer.effectAllowed = 'move'
                    event.dataTransfer.setData('text/plain', pane.id)
                    setPaneDrag(pane.id)
                  },
                  onDragEnd: () => {
                    setPaneDrag(null)
                    setPaneDrop(null)
                  }
                }}
              >
                {paneBody(pane)}
              </Pane>
            </div>
          ))}
          {!zoomed && colFracs.slice(1).map((_, i) => (
            <Splitter
              key={`col-${i}`}
              className="splitter--grid"
              testId={`splitter-col-${i}`}
              label={`Width of column ${i + 1}`}
              style={{ gridColumn: (i + 1) * 2, gridRow: `1 / ${rows * 2}` }}
              onStart={() => beginTrackDrag('cols', i)}
              onMove={(delta) => dragTrack(i, delta)}
              onReset={() => resetTrack('cols')}
            />
          ))}
          {!zoomed && rowFracs.slice(1).map((_, i) => (
            <Splitter
              key={`row-${i}`}
              axis="y"
              className="splitter--grid"
              testId={`splitter-row-${i}`}
              label={`Height of row ${i + 1}`}
              style={{ gridRow: (i + 1) * 2, gridColumn: `1 / ${cols * 2}` }}
              onStart={() => beginTrackDrag('rows', i)}
              onMove={(delta) => dragTrack(i, delta)}
              onReset={() => resetTrack('rows')}
            />
          ))}
        </main>
      </div>

      {palette && <CommandPalette items={paletteItems()} onClose={() => setPalette(false)} />}
      {settingsOpen && <SettingsPanel onClose={() => setSettingsOpen(false)} />}
      {newProjectOpen && <NewProject onClose={() => setNewProjectOpen(false)} />}
      {layoutDialog && (
        <NameDialog
          title="Save layout"
          placeholder="Build"
          hint="Saves the open panes (terminals by launch and folder), the dragged sizes, the sidebar views, and the column choice. Same name overwrites."
          action="Save layout"
          validate={(v) => (v.length > LAYOUT_NAME_MAX ? `Keep it under ${LAYOUT_NAME_MAX} characters` : null)}
          onSubmit={saveLayoutAs}
          onClose={() => setLayoutDialog(false)}
        />
      )}
      {menu && <AgentContextMenu menu={menu} onClose={() => setMenu(null)} />}
    </div>
  )
}
