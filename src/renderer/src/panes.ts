import { Activity, AppWindow, Bot, Coins, Rss, Terminal } from 'lucide-react'
import type { TerminalLaunch } from '@shared/types'
import type { SizeBucket } from '@shared/layout.mjs'
import {
  emptySizes as emptySizesShared, migratePanesV3, readAllSizes, readLaunch, readPaneCols, sanitizeCollapsed,
  sanitizePanes, sanitizeSidebarViews, type Sizes
} from '@shared/panes.mjs'

/** localStorage JSON, or null — every reader here tolerates null. */
function readJson(key: string): unknown {
  try {
    return JSON.parse(localStorage.getItem(key) ?? 'null')
  } catch {
    return null
  }
}

/**
 * The main frame belongs to work: embedded terminal sessions and the reports
 * (Usage, Activity). Starting something is not work — the launch nav lives at
 * the head of the sidebar (`LaunchNav.tsx`), so opening a terminal never costs
 * a pane. At-a-glance status — open windows and limit bars — stacks in the
 * sidebar as toggleable sections; see `SidebarView`.
 */
export type PaneKind = 'agents' | 'terminal' | 'usage' | 'activity'

/** What an embedded terminal pane runs. `sessionId` reattaches after a remount;
 * a stale id (fresh app run) just starts a new shell with the same launch. */
export interface TerminalPaneConfig {
  launch: TerminalLaunch
  cwd?: string
  label?: string
  sessionId?: string
  /** Typed into a freshly created shell once it is up (a project command).
   * Never replayed on reattach — the command already ran. */
  initialCommand?: string
}

export interface PaneInstance {
  id: string
  kind: PaneKind
  term?: TerminalPaneConfig
}

export const PANE_KINDS: { id: PaneKind; label: string; icon: typeof Activity; hint: string }[] = [
  { id: 'agents', label: 'Agents', icon: Bot, hint: 'Live Claude Code, Codex, and Cursor sessions by project' },
  { id: 'terminal', label: 'Terminal', icon: Terminal, hint: 'An embedded PowerShell terminal' },
  { id: 'usage', label: 'Usage', icon: Coins, hint: 'Today’s spend and local usage insights' },
  { id: 'activity', label: 'Activity', icon: Rss, hint: 'What sessions asked, finished, started, and ended' }
]

export const MAX_PANES = 6

export function newPane(kind: PaneKind, term?: TerminalPaneConfig): PaneInstance {
  return { id: crypto.randomUUID(), kind, term: kind === 'terminal' ? (term ?? { launch: 'shell' }) : undefined }
}

/** The agent list is what this app is for, so it is the one pane a fresh
 * workspace opens. Nothing is spawned before the user asks. */
export function defaultPanes(): PaneInstance[] {
  return [newPane('agents')]
}

/** Kinds that may appear only once. Terminals repeat — one shell per pane. */
export function isUniqueKind(kind: PaneKind): boolean {
  return kind !== 'terminal'
}

const STORAGE_KEY = 'tm.panes.v3'
const LEGACY_PANES_KEY = 'tm.panes.v2'

const PANE_KIND_IDS = PANE_KINDS.map((p) => p.id)

export function loadPanes(): PaneInstance[] {
  // Parsing lives in @shared/panes.mjs (tested): retired kinds drop, unique
  // kinds dedupe, and an emptied layout falls back to the default.
  const stored = readJson(STORAGE_KEY)
  const opts = { kinds: PANE_KIND_IDS, isUnique: isUniqueKind, maxPanes: MAX_PANES }
  if (stored === null) {
    // One-time v2 migration: the agent list moved out of the sidebar, so a
    // layout saved before that gets an Agents pane in front of its panes.
    const migrated = migratePanesV3(readJson(LEGACY_PANES_KEY), { ...opts, newId: crypto.randomUUID() })
    return migrated.length ? migrated : defaultPanes()
  }
  const panes = sanitizePanes(stored, opts)
  return panes.length ? panes : defaultPanes()
}

export function savePanes(panes: PaneInstance[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(panes))
  } catch {
    /* private mode / quota — the layout just resets next launch */
  }
}

/** Data views stacked in the sidebar, toggled from the sidebar menu. The
 * `SIDEBAR_TOP` views pin above the agent list; the rest stack below, both in
 * catalog order. */
export type SidebarView = 'windows' | 'limits'

/** Spend and Insights used to be sidebar views; they moved into the `usage`
 * pane. Their stored ids fall out of every sidebar key through `isSidebarView`,
 * which is derived from this catalog, so no migration is needed. */
export const SIDEBAR_VIEWS: { id: SidebarView; label: string; icon: typeof Activity; hint: string }[] = [
  { id: 'limits', label: 'Limits', icon: Activity, hint: 'Provider usage limits' },
  { id: 'windows', label: 'Open windows', icon: AppWindow, hint: 'Switch to an open terminal, editor, or browser' }
]

