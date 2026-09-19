export interface PlacementRect { x: number; y: number; width: number; height: number }
export const DEFAULT_DOCK_INSET: number
export const LAUNCH_WATCH_MS: number
export const REUSE_AFTER_MS: number
export const LAUNCH_EXES: { cursor: string[]; chrome: string[]; terminal: string[] }
export const TIDY_KINDS: Set<string>
export function dockRect(workArea: PlacementRect, inset?: number): PlacementRect | null
export function outerRectFor(target: PlacementRect, windowRect: PlacementRect | null, frameRect: PlacementRect | null): PlacementRect | null
export function pickLaunchedWindow(s: {
  rows: { hwnd: string; pid: number; exe: string }[]
  before: Set<string> | string[]
  exes: string[]
  foreground?: { hwnd: string; pid: number; exe: string } | null
  elapsedMs?: number
}): { hwnd: string; pid: number } | null
export function centreInside(rect: PlacementRect | null, area: PlacementRect): boolean
