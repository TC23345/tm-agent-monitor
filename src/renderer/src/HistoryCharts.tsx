import { useLayoutEffect, useRef, useState, type PointerEvent, type ReactNode } from 'react'
import {
  heatLevel, niceCeil,
  type CalendarGrid, type HistoryBucket, type HistoryMetric, type HistoryView, type WeekdayRow
} from '@shared/history.mjs'
import { compactNumber, money } from './format'
import { PROVIDER_NAME } from './usageShared'

/**
 * The History pane's marks. Every chart here reads the same `HistoryView`
 * buckets and the same hovered index, so the bar under the pointer and the
 * crosshair on the running total are always the same hour or day.
 */

const STACK = ['claude', 'codex'] as const

/** `money`, but compact once a range adds up to five figures ("$33.1K", not "$33081"). */
export function usd(n: number): string {
  return n >= 10_000 ? `$${compactNumber(n)}` : money(n)
}

/** One measure, spelled the way the rest of the app spells it. */
export function fmt(metric: HistoryMetric, n: number): string {
  return metric === 'tokens' ? compactNumber(n) : `~${usd(n)}`
}

/** Which bucket a pointer is over: the whole column is the target, gaps included. */
function bucketAt(e: PointerEvent<HTMLElement>, count: number): number {
  const rect = e.currentTarget.getBoundingClientRect()
  if (rect.width <= 0 || count <= 0) return -1
  return Math.min(count - 1, Math.max(0, Math.floor(((e.clientX - rect.left) / rect.width) * count)))
}

/** A gridline's label: round numbers, so no "~" and no padding decimals ("$50", "$12.5", "$0.25"). */
function tick(metric: HistoryMetric, n: number): string {
  if (metric === 'tokens') return compactNumber(n)
  if (n >= 1000) return `$${compactNumber(n)}`
  return Number.isInteger(n) ? `$${n}` : `$${n.toFixed(n < 10 ? 2 : 1)}`
}

function Gridlines({ metric, top }: { metric: HistoryMetric; top: number }) {
  return (
    <div className="hist-grid" aria-hidden="true">
      <span className="hist-gridline is-top"><i>{tick(metric, top)}</i></span>
      <span className="hist-gridline is-mid"><i>{tick(metric, top / 2)}</i></span>
    </div>
  )
}

export function Axis({ view }: { view: HistoryView }) {
  const n = view.buckets.length
  return (
    <div className="hist-axis" aria-hidden="true">
      {view.ticks.map((t) => (
        <span
          key={t.index}
          className={t.end ? 'is-end' : t.center ? 'is-center' : ''}
          style={t.end ? undefined : { left: `${((t.index + (t.center ? 0.5 : 0)) / n) * 100}%` }}
        >
          {t.label}
        </span>
      ))}
    </div>
  )
}

/** Stacked by provider, one column per bucket. Hours not reached yet stay blank. */
export function BarChart({ view, metric, hover, onHover }: {
  view: HistoryView
  metric: HistoryMetric
  hover: number | null
  onHover: (index: number | null) => void
}) {
  const { buckets } = view
  const top = niceCeil(view.max[metric])
  const scale = top > 0 ? 100 / top : 0
  const perDay = view.unit === 'hour' && buckets.length > 24
  const what = metric === 'tokens' ? 'Tokens out' : 'Estimated value'
  return (
    <div
      className="hist-plot"
      onPointerMove={(e) => {
        const i = bucketAt(e, buckets.length)
        onHover(i >= 0 && !buckets[i].future ? i : null)
      }}
      onPointerLeave={() => onHover(null)}
    >
      <Gridlines metric={metric} top={top} />
      <div
        className={`hist-bars ${buckets.length > 40 ? 'is-dense' : buckets.length <= 10 ? 'is-sparse' : ''}`}
        role="img"
        aria-label={`${what} per ${view.unit}, ${buckets[0]?.title} to ${buckets[buckets.length - 1]?.title}`}
      >
        {buckets.map((b, i) => (
          <Bar key={b.key} bucket={b} metric={metric} scale={scale} hovered={hover === i} dayStart={perDay && i > 0 && i % 24 === 0} />
        ))}
      </div>
    </div>
  )
}

