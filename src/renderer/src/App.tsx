import { Suspense, lazy, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { SizeMode, StatusSnapshot, TerminalLaunch } from '@shared/types'
import { UsageDashboard } from './UsageDashboard'
import { ProjectGroup } from './ProjectGroup'
import { AgentContextMenu, type MenuState } from './AgentContextMenu'
import { NewProject } from './NewProject'
import { groupByProject } from './group'
import { applyOrder, useGroupOrder } from './useGroupOrder'
import { SettingsPanel } from './SettingsPanel'
import { COLLAPSE_ALL_EVENT } from './useCollapse'
import { HistoryPane, InsightsPane, SpendPane } from './UsagePane'
import { TopBar, type MenuName } from './TopBar'
import { EdgeGrip } from './EdgeGrip'
import { setFieldActive } from './fieldActive'
import { StatusBar, type StatusMenu } from './StatusBar'
import { Pane } from './Pane'
import type { TerminalPaneHandle } from './TerminalPane'
// xterm and its addon are ~40% of the renderer bundle; a workspace with no
// terminal pane never parses them. The ref still reaches the real component.
const TerminalPane = lazy(() => import('./TerminalPane').then((m) => ({ default: m.TerminalPane })))
import { SNIPPETS } from './snippets'
import { NameDialog } from './NameDialog'
import { SESSION_NAME_MAX, setSessionName, useSessionNames } from './sessionNames'
import { useProjectCommands } from './useProject'
import { ActivityPane } from './ActivityPane'
import { NotesPane, type NotesPaneHandle } from './NotesPane'
import { ClipboardPane, type PasteTarget } from './clipboard/ClipboardPane'
import { sourceLabel } from '@shared/clips.mjs'
import type { ClipSummary } from '@shared/types'
import { isWorkspaceCommand } from '@shared/workspaceCommand.mjs'
import type { ProjectCommand } from '@shared/types'
import { LAYOUT_NAME_MAX, loadLayouts, panesFromLayout, saveLayouts, snapshotLayout, type LayoutMap } from './layouts'
import { tid } from './testid'
import { agentForTerminal, nextWaiting, paneForAgent, waitingAgents, waitingFirst } from '@shared/attention.mjs'
import { CommandPalette, type PaletteItem } from './CommandPalette'
import { ProviderBadge } from './ProviderBadge'
import { Settings as SettingsIcon } from './Icons'
import {
  MAX_PANES, PANE_KINDS, SIDEBAR_VIEWS, defaultPanes, emptySizes, isUniqueKind, loadPaneCols,
  loadLaunchPrefs, loadPanes, loadSidebarCollapsed, loadSidebarViews, loadSizes, newPane, saveLaunchPrefs, savePaneCols,
  savePanes, saveSidebarCollapsed, saveSidebarViews, saveSizes,
  type AllSizes, type PaneCols, type PaneInstance, type PaneKind, type PaneSizes, type SidebarView,
  type TerminalPaneConfig
} from './panes'
import { Splitter } from './Splitter'
import {
  PANE_MIN, PANE_MIN_ROW, clampSidebarWidth, columnTemplate, normalizeFractions, resizeFractions,
  trackWidths, viewportBucket, type SizeBucket
} from '@shared/layout.mjs'
import { launchFor, launchKey, withLaunch, type LaunchPrefs } from '@shared/panes.mjs'
import { LaunchNav, type LaunchTarget, type NavMenu } from './LaunchNav'
import {
  AppWindow, BellRing, ChevronDown, ChevronsDownUp, ChevronsUpDown, Clipboard, Code2, Code2 as CursorIcon, Columns3, Copy,
  Eye, EyeOff, Filter, Folder, FolderPlus, Globe, LayoutTemplate, Maximize2, Minimize2, Minus, Monitor,
  NotebookPen, PanelLeft, PanelRight, PenLine, Play, Power, RefreshCw, Rss, Ruler, Save, Shrink, Sparkles, SquareSlash,
  SquareTerminal, Terminal, Trash2, X
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
  /** The terminal pane focused most recently: where the Clipboard pane's
   * Ctrl+Enter and the palette's paste land while another pane holds focus
   * (typing in the clipboard search focuses *that* pane). */
  const [lastTermPane, setLastTermPane] = useState<string | null>(null)
  // Ctrl+Shift+W cycles waiting sessions; remember where the cycle is.
  const lastRouted = useRef<string | null>(null)
  // Named layouts and the save-as prompt; a project group dragged over the grid.
  const [layouts, setLayouts] = useState<LayoutMap>(loadLayouts)
  const [layoutDialog, setLayoutDialog] = useState(false)
  // What the nav's split launch row starts on a plain click. Deliberately only
  // the popover changes it: the palette and the Terminal menu are for a one-off
  // you already named, and should not silently move the nav's default.
  // Per folder (tm.launch.v2): the split row starts what you last picked *in
  // this project*; a folder you never picked in follows the global default.
  const [launchPrefs, setLaunchPrefs] = useState<LaunchPrefs<TerminalLaunch>>(loadLaunchPrefs)
  // The session being named, if any (the rows read the same store).
  const [renaming, setRenaming] = useState<string | null>(null)
  const sessionNames = useSessionNames()
  const [gridDropHot, setGridDropHot] = useState(false)
  const snapRef = useRef<StatusSnapshot | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  /** Where Settings opens scrolled to (the picker's "keys" link asks for the shortcuts table). */
  const [settingsSection, setSettingsSection] = useState<'shortcuts' | undefined>(undefined)
  // First-run hook installation from the Agents pane's empty state.
  const [hookSetup, setHookSetup] = useState<{ busy: 'claude' | 'codex' | null; msg: string | null }>({ busy: null, msg: null })
  // Rebuild & relaunch: one state shared by the title-bar chip, File menu, and
  // palette so every entry point shows the same busy label and the same result.
  // Main guards against a second concurrent build; this only stops the UI
  // from asking twice. A success message stays until the app quits under us.
  const [rebuild, setRebuild] = useState<{ busy: boolean; msg: string | null }>({ busy: false, msg: null })
  const rebuildMsgTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const rebuildApp = () => {
    if (rebuild.busy) return
    if (rebuildMsgTimer.current) clearTimeout(rebuildMsgTimer.current)
    setRebuild({ busy: true, msg: 'building installer from source…' })
    window.watch.reinstallApp()
      .then((msg) => msg, (error) => `reinstall failed: ${String(error)}`)
      .then((msg) => {
        setRebuild({ busy: false, msg })
        if (!/reinstalling/.test(msg)) rebuildMsgTimer.current = setTimeout(() => setRebuild({ busy: false, msg: null }), 12_000)
      })
  }
  const [newProjectOpen, setNewProjectOpen] = useState(false)
  const [menu, setMenu] = useState<MenuState | null>(null)
  // One menu open at a time across the whole window — the title-bar menus and
  // the launch nav's two popovers share this, so opening one closes the other
  // and the Escape chain below sees every one of them.
  const [openMenu, setOpenMenu] = useState<MenuName | 'sidebar' | NavMenu | StatusMenu | null>(null)
  const [waitingOnly, setWaitingOnly] = useState(false)
  const [allCollapsed, setAllCollapsed] = useState(false)
  const { order, save: saveOrder, clear: clearOrder } = useGroupOrder()
  const [dragKey, setDragKey] = useState<string | null>(null)
  const [drop, setDrop] = useState<{ key: string; after: boolean } | null>(null)
  // Main-frame layout: work panes (terminals, Usage, Activity), drag-
  // reorderable, up to six. Persisted locally so a summoned workspace comes
  // back as you left it. Starting something lives in the sidebar nav, so an
  // empty grid is a normal state.
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
  /** Clipboard history for the palette's `!` prefix, fetched once per open like the windows. */
  const [paletteClips, setPaletteClips] = useState<ClipSummary[]>([])
  /** Capture paused → the status bar's amber chip (a warning, not a request). */
  const [clipsPaused, setClipsPaused] = useState(false)
  // Live handles to the terminal panes, for the header tools (clear/restart).
  const termRefs = useRef(new Map<string, TerminalPaneHandle>())
  const notesRef = useRef<NotesPaneHandle | null>(null)
  /** The notes folder, once the pane has asked main — the header's copy-to-clipboard path. */
  const [notesDir, setNotesDir] = useState<string | undefined>(undefined)
  /** Preview (rendered Markdown) instead of the editor — the header toggle; remembered. */
  const [notesPreview, setNotesPreview] = useState<boolean>(() => {
    try { return localStorage.getItem('tm.notes.preview') === '1' } catch { return false }
  })
  const toggleNotesPreview = () => setNotesPreview((v) => {
    try { localStorage.setItem('tm.notes.preview', v ? '0' : '1') } catch { /* preference only */ }
    return !v
  })
  /** The Session bar's pace streaks (the one GPU layer) — on unless switched off; remembered. */
  const [fieldOn, setFieldOn] = useState<boolean>(() => {
    try { return localStorage.getItem('tm.field.v1') !== '0' } catch { return true }
  })
  const toggleField = () => setFieldOn((v) => {
    try { localStorage.setItem('tm.field.v1', v ? '0' : '1') } catch { /* preference only */ }
    return !v
  })
  /** Ctrl+B (Ctrl+Shift+B inside a terminal): the grid takes the whole frame. Remembered. */
  const [sidebarHidden, setSidebarHidden] = useState<boolean>(() => {
    try { return localStorage.getItem('tm.sidebar.hidden.v1') === '1' } catch { return false }
  })
  const toggleSidebar = () => setSidebarHidden((v) => {
    try { localStorage.setItem('tm.sidebar.hidden.v1', v ? '0' : '1') } catch { /* preference only */ }
    return !v
  })
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
  // Where launches land. null follows whichever session was most recently
  // active; a target pins a folder (picked in the switcher, or dropped from
  // Explorer onto the nav).
  const [launchChoice, setLaunchChoice] = useState<LaunchTarget | null>(null)
  // Drives the slide-up / slide-down transition. Starts closed so the very first
  // painted frame is already off-screen and the card rises into place.
  const [open, setOpen] = useState(false)
  // The GPU layer (the quota streams) draws only while the workspace is open
  // and the streaks are on; it reads this, not a prop chain.
  useEffect(() => { setFieldActive(open && fieldOn) }, [open, fieldOn])
  useEffect(() => {
    window.watch.getStatus().then(setSnap)
    const off = window.watch.onStatus(setSnap)
    const offMaterial = window.watch.onWindowMaterial((material) => { document.documentElement.dataset.material = material })
    return () => { off(); offMaterial() }
  }, [])
  snapRef.current = snap

  useEffect(() => savePanes(panes), [panes])
  // A layout saved before Agents moved into the sidebar still holds an Agents
  // pane; the sidebar section wins, once, at startup.
  useEffect(() => {
    if (sidebarViews.includes('agents')) setPanes((current) => (current.some((p) => p.kind === 'agents') ? current.filter((p) => p.kind !== 'agents') : current))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => saveLaunchPrefs(launchPrefs), [launchPrefs])
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
      // The system backdrop (Windows 11) shows through a translucent card;
      // styles.css keys off this attribute, main pushes changes live.
      document.documentElement.dataset.material = s.windowMaterial ?? 'none'
    }).catch(() => {})
    // An edge drag flips the mode in main; the radio and chip follow.
    return window.watch.onSizeMode((mode) => setSizeMode(mode))
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
      // Settings → Keyboard shortcuts is recording: the next chord is its, not ours.
      if (document.querySelector('[data-shortcut-recording]')) return
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
      // Ctrl+B belongs to the CLI inside a terminal (Claude Code backgrounds
      // a running command with it), so there the sidebar is Ctrl+Shift+B.
      if (ctrl && (e.key === 'b' || e.key === 'B') && (e.shiftKey || !inTerminal)) {
        e.preventDefault()
        toggleSidebar()
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
      // A ContextMenu or an inline rename owns Escape while it is open.
      const owner = document.querySelector('[data-escape-close]')
      if (owner) {
        e.preventDefault()
        owner.dispatchEvent(new CustomEvent('tm-escape'))
        return
      }
      if (menu) setMenu(null)
      else if (openMenu) setOpenMenu(null)
      else if (palette) setPalette(false)
      else if (renaming) setRenaming(null)
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

  // `tm …` from a terminal or keybind: main validated the argv, the renderer
  // validates the shape again, then runs the same handlers the palette does.
  const commandRef = useRef<(c: unknown) => void>(() => {})
  commandRef.current = (raw: unknown) => {
    if (!isWorkspaceCommand(raw)) return
    switch (raw.kind) {
      case 'palette': setPalette(true); break
      case 'usage': openUsage(); break
      case 'activity': openActivity(); break
      case 'notes': openNotes(); break
      case 'layout': applyLayout(raw.name); break
      case 'settings': setSettingsSection(raw.section); setSettingsOpen(true); break
      case 'open': {
        const label = raw.cwd ? raw.cwd.split(/[\\/]/).pop() : undefined
        if (raw.sessionId) {
          // A session the daemon already spawned for an agent: attach a pane
          // if there is room. With a full grid it stays headless — still
          // driveable through the API, listed with `attached: false`.
          if (panes.length < MAX_PANES) addPane('terminal', { launch: raw.launch, cwd: raw.cwd, label, sessionId: raw.sessionId, initialCommand: raw.command })
          break
        }
        if (panes.length >= MAX_PANES) { window.watch.openTerminal(raw.cwd, raw.launch); break }
        addPane('terminal', { launch: raw.launch, cwd: raw.cwd, label, initialCommand: raw.command })
        break
      }
      case 'show': case 'hide': break // handled in main
    }
  }
  useEffect(() => window.watch.onCommand((c) => commandRef.current(c)), [])

  // The palette lists open windows and clips: refresh once per open rather than polling.
  useEffect(() => {
    if (!palette) return
    let live = true
    window.watch.listWindows().then((list) => { if (live) setPaletteWindows(list) }).catch(() => {})
    window.watch.listClips().then((res) => { if (live) setPaletteClips(res.clips) }).catch(() => {})
    return () => { live = false }
  }, [palette])

  // Only the pause flag is watched here; the pane owns the full listing.
  useEffect(() => {
    const load = () => { window.watch.clipsState().then((s) => setClipsPaused(s.paused)).catch(() => {}) }
    load()
    return window.watch.onClipsChanged(load)
  }, [])

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
  const context: LaunchTarget = launchChoice ?? { cwd: recent?.cwd, label: recent?.project }
  const launchKind = launchFor(launchPrefs, context.cwd)
  const setLaunchKind = (kind: TerminalLaunch) => setLaunchPrefs((current) => withLaunch(current, context.cwd, kind))

  /** Folders the switcher can point at: one per live project, newest first. */
  const launchProjects: LaunchTarget[] = []
  for (const a of [...agents].sort((x, y) => y.updatedAt - x.updatedAt)) {
    if (a.cwd && !launchProjects.some((p) => launchKey(p.cwd) === launchKey(a.cwd))) launchProjects.push({ cwd: a.cwd, label: a.project })
  }

  /** A folder dropped on the nav: main resolves it (a file means its parent). */
  const dropLaunchFolder = (path: string) => {
    window.watch.describePath(path).then((found) => {
      if (found) setLaunchChoice({ cwd: found.dir, label: found.label })
    }).catch(() => {})
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
  const health = { providers: snap?.providers, mock: !!snap?.mock }
  const noHooks = !!snap && !snap.mock && Object.values(snap.providers).every((h) => !h.reporting)
  // The first-run offer, per provider: `install` when none of our hooks are on
  // disk, `repair` when ours are there but written for another copy of the app
  // (a dev checkout's bridge path). Those still report, so they must not read
  // as "no hooks" — the same rule as the connection chip in health.mjs.
  const hookOffer = (['claude', 'codex'] as const).flatMap((p) => {
    const h = snap?.providers[p]
    if (!snap || h?.installed) return []
    return [{ provider: p, action: h?.needsRepair ? 'repair' as const : 'install' as const }]
  })
  const hooksToRepair = hookOffer.some((o) => o.action === 'repair')
  const setUpHooks = (provider: 'claude' | 'codex', action: 'install' | 'repair') => {
    if (hookSetup.busy) return
    setHookSetup({ busy: provider, msg: null })
    window.watch.manageHooks(provider, action)
      .then((result) => setHookSetup({ busy: null, msg: result.ok ? `${provider === 'claude' ? 'Claude Code' : 'Codex'} hooks ${action === 'repair' ? 'repaired' : 'installed'} — start a session and it will appear here.` : result.message }))
      .catch((error) => setHookSetup({ busy: null, msg: String(error) }))
  }

  const agentList = !snap ? (
    <div className="empty">Connecting…</div>
  ) : groups.length === 0 ? (
    <div className="empty" data-testid="agents-empty">
      {noHooks ? (
        <>
          {/* First run: nothing has ever reported. Offer the hooks right here
              instead of pointing at Settings (4.3-plan.md item 8). */}
          {hooksToRepair
            ? 'Nothing has reported yet. Hooks are installed but point at another copy of this app — they still report; repair them to point here.'
            : hookOffer.length > 0
              ? 'Nothing is reporting yet — this app hears about sessions through provider hooks.'
              : 'Hooks are installed but nothing has reported yet. Start Claude Code or Codex in a project.'}
          {hookOffer.length > 0 && (
            <div className="empty-actions">
              {hookOffer.map(({ provider: p, action }) => (
                <button key={p} className="hotkey-btn" disabled={hookSetup.busy !== null} onClick={() => setUpHooks(p, action)} data-testid={tid(`${action}-hooks`, p)}>
                  {hookSetup.busy === p
                    ? action === 'repair' ? 'Repairing…' : 'Installing…'
                    : `${action === 'repair' ? 'Repair' : 'Install'} ${p === 'claude' ? 'Claude Code' : 'Codex'} hooks`}
                </button>
              ))}
            </div>
          )}
          {hookSetup.msg && <div className="empty-note">{hookSetup.msg}</div>}
          {/* A repaired command is a new command to Codex, so it needs trust again too. */}
          {hookOffer.some((o) => o.provider === 'codex') && <div className="empty-note">Codex also needs its hooks trusted once: run /hooks inside Codex.</div>}
        </>
      ) : 'No active agents. Start Claude Code, Codex, or Cursor in a project.'}
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
    // One agent list: the pane replaces the sidebar section.
    if (kind === 'agents') setSidebarViews((current) => current.filter((v) => v !== 'agents'))
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

  /** User → Usage / Activity: open the unique pane, or bring the open one
   * forward. `addPane` already refuses a full grid; a lone pane has nothing
   * to zoom over. */
  const openUnique = (kind: PaneKind) => {
    const existing = panes.find((p) => p.kind === kind)
    if (!existing) {
      addPane(kind)
      return
    }
    if (panes.length > 1) setZoom(existing.id)
  }
  // `tm usage` and the old Usage entry point land on Spend; Insights and
  // History are their own panes now (status bar → Panes).
  const openUsage = () => openUnique('spend')
  const openActivity = () => openUnique('activity')
  const openNotes = () => openUnique('notes')
  const openClipboard = () => openUnique('clipboard')

  useEffect(() => {
    if (focusedPane && panes.some((p) => p.id === focusedPane && p.kind === 'terminal')) setLastTermPane(focusedPane)
  }, [focusedPane, panes])

  /** Open terminal panes a clip can be pasted into (the Clipboard pane's *Paste into ▸*, the palette's Ctrl+Enter). */
  const pasteTargets = (): PasteTarget[] => panes
    .filter((p) => p.kind === 'terminal' && p.term?.sessionId)
    .map((p) => ({
      id: p.id,
      label: `${p.term!.launch === 'claude' ? 'Claude Code' : p.term!.launch === 'codex' ? 'Codex' : 'Terminal'} · ${p.term!.label ?? p.term!.cwd?.split(/[\\/]/).filter(Boolean).pop() ?? 'home'}`,
      paste: (text: string) => termRefs.current.get(p.id)?.paste(text)
    }))
  /** The terminal a paste goes to: the focused pane when it is one, else the last terminal pane that had focus. */
  const pasteTarget = (targets: PasteTarget[]): PasteTarget | undefined =>
    targets.find((t) => t.id === focusedPane) ?? targets.find((t) => t.id === lastTermPane)

  /** The pane the right-clicked session runs in, if any (reply box, "Go to its pane"). */
  const menuAgent = menu ? agents.find((a) => a.id === menu.id) : undefined
  const menuPane = menuAgent ? paneForAgent(panes, menuAgent) : null

  /** The agent a feed row or chip points at: its pane when it has one, else its window. */
  const focusAgentAnywhere = (id: string) => {
    const agent = agents.find((a) => a.id === id)
    const pane = agent ? paneForAgent(panes, agent) : null
    if (pane) focusPane(pane.id)
    else window.watch.focusAgent(id)
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

  /** This folder's commands (`.tm.json`, npm scripts) run in a fresh pane. */
  const projectCommands = useProjectCommands(context.cwd)
  const runProjectCommand = (command: ProjectCommand) => {
    if (panes.length >= MAX_PANES) return
    addPane('terminal', { launch: 'shell', cwd: context.cwd, label: context.label, initialCommand: command.command })
  }

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

  // Remember which provider session each CLI pane hosts (the hooks carry the
  // pane's PTY id as `terminalId`), so a restart resumes exactly that session
  // (`claude --resume <id>`) rather than the most recent one in the folder.
  // A CLI typed into a plain shell pane counts too: the pane's launch becomes
  // that provider, so its title says what it runs and a restart resumes it.
  useEffect(() => {
    for (const p of panes) {
      if (p.kind !== 'terminal' || !p.term || !p.term.sessionId) continue
      const agent = agentForTerminal(agents, p.term)
      if (!agent || agent.terminalId !== p.term.sessionId) continue
      const launch = agent.provider === 'claude' ? 'claude' : agent.provider === 'codex' ? 'codex' : null
      if (!launch) continue
      if (agent.rawSessionId !== p.term.resumeId || p.term.launch !== launch) {
        updateTerm(p.id, { resumeId: agent.rawSessionId, launch })
      }
    }
  }, [agents, panes])

  const closePane = (paneId: string) => {
    const closing = panes.find((p) => p.id === paneId)
    if (closing?.term?.sessionId) window.watch.disposeTerminal(closing.term.sessionId)
    const next = panes.filter((p) => p.id !== paneId)
    setPanes(next.length ? next : defaultPanes())
    if (focusedPane === paneId) setFocusedPane(null)
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
      case 'agents':
        return <div className="agents-inner">{agentList}</div>
      case 'spend':
        return <SpendPane usage={snap?.usage} />
      case 'insights':
        return <InsightsPane />
      case 'history':
        return <HistoryPane />
      case 'activity':
        return <ActivityPane onFocusAgent={focusAgentAnywhere} />
      case 'notes':
        return <NotesPane ref={notesRef} onDir={setNotesDir} preview={notesPreview} />
      case 'clipboard': {
        const targets = pasteTargets()
        return <ClipboardPane terminals={targets} focusedTerminal={pasteTarget(targets)} />
      }
      case 'terminal':
        return (
          <Suspense fallback={<div className="empty">Starting terminal…</div>}>
            <TerminalPane
              ref={(handle) => {
                if (handle) termRefs.current.set(pane.id, handle)
                else termRefs.current.delete(pane.id)
              }}
              config={pane.term!}
              onConfig={(patch) => updateTerm(pane.id, patch)}
            />
          </Suspense>
        )
    }
  }

  /** What sits after the title: a terminal's launch + folder label. */
  const paneContext = (pane: PaneInstance) => {
    if (pane.kind === 'agents') {
      const roots = agents.filter((a) => !a.parentId).length
      return roots > 0 ? <span className="pane-count">{roots}</span> : null
    }
    // A terminal pane carries no chip: its title says what it runs and the
    // live path after it says where (both click-to-copy).
    return null
  }

  /** What a terminal pane runs, as its header title. */
  const paneTitle = (pane: PaneInstance) =>
    pane.kind === 'terminal' && pane.term ? (pane.term.launch === 'claude' ? 'Claude Code' : pane.term.launch === 'codex' ? 'Codex' : 'Terminal')
      : pane.kind === 'notes' ? "TC's NOTES" : undefined

  const tool = (title: string, icon: ReactNode, onClick: () => void, disabled = false, active = false) => (
    <button className={`iconbtn iconbtn--sm ${active ? 'is-on' : ''}`} onClick={onClick} title={title} aria-label={title} aria-pressed={active || undefined} disabled={disabled} data-testid={tid('pane-tool', title)}>
      {icon}
    </button>
  )
  const ic = (Icon: typeof Folder) => <Icon className="gear gear--sm" strokeWidth={2} />

  /** The header tool strip, per kind — an editor title bar's actions. */
  const paneTools = (pane: PaneInstance) => {
    if (pane.kind === 'notes') {
      return (
        <>
          {/* New note / New folder / Open folder live in the tree's own toolbar. */}
          {tool(notesPreview ? 'Edit' : 'Preview', ic(notesPreview ? PenLine : Eye), toggleNotesPreview, false, notesPreview)}
        </>
      )
    }
    if (pane.kind === 'agents') {
      return (
        <>
          {tool(
            waitingOnly ? 'Show every session' : 'Show only sessions waiting on you',
            ic(Filter),
            () => setWaitingOnly((v) => !v),
            waiting === 0 && !waitingOnly
          )}
          {tool(
            allCollapsed ? 'Expand all projects' : 'Collapse all projects',
            ic(allCollapsed ? ChevronsUpDown : ChevronsDownUp),
            collapseAll,
            groups.length < 2
          )}
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
          {/* That is the whole strip (4.3-plan.md item 5): split is Terminal →
              New terminal, snippets are a palette group, clear is Ctrl+L,
              restart is close-and-reopen, external/folder are palette items. */}
        </>
      )
    }
    return null
  }

  const toggleSidebarView = (view: SidebarView) => {
    const on = !sidebarViews.includes(view)
    setSidebarViews((current) => (on ? [...current, view] : current.filter((v) => v !== view)))
    // The agent list lives in one place: turning the sidebar section on closes
    // the Agents pane (and adding the pane hides the section — see addPane).
    if (view === 'agents' && on) setPanes((current) => current.filter((p) => p.kind !== 'agents'))
  }

  const toggleSidebarCollapsed = (view: SidebarView) =>
    setSidebarCollapsed((current) => current.includes(view)
      ? current.filter((v) => v !== view)
      : [...current, view]
    )

  const sidebarBody = (view: SidebarView) => {
    switch (view) {
      case 'limits':
        return snap ? <UsageDashboard usage={snap.usage} /> : <div className="empty">Connecting…</div>
      case 'agents':
        return <div className="agents-inner">{agentList}</div>
    }
  }

  const sideSection = (v: (typeof SIDEBAR_VIEWS)[number], top = false) => {
    const rolled = sidebarCollapsed.includes(v.id)
    return (
      <section className={`sideview ${top ? 'sideview--top' : ''} ${v.id === 'agents' ? 'sideview--fill' : ''} ${rolled ? 'is-collapsed' : ''}`} key={v.id}>
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
            {v.id === 'agents' && !rolled && (
              <>
                {tool(waitingOnly ? 'Show every session' : 'Show only sessions waiting on you', ic(Filter), () => setWaitingOnly((x) => !x), waiting === 0 && !waitingOnly)}
                {tool(allCollapsed ? 'Expand all projects' : 'Collapse all projects', ic(allCollapsed ? ChevronsUpDown : ChevronsDownUp), collapseAll, groups.length < 2)}
              </>
            )}
            <button
              className="iconbtn iconbtn--sm sideview-hide"
              onClick={() => toggleSidebarView(v.id)}
              title={`Hide ${v.label} — bring it back from View → Sidebar`}
              aria-label={`Hide ${v.label}`}
            >
              <EyeOff className="gear gear--sm" strokeWidth={2} />
            </button>
          </span>
        </div>
        {!rolled && <div className="sideview-body">{sidebarBody(v.id)}</div>}
      </section>
    )
  }

  // Sections stack under the launch nav in the fixed catalog order (Limits
  // first), so toggling one never reshuffles the rest.
  const activeViews = SIDEBAR_VIEWS.filter((v) => sidebarViews.includes(v.id))

  // Live geometry for this bucket. The column count still composes choice, pane
  // count and the viewport cap; the fractions only re-split what that leaves.
  const sizes = allSizes[bucket]
  const sidebarWidth = clampSidebarWidth(sizes.sidebar, frameW)
  const cols = Math.max(1, Math.min(paneCols === 'auto' ? 3 : paneCols, panes.length, viewportCap))
  // At least one row even with an empty grid, so the templates stay valid CSS.
  const rows = Math.max(1, Math.ceil(panes.length / cols))
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
    // Pinned items are the palette's resting list (before anything is typed):
    // the ways to start a session, and the jump to a waiting one.
    cmd('new-claude', 'New Claude Code', () => newTerminal('claude'), { icon: <ProviderBadge provider="claude" />, keywords: ['agent'], pinned: true, detail: context.label })
    cmd('new-codex', 'New Codex', () => newTerminal('codex'), { icon: <ProviderBadge provider="codex" />, keywords: ['agent'], pinned: true, detail: context.label })
    cmd('new-terminal', 'New terminal', () => newTerminal('shell'), { icon: <Terminal strokeWidth={2} />, keywords: ['shell', 'powershell'], keys: ['Ctrl', 'Shift', '`'], pinned: true, detail: full ? 'opens a window — all six panes are open' : context.label })
    cmd('ext-terminal', 'Open external terminal', () => window.watch.openTerminal(context.cwd, 'shell'), { icon: <SquareTerminal strokeWidth={2} />, detail: context.label ?? 'home folder' })
    // Snippets act on the focused terminal pane (they used to be a header
    // menu; 4.3-plan.md item 5). No focused terminal, no snippets.
    const focusedTerm = panes.find((p) => p.id === focusedPane && p.kind === 'terminal' && p.term?.sessionId)
    if (focusedTerm?.term?.sessionId) {
      const sid = focusedTerm.term.sessionId
      for (const snip of SNIPPETS[focusedTerm.term.launch]) {
        cmd(`snippet:${snip.text}`, `Snippet: ${snip.label}`, () => { window.watch.termInput(sid, `${snip.text}\r`); termRefs.current.get(focusedTerm.id)?.focus() }, {
          icon: <SquareSlash strokeWidth={2} />,
          detail: snip.hint ?? snip.text,
          keywords: ['snippet', 'terminal', 'type', snip.text]
        })
      }
    }
    cmd('cursor', 'Open Cursor', () => window.watch.openCursor(context.cwd), { icon: <Code2 strokeWidth={2} />, detail: context.label, keywords: ['editor'] })
    cmd('chrome', 'Open Chrome', () => window.watch.openChrome(), { icon: <Globe strokeWidth={2} />, keywords: ['browser'] })
    cmd('new-project', 'New project…', () => setNewProjectOpen(true), { icon: <FolderPlus strokeWidth={2} /> })
    cmd('projects-dir', 'Open Projects folder', () => window.watch.openProjectsDir(), { icon: <Folder strokeWidth={2} />, keywords: ['explorer'] })
    const hasActivity = panes.some((p) => p.kind === 'activity')
    cmd('activity', 'Activity feed', openActivity, {
      icon: <Rss strokeWidth={2} />,
      keywords: ['events', 'timeline', 'questions', 'history', 'log'],
      detail: hasActivity ? 'zoom the open pane' : full ? 'all six panes are open' : undefined
    })
    const hasNotes = panes.some((p) => p.kind === 'notes')
    cmd('notes', 'Notes', openNotes, {
      icon: <NotebookPen strokeWidth={2} />,
      keywords: ['notepad', 'scratch', 'markdown', 'todo', 'shared'],
      detail: hasNotes ? 'zoom the open pane' : full ? 'all six panes are open' : 'the shared notepad'
    })
    const hasClipboard = panes.some((p) => p.kind === 'clipboard')
    cmd('clipboard', 'Clipboard', openClipboard, {
      icon: <Clipboard strokeWidth={2} />,
      keywords: ['history', 'copy', 'paste', 'clips', 'favorites', 'groups'],
      detail: hasClipboard ? 'zoom the open pane' : full ? 'all six panes are open' : 'everything you copy, searchable'
    })
    for (const k of PANE_KINDS) {
      if (k.id !== 'spend' && k.id !== 'insights' && k.id !== 'history') continue
      const open = panes.some((p) => p.kind === k.id)
      cmd(k.id, k.label, () => openUnique(k.id), {
        icon: <k.icon strokeWidth={2} />,
        keywords: ['usage', 'tokens', 'cost', 'value', 'report', 'pane', ...k.hint.toLowerCase().split(/\W+/)],
        detail: open ? 'zoom the open pane' : full ? 'all six panes are open' : k.hint
      })
    }
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
    cmd('sidebar', `${sidebarHidden ? 'Show' : 'Hide'} sidebar`, toggleSidebar, { icon: <PanelLeft strokeWidth={2} />, keys: ['Ctrl', 'B'], keywords: ['sidebar', 'fullscreen', 'full screen', 'focus', 'hide', 'show', 'toggle', 'agents', 'limits'] })
    cmd('field', `Pace streaks: ${fieldOn ? 'off' : 'on'}`, toggleField, { icon: <Sparkles strokeWidth={2} />, keywords: ['field', 'gpu', 'webgpu', 'streaks', 'burn', 'session', 'effects'] })
    if (!full) {
      for (const c of projectCommands) {
        cmd(`run:${c.command}`, `Run: ${c.label}`, () => runProjectCommand(c), { icon: <Play strokeWidth={2} />, detail: `${c.command} · ${context.label ?? 'this folder'}`, keywords: ['project', 'script', 'npm', c.command] })
      }
    }
    cmd('save-layout', 'Save current layout…', () => setLayoutDialog(true), { icon: <Save strokeWidth={2} />, keywords: ['workspace', 'preset'] })
    for (const name of layoutNames) {
      cmd(`layout:${name}`, `Layout: ${name}`, () => applyLayout(name), { icon: <LayoutTemplate strokeWidth={2} />, keywords: ['workspace', 'preset', 'apply'] })
    }
    for (const name of layoutNames) {
      cmd(`layout-delete:${name}`, `Delete layout: ${name}`, () => deleteLayout(name), { icon: <Trash2 strokeWidth={2} />, keywords: ['workspace', 'preset'] })
    }
    if (order.length > 0) cmd('reset-order', 'Reset project order', clearOrder, { icon: <ChevronsUpDown strokeWidth={2} /> })
    if (waitingAgents(agents).length > 0) cmd('route-waiting', 'Go to next waiting session', routeToWaiting, { icon: <BellRing strokeWidth={2} />, keys: ['Ctrl', 'Shift', 'W'], keywords: ['attention', 'question', 'input'], pinned: true })
    cmd('settings', 'Settings…', () => setSettingsOpen(true), { icon: <SettingsIcon strokeWidth={2} />, keys: ['Ctrl', ','], keywords: ['hotkey', 'hooks', 'updates', 'preferences'] })
    cmd('rebuild', 'Rebuild & relaunch', rebuildApp, {
      icon: <RefreshCw strokeWidth={2} />,
      detail: rebuild.busy ? 'building…' : 'npm run dist in the local checkout, then quit, reinstall, relaunch',
      keywords: ['update', 'upgrade', 'reinstall', 'install', 'build', 'latest', 'version', 'restart']
    })
    cmd('hide', 'Hide to tray', () => window.watch.hide(), { icon: <Minus strokeWidth={2} />, keys: ['Esc'] })
    cmd('quit', 'Quit', () => window.watch.quit(), { icon: <Power strokeWidth={2} />, keywords: ['exit'] })

    for (const a of waitingFirst(agents.filter((x) => !x.parentId))) {
      items.push({
        id: `agent:${a.id}`,
        section: 'agent',
        label: sessionNames[a.id] ?? a.project,
        detail: a.state === 'waiting'
          ? `waiting · ${a.question ?? a.activity ?? 'needs input'}`
          : [a.state, a.activity].filter(Boolean).join(' · '),
        keywords: [a.provider, a.cwd ?? '', a.model ?? ''],
        icon: <ProviderBadge provider={a.provider} />,
        pinned: true, // the resting list shows the session, not its sub-actions
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
    // Clipboard history (`!`): Enter copies, Ctrl+Enter pastes into the focused terminal pane.
    const focusedTarget = pasteTarget(pasteTargets())
    for (const c of paletteClips.slice(0, 300)) {
      items.push({
        id: `clip:${c.id}`,
        section: 'clip',
        label: c.title || '(blank)',
        detail: sourceLabel(c.source),
        keywords: [c.preview],
        icon: <Clipboard strokeWidth={2} />,
        run: () => { void window.watch.copyClip(c.id) },
        runAlt: () => {
          if (!focusedTarget || c.kind === 'image') { void window.watch.copyClip(c.id); return }
          void window.watch.getClip(c.id).then((res) => { if (res) focusedTarget.paste(res.text) })
        }
      })
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
      <EdgeGrip edge="left" />
      <EdgeGrip edge="right" />
      <TopBar
        waiting={waiting}
        waitingOnly={waitingOnly}
        onWaitingOnly={() => setWaitingOnly((v) => !v)}
        onRouteWaiting={routeToWaiting}
        health={health}
        panes={panes}
        context={context}
        onNewTerminal={newTerminal}
        onNewProject={() => setNewProjectOpen(true)}
        commands={projectCommands}
        onRunCommand={runProjectCommand}
        canResetOrder={order.length > 0}
        onResetOrder={clearOrder}
        onSettings={() => setSettingsOpen(true)}
        rebuild={rebuild}
        onRebuild={rebuildApp}
        openMenu={openMenu === 'file' || openMenu === 'terminal' || openMenu === 'user' ? openMenu : null}
        onOpenMenu={setOpenMenu}
        onPalette={() => { setOpenMenu(null); setPalette((v) => !v) }}
        onMinimize={() => { setOpenMenu(null); window.watch.minimize() }}
        onHide={() => { setOpenMenu(null); window.watch.hide() }}
        onOpenPane={openUnique}
        hot={hot}
        onFocusAgent={focusAgentAnywhere}
      />


      <div className="frame" ref={frameRef}>
        {/* Hidden, not unmounted: the sections keep their state and the
            launch nav its popover wiring, like a zoomed grid's other panes. */}
        <aside className={`sidebar ${sidebarHidden ? 'is-hidden' : ''}`} style={{ flexBasis: sidebarWidth }} data-testid="sidebar">
          <LaunchNav
            context={context}
            projects={launchProjects}
            following={launchChoice === null}
            onChoose={setLaunchChoice}
            openMenu={openMenu === 'launch-target' ? openMenu : null}
            onOpenMenu={setOpenMenu}
            onLaunch={(kind, external) => (external ? window.watch.openTerminal(context.cwd, kind) : newTerminal(kind))}
            launchKind={launchKind}
            onLaunchKind={setLaunchKind}
            recent={launchProjects.filter((p) => launchKey(p.cwd) !== launchKey(context.cwd)).slice(0, 3)}
            onNewProject={() => setNewProjectOpen(true)}
            onDropFolder={dropLaunchFolder}
          />
          {activeViews.map((v, i) => sideSection(v, i === 0))}
        </aside>

        <Splitter
          className={`splitter--frame ${sidebarHidden ? 'is-hidden' : ''}`}
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
          {panes.length === 0 && (
            <div className="gridempty" data-testid="grid-empty">
              <SquareTerminal strokeWidth={1.5} style={{ width: 28, height: 28 }} />
              <div className="gridempty-hint">
                Nothing open. Pick a project at the top of the sidebar, then start Claude Code or Codex there.
                <kbd>Ctrl</kbd><kbd>Shift</kbd><kbd>`</kbd> opens a plain terminal; <kbd>Ctrl</kbd><kbd>Shift</kbd><kbd>P</kbd> finds everything else.
              </div>
            </div>
          )}
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
                title={paneTitle(pane)}
                plainTitle={pane.kind === 'notes'}
                context={paneContext(pane)}
                path={pane.kind === 'terminal' ? pane.term?.cwd : pane.kind === 'notes' ? notesDir : undefined}
                onCopyPath={
                  pane.kind === 'terminal' && pane.term?.cwd ? () => window.watch.copyText(pane.term!.cwd!)
                    : pane.kind === 'notes' && notesDir ? () => window.watch.copyText(notesDir)
                      : undefined
                }
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

      <StatusBar
        rebuild={rebuild}
        onRebuild={rebuildApp}
        panes={panes}
        onAddPane={addPane}
        onClosePane={closePane}
        sidebarViews={sidebarViews}
        onToggleSidebarView={toggleSidebarView}
        sizeMode={sizeMode}
        onSizeMode={applySizeMode}
        paneCols={paneCols}
        onPaneCols={setPaneCols}
        canResetSizes={sized}
        onResetSizes={resetSizes}
        fieldOn={fieldOn}
        sidebarHidden={sidebarHidden}
        onToggleSidebar={toggleSidebar}
        onToggleField={toggleField}
        layouts={layoutNames}
        onSaveLayout={() => setLayoutDialog(true)}
        onApplyLayout={applyLayout}
        onDeleteLayout={deleteLayout}
        openMenu={openMenu === 'panes' || openMenu === 'layout' ? openMenu : null}
        onOpenMenu={setOpenMenu}
        version={appInfo.version}
        debugPort={appInfo.debugPort}
        clipsPaused={clipsPaused}
        onResumeClips={() => { void window.watch.pauseClips(null) }}
      />

      {palette && <CommandPalette items={paletteItems()} onClose={() => setPalette(false)} />}
      {settingsOpen && <SettingsPanel section={settingsSection} onClose={() => { setSettingsOpen(false); setSettingsSection(undefined) }} />}
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
      {menu && (
        <AgentContextMenu
          menu={menu}
          onClose={() => setMenu(null)}
          replySession={menuPane?.term?.sessionId}
          inPane={!!menuPane}
          onGoTo={focusAgentAnywhere}
          onRename={(id) => { setMenu(null); setRenaming(id) }}
          onLaunch={(launch, cwd) => {
            // Same as the launch nav: a pane in that folder; a full grid opens a window.
            if (panes.length >= MAX_PANES) window.watch.openTerminal(cwd, launch)
            else addPane('terminal', { launch, cwd, label: cwd.split(/[\\/]/).filter(Boolean).pop() })
          }}
        />
      )}
      {renaming && (
        <NameDialog
          title="Name this session"
          placeholder="auth refactor"
          hint="Shown on the row and in the palette, so you can tell your sessions apart. Clearing it removes the name."
          action="Save name"
          initial={sessionNames[renaming] ?? ''}
          validate={(v) => (v.length > SESSION_NAME_MAX ? `Keep it under ${SESSION_NAME_MAX} characters` : null)}
          onSubmit={(value) => { setSessionName(renaming, value); setRenaming(null) }}
          onClose={() => setRenaming(null)}
        />
      )}
    </div>
  )
}
