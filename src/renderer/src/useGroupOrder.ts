import { useCallback, useState } from 'react'
import type { ProjectGroup } from './group'

const STORAGE_KEY = 'cw.groupOrder'

function readOrder(): string[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]')
    return Array.isArray(parsed) ? parsed.filter((k): k is string => typeof k === 'string') : []
  } catch {
    return []
  }
}

/**
 * Manual project ordering persisted in localStorage. Empty until the user drags
 * a group for the first time; `clear` returns to the automatic attention sort.
 */
export function useGroupOrder(): { order: string[]; save: (keys: string[]) => void; clear: () => void } {
  const [order, setOrder] = useState<string[]>(readOrder)
  const save = useCallback((keys: string[]) => {
    setOrder(keys)
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(keys))
    } catch {
      /* private mode / quota — non-fatal */
    }
  }, [])
  const clear = useCallback(() => save([]), [save])
  return { order, save, clear }
}

/**
 * Apply a saved manual order to the auto-sorted groups. Groups the user has
 * never positioned keep their attention-sorted relative order after the
 * positioned ones, so new projects appear at the bottom instead of jumping in.
 */
export function applyOrder(groups: ProjectGroup[], order: string[]): ProjectGroup[] {
  if (order.length === 0) return groups
  const rank = new Map(order.map((k, i) => [k, i]))
  return [...groups].sort((x, y) => {
    const xr = rank.get(x.key) ?? order.length
    const yr = rank.get(y.key) ?? order.length
    return xr - yr
  })
}
