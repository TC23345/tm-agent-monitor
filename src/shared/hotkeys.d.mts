import type { PickerFavoriteModifier } from './types.js'

export function normalizeAccelerator(value: unknown): string | null
export function sameChord(a: unknown, b: unknown): boolean

export type ChordResult =
  | { accelerator: string }
  | { cancel: true }
  | { pending: true }
  | { invalid: string }

export function chordFromKeydown(e: {
  key?: string
  code?: string
  ctrlKey?: boolean
  altKey?: boolean
  shiftKey?: boolean
  metaKey?: boolean
} | null | undefined): ChordResult

export const PICKER_FAVORITE_MODIFIERS: readonly PickerFavoriteModifier[]
export function isPickerFavoriteModifier(value: unknown): value is PickerFavoriteModifier

export const SHORTCUT_DEFAULTS: Readonly<{
  halfHotkey: string
  pickerHotkey: string
  favoriteHotkeys: readonly string[]
  pickerFavoriteModifier: PickerFavoriteModifier
}>

export function normalizeFavoriteHotkeys(value: unknown): string[] | null
export function modifierLabel(mod: string): string
