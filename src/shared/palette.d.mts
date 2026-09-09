export type PaletteSection = 'command' | 'agent' | 'window'

export interface PaletteMatchable {
  section: PaletteSection
  label: string
  detail?: string
  keywords?: string[]
}

export function parseQuery(raw: string): { mode: PaletteSection | null; text: string }
export function fuzzyScore(query: string, text: string): number | null
export function rankItems<T extends PaletteMatchable>(items: T[], raw: string, limit?: number): T[]

export const GROUP_ORDER: string[]
export function commandGroup(id: string): string
export function homeItems<T extends PaletteMatchable & { id?: string; pinned?: boolean }>(items: T[]): T[]
export function browseItems<T extends PaletteMatchable & { id?: string }>(items: T[]): T[]