/** Views that pin above the agent list, in this order. Open windows leads: it
 * starts rolled up, so it costs one header row and is one click from the switcher.
 * Everything else stacks below the agents. */
export const SIDEBAR_TOP: SidebarView[] = ['limits', 'windows']

export function isTopSidebarView(view: SidebarView): boolean {
  return SIDEBAR_TOP.includes(view)
}

const SIDEBAR_KEY = 'tm.sidebar.v2'
const LEGACY_SIDEBAR_KEY = 'tm.sidebar.v1'
const DEFAULT_SIDEBAR: SidebarView[] = ['limits', 'windows']

const SIDEBAR_IDS = SIDEBAR_VIEWS.map((v) => v.id)

export function loadSidebarViews(): SidebarView[] {
  // v2 wins; v1 migrates once (keeping the toggles, surfacing Open windows);
  // ids no longer in the catalog fall out — that is how a retired view goes.
  return sanitizeSidebarViews(readJson(SIDEBAR_KEY), readJson(LEGACY_SIDEBAR_KEY), { ids: SIDEBAR_IDS, defaults: DEFAULT_SIDEBAR })
}

export function saveSidebarViews(views: SidebarView[]): void {
  try {
    localStorage.setItem(SIDEBAR_KEY, JSON.stringify(views))
  } catch {
    /* non-fatal */
  }
}

/** Sections a user rolled up to just their header. Open windows starts
 * collapsed — it earns its space on demand, not by default. */
const COLLAPSED_KEY = 'tm.sidebar.collapsed.v1'
const DEFAULT_COLLAPSED: SidebarView[] = ['windows']

export function loadSidebarCollapsed(): SidebarView[] {
  return sanitizeCollapsed(readJson(COLLAPSED_KEY), { ids: SIDEBAR_IDS, defaults: DEFAULT_COLLAPSED })
}

export function saveSidebarCollapsed(views: SidebarView[]): void {
  try {
    localStorage.setItem(COLLAPSED_KEY, JSON.stringify(views))
  } catch {
    /* non-fatal */
  }
}

/** Grid column preference. `auto` packs up to three columns; a number pins the
 * count, though the viewport can still cap it lower before panes get crushed. */
export type PaneCols = 'auto' | 1 | 2 | 3

/** Column widths a user dragged, keyed by the column count they were dragged
 * at — sizing a two-column grid says nothing about a three-column one. */
export type PaneFractions = Record<string, number[]>

/** Sizes shared one key: columns, sidebar width, dragged column widths. Reads
 * tolerate anything (an older app wrote only `cols`); writes merge so one
 * concern never drops another's value. */
const LAYOUT_KEY = 'tm.layout.v1'

function readLayout(): Record<string, unknown> {
  const raw = readJson(LAYOUT_KEY)
  return typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}
}

function writeLayout(patch: Record<string, unknown>): void {
  try {
    localStorage.setItem(LAYOUT_KEY, JSON.stringify({ ...readLayout(), ...patch }))
  } catch {
    /* private mode / quota — sizes just reset next launch */
  }
}

export function loadPaneCols(): PaneCols {
  return readPaneCols(readLayout())
}

export function savePaneCols(cols: PaneCols): void {
  writeLayout({ cols })
}

/** Sizes are stored per view bucket: a split tuned for the full screen is wrong
 * at half the width, and the transient Alt+Q half view must not overwrite it.
 * `sidebar` stays null until dragged, so an untouched sidebar keeps following
 * the responsive default instead of freezing today's number into storage. */
export type PaneSizes = Sizes

export type AllSizes = Record<SizeBucket, PaneSizes>

export function emptySizes(): PaneSizes {
  return emptySizesShared()
}

export function loadSizes(): AllSizes {
  // Bucketed sizes, or a pre-bucket layout seeding both buckets — see
  // readAllSizes in @shared/panes.mjs.
  return readAllSizes(readLayout())
}

export function saveSizes(sizes: AllSizes): void {
  writeLayout({ sizes })
}

/**
 * What the nav's split launch row starts on a plain click. Three verbs that
 * differ only in which agent they run don't each deserve a row, but a picker
 * that always costs a click is worse than the rows were — so the row starts
 * what you started last and the popover is only for changing your mind.
 * Ctrl+Shift+` is unaffected: it always opens a plain shell.
 */
export const LAUNCH_KINDS: TerminalLaunch[] = ['claude', 'codex', 'shell']

const LAUNCH_KEY = 'tm.launch.v1'

export function loadLaunch(): TerminalLaunch {
  return readLaunch(readJson(LAUNCH_KEY), LAUNCH_KINDS)
}

export function saveLaunch(launch: TerminalLaunch): void {
  try {
    localStorage.setItem(LAUNCH_KEY, JSON.stringify(launch))
  } catch {
    /* private mode / quota — the default just resets next launch */
  }
}
