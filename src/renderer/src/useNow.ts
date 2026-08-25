import { useSyncExternalStore } from 'react'

/**
 * A shared one-second clock for the few components that show durations and
 * countdowns. Subscribing here instead of ticking `App` keeps the title bar,
 * the pane grid, and every xterm host out of the per-second render — only the
 * rows and bars that print a time re-render. One interval runs while anyone is
 * subscribed; none when the workspace shows nothing time-based.
 */
let now = Date.now()
const listeners = new Set<() => void>()
let timer: number | null = null

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  if (timer === null) {
    timer = window.setInterval(() => {
      now = Date.now()
      for (const fn of listeners) fn()
    }, 1000)
  }
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0 && timer !== null) {
      window.clearInterval(timer)
      timer = null
    }
  }
}

const read = () => now

export function useNow(): number {
  return useSyncExternalStore(subscribe, read, read)
}
