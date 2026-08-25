/**
 * "While you were away": what changed between the snapshot at hide and the
 * one at summon. Pure and tested; the strip only prints it.
 */

function roots(snap) {
  const list = snap && Array.isArray(snap.agents) ? snap.agents : []
  return list.filter((a) => a && typeof a.id === 'string' && !a.parentId)
}

/** Estimated value across accounts, actual API spend kept out (it is not comparable). */
function estimatedSpend(snap) {
  const accounts = snap && snap.usage && Array.isArray(snap.usage.accounts) ? snap.usage.accounts : []
  let sum = 0
  for (const acc of accounts) {
    if (!acc || acc.actualSpend) continue
    if (typeof acc.todayCostUsd === 'number' && Number.isFinite(acc.todayCostUsd)) sum += acc.todayCostUsd
  }
  return sum
}

/**
 * Diff two snapshots. `awayMs` is how long the workspace was hidden; a digest
 * with nothing to say has `empty: true` so the strip can stay hidden.
 */
export function digestSnapshots(before, after, awayMs = 0) {
  const prev = new Map(roots(before).map((a) => [a.id, a]))
  const next = new Map(roots(after).map((a) => [a.id, a]))
  const brief = (a) => ({ id: a.id, project: a.project, provider: a.provider, question: a.question })
  const finished = []
  const waiting = []
  const started = []
  for (const a of next.values()) {
    const was = prev.get(a.id)
    if (a.state === 'waiting' && (!was || was.state !== 'waiting')) waiting.push(brief(a))
    else if (a.state === 'complete' && was && was.state !== 'complete') finished.push(brief(a))
    if (!was) started.push(brief(a))
  }
  const ended = []
  for (const a of prev.values()) if (!next.has(a.id)) ended.push(brief(a))
  const spendDelta = Math.max(0, estimatedSpend(after) - estimatedSpend(before))
  const empty = finished.length === 0 && waiting.length === 0 && started.length === 0 && ended.length === 0 && spendDelta < 0.005
  return { awayMs: Math.max(0, awayMs), finished, waiting, started, ended, spendDelta, empty }
}

function plural(n, word) {
  return `${n} ${word}${n === 1 ? '' : 's'}`
}

/** "away 42m · 2 finished · 1 waiting · +$3.10" — the strip's one line. */
export function describeDigest(d, money = (usd) => `$${usd.toFixed(2)}`) {
  const mins = Math.round(d.awayMs / 60000)
  const away = mins >= 120 ? `${Math.round(mins / 60)}h` : `${mins}m`
  const parts = [`away ${away}`]
  if (d.waiting.length) parts.push(`${plural(d.waiting.length, 'session')} waiting on you`)
  if (d.finished.length) parts.push(`${d.finished.length} finished`)
  if (d.started.length) parts.push(`${d.started.length} started`)
  if (d.ended.length) parts.push(`${d.ended.length} ended`)
  if (d.spendDelta >= 0.005) parts.push(`+${money(d.spendDelta)} estimated`)
  return parts.join(' · ')
}
