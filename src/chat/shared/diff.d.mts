export interface DiffLine { type: 'eq' | 'del' | 'add' | 'hunk'; text: string }
export interface DiffRow { left: DiffLine | null; right: DiffLine | null; hunk?: string }

export const MAX_DIFF_CELLS: number
export function splitLines(text: unknown): string[]
export function lineDiff(before: string, after: string, maxCells?: number): DiffLine[]
export function looksLikeUnifiedDiff(text: unknown): boolean
export function parseUnifiedDiff(diff: string): DiffLine[]
export function changeLines(change: { before?: string; after?: string; diff?: string; kind?: 'add' | 'delete' | 'update' }): DiffLine[]
export function splitRows(lines: DiffLine[]): DiffRow[]
export function countChanges(lines: DiffLine[]): { added: number; removed: number }
export function changeSummary(counts: { added: number; removed: number }): string
export interface WordSegment { text: string; changed: boolean }
export function wordDiff(before: string, after: string, maxCells?: number): { left: WordSegment[]; right: WordSegment[] }
export function relTo(path: string, cwd: string): string
export function filePatch(rel: string, kind: string | undefined, diff: string): string | null
