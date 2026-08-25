/**
 * Parsing for the renderer's persisted layout state — panes, sidebar views,
 * collapse state, column choice, and dragged sizes — kept pure so the
 * migration rules (unknown ids are dropped, unique kinds are deduped, a
 * pre-bucket size set seeds both buckets) are tested rather than trusted.
 * `panes.ts` only reads/writes localStorage and hands the JSON here.
 */

function isRecord(v) {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** `raw` is the parsed `tm.panes.v2` value; `kinds` the catalog ids. */
export function sanitizePanes(raw, { kinds, isUnique, maxPanes, launches = ['shell', 'claude', 'codex'] }) {
  if (!Array.isArray(raw)) return []
  const known = new Set(kinds)
  const out = []
  const seen = new Set()
  for (const item of raw) {
    if (!isRecord(item)) continue
    const { id, kind, term } = item
    if (typeof id !== 'string' || !known.has(kind)) continue
    if (isUnique(kind)) {
      if (seen.has(kind)) continue
      seen.add(kind)
    }
    if (kind === 'terminal') {
      const t = isRecord(term) ? term : {}
      out.push({
        id,
        kind,
        term: {
          launch: launches.includes(t.launch) ? t.launch : 'shell',
          cwd: typeof t.cwd === 'string' ? t.cwd : undefined,
          label: typeof t.label === 'string' ? t.label : undefined,
          sessionId: typeof t.sessionId === 'string' ? t.sessionId : undefined,
          initialCommand: typeof t.initialCommand === 'string' ? t.initialCommand : undefined
        }
      })
    } else {
      out.push({ id, kind })
    }
    if (out.length === maxPanes) break
  }
  return out
}

/**
 * Sidebar views from the v2 value, else a one-time v1 migration (keep the
 * user's toggles, surface Open windows once), else the defaults. Ids not in
 * the catalog fall out — that is how a retired view disappears without a
 * migration key.
 */
export function sanitizeSidebarViews(raw, legacyRaw, { ids, defaults }) {
  const known = new Set(ids)
  if (Array.isArray(raw)) return [...new Set(raw.filter((v) => known.has(v)))]
  if (Array.isArray(legacyRaw)) {
    const views = [...new Set(legacyRaw.filter((v) => known.has(v)))]
    if (known.has('windows') && !views.includes('windows')) views.push('windows')
    return views
  }
  return [...defaults]
}

export function sanitizeCollapsed(raw, { ids, defaults }) {
  const known = new Set(ids)
  if (!Array.isArray(raw)) return [...defaults]
  return [...new Set(raw.filter((v) => known.has(v)))]
}

/**
 * v2 → v3: the agent list left the sidebar for its own pane, so a layout
 * saved before that has nowhere to show sessions. Put an Agents pane first
 * (space permitting) and keep everything else in order.
 */
export function migratePanesV3(rawV2, { newId, maxPanes, ...options }) {
  const panes = sanitizePanes(rawV2, { maxPanes, ...options })
  if (panes.some((p) => p.kind === 'agents')) return panes
  return [{ id: newId, kind: 'agents' }, ...panes].slice(0, maxPanes)
}

export function readPaneCols(raw) {
  const cols = isRecord(raw) ? raw.cols : undefined
  return cols === 1 || cols === 2 || cols === 3 || cols === 'auto' ? cols : 'auto'
}

function readFractions(raw) {
  if (!isRecord(raw)) return {}
  const out = {}
  for (const [count, list] of Object.entries(raw)) {
    if (!/^[1-9]\d*$/.test(count) || !Array.isArray(list)) continue
    if (list.length > 0 && list.every((n) => typeof n === 'number' && Number.isFinite(n) && n > 0)) out[count] = list
  }
  return out
}

function readWidth(raw) {
  return typeof raw === 'number' && Number.isFinite(raw) && raw > 0 ? raw : null
}

export function emptySizes() {
  return { sidebar: null, cols: {}, rows: {} }
}

function readSizes(raw) {
  if (!isRecord(raw)) return emptySizes()
  return { sidebar: readWidth(raw.sidebar), cols: readFractions(raw.cols), rows: readFractions(raw.rows) }
}

/**
 * Per-bucket sizes from `tm.layout.v1`. A pre-bucket layout held one set at
 * the top level (`sidebar`, `fracs`); the user sized whichever view they were
 * in, so both buckets are seeded from it rather than discarding the drag.
 */
export function readAllSizes(raw) {
  const layout = isRecord(raw) ? raw : {}
  if (isRecord(layout.sizes)) {
    return { full: readSizes(layout.sizes.full), half: readSizes(layout.sizes.half) }
  }
  const legacy = { sidebar: readWidth(layout.sidebar), cols: readFractions(layout.fracs), rows: {} }
  return { full: legacy, half: { ...legacy, cols: { ...legacy.cols } } }
}
