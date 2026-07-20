import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pricingFor, estimateCostUsd, MODEL_PRICING } from './pricing.mjs'

test('matches provider-specific model families', () => {
  assert.equal(pricingFor('claude-opus-4-8'), MODEL_PRICING.claude.opus)
  assert.equal(pricingFor('gpt-5.6-sol'), MODEL_PRICING.codex.sol)
  assert.equal(pricingFor('GPT-5.6-TERRA'), MODEL_PRICING.codex.terra)
  assert.equal(pricingFor('gpt-5.6-luna'), MODEL_PRICING.codex.luna)
})

test('unknown models remain unpriced', () => {
  assert.equal(pricingFor('<synthetic>', 'claude'), undefined)
  assert.equal(pricingFor('gpt-9', 'codex'), undefined)
  assert.equal(pricingFor(undefined), undefined)
  assert.equal(estimateCostUsd({ output: 10 }, 'unknown', 'claude'), undefined)
})

test('estimates cached input with Codex Sol rates', () => {
  const usd = estimateCostUsd({ input: 1_000_000, output: 1_000_000, cacheRead: 1_000_000 }, 'gpt-5.6-sol')
  assert.ok(Math.abs(usd - 35.5) < 1e-9)
})

test('estimates Claude cache writes independently', () => {
  const usd = estimateCostUsd({ input: 1_000_000, output: 1_000_000, cacheRead: 1_000_000, cacheWrite: 1_000_000 }, 'claude-opus-4-8')
  assert.ok(Math.abs(usd - 36.75) < 1e-9)
})
