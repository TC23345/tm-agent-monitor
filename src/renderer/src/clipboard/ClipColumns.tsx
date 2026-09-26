import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import { autoKeyWidth, boundaryColumn, CLIP_COLS_KEY, CLIP_COLUMNS, readClipCols, resetColumn, resizeColumns, templateFor, withClipCols, type ClipColBucket, type ClipColWidths } from '@shared/clipColumns.mjs'
import { trackWidths } from '@shared/layout.mjs'
import { Splitter } from '../Splitter'

function readStored(): unknown {
  try { return JSON.parse(localStorage.getItem(CLIP_COLS_KEY) ?? 'null') } catch { return null }
}

/**
 * One clip table's column widths (`tm.clipcols.v1`, its own bucket per
 * window): the `grid-template-columns` the header and every row read — the
 * caller sets it as `--picker-cols` / `--picker-row-cols` on the element that
 * holds both — and the handlers a header grip needs. The arithmetic is
 * `@shared/clipColumns.mjs`; this only measures, remembers and persists.
 */
export function useClipColumns(bucket: ClipColBucket, headRef: RefObject<HTMLElement>, keyLabels: readonly string[] = []) {
  const model = CLIP_COLUMNS[bucket]
  const [widths, setWidths] = useState<ClipColWidths>(() => readClipCols(readStored(), bucket))
  const drag = useRef<{ widths: number[]; available: number; stored: ClipColWidths } | null>(null)

  useEffect(() => {
    try { localStorage.setItem(CLIP_COLS_KEY, JSON.stringify(withClipCols(readStored(), bucket, widths))) } catch { /* a layout nicety only */ }
  }, [bucket, widths])

  /** Drag start: the header's used tracks and content width, measured rather than assumed. */
  const start = useCallback(() => {
    const head = headRef.current
    if (!head) { drag.current = null; return }
    const cs = getComputedStyle(head)
    const available = head.clientWidth - (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0)
    drag.current = { widths: trackWidths(cs.gridTemplateColumns), available, stored: widths }
  }, [headRef, widths])

  const move = useCallback((index: number, delta: number) => {
    const d = drag.current
    if (!d) return
    setWidths(resizeColumns(model, d.widths, index, delta, d.available, d.stored))
  }, [model])

  const reset = useCallback((index: number) => setWidths((w) => resetColumn(model, w, index)), [model])

  // Rows with a clip keybind widen the key column's default to the longest chord chip (a dragged width still wins).
  const autoKey = autoKeyWidth(keyLabels)
  return { model, template: templateFor(model, widths, autoKey), start, move, reset }
}

/**
 * The drag handle on a header cell's right edge (`.clip-col-grip`): the
 * shared `Splitter` — pointer capture, arrow keys, double-click resets that
 * boundary — laid over the gap between two columns.
 */
export function ColumnGrip({ cols, index, label, testId }: {
  cols: ReturnType<typeof useClipColumns>
  index: number
  label: string
  testId: string
}) {
  return (
    <Splitter
      axis="x"
      className="clip-col-grip"
      label={`${label} column`}
      title={`Drag to resize the ${label.toLowerCase()} column — double-click to reset`}
      onStart={cols.start}
      onMove={(delta) => cols.move(index, delta)}
      onReset={() => cols.reset(index)}
      step={24}
      testId={testId}
    />
  )
}

const COLUMN_LABELS: Record<string, string> = { clip: 'Clip', source: 'Source', when: 'When', key: 'Key' }

/** The grip for header cell `index`, or null when its right edge sizes nothing (fixed columns, the table's edge). */
export function gripAt(cols: ReturnType<typeof useClipColumns>, bucket: ClipColBucket, index: number) {
  const target = boundaryColumn(cols.model, index)
  if (!target) return null
  const id = cols.model[target.index].id
  return <ColumnGrip cols={cols} index={index} label={COLUMN_LABELS[id] ?? id} testId={`clip-col-grip:${bucket}:${cols.model[index].id}`} />
}
