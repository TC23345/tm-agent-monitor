export const RELOAD_MAX: number
export const RELOAD_WINDOW_MS: number
export function reloadBudget(history: number[], now: number, options?: { max?: number; windowMs?: number }): { allow: boolean; history: number[] }
