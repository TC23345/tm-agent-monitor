/**
 * How many times the workspace renderer may be reloaded automatically after
 * it dies, before we stop and tell the user. A crash loop reloading forever
 * would be worse than a blank window. Pure and tested.
 */

export const RELOAD_MAX = 3
export const RELOAD_WINDOW_MS = 5 * 60_000

/**
 * @param {number[]} history  timestamps of recent automatic reloads
 * @param {number} now
 * @returns {{ allow: boolean, history: number[] }}  whether to reload now, and
 *   the history to keep (pruned to the window, with `now` appended on allow)
 */
export function reloadBudget(history, now, { max = RELOAD_MAX, windowMs = RELOAD_WINDOW_MS } = {}) {
  const recent = (Array.isArray(history) ? history : []).filter((t) => Number.isFinite(t) && now - t < windowMs)
  if (recent.length >= max) return { allow: false, history: recent }
  return { allow: true, history: [...recent, now] }
}
