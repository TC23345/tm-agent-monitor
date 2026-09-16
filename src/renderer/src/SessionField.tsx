import { useEffect, useRef } from 'react'
import { Device, bind, createBindGroup, createBindGroupLayout, createPipelineLayout, type Buffer as GpuBuffer } from '@vgpu/core'
import fieldShader from './field.wgsl'
import { FIELD_BYTES, FIELD_FLOATS, fieldGlows, packField, trackFlares, type FlareTrack, type Rect } from '@shared/sessionField.mjs'
import type { Agent } from '@shared/types'
import { tid } from './testid'

/**
 * The session field: a WebGPU canvas under the sidebar that puts one soft glow
 * behind each session row — provider colour, drifting and breathing while it
 * runs, still and dim when idle, red and pulsing when it waits on a person,
 * with a burst on the edge into waiting. The same signal as the tray badge,
 * readable from across the room while the workspace is up.
 *
 * What is drawn is decided in `@shared/sessionField.mjs` (pure, tested); this
 * component only measures the rows, uploads the packed uniform, and runs the
 * loop — at ~15 fps, only while the workspace is open and the document
 * visible, and parked entirely when there is no session to draw. No WebGPU,
 * no adapter, or a lost device means the canvas stays empty and nothing else
 * changes; `data-state` says which, for automation.
 */

/** ~15 fps: soft glows need no more, and this runs for as long as the workspace is up. */
const FRAME_MS = 66
/** Canvas pixels per CSS pixel. The glows are blur, so half resolution is free. */
const RENDER_SCALE = 0.5
const RETRY_MS = 5000

export type FieldState = 'off' | 'starting' | 'on' | 'idle' | 'unsupported' | 'lost'

interface Gpu {
  device: Device
  context: GPUCanvasContext
  pipeline: GPURenderPipeline
  group: GPUBindGroup
  uniforms: GpuBuffer
}

async function openGpu(canvas: HTMLCanvasElement): Promise<Gpu | null> {
  const nav = navigator.gpu
  if (!nav) return null
  const adapter = await nav.requestAdapter({ powerPreference: 'low-power' })
  if (!adapter) return null
  const raw = await adapter.requestDevice({ label: 'session-field' })
  const device = new Device(raw, adapter.info ?? null)
  const context = canvas.getContext('webgpu')
  if (!context) {
    device.destroy()
    return null
  }
  const format = nav.getPreferredCanvasFormat()
  context.configure({ device: raw, format, alphaMode: 'premultiplied' })
  const shader = device.createShader(fieldShader.wgsl)
  const uniforms = device.createBuffer({ size: FIELD_BYTES, usage: ['uniform', 'copy_dst'], label: 'session-field uniforms' })
  const layout = createBindGroupLayout(device, { label: 'session-field', entries: [bind.uniform(0, 'fragment')] })
  const pipeline = raw.createRenderPipeline({
    label: 'session-field',
    layout: createPipelineLayout(device, { bindGroups: [layout] }),
    vertex: { module: shader.gpu, entryPoint: 'vs' },
    fragment: { module: shader.gpu, entryPoint: 'fs', targets: [{ format }] },
    primitive: { topology: 'triangle-list' }
  })
  const group = createBindGroup(device, { layout, entries: [bind.resource(0, uniforms)] })
  return { device, context, pipeline, group, uniforms }
}

