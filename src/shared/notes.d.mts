export const NOTE_EXT: string
export const MAX_NOTE_BYTES: number
export const MAX_NOTES: number
export const MAX_FOLDER_DEPTH: number
export const MAX_FOLDERS: number
export interface NoteMeta {
  /** Path relative to the notes folder, `/`-separated: `todo.md`, `Work/todo.md`. */
  name: string
  mtime: number
  size: number
  /** The note's first `# ` heading, if any — the tree shows it as the title. */
  heading?: string
  preview?: string
}
/** Saved manual order: folder path ('' = top level) → child names. */
export type NoteOrder = Record<string, string[]>
export interface NoteFolderNode<T extends { name: string; mtime: number } = NoteMeta> {
  /** '' for the notes folder itself. */
  path: string
  name: string
  folders: NoteFolderNode<T>[]
  notes: T[]
  /** Notes in this folder and every folder under it. */
  count: number
}
export function isNoteName(name: unknown): name is string
export function isFolderName(name: unknown): name is string
export function isFolderPath(path: unknown): path is string
export function isNotePath(path: unknown): path is string
export function parentOf(path: string): string
export function baseName(path: string): string
export function joinNotePath(folder: string, name: string): string
export function noteTitle(name: string): string
export function noteNameFor(title: string): string | undefined
export function folderNameFor(title: string): string | undefined
export function nextFolderName(existing: string[]): string
export function buildTree<T extends { name: string; mtime: number }>(notes: T[], folders?: string[], order?: NoteOrder): NoteFolderNode<T>
export function nextNoteName(existing: string[], now?: number, prefix?: string): string
export interface NoteTemplate {
  id: string
  label: string
  prefix: string
  once: boolean
  body: (day: string) => string
}
export const NOTE_TEMPLATES: NoteTemplate[]
export function noteTemplate(id: unknown): NoteTemplate | undefined
export function templateForFolder(folder: string): NoteTemplate | undefined
export function planNewNote(existing: string[], templateId: unknown, now?: number, folder?: string): { name: string; body: string; exists: boolean; folder: string }
export function noteHeading(text: string): string
export function displayTitle(name: string, heading?: string): string
export function migrationPlan(rootNames: string[], inFolder?: Record<string, string[]>): { from: string; to: string }[]
export function sanitizeOrder(raw: unknown): NoteOrder
export function applyOrder<T>(items: T[], saved: string[] | undefined, nameOf?: (x: T) => string): T[]
export function orderAfterMove(order: NoteOrder, from: string, to: string, index?: number, visible?: string[]): NoteOrder
export function orderAfterRemove(order: NoteOrder, path: string): NoteOrder
export function moveProblem(from: string, toFolder: string, isFolder: boolean, subtreeDepth?: number): string | null
export function subtreeDepth(folder: string, folders: string[]): number
export function sortNotes<T extends { name: string; mtime: number }>(notes: T[]): T[]
export function notePreview(text: string, max?: number): string
