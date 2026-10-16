export const IGNORED_DIRS: readonly string[]
export const MAX_DIR_ENTRIES: number
export const MAX_TEXT_BYTES: number
export const MAX_IMAGE_BYTES: number

export interface DirEntry { name: string; kind: 'dir' | 'file' }
/** What a persisted file pane carries: the file it shows. */
export interface FilePaneConfig { path: string }

export function extOf(name: unknown): string
export function baseName(path: unknown): string
export function parentDir(path: unknown): string
export function imageMime(name: unknown): string | null
export function fileKind(name: unknown): 'image' | 'markdown' | 'text'
export function hasNul(bytes: ArrayLike<number> | null | undefined): boolean
export function sortEntries(entries: unknown): DirEntry[]
export function isAbsolutePath(p: unknown): p is string
export function sanitizeFileConfig(raw: unknown): FilePaneConfig | null
