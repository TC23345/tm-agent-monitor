export interface PowerState { locked?: boolean; suspended?: boolean }
export function tickAllowed(state: PowerState | undefined | null): boolean
export function isWake(prev: PowerState | undefined | null, next: PowerState | undefined | null): boolean
