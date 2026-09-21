/**
 * Pixel tests for the WGSL shader, rendered headlessly through vgpu's Node
 * adapter (Dawn). They assert what the layer promises: streaks only inside a
 * bar's fill, and none without a projection.
 * Without a GPU device on the machine the tests skip and say why.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { bind, createBindGroup, createBindGroupLayout, createPipelineLayout } from '@vgpu/core'
import { STREAM_BYTES, STREAM_RGB, packStream, streamParams } from './burnStream.mjs'

const wgsl = (name) => readFileSync(new URL(`../renderer/src/${name}`, import.meta.url), 'utf8')
const SIZE = 64

let device = null
let why = 'no WebGPU device'
try {
  const { createNodeDevice } = await import('@vgpu/adapter-node')
  device = await createNodeDevice()
} catch (err) {
  why = `no WebGPU device: ${err?.message ?? err}`
}
const gpu = { skip: device ? false : why }
test.after(() => { try { device?.destroy() } catch { /* already gone */ } })

/** Draw one fullscreen triangle of `code` with `data` as its uniform; returns a pixel reader. */
async function render(code, bytes, data) {
  const shader = device.createShader(code)
  const target = device.createTexture({ kind: '2d', size: [SIZE, SIZE], format: 'rgba8unorm', usage: ['render_attachment', 'copy_src'] })
  const uniforms = device.createBuffer({ size: bytes, usage: ['uniform', 'copy_dst'] })
  uniforms.write(data)
  const layout = createBindGroupLayout(device, { entries: [bind.uniform(0, 'fragment')] })
  const pipeline = device.gpu.createRenderPipeline({
    layout: createPipelineLayout(device, { bindGroups: [layout] }),
    vertex: { module: shader.gpu, entryPoint: 'vs' },
    fragment: { module: shader.gpu, entryPoint: 'fs', targets: [{ format: 'rgba8unorm' }] },
    primitive: { topology: 'triangle-list' }
  })
  const group = createBindGroup(device, { layout, entries: [bind.resource(0, uniforms)] })
  const encoder = device.gpu.createCommandEncoder()
  const pass = encoder.beginRenderPass({
    colorAttachments: [{ view: target.createView(), clearValue: { r: 0, g: 0, b: 0, a: 0 }, loadOp: 'clear', storeOp: 'store' }]
  })
  pass.setPipeline(pipeline)
  pass.setBindGroup(0, group)
  pass.draw(3)
  pass.end()
  device.gpu.queue.submit([encoder.finish()])
  const px = await target.read({ mipLevel: 0, region: 'all' })
  uniforms.destroy()
  target.destroy()
  return (x, y) => {
    const o = (y * SIZE + x) * 4
    return { r: px[o], g: px[o + 1], b: px[o + 2], a: px[o + 3] }
  }
}

test('stream.wgsl: streaks travel only inside the filled part of the bar', gpu, async () => {
  const params = { ...streamParams(50, 3_600_000, 0), count: 40, speed: 0 }
  const data = packStream(params, { time: 0, w: SIZE, h: SIZE, sx: 1, sy: 1, color: STREAM_RGB.amber })
  const at = await render(wgsl('stream.wgsl'), STREAM_BYTES, data)
  let lit = 0
  let beyond = 0
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const a = at(x, y).a
      if (x < 32) lit = Math.max(lit, a)
      else beyond = Math.max(beyond, a)
    }
  }
  assert.ok(lit > 40, `something is lit inside the fill: max alpha ${lit}`)
  assert.equal(beyond, 0, 'and nothing past it')
  const none = await render(wgsl('stream.wgsl'), STREAM_BYTES, packStream(null, { time: 0, w: SIZE, h: SIZE, sx: 1, sy: 1, color: STREAM_RGB.amber }))
  assert.equal(none(16, 32).a, 0, 'no projection, no streaks')
})
