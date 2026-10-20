/*
 * The effort control in the model menu (the user's call, 2026-10-20): Neon UI's ThinkingSelect
 * (ui.neon.com/agent/thinking-select, registry ui.neon.com/r/thinking-select.json), which is
 * Chánh Đại's Elastic Slider (chanhdai.com/r/elastic-slider.json, MIT, @iamncdai) with a spring snap
 * and pixel sparkles in its fill. Ported from Tailwind and Neon's tokens to the pane's own CSS
 * (`.chat-slider` in chat.css, the accent for Neon's primary); the motion stays motion's (`motion/react`,
 * the one dependency it brings). Changes from upstream: discrete steps only (`count` positions, step 1),
 * a value is committed on release or key press (`onCommit`) while a drag only previews it
 * (`onPreview`), the sparkle's density and speed follow the position rather than a fixed effort table
 * (Codex lists other levels), and the track's radius is the pane's 6px.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { animate, domAnimation, LazyMotion, m, useMotionValue, useReducedMotion, useTransform } from 'motion/react'

// Drag detection & rubber band (upstream's values)
const CLICK_THRESHOLD = 3
const DEAD_ZONE = 32
const MAX_CURSOR_RANGE = 200
const MAX_STRETCH = 8
// The handle dodges the label and the value
const HANDLE_BUFFER = 8
const LABEL_OFFSET = 12 + 4
const VALUE_OFFSET = 12 - 8
/** One sparkle pixel, in CSS px. */
const GRAIN_CELL = 3

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v))
}

/** Deterministic pseudo-random noise, stable for a given cell and tick. */
function hashNoise(cell: number, tick: number) {
  const raw = Math.sin(cell * 127.1 + tick * 311.7) * 43_758.5453
  return raw - Math.floor(raw)
}

/**
 * How lively the fill's sparkle is at a position: none at the first (Auto: the model decides), then
 * from upstream's `low` (density 0.04, speed 8) to its `max` (0.2, 48) across the levels after it.
 */
function sparkleAt(index: number, count: number) {
  if (index <= 0 || count < 2) return { density: 0, speed: 0 }
  const t = count > 2 ? (index - 1) / (count - 2) : 1
  return { density: 0.04 + 0.16 * t, speed: 8 + 40 * t }
}

/**
 * Pixel sparkle confined to the fill (upstream's GrainFill). Reads the fill's live width each frame, so
 * the glints stretch with the elastic drag and spring with the snap; skips its work while hidden and
 * draws nothing under reduced motion. Its colour is the canvas's CSS `color` (the accent).
 */
