import { useEffect, useMemo, useRef } from 'react'
import fieldShader from './field.wgsl'
import { FIELD_BYTES, PROVIDER_RGB, flareStrength, layerGlows, packField, rampStrength, trackFlares, type FlareSpec, type FlareTrack } from '@shared/sessionField.mjs'
import { paneForAgent } from '@shared/attention.mjs'
import type { Agent } from '@shared/types'
import type { PaneInstance } from './panes'
import { REDUCED_MOTION } from './gpuField'
import { useFieldActive } from './fieldActive'
import { useGpuLayer, type LayerSpec } from './useGpuLayer'
import { tid } from './testid'

/**
 * The attention layer: a transparent WebGPU canvas over the whole frame
 * (sidebar and grid) that draws only when something happens. When a session
 * flips to waiting, a red burst spreads from the header of the pane that runs
 * it and fades over `FLARE_MS`. Hover a session row in the sidebar and a soft
 * beam in the provider's colour connects the row to its pane. Between those
 * moments the layer is parked: no frames, no cost.
 *
 * Which pane a session runs in is `paneForAgent` — the same answer the pane
 * bell badge and Ctrl+Shift+W use — so a session with no pane (a CLI in an
 * external window) flares nowhere here; the sidebar field carries it.
 */

const FRAME_MS = 33

export function AttentionLayer({ agents, panes }: { agents: Agent[]; panes: PaneInstance[] }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const agentsRef = useRef(agents)
  agentsRef.current = agents
  const panesRef = useRef(panes)
  panesRef.current = panes
  const trackRef = useRef<FlareTrack | null>(null)
  const hoverRef = useRef<{ id: string; since: number } | null>(null)
  const drewRef = useRef(false)
  const active = useFieldActive()

  const spec = useMemo<LayerSpec>(() => ({
    wgsl: fieldShader.wgsl,
    bytes: FIELD_BYTES,
    label: 'attention-layer',
    scale: 0.5,
    frameMs: REDUCED_MOTION ? 250 : FRAME_MS,
    frame: (now, css, canvas, data) => {
      const host = canvas.parentElement
      if (!host) return false
      const origin = canvas.getBoundingClientRect()
      const local = (r: DOMRect) => ({ x: r.left - origin.left, y: r.top - origin.top, w: r.width, h: r.height })
      const head = (agent: Agent) => {
        const pane = paneForAgent(panesRef.current, agent)
        if (!pane) return null
        const el = host.querySelector<HTMLElement>(`[data-pane="${pane.id}"] .gpane-head`)
        const r = el?.getBoundingClientRect()
        return r && r.width > 0 ? local(r) : null
      }
      const byId = new Map(agentsRef.current.map((a) => [a.id, a] as const))

      trackRef.current = trackFlares(trackRef.current, agentsRef.current, now)
      const flares: FlareSpec[] = []
      for (const [id, at] of trackRef.current.flares) {
        const agent = byId.get(id)
        const h = agent && head(agent)
        if (!h) continue
        flares.push({ id, x: h.x + h.w / 2, y: h.y + h.h / 2, w: h.w, strength: flareStrength(now, at) })
      }

      let beam = null
      const hover = hoverRef.current
      const hovered = hover && byId.get(hover.id)
      if (hover && hovered) {
        const row = host.querySelector<HTMLElement>(`.sidebar [data-testid="${tid('agent', hovered.id)}"]`)?.getBoundingClientRect()
        const h = head(hovered)
        if (row && h) {
          beam = {
            from: { x: row.right - origin.left, y: row.top + row.height / 2 - origin.top },
            to: { x: h.x + h.w / 2, y: h.y + h.h / 2, w: h.w },
            color: PROVIDER_RGB[hovered.provider] ?? PROVIDER_RGB.claude,
            strength: REDUCED_MOTION ? 1 : rampStrength(now, hover.since)
          }
        }
      }

      const glows = layerGlows({ flares, beam })
      drewRef.current = glows.length > 0
      if (!drewRef.current) return false
      packField(glows, { time: 0, sx: css.w / canvas.width, sy: css.h / canvas.height }, data)
      return true
    },
    // Nothing on screen: park until a wake (a hover, a new snapshot).
    park: () => !drewRef.current
  }), [])

  const wake = useGpuLayer(canvasRef, spec, active)
  useEffect(() => { wake() }, [agents, panes, wake])

  // Hover is delegated so the rows need no wiring: any agent row in the sidebar.
  useEffect(() => {
    const rowOf = (target: EventTarget | null) => (target as HTMLElement | null)?.closest?.('.sidebar [data-testid^="agent:"]') as HTMLElement | null
    const over = (event: PointerEvent) => {
      const row = rowOf(event.target)
      if (!row) return
      const id = agentsRef.current.find((a) => tid('agent', a.id) === row.dataset.testid)?.id
      if (!id || hoverRef.current?.id === id) return
      hoverRef.current = { id, since: performance.now() }
      wake()
    }
    const out = (event: PointerEvent) => {
      const row = rowOf(event.target)
      if (!row || (event.relatedTarget && row.contains(event.relatedTarget as Node))) return
      hoverRef.current = null
      wake()
    }
    document.addEventListener('pointerover', over)
    document.addEventListener('pointerout', out)
    return () => {
      document.removeEventListener('pointerover', over)
      document.removeEventListener('pointerout', out)
    }
  }, [wake])

  return <canvas ref={canvasRef} className="attn-layer" data-testid="attention-layer" data-state="off" aria-hidden="true" />
}
