import { Activity, AppWindow, Coins, SquareTerminal, Terminal } from 'lucide-react'
import type { TerminalLaunch } from '@shared/types'
import type { SizeBucket } from '@shared/layout.mjs'

/**
 * The main frame belongs to work: the launcher, embedded terminal sessions,
 * and the Usage report (spend + insights). At-a-glance status — open windows
 * and limit bars — lives in the Coding Agents sidebar as toggleable stacked
 * sections; see `SidebarView`.
 */
export type PaneKind = 'launcher' | 'terminal' | 'usage'

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
  { id: 'launcher', label: 'Launch', icon: SquareTerminal, hint: 'Start a terminal, editor, or browser' },
  { id: 'terminal', label: 'Terminal', icon: Terminal, hint: 'An embedded PowerShell terminal' },
  { id: 'usage', label: 'Usage', icon: Coins, hint: 'Today’s spend and local usage insights' }
]

export const MAX_PANES = 6

export function newPane(kind: PaneKind, term?: TerminalPaneConfig): PaneInstance {
  return { id: crypto.randomUUID(), kind, term: kind === 'terminal' ? (term ?? { launch: 'shell' }) : undefined }
}

export function defaultPanes(): PaneInstance[] {
  return [newPane('launcher')]
}

/** Kinds that may appear only once. Terminals repeat — one shell per pane. */
export function isUniqueKind(kind: PaneKind): boolean {
  return kind !== 'terminal'
}

const STORAGE_KEY = 'tm.panes.v2'

function isPaneKind(value: unknown): value is PaneKind {
  return PANE_KINDS.some((p) => p.id === value)
}

function sanitize(raw: unknown): PaneInstance[] {
  if (!Array.isArray(raw)) return []
  const out: PaneInstance[] = []
  const seen = new Set<PaneKind>()
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue
    const { id, kind, term } = item as Partial<PaneInstance>
    if (typeof id !== 'string' || !isPaneKind(kind)) continue
    if (isUniqueKind(kind)) {
      if (seen.has(kind)) continue
      seen.add(kind)
    }
    if (kind === 'terminal') {
      const launch = term?.launch === 'claude' || term?.launch === 'codex' ? term.launch : 'shell'
      out.push({
        id,
        kind,
        term: {
          launch,
          cwd: typeof term?.cwd === 'string' ? term.cwd : undefined,
          label: typeof term?.label === 'string' ? term.label : undefined,
          sessionId: typeof term?.sessionId === 'string' ? term.sessionId : undefined,
          initialCommand: typeof term?.initialCommand === 'string' ? term.initialCommand : undefined
        }
      })
    } else {
      out.push({ id, kind })
    }
    if (out.length === MAX_PANES) break
  }
  return out
}

