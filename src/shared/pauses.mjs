/**
 * Whether background work should run right now, from what powerMonitor has
 * told us. Locked or suspended: nothing polls, so a machine left overnight
 * does not burn the usage endpoint's rate limit (which has bitten us) or
 * re-scan ledgers nobody is looking at. Pure and tested.
 */

/** @param {{ locked?: boolean, suspended?: boolean }} state */
export function tickAllowed(state) {
  return !(state?.locked === true || state?.suspended === true)
}

/** True when the transition `prev`→`next` is a wake-up: work was paused and
 * is not any more. The caller runs one immediate refresh so the first look
 * after unlocking is fresh instead of up to a poll interval stale. */
export function isWake(prev, next) {
  return !tickAllowed(prev) && tickAllowed(next)
}
