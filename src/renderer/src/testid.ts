/**
 * Stable `data-testid` values for automation (the electron-debug MCP loop,
 * capture scripts). Derived from labels so they never need hand-maintenance,
 * but stable across styling changes — unlike class names and aria text.
 */
export function slug(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

export function tid(kind: string, ...parts: (string | number | undefined)[]): string {
  return [kind, ...parts.filter((p) => p !== undefined).map((p) => slug(String(p)))].join(':')
}
