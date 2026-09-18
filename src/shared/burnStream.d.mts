import type { Quota } from './types'

export const STREAM_FLOATS: number
export const STREAM_BYTES: number
export const MAX_STREAKS: number
export const STREAM_RGB: Readonly<Record<'amber' | 'blue' | 'green' | 'critical', readonly [number, number, number]>>

export interface StreamParams { rate: number; count: number; speed: number; fill: number }
export interface StreamHead { time: number; w: number; h: number; sx: number; sy: number; color: readonly number[] }

export function burnRate(usedPct: number, projectedLimitAt: number | undefined, now: number): number
export function streamParams(usedPct: number, projectedLimitAt: number | undefined, now: number): StreamParams | null
export function streamColor(tone: Quota['tone'], severity: Quota['severity']): readonly [number, number, number]
export function packStream(params: StreamParams | null, head: StreamHead, out?: Float32Array): Float32Array
