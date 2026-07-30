import { Activity, AppWindow, ChartColumn, Coins, ListTree, SquareTerminal } from 'lucide-react'

/**
 * The content a main-frame pane can show. Each kind appears at most once, so the
 * grid tops out at one pane per kind and nothing is ever polled twice.
 */
export type PaneKind = 'launcher' | 'windows' | 'limits' | 'spend' | 'insights' | 'agents'

export const PANE_KINDS: { id: PaneKind; label: string; icon: typeof Activity; hint: string }[] = [
  { id: 'launcher', label: 'Launch', icon: SquareTerminal, hint: 'Start a terminal, editor, or browser' },
  { id: 'windows', label: 'Open windows', icon: AppWindow, hint: 'Switch to an open terminal, editor, or browser' },
  { id: 'limits', label: 'Limits', icon: Activity, hint: 'Provider usage limits' },
  { id: 'spend', label: 'Spend', icon: Coins, hint: 'Today’s tokens and value per provider and project' },
  { id: 'insights', label: 'Insights', icon: ChartColumn, hint: 'Local Claude and Codex usage patterns' },
  { id: 'agents', label: 'Agents', icon: ListTree, hint: 'Live sessions, grouped by project' }
]

/** Three vertical columns to start; the grid grows to a second row up to six. */
export const DEFAULT_PANES: PaneKind[] = ['launcher', 'windows', 'limits']
export const MAX_PANES = 6

const STORAGE_KEY = 'tm.panes.v1'

export function loadPanes(): PaneKind[] {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null')
    if (!Array.isArray(raw)) return [...DEFAULT_PANES]
    const valid = raw.filter((k): k is PaneKind => PANE_KINDS.some((p) => p.id === k))
    const unique = [...new Set(valid)].slice(0, MAX_PANES)
    return unique.length ? unique : [...DEFAULT_PANES]
  } catch {
    return [...DEFAULT_PANES]
  }
}

export function savePanes(panes: PaneKind[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(panes))
  } catch {
    /* private mode / quota — the layout just resets next launch */
  }
}
