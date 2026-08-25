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
