export interface TerminalColors {
  background: string
  foreground: string
  cursor: string
  cursorAccent: string
  selectionBackground: string
  black?: string
  red?: string
  green?: string
  yellow?: string
  blue?: string
  magenta?: string
  cyan?: string
  white?: string
  brightBlack?: string
  brightRed?: string
  brightGreen?: string
  brightYellow?: string
  brightBlue?: string
  brightMagenta?: string
  brightCyan?: string
  brightWhite?: string
}
export interface TerminalThemeDef {
  id: string
  label: string
  hint: string
  theme: TerminalColors
}
export const DEFAULT_TERMINAL_THEME: string
export const TERMINAL_THEME_KEY: string
export const TERMINAL_THEMES: TerminalThemeDef[]
export function readTerminalTheme(raw: unknown): string
export function terminalContrast(id: string): number
export function terminalTheme(id: string): TerminalColors
