// The user's names and defaults for the composer's menus (shared/chatPrefs.mjs), in localStorage: every chat
// pane in the window reads the same copy, and a change in one re-renders the others (a window event; the
// `storage` event covers another window).
import { useEffect, useState } from 'react'
import { CHAT_PREFS_KEY, emptyPrefs, parsePrefs, type ChatPrefs } from '../shared/chatPrefs.mjs'

const CHANGED = 'tm-chat-prefs'

export function readPrefs(): ChatPrefs {
  try {
    return parsePrefs(localStorage.getItem(CHAT_PREFS_KEY))
  } catch {
    return emptyPrefs()
  }
}

export function savePrefs(prefs: ChatPrefs): void {
  try {
    localStorage.setItem(CHAT_PREFS_KEY, JSON.stringify(prefs))
  } catch {
    // Storage refused (a private window): the change lasts until the pane re-reads.
  }
  window.dispatchEvent(new CustomEvent(CHANGED, { detail: prefs }))
}

export function useChatPrefs(): ChatPrefs {
  const [prefs, setPrefs] = useState(readPrefs)
  useEffect(() => {
    const local = (e: Event) => setPrefs((e as CustomEvent<ChatPrefs>).detail ?? readPrefs())
    const other = (e: StorageEvent) => { if (e.key === CHAT_PREFS_KEY) setPrefs(readPrefs()) }
    window.addEventListener(CHANGED, local)
    window.addEventListener('storage', other)
    return () => {
      window.removeEventListener(CHANGED, local)
      window.removeEventListener('storage', other)
    }
  }, [])
  return prefs
}
