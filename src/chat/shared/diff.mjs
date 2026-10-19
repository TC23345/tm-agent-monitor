// Line diffs for the edit rows. Claude's Edit / MultiEdit carry the replaced
// and the replacing text (`old_string`, `new_string`); Codex's fileChange
// carries a unified diff per file. Both become one list of lines, which the
// pane lays out inline or side by side (the Claude Code extension switches at
// 900 px — docs/rea-findings.md, webview pass). Pure and tested.

/**
 * One line of a diff. `type` is unchanged (`eq`), removed (`del`) or added
 * (`add`); a `hunk` line is a unified diff's `@@` header, kept as a separator.
 * @typedef {{ type: 'eq' | 'del' | 'add' | 'hunk', text: string }} DiffLine
 */

/**
 * A side-by-side row: the old line on the left, the new on the right; a
 * removed run sits beside the added run that replaced it. `hunk` rows span
 * both sides.
 * @typedef {{ left: DiffLine | null, right: DiffLine | null, hunk?: string }} DiffRow
 */

/** Past this many LCS cells (old lines × new lines, after the shared head and tail are cut) a diff is "everything removed, everything added". */
export const MAX_DIFF_CELLS = 4_000_000

/** A text's lines; one trailing newline does not make an empty last line. */
export function splitLines(text) {
  if (typeof text !== 'string' || text === '') return []
  const body = text.endsWith('\r\n') ? text.slice(0, -2) : text.endsWith('\n') ? text.slice(0, -1) : text
  return body.split(/\r?\n/)
}

/**
 * The line diff of two texts: the shared head and tail, and a longest common
 * subsequence between them.
 * @param {string} before
 * @param {string} after
 * @returns {DiffLine[]}
 */
export function lineDiff(before, after, maxCells = MAX_DIFF_CELLS) {
  const a = splitLines(before)
  const b = splitLines(after)
  let head = 0
  while (head < a.length && head < b.length && a[head] === b[head]) head++
  let tail = 0
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++
  const out = a.slice(0, head).map((text) => ({ type: 'eq', text }))
  const midA = a.slice(head, a.length - tail)
  const midB = b.slice(head, b.length - tail)
  out.push(...middle(midA, midB, maxCells))
  out.push(...a.slice(a.length - tail).map((text) => ({ type: 'eq', text })))
  return out
}

function middle(a, b, maxCells) {
  const n = a.length
  const m = b.length
  if (n === 0) return b.map((text) => ({ type: 'add', text }))
  if (m === 0) return a.map((text) => ({ type: 'del', text }))
  if (n * m > maxCells) return [...a.map((text) => ({ type: 'del', text })), ...b.map((text) => ({ type: 'add', text }))]
  // lcs[i][j] = LCS length of a[i..] and b[j..], one flat row-major array.
  const w = m + 1
  const lcs = new Uint32Array((n + 1) * w)
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i * w + j] = a[i] === b[j] ? lcs[(i + 1) * w + j + 1] + 1 : Math.max(lcs[(i + 1) * w + j], lcs[i * w + j + 1])
    }
  }
  const out = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ type: 'eq', text: a[i] })
      i++
      j++
    } else if (lcs[(i + 1) * w + j] >= lcs[i * w + j + 1]) {
      out.push({ type: 'del', text: a[i++] })
    } else {
      out.push({ type: 'add', text: b[j++] })
    }
  }
  while (i < n) out.push({ type: 'del', text: a[i++] })
  while (j < m) out.push({ type: 'add', text: b[j++] })
  return out
}

/** Whether a text is a unified diff (a hunk header, or file headers), not a file's content. */
export function looksLikeUnifiedDiff(text) {
  return typeof text === 'string' && /^(@@ |--- |\+\+\+ |diff --git )/m.test(text)
}

/**
 * A unified diff → lines. File headers (`---`, `+++`, `diff --git`, `index`)
 * are dropped; `\ No newline at end of file` too.
 * @returns {DiffLine[]}
 */
export function parseUnifiedDiff(diff) {
  const out = []
  for (const line of splitLines(diff)) {
    if (/^(diff --git |index |--- |\+\+\+ |\\ No newline)/.test(line)) continue
    if (line.startsWith('@@')) out.push({ type: 'hunk', text: line })
    else if (line.startsWith('+')) out.push({ type: 'add', text: line.slice(1) })
    else if (line.startsWith('-')) out.push({ type: 'del', text: line.slice(1) })
    else out.push({ type: 'eq', text: line.startsWith(' ') ? line.slice(1) : line })
  }
  return out
}

/**
 * The lines of one file change: a before/after pair, a unified diff, or the
 * whole content of an added (or deleted) file.
 * @param {{ before?: string, after?: string, diff?: string, kind?: 'add' | 'delete' | 'update' }} change
 * @returns {DiffLine[]}
 */
export function changeLines(change) {
  if (typeof change.diff === 'string') {
    if (looksLikeUnifiedDiff(change.diff)) return parseUnifiedDiff(change.diff)
    const type = change.kind === 'delete' ? 'del' : 'add'
    return splitLines(change.diff).map((text) => ({ type, text }))
  }
  return lineDiff(change.before ?? '', change.after ?? '')
}

/**
 * Lines → side-by-side rows. Unchanged lines face each other; a run of
 * removed lines is paired, line for line, with the run of added lines that
 * follows it; what is left of either run faces an empty cell.
 * @param {DiffLine[]} lines
 * @returns {DiffRow[]}
 */
