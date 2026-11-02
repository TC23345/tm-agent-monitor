import type { AppUpdateOffer } from './types.js'
export function compareVersions(a: unknown, b: unknown): -1 | 0 | 1 | null
export function updateOffer(versions: { running: string; checkout?: string | null; downloaded?: string | null }): AppUpdateOffer | null
export function installersToRemove(names: string[], versions: { built: string; running?: string }): string[]
