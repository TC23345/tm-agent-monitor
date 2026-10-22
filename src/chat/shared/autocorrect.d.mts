export const BOUNDARY: RegExp
export const MAX_KEEP: number
export const MAX_LEXICON: number
export const CONTRACTIONS: Record<string, string>
export const TECH_WORDS: Set<string>
export interface SpellAnswer { ok: boolean; suggestions: string[] }
export function wordBefore(text: string, caret: number): { start: number; end: number; word: string } | null
export function inCode(text: string, at: number): boolean
export function correctable(word: string, known?: Iterable<string>): boolean
export function editDistance(a: string, b: string): number
export function acceptable(word: string, fix: string): boolean
export function applyCase(word: string, fix: string): string
export function fixFor(word: string, answer: SpellAnswer | null | undefined): string | null
export function lexicon(texts: Iterable<string>, max?: number): Set<string>
export function sanitizeKeep(list: unknown): string[]
