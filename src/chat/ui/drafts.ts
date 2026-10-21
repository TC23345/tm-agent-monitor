// The composer's unsent drafts (shared/drafts.mjs) in localStorage, one per pane. Reads and writes never throw:
// a private window or a full store just means the draft is not kept, and a full store keeps the text and cards
// without the images.
import { DRAFTS_KEY, parseDrafts, withDraft, withoutImages, type Draft } from '../shared/drafts.mjs'

export function readDraft(key: string | undefined): Draft | null {
  if (!key) return null
  try {
    return parseDrafts(localStorage.getItem(DRAFTS_KEY))[key] ?? null
  } catch {
    return null
  }
}

export function writeDraft(key: string | undefined, draft: Omit<Draft, 'at'> | null): void {
  if (!key) return
  try {
    const next = withDraft(parseDrafts(localStorage.getItem(DRAFTS_KEY)), key, draft)
    try {
      localStorage.setItem(DRAFTS_KEY, JSON.stringify(next))
    } catch {
      localStorage.setItem(DRAFTS_KEY, JSON.stringify(withoutImages(next)))
    }
  } catch {
    // Storage refused: the draft lives only as long as the pane.
  }
}
