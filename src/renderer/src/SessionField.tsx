import { useEffect, useMemo, useRef } from 'react'
import fieldShader from './field.wgsl'
import { FIELD_BYTES, fieldGlows, packField, trackFlares, type FlareTrack, type Rect } from '@shared/sessionField.mjs'
import type { Agent } from '@shared/types'
import { REDUCED_MOTION } from './gpuField'
import { useFieldActive } from './fieldActive'
import { useGpuLayer, type LayerSpec } from './useGpuLayer'
import { tid } from './testid'

/**
 * The session field: a WebGPU canvas under the sidebar that washes its
 * background with one broad, faint light per session — provider colour,
 * drifting and breathing while it runs, still and dimmer when idle, red and
 * pulsing when it waits on a person, with a burst on the edge into waiting.
 * Anchored loosely at the session's row when that row is on screen, spread
 * evenly otherwise. The same signal as the tray badge, as atmosphere rather
 * than outline, while the workspace is up.
 *
 * What is drawn is decided in `@shared/sessionField.mjs` (pure, tested); this
 * component only measures the rows and fills the uniform. The loop, the
 * parking, and every failure mode live in `useGpuLayer`.
 */

/** ~15 fps: soft glows need no more, and this runs for as long as the workspace is up. */
const FRAME_MS = 66

export function SessionField({ agents }: { agents: Agent[] }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const agentsRef = useRef(agents)
  agentsRef.current = agents
  const trackRef = useRef<FlareTrack | null>(null)
  const active = useFieldActive()

  const spec = useMemo<LayerSpec>(() => ({
    wgsl: fieldShader.wgsl,
    bytes: FIELD_BYTES,
    label: 'session-field',
    // The glows are blur, so half resolution is free.
    scale: 0.5,
    frameMs: REDUCED_MOTION ? 250 : FRAME_MS,
    frame: (now, css, canvas, data) => {
      trackRef.current = trackFlares(trackRef.current, agentsRef.current, now)
      const glows = fieldGlows(agentsRef.current, measure(canvas, agentsRef.current), trackRef.current.flares, now, css)
      if (glows.length === 0) return false
      packField(glows, { time: REDUCED_MOTION ? 0 : (now % 1_000_000) / 1000, sx: css.w / canvas.width, sy: css.h / canvas.height }, data)
      return true
    },
    // No sessions at all: park until the list changes.
    park: () => agentsRef.current.length === 0
  }), [])

  const wake = useGpuLayer(canvasRef, spec, active)
  useEffect(() => { wake() }, [agents, wake])

  return <canvas ref={canvasRef} className="field" data-testid="session-field" data-state="off" aria-hidden="true" />
}

// Row boxes in canvas pixels, for the rows inside the agent list's scroll
// viewport — a row scrolled under the launch nav anchors nothing.
function measure(canvas: HTMLCanvasElement, agents: Agent[]): Map<string, Rect> {
  const rects = new Map<string, Rect>()
  const host = canvas.parentElement
  const body = host?.querySelector('.sideview--fill .sideview-body')?.getBoundingClientRect()
  if (!host || !body) return rects
  const origin = canvas.getBoundingClientRect()
  const byTid = new Map<string, DOMRect>()
  host.querySelectorAll<HTMLElement>('[data-testid^="agent:"]').forEach((el) => byTid.set(el.dataset.testid ?? '', el.getBoundingClientRect()))
  for (const a of agents) {
    const r = byTid.get(tid('agent', a.id))
    if (!r) continue
    const cy = r.top + r.height / 2
    if (cy < body.top || cy > body.bottom) continue
    rects.set(a.id, { x: r.left - origin.left, y: r.top - origin.top, w: r.width, h: r.height })
  }
  return rects
}
