export const NOTE_EXT: string
export const MAX_NOTE_BYTES: number
export const MAX_NOTES: number
export interface NoteMeta {
  name: string
  mtime: number
  size: number
  preview?: string
}
export function isNoteName(name: unknown): name is string
export function noteTitle(name: string): string
export function noteNameFor(title: string): string | undefined
export function nextNoteName(existing: string[], now?: number): string
export function sortNotes<T extends { name: string; mtime: number }>(notes: T[]): T[]
export function notePreview(text: string, max?: number): string
