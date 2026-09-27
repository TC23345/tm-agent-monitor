export type AppKeyAction =
  | 'palette' | 'legend' | 'settings' | 'sidebar' | 'waiting'
  | 'newTerminal' | 'nextPane' | 'prevPane' | 'focusPane' | 'zoom'

export interface AppKey { chord: string; terminal: boolean; arg?: number }
export interface AppKeyEntry { action: AppKeyAction; label: string; keys: readonly AppKey[]; display?: readonly string[] }
export interface OtherKeyRow { label: string; keys: readonly string[]; terminal?: boolean }
export interface ReservedKey { owner: string; chord: string; action: string }
export interface KeyOwner { owner: string; action: string; terminal?: boolean }

export function canonicalChord(chord: unknown): string | null
export function eventChord(e: {
  key?: string
  code?: string
  ctrlKey?: boolean
  altKey?: boolean
  shiftKey?: boolean
  metaKey?: boolean
} | null | undefined): string | null
export function keyLabel(chord: string): string

export const APP_KEYS: readonly AppKeyEntry[]
export const OTHER_KEYS: readonly { group: string; rows: readonly OtherKeyRow[] }[]
export const RESERVED: readonly ReservedKey[]
export const RESERVED_OWNERS: readonly string[]

export function matchAppKey(chord: string | null, inTerminal: boolean): { action: AppKeyAction; arg?: number } | null
export function ownersOf(chord: string | null): KeyOwner[]
export function terminalCollisions(): { action: AppKeyAction; chord: string; owner: string; what: string }[]
