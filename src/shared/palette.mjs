/**
 * Command-palette matching, kept pure so the ranking that decides what the
 * first Enter runs is testable without a DOM.
 *
 * Query prefixes narrow the list the way VS Code's do: `>` commands only,
 * `@` agents only, `#` open windows only. Anything else searches everything.
 */

/** Section a prefix narrows to, or null for everything. */
export function parseQuery(raw) {
  const text = typeof raw === 'string' ? raw : ''
  const first = text[0]
  const mode = first === '>' ? 'command' : first === '@' ? 'agent' : first === '#' ? 'window' : null
  return { mode, text: (mode ? text.slice(1) : text).trim() }
}

/**
 * Subsequence match of `query` in `text`, scored so that word starts and
 * consecutive runs win over scattered letters. Returns null when the query
 * does not fit; an empty query matches everything with score 0.
 */
export function fuzzyScore(query, text) {
  if (typeof text !== 'string') return null
  const q = typeof query === 'string' ? query.toLowerCase() : ''
  if (q.length === 0) return 0
  const t = text.toLowerCase()
  // Whole-substring hits beat any subsequence, earlier and at word starts more so.
  const at = t.indexOf(q)
  if (at >= 0) {
    const wordStart = at === 0 || /[\s/\\:.\-_·—]/.test(t[at - 1])
    return 1000 + (wordStart ? 200 : 0) - Math.min(at, 100) - Math.min(t.length - q.length, 100) / 10
  }
  let score = 0
  let ti = 0
  let prev = -2
  for (let qi = 0; qi < q.length; qi++) {
    const found = t.indexOf(q[qi], ti)
    if (found < 0) return null
    const wordStart = found === 0 || /[\s/\\:.\-_·—]/.test(t[found - 1])
    score += 10 + (wordStart ? 15 : 0) + (found === prev + 1 ? 12 : 0) - Math.min(found - ti, 20)
    prev = found
    ti = found + 1
  }
  return Math.max(1, score)
}

/**
 * Filter and rank `items` — `{ section, label, detail?, keywords? }` — for a raw
 * query. Ties keep the caller's order, so a curated command list stays stable
 * while empty. Only `section` values 'command' | 'agent' | 'window' are
 * narrowed by a prefix.
 */
export function rankItems(items, raw, limit = 40) {
  const { mode, text } = parseQuery(raw)
  const list = Array.isArray(items) ? items : []
  const scored = []
  for (let i = 0; i < list.length; i++) {
    const item = list[i]
    if (!item || typeof item.label !== 'string') continue
    if (mode && item.section !== mode) continue
    const hay = [item.label, item.detail, ...(Array.isArray(item.keywords) ? item.keywords : [])].filter((s) => typeof s === 'string')
    let best = null
    for (const field of hay) {
      const s = fuzzyScore(text, field)
      if (s !== null && (best === null || s > best)) best = s
    }
    // Only the label carries full weight; a hit in detail or keywords ranks below.
    if (best === null) continue
    const labelScore = fuzzyScore(text, item.label)
    scored.push({ item, score: labelScore !== null ? labelScore : best - 500, index: i })
  }
  scored.sort((a, b) => (b.score - a.score) || (a.index - b.index))
  return scored.slice(0, Math.max(0, limit | 0)).map((s) => s.item)
}