function Bar({ bucket, metric, scale, hovered, dayStart }: {
  bucket: HistoryBucket
  metric: HistoryMetric
  scale: number
  hovered: boolean
  dayStart: boolean
}) {
  const split = STACK.map((p) => bucket.providers[p]?.[metric] ?? 0)
  // What no provider accounts for (a legacy day); rounding crumbs are not a segment.
  const rest = bucket[metric] - split.reduce((sum, v) => sum + v, 0)
  const other = rest > bucket[metric] * 0.005 ? rest : 0
  const cls = ['hist-bar', bucket.current && 'is-current', bucket.future && 'is-future', hovered && 'is-hover', dayStart && 'is-daystart']
    .filter(Boolean).join(' ')
  return (
    <span className={cls} title={bucket.future ? undefined : `${bucket.title}: ${compactNumber(bucket.tokens)} tokens · ~${usd(bucket.value)}`}>
      {STACK.map((p, i) => split[i] > 0 && <span key={p} className={`hist-seg is-${p}`} style={{ height: `${split[i] * scale}%` }} />)}
      {other > 0 && <span className="hist-seg is-other" style={{ height: `${other * scale}%` }} />}
    </span>
  )
}

/** What the bar chart's legend says: the range's totals, or the hovered bucket's. */
export function ProviderLegend({ view, bucket }: { view: HistoryView; bucket: HistoryBucket | null }) {
  const source = bucket ? bucket.providers : view.totals.byProvider
  const shown = STACK.filter((p) => view.totals.byProvider[p])
  if (shown.length === 0) return null
  return (
    <div className="hist-providers">
      {shown.map((p) => (
        <span key={p} className="hist-prov">
          <span className={`hist-swatch is-${p}`} />
          {PROVIDER_NAME[p]} · {compactNumber(source[p]?.tokens ?? 0)} · ~{usd(source[p]?.value ?? 0)}
        </span>
      ))}
    </div>
  )
}

/**
 * The running total of this period against the one before, on the bar chart's
 * x axis. This period stops at now; the earlier one runs its full length, so
 * the gap between the two lines is how far ahead or behind you are.
 */
export function PaceChart({ view, metric, hover, onHover }: {
  view: HistoryView
  metric: HistoryMetric
  hover: number | null
  onHover: (index: number | null) => void
}) {
  const n = view.buckets.length
  const { current, previous } = view.pace[metric]
  const top = niceCeil(Math.max(current[current.length - 1] ?? 0, previous?.[previous.length - 1] ?? 0))
  if (top <= 0 || n === 0) return null
  const x = (i: number) => ((i + 0.5) / n) * 100
  const y = (v: number) => 100 - (v / top) * 100
  const line = (values: number[]) => values.map((v, i) => `${x(i).toFixed(2)},${y(v).toFixed(2)}`).join(' ')
  const end = current.length - 1
  return (
    <div
      className="hist-plot hist-plot--line"
      onPointerMove={(e) => {
        const i = bucketAt(e, n)
        onHover(i >= 0 ? i : null)
      }}
      onPointerLeave={() => onHover(null)}
    >
      <Gridlines metric={metric} top={top} />
      <svg className="hist-line" viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label={`Running total of ${metric === 'tokens' ? 'tokens out' : 'estimated value'}`}>
        {previous && <polyline className="hist-line-prev" points={line(previous)} />}
        {end >= 0 && <polygon className="hist-line-wash" points={`${x(0).toFixed(2)},100 ${line(current)} ${x(end).toFixed(2)},100`} />}
        {end >= 0 && <polyline className="hist-line-now" points={line(current)} />}
      </svg>
      {hover !== null && <span className="hist-cross" style={{ left: `${x(hover)}%` }} />}
      {end >= 0 && <span className="hist-dot" style={{ left: `${x(end)}%`, top: `${y(current[end])}%` }} />}
    </div>
  )
}

export function LineLegend({ now, before }: { now: string; before: string }) {
  return (
    <div className="hist-providers">
      <span className="hist-prov"><span className="hist-key is-now" />{now}</span>
      <span className="hist-prov"><span className="hist-key is-prev" />{before}</span>
    </div>
  )
}

export interface BreakdownRow {
  name: string
  title?: string
  /** 0–1: how much of the track is filled. */
  fill: number
  cells: ReactNode[]
}

/** A titled list of labelled bars — models, projects, weekdays. */
export function Breakdown({ title, note, rows, wide }: { title: string; note?: ReactNode; rows: BreakdownRow[]; wide?: boolean }) {
  if (rows.length === 0) return null
  return (
    <div className="hist-mix">
      <div className="hist-mix-head">
        <span>{title}</span>
        {note}
      </div>
      {rows.map((r) => (
        <div className={`hist-mix-row ${wide ? '' : 'is-short'}`} key={r.name} title={r.title ?? r.name}>
          <span className="hist-mix-name">{r.name}</span>
          <span className="hist-mix-track"><span className="hist-mix-fill" style={{ width: `${Math.max(r.fill > 0 ? 1 : 0, r.fill * 100)}%` }} /></span>
          {r.cells.map((cell, i) => <span key={i} className={i === r.cells.length - 1 && wide ? 'hist-mix-pct' : 'hist-mix-num'}>{cell}</span>)}
        </div>
      ))}
    </div>
  )
}

