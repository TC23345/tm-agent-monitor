import { useSyncExternalStore } from 'react'

/**
 * User-set names for sessions, keyed by agent id. A session's own text says
 * what it is *doing*; only a person can say what it is *for*, and that is what
 * you need to pick the right one out of five. Names outlive nothing — a
 * session id is per-run — so this is deliberately a small, self-pruning map in
 * localStorage rather than durable history.
 */
const KEY = 'tm.session-names.v1'
const MAX_NAMES = 200

let names: Record<string, string> = read()
const listeners = new Set<() => void>()

function read(): Record<string, string> {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null')
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {}
    const out: Record<string, string> = {}
    for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof value === 'string' && value.trim()) out[id] = value.trim().slice(0, 60)
    }
    return out
  } catch {
    return {}
  }
}

function write(next: Record<string, string>): void {
  names = next
  try {
    localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    /* private mode / quota — names just reset next launch */
  }
  for (const fn of listeners) fn()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

const snapshot = () => names

/** The whole map; re-renders the caller when any name changes. */
export function useSessionNames(): Record<string, string> {
  return useSyncExternalStore(subscribe, snapshot, snapshot)
}

export function setSessionName(id: string, name: string): void {
  const trimmed = name.trim().slice(0, 60)
  const next = { ...names }
  if (trimmed) next[id] = trimmed
  else delete next[id]
  // Oldest entries go first if a long-running install accumulates dead ids.
  const keys = Object.keys(next)
  if (keys.length > MAX_NAMES) for (const k of keys.slice(0, keys.length - MAX_NAMES)) delete next[k]
  write(next)
}

export const SESSION_NAME_MAX = 60