export function loadPanes(): PaneInstance[] {
  try {
    // Older layouts stored data-view kinds here; sanitize drops them (they moved
    // to the sidebar) and an emptied layout falls back to the default.
    const panes = sanitize(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null'))
    return panes.length ? panes : defaultPanes()
  } catch {
    return defaultPanes()
  }
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
  { id: 'windows', label: 'Open windows', icon: AppWindow, hint: 'Switch to an open terminal, editor, or browser' },
  { id: 'limits', label: 'Limits', icon: Activity, hint: 'Provider usage limits' }
]

/** Views that pin above the agent list, in this order. Open windows leads: it
 * starts rolled up, so it costs one header row and is one click from the switcher.
 * Everything else stacks below the agents. */
export const SIDEBAR_TOP: SidebarView[] = ['windows', 'limits']

export function isTopSidebarView(view: SidebarView): boolean {
  return SIDEBAR_TOP.includes(view)
}

const SIDEBAR_KEY = 'tm.sidebar.v2'
const LEGACY_SIDEBAR_KEY = 'tm.sidebar.v1'
const DEFAULT_SIDEBAR: SidebarView[] = ['windows', 'limits']

function isSidebarView(value: unknown): value is SidebarView {
  return SIDEBAR_VIEWS.some((v) => v.id === value)
}

export function loadSidebarViews(): SidebarView[] {
  try {
    const raw = JSON.parse(localStorage.getItem(SIDEBAR_KEY) ?? 'null')
    if (Array.isArray(raw)) return [...new Set(raw.filter(isSidebarView))]
    // One-time v1 migration: keep the user's toggles but surface the new
    // collapsed Open windows section once. Hiding it again sticks (v2).
    const legacy = JSON.parse(localStorage.getItem(LEGACY_SIDEBAR_KEY) ?? 'null')
    if (Array.isArray(legacy)) {
      const views = [...new Set(legacy.filter(isSidebarView))]
      if (!views.includes('windows')) views.push('windows')
      return views
    }
    return [...DEFAULT_SIDEBAR]
  } catch {
    return [...DEFAULT_SIDEBAR]
  }
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
  try {
    const raw = JSON.parse(localStorage.getItem(COLLAPSED_KEY) ?? 'null')
    if (!Array.isArray(raw)) return [...DEFAULT_COLLAPSED]
    return [...new Set(raw.filter(isSidebarView))]
  } catch {
    return [...DEFAULT_COLLAPSED]
  }
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
  try {
    const raw = JSON.parse(localStorage.getItem(LAYOUT_KEY) ?? 'null')
    return typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

function writeLayout(patch: Record<string, unknown>): void {
  try {
    localStorage.setItem(LAYOUT_KEY, JSON.stringify({ ...readLayout(), ...patch }))
  } catch {
    /* private mode / quota — sizes just reset next launch */
  }
}

export function loadPaneCols(): PaneCols {
  const cols = readLayout().cols
  return cols === 1 || cols === 2 || cols === 3 || cols === 'auto' ? cols : 'auto'
}

export function savePaneCols(cols: PaneCols): void {
  writeLayout({ cols })
}

/** Sizes are stored per view bucket: a split tuned for the full screen is wrong
 * at half the width, and the transient Alt+Q half view must not overwrite it.
 * `sidebar` stays null until dragged, so an untouched sidebar keeps following
 * the responsive default instead of freezing today's number into storage. */
export interface PaneSizes {
  sidebar: number | null
  cols: PaneFractions
  rows: PaneFractions
}

export type AllSizes = Record<SizeBucket, PaneSizes>

export function emptySizes(): PaneSizes {
  return { sidebar: null, cols: {}, rows: {} }
}

function readFractions(raw: unknown): PaneFractions {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {}
  const out: PaneFractions = {}
  for (const [count, list] of Object.entries(raw as Record<string, unknown>)) {
    if (!/^[1-9]\d*$/.test(count) || !Array.isArray(list)) continue
    if (list.every((n) => typeof n === 'number' && Number.isFinite(n) && n > 0)) out[count] = list as number[]
  }
  return out
}

function readWidth(raw: unknown): number | null {
  return typeof raw === 'number' && Number.isFinite(raw) && raw > 0 ? raw : null
}

function readSizes(raw: unknown): PaneSizes {
  if (typeof raw !== 'object' || raw === null) return emptySizes()
  const { sidebar, cols, rows } = raw as Record<string, unknown>
  return { sidebar: readWidth(sidebar), cols: readFractions(cols), rows: readFractions(rows) }
}

export function loadSizes(): AllSizes {
  const stored = readLayout()
  const buckets = stored.sizes
  if (typeof buckets === 'object' && buckets !== null) {
    const { full, half } = buckets as Record<string, unknown>
    return { full: readSizes(full), half: readSizes(half) }
  }
  // Pre-bucket layouts held one set of sizes at the top level. The user sized
  // whichever view they were in; seeding both beats discarding the drag.
  const legacy: PaneSizes = { sidebar: readWidth(stored.sidebar), cols: readFractions(stored.fracs), rows: {} }
  return { full: legacy, half: { ...legacy, cols: { ...legacy.cols } } }
}

export function saveSizes(sizes: AllSizes): void {
  writeLayout({ sizes })
}
