import { useCallback, useEffect, useState } from 'react'

/** Fired by the footer collapse-all button; detail = desired collapsed state. */
export const COLLAPSE_ALL_EVENT = 'cw-collapse-all'

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
    },
    [storageKey]
  )
  const toggle = useCallback(() => set(!collapsed), [set, collapsed])

  useEffect(() => {
    if (!bulk) return
    const onAll = (e: Event) => set(!!(e as CustomEvent<boolean>).detail)
    window.addEventListener(COLLAPSE_ALL_EVENT, onAll)
    return () => window.removeEventListener(COLLAPSE_ALL_EVENT, onAll)
  }, [bulk, set])

  return [collapsed, toggle]
}
