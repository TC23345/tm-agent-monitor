export const MAX_IMPORT_BYTES: number
export const MAX_IMPORT_CLIPS: number
export const MAX_IMPORT_SNIPPETS: number

export interface ImportedClip {
  text: string
  title?: string
  favorite?: boolean
  groups?: string[]
  createdAt?: number
  copiedAt?: number
  /** The page it was copied from (a browser clip). */
  sourceUrl?: string
  /** Position among favorites in the backup, when it had one. */
  order?: number
  merged?: boolean
  edited?: boolean
}

export interface ImportedSnippet {
  shortcut: string
  text: string
}

export interface ImportPlan {
  source: 'agent-monitor' | 'clipboard-history-pro'
  clips: ImportedClip[]
  snippets: ImportedSnippet[]
}

export function parseClipImport(raw: unknown): ImportPlan | null
export function snippetNote(snippet: ImportedSnippet): { file: string; body: string } | null