/** Share rows (models, projects): top six, the rest folded into one line. */
export function shareRows(rows: { name: string; title?: string; tokens: number; value: number; valueComplete: boolean; share: number }[]): BreakdownRow[] {
  const TOP = 6
  const head = rows.slice(0, TOP)
  const tail = rows.slice(TOP)
  const folded = tail.length > 0 ? [{
    name: `${tail.length} more`,
    title: tail.map((r) => r.name).join(', '),
    tokens: tail.reduce((sum, r) => sum + r.tokens, 0),
    value: tail.reduce((sum, r) => sum + r.value, 0),
    valueComplete: tail.every((r) => r.valueComplete),
    share: tail.reduce((sum, r) => sum + r.share, 0)
  }] : []
  return [...head, ...folded].map((r) => ({
    name: r.name,
    title: r.title,
    fill: r.share,
    cells: [compactNumber(r.tokens), `~${usd(r.value)}${r.valueComplete ? '' : '*'}`, `${Math.round(r.share * 100)}%`]
  }))
}

/** The average day of each weekday, Monday first so the weekend sits together. */
export function weekdayRows(profile: WeekdayRow[], metric: HistoryMetric): BreakdownRow[] {
  const avg = (r: WeekdayRow) => (metric === 'tokens' ? r.avgTokens : r.avgValue)
  const max = profile.reduce((m, r) => Math.max(m, avg(r)), 0)
  return [...profile.slice(1), profile[0]].map((r) => ({
    name: r.label,
    title: `${r.label}: ${fmt(metric, avg(r))} a day on average over ${r.days} ${r.days === 1 ? 'day' : 'days'}`,
    fill: max > 0 ? avg(r) / max : 0,
    cells: [fmt(metric, avg(r))]
  }))
}

const DAY_LABELS = ['', 'Mon', '', 'Wed', '', 'Fri', '']

/** A year of days at most, one square each: where the busy weeks and the gaps are. */
export function CalendarHeat({ grid, metric }: { grid: CalendarGrid; metric: HistoryMetric }) {
  const scroller = useRef<HTMLDivElement>(null)
  const [over, setOver] = useState<string | null>(null)
  // The newest weeks are the ones you came for: start scrolled to them.
  useLayoutEffect(() => {
    const el = scroller.current
    if (el) el.scrollLeft = el.scrollWidth
  }, [grid.weeks.length])
  // A month that starts in the last column or two has no room for its name.
  const months = grid.months.filter((m, i) => {
    const next = grid.months[i + 1]
    return next ? next.week - m.week >= 3 : grid.weeks.length - m.week >= 2
  })
  const scale = grid.scale[metric]
  return (
    <div className="hist-mix">
      <div className="hist-mix-head">
        <span>Calendar</span>
        <span className="hist-readout">{over ?? 'each square is a day'}</span>
      </div>
      <div className="hist-cal">
        <div className="hist-cal-days" aria-hidden="true">{DAY_LABELS.map((d, i) => <span key={i}>{d}</span>)}</div>
        <div className="hist-cal-scroll" ref={scroller}>
          <div className="hist-cal-months" style={{ gridTemplateColumns: `repeat(${grid.weeks.length}, var(--cal-cell))` }} aria-hidden="true">
            {months.map((m) => <span key={m.week} style={{ gridColumn: m.week + 1 }}>{m.label}</span>)}
          </div>
          <div className="hist-cal-grid" role="img" aria-label={`Daily ${metric === 'tokens' ? 'tokens out' : 'estimated value'} since ${grid.since}`} onPointerLeave={() => setOver(null)}>
            {grid.weeks.map((week, w) => week.map((cell, d) => cell
              ? (
                <span
                  key={cell.date}
                  className={`hist-cell lv-${heatLevel(cell[metric], scale)}`}
                  title={`${cell.title}: ${compactNumber(cell.tokens)} tokens · ~${usd(cell.value)}`}
                  onPointerEnter={() => setOver(`${cell.title} · ${compactNumber(cell.tokens)} · ~${usd(cell.value)}`)}
                />
              )
              : <span key={`${w}:${d}`} className="hist-cell is-out" />))}
          </div>
        </div>
      </div>
      <div className="hist-cal-scale" aria-hidden="true">
        <span>Less</span>
        {[0, 1, 2, 3, 4].map((lv) => <span key={lv} className={`hist-cell lv-${lv}`} />)}
        <span>More</span>
      </div>
    </div>
  )
}
