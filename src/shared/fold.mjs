// Pure list helper, plain .mjs so node --test can exercise it (see pricing.mjs).

/**
 * Keep the top N rows (assumed pre-sorted), folding the rest into a single
 * "other" entry that sums tokensOut and costUsd.
 */
export function foldTopN(rows, n) {
  if (rows.length <= n) return rows
  const top = rows.slice(0, n)
  const rest = rows.slice(n)
  top.push({
    project: 'other',
    tokensOut: rest.reduce((a, r) => a + r.tokensOut, 0),
    costUsd: rest.reduce((a, r) => a + r.costUsd, 0)
  })
  return top
}
