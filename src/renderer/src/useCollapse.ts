import { useCallback, useEffect, useState } from 'react'

/** Fired by the top bar's collapse-all button; detail = desired collapsed state. */
export const COLLAPSE_ALL_EVENT = 'cw-collapse-all'

/**
 * Fired whenever one hook instance changes a key. The same group can be on
 * screen twice (the agent sidebar and an `agents` pane), and each instance holds
 * its own React state over the shared localStorage key — without this, toggling
 * one leaves the other stale until it remounts.
 */
const COLLAPSE_SYNC_EVENT = 'cw-collapse-sync'

/**
 * Boolean collapse state persisted in localStorage, keyed per group/panel.
 * Pass `bulk: true` (project groups) to also follow the collapse-all event —
 * the usage zones deliberately don't, so collapse-all only sweeps the agent list.
 */
export function useCollapse(key: string, defaultCollapsed = false, bulk = false): [boolean, () => void] {
  const storageKey = `cw.collapse.${key}`
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try {
      const v = localStorage.getItem(storageKey)
      return v === null ? defaultCollapsed : v === '1'
    } catch {
      return defaultCollapsed
    }
  })
  const set = useCallback(
    (next: boolean) => {
      setCollapsed(next)
      try {
        localStorage.setItem(storageKey, next ? '1' : '0')
      } catch {
        /* private mode / quota — non-fatal */
      }
      window.dispatchEvent(new CustomEvent(COLLAPSE_SYNC_EVENT, { detail: storageKey }))
    },
    [storageKey]
  )
  const toggle = useCallback(() => set(!collapsed), [set, collapsed])

  // Adopt a change made by another instance of the same key. This reads back the
  // stored value rather than re-setting it, so it never re-dispatches.
  useEffect(() => {
    const onSync = (e: Event) => {
      if ((e as CustomEvent<string>).detail !== storageKey) return
      try {
        const v = localStorage.getItem(storageKey)
        setCollapsed(v === null ? defaultCollapsed : v === '1')
      } catch {
        /* non-fatal */
      }
    }
    window.addEventListener(COLLAPSE_SYNC_EVENT, onSync)
    return () => window.removeEventListener(COLLAPSE_SYNC_EVENT, onSync)
  }, [storageKey, defaultCollapsed])

  useEffect(() => {
    if (!bulk) return
    const onAll = (e: Event) => set(!!(e as CustomEvent<boolean>).detail)
    window.addEventListener(COLLAPSE_ALL_EVENT, onAll)
    return () => window.removeEventListener(COLLAPSE_ALL_EVENT, onAll)
  }, [bulk, set])

  return [collapsed, toggle]
}
