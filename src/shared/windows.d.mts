import type { DesktopWindow, DesktopWindowKind, ProviderId } from './types.js'

export interface WindowGroup {
  kind: DesktopWindowKind
  label: string
  windows: DesktopWindow[]
}

export const WINDOW_GROUPS: { kind: DesktopWindowKind; label: string }[]
export function classifyWindow(exe: unknown): { app: string; kind: DesktopWindowKind } | null
export function cleanWindowTitle(title: unknown, app: string): string
export function buildWindowList(
  raw: unknown,
  options?: {
    agents?: { id: string; provider: ProviderId; focusHwnd?: string; focusPid?: number }[]
    excludePids?: number[]
  }
): DesktopWindow[]
export function groupWindows(list: DesktopWindow[] | undefined): WindowGroup[]
