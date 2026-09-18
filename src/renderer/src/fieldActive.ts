import { useSyncExternalStore } from 'react'

/**
 * Whether the GPU layers may draw: the workspace is open and the user has
 * not switched the session glow off. App sets it; the session field, the
 * attention layer, and the quota streams read it, so a bar deep in the
 * Limits section needs no prop chain to know the window is hidden.
 */
let active = false
const subs = new Set<() => void>()

export function setFieldActive(next: boolean): void {
  if (active === next) return
  active = next
  for (const fn of subs) fn()
}

function subscribe(fn: () => void): () => void {
  subs.add(fn)
  return () => { subs.delete(fn) }
}

export function useFieldActive(): boolean {
  return useSyncExternalStore(subscribe, () => active)
}
