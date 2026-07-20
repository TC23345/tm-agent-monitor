import type { HookReport } from '../shared/types.js'
import type { StoreEventV1 } from './store.js'

export function validateLegacyReport(value: unknown, now?: number): HookReport | null
export function validateAgentEventV1(value: unknown, now?: number): StoreEventV1 | null
