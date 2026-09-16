import type { Agent, AgentState } from './types'

export const MAX_GLOWS: number
export const FLOATS_PER_GLOW: number
export const HEADER_FLOATS: number
export const FIELD_FLOATS: number
export const FIELD_BYTES: number
export const FLARE_MS: number
export const PROVIDER_RGB: Readonly<Record<'claude' | 'codex' | 'cursor', readonly [number, number, number]>>
export const ATTENTION_RGB: readonly [number, number, number]

export type RGB = readonly [number, number, number] | readonly number[]
export interface GlowStyle { color: RGB; intensity: number; motion: number; pulse: number }
export interface Rect { x: number; y: number; w: number; h: number }
export interface Glow extends GlowStyle {
  id: string
  x: number
  y: number
  rx: number
  ry: number
  flare: number
  seed: number
}
export interface FlareTrack { states: Map<string, AgentState>; flares: Map<string, number> }
export interface FieldHead { time: number; sx: number; sy: number }

export function seedFor(id: string): number
export function glowFor(agent: Pick<Agent, 'provider' | 'state'>): GlowStyle
export function flareStrength(now: number, flareAt: number | undefined, duration?: number): number
export function trackFlares(prev: FlareTrack | null | undefined, agents: readonly Pick<Agent, 'id' | 'state'>[], now: number): FlareTrack
export function fieldGlows(
  agents: readonly Pick<Agent, 'id' | 'provider' | 'state'>[],
  rects: Map<string, Rect>,
  flares: Map<string, number> | undefined,
  now: number
): Glow[]
export function packField(glows: readonly Glow[], head: FieldHead, out?: Float32Array): Float32Array
