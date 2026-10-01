export const RECENT_WINDOW_MS: number
export const MAX_RECENT: number
export interface RecentProject { cwd: string; label: string; at: number }
export type RecentMap = Record<string, RecentProject>
export interface ProjectTouch { cwd?: string; label?: string; at: number }
export function sanitizeRecent(raw: unknown, now?: number): RecentMap
export function touchRecent(map: RecentMap, touches: ProjectTouch[], now?: number): RecentMap
export function recentList(map: RecentMap, now?: number): RecentProject[]
export function packRows(widths: number[], width: number, gap?: number): { rows: number[][]; overflow: boolean }
export const STREAM_DEFAULT: number
export const STREAM_SNAP: number
export const STREAM_RESERVE: number
export function clampStreamHeight(height: number, sidebarHeight: number): number
export function readStreamHeight(raw: unknown): number
