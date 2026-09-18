import { useCallback, useEffect, useRef, type RefObject } from 'react'
import { closeSurface, fitCanvas, openSurface, renderSurface, type Surface } from './gpuField'

/**
 * The loop and lifecycle every GPU layer shares. A layer is a canvas, a
 * fullscreen shader, and a `frame` that fills the uniform for one draw; this
 * hook does the rest: opens the surface lazily on first activation, ticks at
 * `frameMs` only while `active` and the document is visible, parks when
 * `park()` says there is nothing more to draw until `wake()` (returned) is
 * called, re-fits on resize, clears the canvas when switched off, and treats
 * a missing GPU, a failed open, or a lost device (one retry) as "draw
 * nothing". `data-state` on the canvas says which, for automation.
 */

export type LayerState = 'off' | 'starting' | 'on' | 'idle' | 'unsupported' | 'lost'

export interface LayerSpec {
  wgsl: string
  bytes: number
  label: string
  /** Canvas pixels per css pixel, before the device pixel ratio. */
  scale: number
  frameMs: number
  /** Fill `data` for this frame. Return false to draw nothing (the canvas is cleared). */
  frame: (now: number, css: { w: number; h: number }, canvas: HTMLCanvasElement, data: Float32Array<ArrayBuffer>) => boolean
  /** After a frame: true to stop ticking until the next wake. */
  park: () => boolean
}

const RETRY_MS = 5000

export function useGpuLayer(canvasRef: RefObject<HTMLCanvasElement | null>, spec: LayerSpec, active: boolean): () => void {
  const specRef = useRef(spec)
  specRef.current = spec
  const activeRef = useRef(active)
  activeRef.current = active
  const wakeRef = useRef<() => void>(() => {})

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    let alive = true
    let surface: Surface | null = null
    let opening = false
    let retried = false
    let raf = 0
    let last = 0
    let parked = false
    let css = { w: 0, h: 0 }
    const data = new Float32Array(new ArrayBuffer(specRef.current.bytes))
    const setState = (s: LayerState) => { canvas.dataset.state = s }

    const frame = (now: number) => {
      if (!surface) return
      const s = specRef.current
      const draw = s.frame(now, css, canvas, data)
      renderSurface(surface, draw ? data : null)
      parked = s.park()
      setState(parked ? 'idle' : 'on')
    }

    const teardown = () => {
      if (raf) cancelAnimationFrame(raf)
      raf = 0
      const s = surface
      surface = null
      if (s) closeSurface(s)
    }

    const fail = (err: unknown) => {
      console.warn(`[${specRef.current.label}] disabled:`, err)
      teardown()
      setState('unsupported')
    }

    const schedule = () => {
      if (raf || !alive || !activeRef.current || document.hidden || !surface) return
      raf = requestAnimationFrame(tick)
    }

    const tick = (now: number) => {
      raf = 0
      if (!alive || !activeRef.current || document.hidden || !surface) return
      if (now - last >= specRef.current.frameMs) {
        last = now
        try { frame(now) } catch (err) { fail(err); return }
      }
      if (!parked) schedule()
    }

    const open = async () => {
      if (surface || opening || !alive) return
      opening = true
      setState('starting')
      try {
        const s = specRef.current
        const opened = await openSurface(canvas, s.wgsl, s.bytes, s.label)
        if (!alive) { if (opened) closeSurface(opened); return }
        if (!opened) { setState('unsupported'); return }
        surface = opened
        void opened.device.gpu.lost.then((info) => {
          if (!alive || info.reason === 'destroyed' || surface !== opened) return
          console.warn(`[${specRef.current.label}] device lost:`, info.message)
          teardown()
          setState('lost')
          if (!retried) {
            retried = true
            setTimeout(() => { if (alive && activeRef.current) void open() }, RETRY_MS)
          }
        })
        css = fitCanvas(canvas, s.scale)
        parked = false
        schedule()
      } catch (err) {
        fail(err)
      } finally {
        opening = false
      }
    }

    wakeRef.current = () => {
      if (!activeRef.current) {
        // Switched off, or the workspace hid: stop, and leave nothing on screen.
        if (raf) cancelAnimationFrame(raf)
        raf = 0
        if (surface) { try { renderSurface(surface, null) } catch { /* the loss handler owns it */ } }
        setState(surface ? 'idle' : 'off')
        return
      }
      if (!surface) { void open(); return }
      parked = false
      schedule()
    }

    const ro = new ResizeObserver(() => {
      css = fitCanvas(canvas, specRef.current.scale)
      parked = false
      schedule()
    })
    ro.observe(canvas)
    const onVisibility = () => { if (!document.hidden) { parked = false; schedule() } }
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      alive = false
      wakeRef.current = () => {}
      ro.disconnect()
      document.removeEventListener('visibilitychange', onVisibility)
      teardown()
    }
  }, [canvasRef])

  useEffect(() => { wakeRef.current() }, [active])

  return useCallback(() => wakeRef.current(), [])
}
