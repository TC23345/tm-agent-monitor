import { Device, bind, createBindGroup, createBindGroupLayout, createPipelineLayout, type Buffer as GpuBuffer } from '@vgpu/core'

/**
 * The one WebGPU device the GPU layers share (the
 * attention layer, the quota streams), and the per-canvas plumbing each of
 * them needs: a configured context, a pipeline for its fullscreen shader, and
 * one uniform buffer. Every layer draws the same way — one clear, one
 * triangle — so `renderSurface` is the whole render path.
 *
 * The device is reference-counted: the first surface opens it, the last one
 * closed destroys it. A lost device drops the shared promise so the next
 * open asks the adapter again; each layer watches `surface.device.gpu.lost`
 * and reopens on its own schedule.
 */

export interface Surface {
  device: Device
  context: GPUCanvasContext
  pipeline: GPURenderPipeline
  group: GPUBindGroup
  uniforms: GpuBuffer
}

let shared: Promise<Device | null> | null = null
let users = 0

function openDevice(): Promise<Device | null> {
  if (!shared) {
    const opening: Promise<Device | null> = (async () => {
      const nav = navigator.gpu
      if (!nav) return null
      const adapter = await nav.requestAdapter({ powerPreference: 'low-power' })
      if (!adapter) return null
      const raw = await adapter.requestDevice({ label: 'tm-gpu-layers' })
      const device = new Device(raw, adapter.info ?? null)
      // Lost: forget it, so the next open asks the adapter again.
      void raw.lost.then(() => { if (shared === opening) shared = null })
      return device
    })()
    shared = opening
  }
  return shared
}

function releaseDevice(device: Device): void {
  users = Math.max(0, users - 1)
  if (users === 0) {
    const gone = shared
    shared = null
    void gone?.then((d) => { if (d === device) { try { d.destroy() } catch { /* already lost */ } } })
  }
}

/** Open a canvas as a render surface for `wgsl` with a `bytes`-long uniform. Null when WebGPU is unavailable. */
export async function openSurface(canvas: HTMLCanvasElement, wgsl: string, bytes: number, label: string): Promise<Surface | null> {
  const device = await openDevice()
  if (!device) return null
  const context = canvas.getContext('webgpu')
  if (!context) return null
  users++
  try {
    const format = navigator.gpu.getPreferredCanvasFormat()
    context.configure({ device: device.gpu, format, alphaMode: 'premultiplied' })
    const shader = device.createShader(wgsl)
    const uniforms = device.createBuffer({ size: bytes, usage: ['uniform', 'copy_dst'], label: `${label} uniforms` })
    const layout = createBindGroupLayout(device, { label, entries: [bind.uniform(0, 'fragment')] })
    const pipeline = device.gpu.createRenderPipeline({
      label,
      layout: createPipelineLayout(device, { bindGroups: [layout] }),
      vertex: { module: shader.gpu, entryPoint: 'vs' },
      fragment: { module: shader.gpu, entryPoint: 'fs', targets: [{ format }] },
      primitive: { topology: 'triangle-list' }
    })
    const group = createBindGroup(device, { layout, entries: [bind.resource(0, uniforms)] })
    return { device, context, pipeline, group, uniforms }
  } catch (err) {
    releaseDevice(device)
    throw err
  }
}

/** One frame: upload `data` and draw the triangle, or just clear when `data` is null. */
export function renderSurface(s: Surface, data: Float32Array<ArrayBuffer> | null): void {
  if (data) s.uniforms.write(data)
  const encoder = s.device.gpu.createCommandEncoder()
  const pass = encoder.beginRenderPass({
    colorAttachments: [{ view: s.context.getCurrentTexture().createView(), clearValue: { r: 0, g: 0, b: 0, a: 0 }, loadOp: 'clear', storeOp: 'store' }]
  })
  if (data) {
    pass.setPipeline(s.pipeline)
    pass.setBindGroup(0, s.group)
    pass.draw(3)
  }
  pass.end()
  s.device.gpu.queue.submit([encoder.finish()])
}

export function closeSurface(s: Surface): void {
  try { s.uniforms.destroy() } catch { /* device gone */ }
  try { s.context.unconfigure() } catch { /* never configured */ }
  releaseDevice(s.device)
}

/** Size the backing store for the canvas's css box at `scale` of the device pixel ratio. */
export function fitCanvas(canvas: HTMLCanvasElement, scale: number): { w: number; h: number } {
  const w = canvas.clientWidth
  const h = canvas.clientHeight
  const k = Math.min(window.devicePixelRatio || 1, 2) * scale
  canvas.width = Math.max(1, Math.round(w * k))
  canvas.height = Math.max(1, Math.round(h * k))
  return { w, h }
}

export const REDUCED_MOTION = typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
