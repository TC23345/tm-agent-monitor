export function imageSize(base64: string): { width: number; height: number } | null
export function serverTitle(server: string): string
export function mcpTitle(server: string, tool?: string): string
export function splitMcpName(name: string): { server: string; tool: string } | null
export function argDetail(args: unknown): string | undefined
export function effortLabel(effort: string | null | undefined): string
export function modelLabel(id: string | null | undefined): string
export function latestModels<M extends { id: string; label: string }>(models: M[], keep?: string): M[]
export function formatElapsed(ms: number): string
export function clockTime(at: number, locale?: string): string
export function fmtTokens(n: number): string
