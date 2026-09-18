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
export function flareStrength(now: number, flareAt: number | undefined, duration?: number): number
export function trackFlares(prev: FlareTrack | null | undefined, agents: readonly Pick<Agent, 'id' | 'state'>[], now: number): FlareTrack
export function packField(glows: readonly Glow[], head: FieldHead, out?: Float32Array): Float32Array

export interface Point { x: number; y: number; w?: number }
export interface FlareSpec { id: string; x: number; y: number; w?: number; strength: number }
export interface BeamSpec { from: Point; to: Point; color: RGB; strength?: number; points?: number; radius?: number }
export function rampStrength(now: number, since: number | undefined, ms?: number): number
export function flareGlow(spec: FlareSpec): Glow | null
export function beamGlows(spec: BeamSpec): Glow[]
export function layerGlows(spec?: { flares?: readonly FlareSpec[]; beam?: BeamSpec | null }): Glow[]