export function splitRows(lines) {
  const rows = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (line.type === 'hunk') {
      rows.push({ left: null, right: null, hunk: line.text })
      i++
    } else if (line.type === 'eq') {
      rows.push({ left: line, right: line })
      i++
    } else {
      const dels = []
      const adds = []
      while (i < lines.length && lines[i].type === 'del') dels.push(lines[i++])
      while (i < lines.length && lines[i].type === 'add') adds.push(lines[i++])
      for (let k = 0; k < Math.max(dels.length, adds.length); k++) rows.push({ left: dels[k] ?? null, right: adds[k] ?? null })
    }
  }
  return rows
}

/** How many lines a diff adds and removes. @param {DiffLine[]} lines */
export function countChanges(lines) {
  let added = 0
  let removed = 0
  for (const l of lines) {
    if (l.type === 'add') added++
    else if (l.type === 'del') removed++
  }
  return { added, removed }
}

/**
 * What changed inside a removed line and the added line that replaced it,
 * word by word, so the diff can mark the changed words rather than the whole
 * line (the extension's Monaco diff marks characters). Words, runs of spaces
 * and single punctuation marks are the tokens. Past `maxCells` token pairs,
 * or when the lines share less than a fifth of their tokens, both lines are
 * one changed segment: a rewrite reads better whole.
 * @typedef {{ text: string, changed: boolean }} WordSegment
 * @param {string} before
 * @param {string} after
 * @returns {{ left: WordSegment[], right: WordSegment[] }}
 */
export function wordDiff(before, after, maxCells = 40_000) {
  const a = tokens(before)
  const b = tokens(after)
  const whole = { left: before ? [{ text: before, changed: true }] : [], right: after ? [{ text: after, changed: true }] : [] }
  if (!a.length || !b.length || a.length * b.length > maxCells) return whole
  const w = b.length + 1
  const lcs = new Uint16Array((a.length + 1) * w)
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) lcs[i * w + j] = a[i] === b[j] ? lcs[(i + 1) * w + j + 1] + 1 : Math.max(lcs[(i + 1) * w + j], lcs[i * w + j + 1])
  }
  const left = []
  const right = []
  const push = (list, text, changed) => {
    const last = list[list.length - 1]
    if (last && last.changed === changed) last.text += text
    else list.push({ text, changed })
  }
  let i = 0
  let j = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      push(left, a[i++], false)
      push(right, b[j++], false)
    } else if (lcs[(i + 1) * w + j] >= lcs[i * w + j + 1]) push(left, a[i++], true)
    else push(right, b[j++], true)
  }
  while (i < a.length) push(left, a[i++], true)
  while (j < b.length) push(right, b[j++], true)
  // Shared spaces alone do not make two lines alike: measure the shared words.
  const words = (list) => list.filter((s) => !s.changed).reduce((n, s) => n + (s.text.match(/[^\s]+/g)?.length ?? 0), 0)
  const all = (text) => text.match(/\w+|[^\w\s]/g)?.length ?? 0
  if (words(left) * 5 < Math.max(all(before), all(after))) return whole
  return { left, right }
}

function tokens(text) {
  return typeof text === 'string' && text ? text.match(/\w+|\s+|[^\w\s]/g) ?? [] : []
}

/** The edit row's summary line, in the extension's words ("Added 2 lines, removed 1 line", "Modified"). */
export function changeSummary({ added, removed }) {
  const lines = (n) => `${n} line${n === 1 ? '' : 's'}`
  if (added && removed) return `Added ${lines(added)}, removed ${lines(removed)}`
  if (added) return `Added ${lines(added)}`
  if (removed) return `Removed ${lines(removed)}`
  return 'Modified'
}

/** A path relative to a folder with forward slashes, case-insensitively on the prefix (what `git apply` reads); a path outside it is returned as is. */
export function relTo(path, cwd) {
  const norm = (x) => String(x ?? '').replace(/\\/g, '/')
  const p = norm(path)
  const root = norm(cwd).replace(/\/+$/, '')
  return root && p.toLowerCase().startsWith(`${root.toLowerCase()}/`) ? p.slice(root.length + 1) : p
}

/**
 * One file's change as a git patch, for a Codex turn's Undo when the server's
 * aggregated turn diff is not at hand: an update's hunks under file headers,
 * an add or a delete as one whole-file hunk. A diff that already carries
 * headers passes through; anything else is null.
 */
export function filePatch(rel, kind, diff) {
  if (!rel) return null
  const text = String(diff ?? '')
  if (kind === 'add' || kind === 'delete') {
    const lines = text.replace(/\n$/, '').split('\n')
    const mark = kind === 'add' ? '+' : '-'
    const hunk = `@@ ${kind === 'add' ? `-0,0 +1,${lines.length}` : `-1,${lines.length} +0,0`} @@\n${lines.map((l) => mark + l).join('\n')}\n`
    return kind === 'add'
      ? `diff --git a/${rel} b/${rel}\nnew file mode 100644\n--- /dev/null\n+++ b/${rel}\n${hunk}`
      : `diff --git a/${rel} b/${rel}\ndeleted file mode 100644\n--- a/${rel}\n+++ /dev/null\n${hunk}`
  }
  const body = text.endsWith('\n') ? text : `${text}\n`
  if (/^(diff --git|--- )/m.test(body)) return body
  if (!/^@@ /m.test(body)) return null
  return `diff --git a/${rel} b/${rel}\n--- a/${rel}\n+++ b/${rel}\n${body}`
}
