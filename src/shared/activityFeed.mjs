// File edits in the activity feed. A session edits in bursts — one turn can
// touch a dozen files — so edits fold into one `edited` row per session until
// that session does something else worth a row (finishes, asks, compacts).
// Pure and tested; the store owns the ring and calls in.

/** File names one `edited` row remembers (newest first). */
export const MAX_EDIT_FILES = 12
/** How far back the fold looks for the session's open `edited` row. */
const LOOKBACK = 80

/** The file an edit touched, from the bridge's `editing <name>` activity. */
export function editedFile(activity) {
  if (typeof activity !== 'string') return undefined
  const m = /^editing (.+)$/.exec(activity.trim())
  const name = m?.[1]?.trim()
  return name && name.length <= 200 ? name : undefined
}

/** One line for the row: the files by name, newest first. */
export function editedText(files, count) {
  if (!files.length) return count > 1 ? `made ${count} edits` : 'made an edit'
  const shown = files.slice(0, 2).join(', ')
  const more = files.length - 2
  return more > 0 ? `edited ${shown} +${more} more` : `edited ${shown}`
}

/**
 * Fold one edit into the ring (mutates `events`, oldest first, and returns it).
 * The session's latest row is extended and moved to the end when it is
 * already an `edited` row; otherwise a new row starts.
 */
export function foldEdit(events, edit) {
  const file = editedFile(edit.activity)
  for (let i = events.length - 1, seen = 0; i >= 0 && seen < LOOKBACK; i--, seen++) {
    const e = events[i]
    if (e.agentId !== edit.agentId) continue
    if (e.kind !== 'edited') break
    const files = file ? [file, ...(e.files ?? []).filter((f) => f !== file)].slice(0, MAX_EDIT_FILES) : (e.files ?? [])
    const count = (e.count ?? 1) + 1
    events.splice(i, 1)
    events.push({ ...e, at: Math.max(e.at, edit.at), files, count, text: editedText(files, count), cwd: edit.cwd ?? e.cwd })
    return events
  }
  const files = file ? [file] : []
  events.push({
    at: edit.at,
    kind: 'edited',
    agentId: edit.agentId,
    provider: edit.provider,
    project: edit.project,
    ...(edit.cwd ? { cwd: edit.cwd } : {}),
    files,
    count: 1,
    text: editedText(files, 1)
  })
  return events
}