export function SessionField({ agents, active }: { agents: Agent[]; active: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const agentsRef = useRef(agents)
  agentsRef.current = agents
  const activeRef = useRef(active)
  activeRef.current = active
  const wakeRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    let alive = true
    let gpu: Gpu | null = null
    let opening = false
    let retried = false
    let raf = 0
    let last = 0
    let parked = false
    let track: FlareTrack | null = null
    const css = { w: 0, h: 0 }
    const data = new Float32Array(FIELD_FLOATS)
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
    const frameMs = reduced ? 250 : FRAME_MS

    const setState = (s: FieldState) => { canvas.dataset.state = s }

    const fit = () => {
      css.w = canvas.clientWidth
      css.h = canvas.clientHeight
      const scale = Math.min(window.devicePixelRatio || 1, 2) * RENDER_SCALE
      canvas.width = Math.max(1, Math.round(css.w * scale))
      canvas.height = Math.max(1, Math.round(css.h * scale))
    }

    // Row boxes in canvas pixels, for the rows inside the agent list's scroll
    // viewport — a row scrolled under the launch nav must not glow through it.
    const measure = () => {
      const rects = new Map<string, Rect>()
      const host = canvas.parentElement
      const body = host?.querySelector('.sideview--fill .sideview-body')?.getBoundingClientRect()
      if (!host || !body) return rects
      const origin = canvas.getBoundingClientRect()
      const byTid = new Map<string, DOMRect>()
      host.querySelectorAll<HTMLElement>('[data-testid^="agent:"]').forEach((el) => byTid.set(el.dataset.testid ?? '', el.getBoundingClientRect()))
      for (const a of agentsRef.current) {
        const r = byTid.get(tid('agent', a.id))
        if (!r) continue
        const cy = r.top + r.height / 2
        if (cy < body.top || cy > body.bottom) continue
        rects.set(a.id, { x: r.left - origin.left, y: r.top - origin.top, w: r.width, h: r.height })
      }
      return rects
    }

    const pass = (g: Gpu, draw: boolean) => {
      const encoder = g.device.gpu.createCommandEncoder({ label: 'session-field' })
      const rp = encoder.beginRenderPass({
        colorAttachments: [{ view: g.context.getCurrentTexture().createView(), clearValue: { r: 0, g: 0, b: 0, a: 0 }, loadOp: 'clear', storeOp: 'store' }]
      })
      if (draw) {
        rp.setPipeline(g.pipeline)
        rp.setBindGroup(0, g.group)
        rp.draw(3)
      }
      rp.end()
      g.device.gpu.queue.submit([encoder.finish()])
    }

    const frame = (now: number) => {
      if (!gpu) return
      track = trackFlares(track, agentsRef.current, now)
      const glows = fieldGlows(agentsRef.current, measure(), track.flares, now)
      packField(glows, { time: reduced ? 0 : (now % 1_000_000) / 1000, sx: css.w / canvas.width, sy: css.h / canvas.height }, data)
      gpu.uniforms.write(data)
      pass(gpu, glows.length > 0)
      // No sessions at all: one clear frame, then park until the list changes.
      parked = agentsRef.current.length === 0
      setState(parked ? 'idle' : 'on')
    }

    const teardown = () => {
      if (raf) cancelAnimationFrame(raf)
      raf = 0
      const g = gpu
      gpu = null
      try { g?.device.destroy() } catch { /* already lost */ }
    }

    const fail = (err: unknown) => {
      console.warn('[field] disabled:', err)
      teardown()
      setState('unsupported')
    }

    const schedule = () => {
      if (raf || !alive || !activeRef.current || document.hidden || !gpu) return
      raf = requestAnimationFrame(tick)
    }

    const tick = (now: number) => {
      raf = 0
      if (!alive || !activeRef.current || document.hidden || !gpu) return
      if (now - last >= frameMs) {
        last = now
        try { frame(now) } catch (err) { fail(err); return }
      }
      if (!parked) schedule()
    }

    const open = async () => {
      if (gpu || opening || !alive) return
      opening = true
      setState('starting')
      try {
        const g = await openGpu(canvas)
        if (!alive) { g?.device.destroy(); return }
        if (!g) { setState('unsupported'); return }
        gpu = g
        void g.device.gpu.lost.then((info) => {
          if (!alive || info.reason === 'destroyed') return
          console.warn('[field] device lost:', info.message)
          teardown()
          setState('lost')
          if (!retried) {
            retried = true
            setTimeout(() => { if (alive && activeRef.current) void open() }, RETRY_MS)
          }
        })
        fit()
        parked = false
        schedule()
      } catch (err) {
        fail(err)
      } finally {
        opening = false
      }
    }

    // Called on mount and whenever `active` or the agent list changes.
    wakeRef.current = () => {
      if (!activeRef.current) {
        // Switched off while showing: stop, and leave nothing on screen.
        if (raf) cancelAnimationFrame(raf)
        raf = 0
        if (gpu) { try { pass(gpu, false) } catch { /* device gone; the loss handler owns it */ } }
        setState(gpu ? 'idle' : 'off')
        return
      }
      if (!gpu) { void open(); return }
      parked = false
      schedule()
    }

    const ro = new ResizeObserver(() => { fit(); parked = false; schedule() })
    ro.observe(canvas)
    const onVisibility = () => { if (!document.hidden) { parked = false; schedule() } }
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      alive = false
      wakeRef.current = null
      ro.disconnect()
      document.removeEventListener('visibilitychange', onVisibility)
      teardown()
    }
  }, [])

  useEffect(() => { wakeRef.current?.() }, [active, agents])

  return <canvas ref={canvasRef} className="field" data-testid="session-field" data-state="off" aria-hidden="true" />
}
