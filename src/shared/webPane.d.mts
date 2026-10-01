import type { AppKeyAction } from './keymap.mjs'
export const WEB_PARTITION: string
export interface WebPaneConfig { url: string; label: string }
export function sanitizeWebUrl(raw: unknown): string | null
export function webLabel(raw: unknown): string
export function sameOrigin(a: unknown, b: unknown): boolean
export function sanitizeWebConfig(raw: unknown): WebPaneConfig | null
export function webPaneKey(input: unknown): { action: AppKeyAction; arg?: number } | null
export function plainUserAgent(ua: unknown): string
