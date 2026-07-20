import type { ProviderId } from './types.js'
export interface ModelPricing { input: number; output: number; cacheRead: number; cacheWrite: number }
export interface UsageTokens { input?: number; output?: number; cacheRead?: number; cacheWrite?: number }
export const MODEL_PRICING: Record<ProviderId, Record<string, ModelPricing>>
export function pricingFor(model?: string, provider?: ProviderId): ModelPricing | undefined
export function estimateCostUsd(u: UsageTokens, model?: string, provider?: ProviderId): number | undefined
