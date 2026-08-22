import { Activity, AppWindow, ChartColumn, Coins, SquareTerminal, Terminal } from 'lucide-react'
import type { TerminalLaunch } from '@shared/types'

/**
 * The main frame belongs to work: the launcher and embedded terminal sessions.
 * The data views (limits, spend, open windows, insights) live in the Coding
 * Agents sidebar as toggleable stacked sections — see `SidebarView`.
 */
export type PaneKind = 'launcher' | 'terminal'

/** What an embedded terminal pane runs. `sessionId` reattaches after a remount;
 * a stale id (fresh app run) just starts a new shell with the same launch. */
export interface TerminalPaneConfig {
  launch: TerminalLaunch
  cwd?: string
  label?: string
  sessionId?: string
}

export interface PaneInstance {
  id: string
  kind: PaneKind
  term?: TerminalPaneConfig
}

export const PANE_KINDS: { id: PaneKind; label: string; icon: typeof Activity; hint: string }[] = [
  { id: 'launcher', label: 'Launch', icon: SquareTerminal, hint: 'Start a terminal, editor, or browser' },
  { id: 'terminal', label: 'Terminal', icon: Terminal, hint: 'An embedded PowerShell terminal' }
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
          sessionId: typeof term?.sessionId === 'string' ? term.sessionId : undefined
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

/** Data views stacked in the sidebar, toggled from the sidebar menu. Limits
 * pins above the agent list; the rest stack below in catalog order. */
export type SidebarView = 'limits' | 'spend' | 'windows' | 'insights'

export const SIDEBAR_VIEWS: { id: SidebarView; label: string; icon: typeof Activity; hint: string }[] = [
  { id: 'limits', label: 'Limits', icon: Activity, hint: 'Provider usage limits' },
  { id: 'spend', label: 'Spend', icon: Coins, hint: 'Today’s tokens and value per provider and project' },
  { id: 'windows', label: 'Open windows', icon: AppWindow, hint: 'Switch to an open terminal, editor, or browser' },
  { id: 'insights', label: 'Insights', icon: ChartColumn, hint: 'Local Claude and Codex usage patterns' }
]

const SIDEBAR_KEY = 'tm.sidebar.v2'
const LEGACY_SIDEBAR_KEY = 'tm.sidebar.v1'
const DEFAULT_SIDEBAR: SidebarView[] = ['limits', 'windows']

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

/** Sidebar stacking order. The agent list is itself a slot, so data views can
 * be dragged above or below it; a hidden view keeps its place for when it
 * returns. Views added in later versions append in catalog order. */
export type SidebarSlot = SidebarView | 'agents'

const SIDEBAR_ORDER_KEY = 'tm.sidebarOrder.v1'
const DEFAULT_SIDEBAR_ORDER: SidebarSlot[] = ['limits', 'agents', 'spend', 'windows', 'insights']

function isSidebarSlot(value: unknown): value is SidebarSlot {
  return value === 'agents' || isSidebarView(value)
}

export function loadSidebarOrder(): SidebarSlot[] {
  try {
    const raw = JSON.parse(localStorage.getItem(SIDEBAR_ORDER_KEY) ?? 'null')
    const order = Array.isArray(raw) ? [...new Set(raw.filter(isSidebarSlot))] : []
    for (const slot of DEFAULT_SIDEBAR_ORDER) if (!order.includes(slot)) order.push(slot)
    return order
  } catch {
    return [...DEFAULT_SIDEBAR_ORDER]
  }
}

export function saveSidebarOrder(order: SidebarSlot[]): void {
  try {
    localStorage.setItem(SIDEBAR_ORDER_KEY, JSON.stringify(order))
  } catch {
    /* non-fatal */
  }
}

/** Grid column preference. `auto` packs up to three columns; a number pins the
 * count, though the viewport can still cap it lower before panes get crushed. */
export type PaneCols = 'auto' | 1 | 2 | 3

const LAYOUT_KEY = 'tm.layout.v1'

export function loadPaneCols(): PaneCols {
  try {
    const raw = JSON.parse(localStorage.getItem(LAYOUT_KEY) ?? 'null') as { cols?: unknown } | null
    const cols = raw?.cols
    return cols === 1 || cols === 2 || cols === 3 || cols === 'auto' ? cols : 'auto'
  } catch {
    return 'auto'
  }
}

export function savePaneCols(cols: PaneCols): void {
  try {
    localStorage.setItem(LAYOUT_KEY, JSON.stringify({ cols }))
  } catch {
    /* non-fatal */
  }
}
