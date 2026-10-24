export const FOLDERS_KEY: string
export const MAX_FOLDERS: number
export interface FolderEntry { cwd: string; label: string; at: number }
export interface FolderPaneConfig { path: string; tree?: number }
export const TREE_DEFAULT: number
export const TREE_MIN: number
export const TREE_MAX: number
export const WORK_MIN: number
export function clampTreeWidth(width: number, paneWidth?: number): number
export function pillLines(label?: string): string[]
export const TYPE_MS: number
export const LINE_PAUSE_MS: number
export function streamedLines(lines: string[], elapsed: number, typeMs?: number, pauseMs?: number): { shown: string[]; current: number; done: boolean }
export function streamDuration(lines: string[], typeMs?: number, pauseMs?: number): number
export function folderLabel(path: string): string
export function sanitizeFolderConfig(raw: unknown): FolderPaneConfig | null
export function sanitizeFolders(raw: unknown): FolderEntry[]
export function rememberFolder(list: FolderEntry[], cwd: string, at?: number, label?: string): FolderEntry[]
export function forgetFolder(list: FolderEntry[], cwd: string): FolderEntry[]
export function whenLabel(at: number, now?: number): string
