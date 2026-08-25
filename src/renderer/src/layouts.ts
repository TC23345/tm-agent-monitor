import type { AllSizes, PaneCols, PaneInstance, SidebarView } from './panes'
import { newPane } from './panes'

/**
 * Named workspace layouts: a snapshot of the pane set, the dragged sizes, the
 * sidebar views and their collapse state, and the column choice. Terminal
 * panes are saved by launch + folder only — a layout restores a fresh shell
 * there, the way an app restart does — so `sessionId` is stripped on save.
 */
export interface SavedLayout {
  panes: PaneInstance[]
  sizes: AllSizes
  sidebar: SidebarView[]
  collapsed: SidebarView[]
  cols: PaneCols
  savedAt: number
}

export type LayoutMap = Record<string, SavedLayout>

const KEY = 'tm.layouts.v1'

export function loadLayouts(): LayoutMap {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null')
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {}
    const out: LayoutMap = {}
    for (const [name, value] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof value !== 'object' || value === null) continue
      const v = value as Partial<SavedLayout>
      if (!Array.isArray(v.panes) || !v.sizes || !Array.isArray(v.sidebar)) continue
      out[name] = {
        panes: v.panes,
        sizes: v.sizes,
        sidebar: v.sidebar,
        collapsed: Array.isArray(v.collapsed) ? v.collapsed : [],
        cols: v.cols === 1 || v.cols === 2 || v.cols === 3 ? v.cols : 'auto',
        savedAt: typeof v.savedAt === 'number' ? v.savedAt : 0
      }
    }
    return out
  } catch {
    return {}
  }
}

export function saveLayouts(map: LayoutMap): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(map))
  } catch {
    /* non-fatal */
  }
}

/** A layout captured from live state; the pane ids are kept so the saved
 * order is exact, but they are regenerated on restore. */
export function snapshotLayout(state: Omit<SavedLayout, 'savedAt'>): SavedLayout {
  return {
    ...state,
    panes: state.panes.map((p) => (p.term ? { ...p, term: { ...p.term, sessionId: undefined } } : { ...p })),
    savedAt: Date.now()
  }
}

/** Fresh pane instances for a saved layout, so restoring twice never collides. */
export function panesFromLayout(layout: SavedLayout): PaneInstance[] {
  return layout.panes.map((p) => newPane(p.kind, p.term ? { ...p.term, sessionId: undefined } : undefined))
}

export const LAYOUT_NAME_MAX = 40