function GrainFill({ index, count }: { index: number; count: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const level = useRef({ index, count })
  level.current = { index, count }
  useEffect(() => {
    const canvas = canvasRef.current
    const context = canvas?.getContext('2d')
    if (!canvas || !context || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    let frame = 0
    const draw = (now: number) => {
      frame = requestAnimationFrame(draw)
      if (!(canvas.checkVisibility?.() ?? true)) return
      const host = canvas.parentElement
      const fill = host?.querySelector<HTMLElement>('.chat-slider-fill')
      if (!host || !fill) return
      const hostRect = host.getBoundingClientRect()
      const fillRect = fill.getBoundingClientRect()
      const width = Math.round(hostRect.width * dpr)
      const height = Math.round(hostRect.height * dpr)
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width
        canvas.height = height
      }
      context.clearRect(0, 0, width, height)
      const { density, speed } = sparkleAt(level.current.index, level.current.count)
      if (density === 0) return
      const fillLeft = (fillRect.left - hostRect.left) * dpr
      const cell = GRAIN_CELL * dpr
      const columns = Math.ceil((fillRect.width * dpr) / cell)
      const rows = Math.ceil(height / cell)
      const seconds = now / 1000
      context.fillStyle = getComputedStyle(canvas).color
      for (let i = 0; i < columns * rows; i++) {
        // A sparse, stable subset of cells may ever sparkle; each breathes on its own phase, dark most of
        // the cycle and glinting briefly at the crest.
        if (hashNoise(i, 1) > density) continue
        const twinkle = Math.sin(seconds * (speed / 4) + hashNoise(i, 2) * Math.PI * 2)
        if (twinkle < 0.75) continue
        context.globalAlpha = ((twinkle - 0.75) / 0.25) * 0.45
        context.fillRect(fillLeft + (i % columns) * cell, Math.floor(i / columns) * cell, cell + 0.5, cell + 0.5)
      }
      context.globalAlpha = 1
    }
    frame = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(frame)
  }, [])
  return <canvas aria-hidden className="chat-slider-grain" ref={canvasRef} />
}

export interface EffortSliderProps {
  /** Shown inside the track at its left ("Thinking"). */
  label: string
  /** Positions, left to right (Auto, then the levels). */
  count: number
  /** The committed position. */
  value: number
  /** The value inside the track at its right, and the slider's `aria-valuetext`. */
  format: (index: number) => string
  /** While dragging: the position under the pointer (for the menu's heading). */
  onPreview?: (index: number) => void
  /** A click, a release after a drag, or a key: the position to apply. */
  onCommit: (index: number) => void
  'aria-label'?: string
  testid?: string
}

/** The elastic slider, wrapped as upstream's ThinkingSelect: the sparkle canvas over the track. */
export function EffortSlider({ label, count, value, format, onPreview, onCommit, 'aria-label': ariaLabel, testid }: EffortSliderProps) {
  const max = Math.max(1, count - 1)
  const [draft, setDraft] = useState(value)
  const reduceMotion = useReducedMotion()
  const wrapperRef = useRef<HTMLDivElement>(null)
  const trackRef = useRef<HTMLDivElement>(null)
  const labelRef = useRef<HTMLSpanElement>(null)
  const valueRef = useRef<HTMLSpanElement>(null)
  const [isInteracting, setIsInteracting] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const [isHovered, setIsHovered] = useState(false)
  /** A ring only for Tab focus or a key, not for a pointer press. */
  const [keyboardRing, setKeyboardRing] = useState(false)
  const pointerDown = useRef<{ x: number; y: number } | null>(null)
  const pendingPointerFocus = useRef(false)
  const isClick = useRef(true)
  const anim = useRef<ReturnType<typeof animate> | null>(null)
  const wrapperRect = useRef<DOMRect | null>(null)
  const scale = useRef(1)

  // The slider shows its own draft: a release or a key moves it at once, and the committed value, when it
  // arrives (or changes from elsewhere), resets it. Synced on a change of `value` only, so a release does
  // not flash the old level while its commit is on its way.
  useEffect(() => { setDraft(value) }, [value])

  const shown = draft
  const percentage = (shown / max) * 100
  const isActive = isInteracting || isHovered

  // Fill and handle ride one motion value, updated imperatively.
  const fillPercent = useMotionValue(percentage)
  const fillWidth = useTransform(fillPercent, (pct) => `${pct}%`)
  const handleLeft = useTransform(fillPercent, (pct) => `max(4px, calc(${pct}% - 8px))`)
  // Rubber band: past either end the track widens and, past the left, shifts left.
  const rubberStretch = useMotionValue(0)
  const rubberWidth = useTransform(rubberStretch, (s) => `calc(100% + ${Math.abs(s)}px)`)
  const rubberX = useTransform(rubberStretch, (s) => (s < 0 ? s : 0))

  const positionToValue = useCallback((clientX: number) => {
    const rect = wrapperRect.current
    if (!rect) return 0
    const width = wrapperRef.current?.offsetWidth ?? rect.width
    return clamp(((clientX - rect.left) / scale.current / width) * max, 0, max)
  }, [max])

  const animateFillTo = useCallback((target: number) => {
    anim.current?.stop()
    if (reduceMotion) { fillPercent.jump(target); anim.current = null; return }
    anim.current = animate(fillPercent, target, { type: 'spring', stiffness: 300, damping: 25, mass: 0.8, onComplete: () => { anim.current = null } })
  }, [fillPercent, reduceMotion])

  // A value from outside (another pane's change, a failed commit) springs rather than jumps.
  useEffect(() => {
    if (isInteracting || anim.current) return
    if (Math.abs(fillPercent.get() - percentage) < 0.5) { fillPercent.jump(percentage); return }
    animateFillTo(percentage)
  }, [percentage, isInteracting, fillPercent, animateFillTo])

  const rubber = useCallback((clientX: number, sign: number) => {
    const rect = wrapperRect.current
    if (!rect) return 0
    const past = sign < 0 ? rect.left - clientX : clientX - rect.right
    return sign * MAX_STRETCH * Math.sqrt(Math.min(Math.max(0, past - DEAD_ZONE) / MAX_CURSOR_RANGE, 1))
  }, [])

  const settle = (index: number) => {
    const snapped = clamp(Math.round(index), 0, max)
    animateFillTo((snapped / max) * 100)
    setDraft(snapped)
    if (snapped !== value) onCommit(snapped)
    else onPreview?.(snapped)
  }

  const onPointerDown = (e: React.PointerEvent) => {
    e.preventDefault()
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    pointerDown.current = { x: e.clientX, y: e.clientY }
    isClick.current = true
    setIsInteracting(true)
    pendingPointerFocus.current = true
    setKeyboardRing(false)
    trackRef.current?.focus({ preventScroll: true })
    requestAnimationFrame(() => { pendingPointerFocus.current = false })
    // The rect at press time: later math is immune to layout shifts.
    const wrapper = wrapperRef.current
    if (wrapper) {
      const rect = wrapper.getBoundingClientRect()
      wrapperRect.current = rect
      scale.current = rect.width / wrapper.offsetWidth
    }
  }

  const onPointerMove = (e: React.PointerEvent) => {
    if (!isInteracting || !pointerDown.current) return
    if (isClick.current && Math.hypot(e.clientX - pointerDown.current.x, e.clientY - pointerDown.current.y) > CLICK_THRESHOLD) {
      isClick.current = false
      setIsDragging(true)
    }
    if (isClick.current) return
    const rect = wrapperRect.current
    if (rect && !reduceMotion) rubberStretch.jump(e.clientX < rect.left ? rubber(e.clientX, -1) : e.clientX > rect.right ? rubber(e.clientX, 1) : 0)
    const raw = positionToValue(e.clientX)
    anim.current?.stop()
    anim.current = null
    fillPercent.jump((raw / max) * 100)
    const step = Math.round(raw)
    if (step !== draft) { setDraft(step); onPreview?.(step) }
  }

  const onPointerUp = (e: React.PointerEvent) => {
    if (!isInteracting) return
    // A click or a release springs the fill onto the nearest step, so it never rests between positions.
    settle(positionToValue(e.clientX))
    if (!reduceMotion && rubberStretch.get() !== 0) animate(rubberStretch, 0, { type: 'spring', visualDuration: 0.35, bounce: 0.15 })
    setIsInteracting(false)
    setIsDragging(false)
    pointerDown.current = null
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    let next: number | null = null
    switch (e.key) {
      case 'ArrowRight': case 'ArrowUp': next = draft + 1; break
      case 'ArrowLeft': case 'ArrowDown': next = draft - 1; break
      case 'Home': next = 0; break
      case 'End': next = max; break
      default: return
    }
    e.preventDefault()
    e.stopPropagation()
    setKeyboardRing(true)
    settle(next)
  }

  // Measure the label and the value, so the handle fades where it would cross either.
  const [dodge, setDodge] = useState({ left: 38, right: 72 })
  const display = format(shown)
  useLayoutEffect(() => {
    const wrapper = wrapperRef.current
    if (!wrapper) return
    const measure = () => {
      const width = wrapper.offsetWidth
      if (width <= 0) return
      const left = labelRef.current ? ((LABEL_OFFSET + labelRef.current.offsetWidth + HANDLE_BUFFER) / width) * 100 : 38
      const right = valueRef.current ? ((width - VALUE_OFFSET - valueRef.current.offsetWidth - HANDLE_BUFFER) / width) * 100 : 72
      setDodge((prev) => (prev.left === left && prev.right === right ? prev : { left, right }))
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(wrapper)
    if (labelRef.current) observer.observe(labelRef.current)
    if (valueRef.current) observer.observe(valueRef.current)
    return () => observer.disconnect()
  }, [label, display])
  const dodging = percentage < dodge.left || percentage > dodge.right
  const handleOpacity = !isActive ? 0 : dodging ? 0.1 : isDragging ? 0.8 : 0.5

  return (
    <div className="chat-slider-host" data-effort-index={shown} data-testid={testid}>
      <GrainFill index={shown} count={count} />
      <LazyMotion features={domAnimation} strict>
        <div ref={wrapperRef} className="chat-slider">
          <m.div
            ref={trackRef}
            role="slider"
            tabIndex={0}
            className="chat-slider-track"
            data-active={isActive}
            data-focus-visible={keyboardRing}
            aria-label={ariaLabel ?? label}
            aria-orientation="horizontal"
            aria-valuemin={0}
            aria-valuemax={max}
            aria-valuenow={shown}
            aria-valuetext={display}
            style={{ width: rubberWidth, x: rubberX }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onFocus={() => { if (!pendingPointerFocus.current) setKeyboardRing(true) }}
            onBlur={() => setKeyboardRing(false)}
            onKeyDown={onKeyDown}
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
          >
            <div className="chat-slider-marks" aria-hidden>
              {Array.from({ length: max - 1 }, (_, i) => <div key={i} className="chat-slider-mark" style={{ left: `${((i + 1) / max) * 100}%` }} />)}
            </div>
            <m.div className="chat-slider-fill" aria-hidden style={{ width: fillWidth }} />
            <m.div
              className="chat-slider-handle"
              aria-hidden
              style={{ left: handleLeft, y: '-50%' }}
              animate={{ opacity: handleOpacity, scaleX: isActive ? 1 : 0.25, scaleY: isActive && dodging ? 0.75 : 1 }}
              transition={reduceMotion ? { duration: 0 } : { scaleX: { type: 'spring', visualDuration: 0.25, bounce: 0.15 }, scaleY: { type: 'spring', visualDuration: 0.2, bounce: 0.1 }, opacity: { duration: 0.15 } }}
            />
            <span ref={labelRef} className="chat-slider-label" aria-hidden>{label}</span>
            <span ref={valueRef} className="chat-slider-value" aria-hidden>{display}</span>
          </m.div>
        </div>
      </LazyMotion>
    </div>
  )
}
