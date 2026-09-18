import { useEffect, useMemo, useRef } from 'react'
import streamShader from './stream.wgsl'
import { STREAM_BYTES, packStream, streamColor, streamParams } from '@shared/burnStream.mjs'
import type { Quota } from '@shared/types'
import { REDUCED_MOTION } from './gpuField'
import { useFieldActive } from './fieldActive'
import { useGpuLayer, type LayerSpec } from './useGpuLayer'

/**
 * The burn-rate stream on a quota bar: streaks of light travelling along the
 * filled part of the bar, as many and as fast as main's projection of when the
 * window hits its limit says. A bar shows level; this shows speed. It draws
 * only while there is a projection (`projectedLimitAt`), the workspace is open,
 * and the glow is on; a bar without a projection is exactly as static as it
 * was. What the pace means is decided in `@shared/burnStream.mjs` (pure, tested).
 */

const FRAME_MS = 66

export function QuotaStream({ q, projectedLimitAt }: { q: Quota; projectedLimitAt: number | undefined }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const propsRef = useRef({ q, projectedLimitAt })
  propsRef.current = { q, projectedLimitAt }
  const active = useFieldActive()

  const spec = useMemo<LayerSpec>(() => ({
    wgsl: streamShader.wgsl,
    bytes: STREAM_BYTES,
    label: 'quota-stream',
    // Streaks are a few pixels tall: draw at full resolution.
    scale: 1,
    frameMs: REDUCED_MOTION ? 500 : FRAME_MS,
    frame: (now, css, canvas, data) => {
      const { q, projectedLimitAt } = propsRef.current
      const params = streamParams(q.usedPct, projectedLimitAt, Date.now())
      if (!params) return false
      packStream(params, {
        time: REDUCED_MOTION ? 0 : (now % 1_000_000) / 1000,
        w: css.w,
        h: css.h,
        sx: css.w / canvas.width,
        sy: css.h / canvas.height,
        color: streamColor(q.tone, q.severity)
      }, data)
      return true
    },
    park: () => streamParams(propsRef.current.q.usedPct, propsRef.current.projectedLimitAt, Date.now()) === null
  }), [])

  const wake = useGpuLayer(canvasRef, spec, active)
  useEffect(() => { wake() }, [q.usedPct, projectedLimitAt, wake])

  return <canvas ref={canvasRef} className="quota-stream" data-testid="quota-stream" data-state="off" aria-hidden="true" />
}
