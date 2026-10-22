export interface OutputStyleInfo { name: string; description?: string; path?: string; builtin: boolean; preview?: string[] }
export interface StyleFile { path: string; text: string }
export const BUILTIN_STYLES: { name: string; description: string }[]
export const PREVIEW_LINES: number
export function styleKey(name: string | undefined): string
export function parseStyleFile(text: string, path: string): { name: string; description: string; keepCoding: boolean; body: string }
export function previewLines(body: string | undefined, count?: number): string[]
export function styleCatalog(listed: string[] | undefined, files: StyleFile[] | undefined): OutputStyleInfo[]
export function duplicateStyle(name: string): { fileName: string; text: string } | null
