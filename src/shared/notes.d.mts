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
export function nextNoteName(existing: string[], now?: number, prefix?: string): string
export const NOTES_GROUP: 'notes'
export interface NoteTemplate {
  id: string
  label: string
  prefix: string
  once: boolean
  body: (day: string) => string
}
export const NOTE_TEMPLATES: NoteTemplate[]
export function noteTemplate(id: unknown): NoteTemplate | undefined
export function noteGroup(name: string): string
export function groupNotes<T extends { name: string }>(notes: T[]): { id: string; label: string; notes: T[] }[]
export function planNewNote(existing: string[], templateId: unknown, now?: number): { name: string; body: string; exists: boolean }
export function sortNotes<T extends { name: string; mtime: number }>(notes: T[]): T[]
export function notePreview(text: string, max?: number): string
