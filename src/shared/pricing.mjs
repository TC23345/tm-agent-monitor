// Provider-specific API-equivalent prices in USD per million tokens.
// Unknown models intentionally return no estimate; a token count from one
// provider must never inherit another provider's fallback rate.

export const MODEL_PRICING = {
  claude: {
    fable:  { input: 10, output: 50, cacheRead: 1.0, cacheWrite: 12.5 },
    mythos: { input: 10, output: 50, cacheRead: 1.0, cacheWrite: 12.5 },
    opus:   { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
    sonnet: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
    haiku:  { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 }
  },
  codex: {
    sol:   { input: 5, output: 30, cacheRead: 0.5, cacheWrite: 5 },
    terra: { input: 2.5, output: 15, cacheRead: 0.25, cacheWrite: 2.5 },
    luna:  { input: 1, output: 6, cacheRead: 0.1, cacheWrite: 1 }
  }
}

function inferredProvider(model, provider) {
  if (provider) return provider
  const m = String(model ?? '').toLowerCase()
  if (m.includes('claude')) return 'claude'
  if (m.includes('gpt') || m.includes('codex')) return 'codex'
  return undefined
}

export function pricingFor(model, provider) {
  const p = inferredProvider(model, provider)
  if (!p || !MODEL_PRICING[p] || !model) return undefined
  const m = String(model).toLowerCase()
  for (const [family, pricing] of Object.entries(MODEL_PRICING[p])) {
    if (m.includes(family)) return pricing
  }
  return undefined
}

export function estimateCostUsd(u, model, provider) {
  const p = pricingFor(model, provider)
  if (!p) return undefined
  return (
    ((u.input ?? 0) * p.input +
      (u.output ?? 0) * p.output +
      (u.cacheRead ?? 0) * p.cacheRead +
      (u.cacheWrite ?? 0) * p.cacheWrite) /
    1_000_000
  )
}
