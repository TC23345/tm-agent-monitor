export const FOLDERS_KEY: string
export const MAX_FOLDERS: number
export interface FolderEntry { cwd: string; label: string; at: number }
export interface FolderPaneConfig { path: string }
export function folderLabel(path: string): string
export function sanitizeFolderConfig(raw: unknown): FolderPaneConfig | null
export function sanitizeFolders(raw: unknown): FolderEntry[]
export function rememberFolder(list: FolderEntry[], cwd: string, at?: number, label?: string): FolderEntry[]
export function forgetFolder(list: FolderEntry[], cwd: string): FolderEntry[]
export function whenLabel(at: number, now?: number): string
