import { useCallback, useState } from 'react'

/** Boolean collapse state persisted in localStorage, keyed per group/panel. */
export function useCollapse(key: string, defaultCollapsed = false): [boolean, () => void] {
  const storageKey = `cw.collapse.${key}`
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try {
      const v = localStorage.getItem(storageKey)
      return v === null ? defaultCollapsed : v === '1'
    } catch {
      return defaultCollapsed
    }
  })
  const toggle = useCallback(() => {
    setCollapsed((c) => {
      const next = !c
      try {
        localStorage.setItem(storageKey, next ? '1' : '0')
      } catch {
        /* private mode / quota — non-fatal */
      }
      return next
    })
  }, [storageKey])
  return [collapsed, toggle]
}
