/**
 * Parse `git status --porcelain=v1 -b` into what a project header shows:
 * branch, ahead/behind, and how many paths are dirty. Pure and tested; main
 * only runs git.
 */
export function parseGitStatus(output) {
  if (typeof output !== 'string') return null
  const lines = output.split(/\r?\n/).filter((l) => l.length > 0)
  if (lines.length === 0 || !lines[0].startsWith('## ')) return null
  const head = lines[0].slice(3)
  let branch = null
  let ahead = 0
  let behind = 0
  let detached = false
  if (head.startsWith('No commits yet on ')) {
    branch = head.slice('No commits yet on '.length).trim()
  } else if (head.startsWith('HEAD (no branch)')) {
    detached = true
  } else {
    const m = /^([^.\s]+(?:\.[^.\s]+)*?)(?:\.\.\.\S+)?(?:\s+\[([^\]]+)\])?$/.exec(head)
    if (m) {
      branch = m[1]
      const track = m[2] ?? ''
      const a = /ahead (\d+)/.exec(track)
      const b = /behind (\d+)/.exec(track)
      ahead = a ? Number(a[1]) : 0
      behind = b ? Number(b[1]) : 0
    } else {
      branch = head
    }
  }
  const dirty = lines.length - 1
  return { branch, detached, ahead, behind, dirty }
}

/** "main · 3" / "main ↑2" / "detached" — the header chip text. */
export function describeGitStatus(s) {
  if (!s) return ''
  const name = s.detached ? 'detached' : s.branch ?? '?'
  const bits = [name]
  if (s.ahead) bits.push(`↑${s.ahead}`)
  if (s.behind) bits.push(`↓${s.behind}`)
  if (s.dirty) bits.push(`±${s.dirty}`)
  return bits.join(' ')
}
