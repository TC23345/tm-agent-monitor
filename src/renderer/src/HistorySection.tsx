import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { DailyUsageDay } from '@shared/types'
import {
  calendarWeeks, dateLabel, dayKey, deltaOf, historyView, hourLabel, modelMix, projectMix, rangeScope, readHistoryPrefs, weekdayProfile,
  HISTORY_METRICS, HISTORY_RANGES,
  type HistoryMetric, type HistoryRange, type HistoryScope, type HistoryView
} from '@shared/history.mjs'
import { compactNumber, modelShort } from './format'
import { tid } from './testid'
import { Axis, BarChart, Breakdown, CalendarHeat, LineLegend, PaceChart, ProviderLegend, fmt, shareRows, usd, weekdayRows } from './HistoryCharts'

const REFRESH_MS = 5 * 60_000
const PREFS_KEY = 'tm.history.v1'

const RANGE_LABEL: Record<HistoryRange, string> = { '1d': '1D', '3d': '3D', '7d': '7D', '30d': '30D', all: 'ALL' }
const RANGE_NAME: Record<HistoryRange, string> = { '1d': 'Today', '3d': 'Last 3 days', '7d': 'Last 7 days', '30d': 'Last 30 days', all: 'All time' }
const BEFORE_NAME: Record<HistoryRange, string> = { '1d': 'Yesterday', '3d': 'The 3 days before', '7d': 'The 7 days before', '30d': 'The 30 days before', all: '' }
const METRIC_LABEL: Record<HistoryMetric, string> = { tokens: 'Tokens', value: 'Value' }
const UNIT_NOUN = { hour: 'hour', day: 'day', week: 'week', month: 'month' } as const

function loadPrefs() {
  try { return readHistoryPrefs(window.localStorage.getItem(PREFS_KEY)) } catch { return readHistoryPrefs(null) }
}

interface Loaded {
  scope: HistoryScope
  days: DailyUsageDay[]
  /** When it was read: the view's "today" and "this hour" come from here. */
  at: number
}

/**
 * Usage over time behind one range filter — 1D and 3D by hour, 7D and 30D by
 * day, ALL by day, week or month — with every tile and chart below it drawn from
 * the same slice. Polls `history:recent` every five minutes while visible (the
 * Mongo read is cheap; the live-day overlay is what keeps today current), and
 * asks for the whole history only while ALL is selected.
 */
export function HistorySection() {
  const [prefs, setPrefs] = useState(loadPrefs)
  const [data, setData] = useState<Loaded | null>(null)
  const [failed, setFailed] = useState(false)
  const [hover, setHover] = useState<number | null>(null)
  const { range, metric } = prefs
  const scope = rangeScope(range)

  useEffect(() => {
    let alive = true
    let timer: number | null = null
    const load = () => window.watch.getHistory(scope)
      .then((days) => { if (alive) { setData({ scope, days, at: Date.now() }); setFailed(false) } })
      .catch(() => { if (alive) setFailed(true) })
    const start = () => {
      if (timer !== null) return
      load()
      timer = window.setInterval(load, REFRESH_MS)
    }
    const stop = () => {
      if (timer === null) return
      window.clearInterval(timer)
      timer = null
    }
    const onVisibility = () => (document.hidden ? stop() : start())
    if (!document.hidden) start()
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      alive = false
      stop()
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [scope])

  const choose = (patch: Partial<typeof prefs>) => {
    setPrefs((prev) => ({ ...prev, ...patch }))
    setHover(null)
  }
  useEffect(() => {
    try { window.localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)) } catch { /* the choice lasts this session */ }
  }, [prefs])

  const derived = useMemo(() => {
    if (!data) return null
    const now = new Date(data.at)
    const view = historyView(data.days, { range, today: dayKey(now), hour: now.getHours() })
    const span = { since: view.since, until: view.until }
    return {
      view,
      models: modelMix(data.days, span),
      projects: projectMix(data.days, span),
      // A typical week needs several of each weekday; over 7D it would only repeat the bars.
      weekdays: range === '30d' || range === 'all' ? weekdayProfile(data.days, span) : null,
      calendar: range === 'all' ? calendarWeeks(data.days, span) : null
    }
  }, [data, range])

  const filters = (
    <div className="hist-filters">
      <Segmented label="Range" kind="history-range" options={HISTORY_RANGES} names={RANGE_LABEL} titles={RANGE_NAME} value={range} onChange={(r) => choose({ range: r })} />
      <span className="hist-caption">{derived ? caption(derived.view) : ''}</span>
      <Segmented label="Measure" kind="history-metric" options={HISTORY_METRICS} names={METRIC_LABEL} value={metric} onChange={(m) => choose({ metric: m })} />
    </div>
  )

  if (!derived) {
    return (
      <div className="hist" data-testid="history-section">
        {filters}
        <div className="empty">{failed ? 'History is unavailable right now.' : 'Loading history…'}</div>
      </div>
    )
  }

  const { view, models, projects, weekdays, calendar } = derived
  const { totals } = view
  // ALL drawn from the recent read is a stand-in: hold it, dimmed, until the whole history lands.
  const stale = data!.scope !== scope && scope === 'all'
  const hovered = hover !== null ? view.buckets[hover] ?? null : null
  const hourlyMissing = view.unit === 'hour' && totals.tokens > 0 && totals.unplacedTokens >= totals.tokens
  const hourlyPartial = !hourlyMissing && totals.tokens > 0 && totals.unplacedTokens / totals.tokens > 0.01
  const pace = view.pace[metric]
  const paceEnd = pace.current.length - 1
  const top = models[0]

  return (
    <div className="hist" data-testid="history-section" data-range={range} data-unit={view.unit}>
      {filters}
      <div className={`hist-body ${stale ? 'is-stale' : ''}`}>
        <Tiles view={view} metric={metric} />

        {totals.tokens === 0 ? (
          <div className="empty">Nothing recorded {range === '1d' ? 'today yet' : range === 'all' ? 'yet' : `in the ${RANGE_NAME[range].toLowerCase()}`}.</div>
        ) : (
          <>
            <section className="hist-chart">
              <div className="hist-mix-head">
                <span>{metric === 'tokens' ? 'Tokens out' : 'Estimated value'} by {UNIT_NOUN[view.unit]}</span>
                <span className="hist-readout" data-testid="history-readout">
                  {hovered
                    ? `${hovered.title} · ${compactNumber(hovered.tokens)} · ~${usd(hovered.value)}${hovered.valueComplete ? '' : '*'}${hovered.apiValue > 0 ? ` · ${usd(hovered.apiValue)} API` : ''}`
                    : view.peak[metric] ? `Peak · ${view.peak[metric]!.title} · ${fmt(metric, view.peak[metric]![metric])}` : ''}
                </span>
              </div>
              {hourlyMissing ? (
                <div className="hist-note">No hourly detail for this period yet. It comes from the local transcripts, which only cover the last week.</div>
              ) : (
                <>
                  <BarChart view={view} metric={metric} hover={hover} onHover={setHover} />
                  <Axis view={view} />
                </>
              )}
              <ProviderLegend view={view} bucket={hourlyMissing ? null : hovered} />
              {hourlyPartial && (
                <div className="hist-note">{compactNumber(totals.unplacedTokens)} tokens in this period have no hourly detail, so they are counted above but not drawn.</div>
              )}
            </section>

            {!hourlyMissing && paceEnd >= 0 && (
              <section className="hist-chart">
                <div className="hist-mix-head">
                  <span>Running total</span>
                  <span className="hist-readout">
                    {hover !== null && view.buckets[hover]
                      ? [
                          view.buckets[hover].title,
                          hover <= paceEnd ? fmt(metric, pace.current[hover]) : null,
                          pace.previous ? `${fmt(metric, pace.previous[hover] ?? 0)} before` : null
                        ].filter(Boolean).join(' · ')
                      : [
                          `${fmt(metric, pace.current[paceEnd])} so far`,
                          pace.previous ? `${fmt(metric, pace.previous[paceEnd] ?? 0)} at this point ${range === '1d' ? 'yesterday' : `in ${view.previous?.label ?? 'the period before'}`}` : null
                        ].filter(Boolean).join(' · ')}
                  </span>
                </div>
                <PaceChart view={view} metric={metric} hover={hover} onHover={setHover} />
                <Axis view={view} />
                {pace.previous && <LineLegend now={RANGE_NAME[range]} before={BEFORE_NAME[range]} />}
              </section>
            )}

            {calendar && <CalendarHeat grid={calendar} metric={metric} />}

            <div className="hist-cols">
              <Breakdown
                wide
                title="Projects"
                rows={shareRows(projects.map((r) => ({ ...r, name: r.project })))}
              />
              <Breakdown
                wide
                title="Models"
                note={top && top.share >= 0.7 && models.length > 1 && (
                  <span className="hist-mix-flag" title="One model carries most of the estimated value — worth checking it is the intended one">
                    {Math.round(top.share * 100)}% on {modelShort(top.model) ?? top.model}
                  </span>
                )}
                rows={shareRows(models.map((r) => ({ ...r, name: modelShort(r.model) ?? r.model, title: r.model })))}
              />
              {weekdays && (
                <Breakdown
                  title="Typical week"
                  note={<span className="hist-readout">average per day</span>}
                  rows={weekdayRows(weekdays, metric)}
                />
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

/** What the range covers and how it is cut, next to the filter. */
function caption(view: HistoryView): string {
  if (view.range === '1d') return `${dateLabel(view.until)}, by hour`
  if (view.range === '3d') return `${dateLabel(view.since)} – ${dateLabel(view.until)}, by hour`
  if (view.range !== 'all') return `${dateLabel(view.since)} – ${dateLabel(view.until)}, by day`
  return `Since ${dateLabel(view.since)} ${view.since.slice(0, 4)} · ${view.totals.days} days, by ${view.unit}`
}

function Segmented<T extends string>({ label, kind, options, names, titles, value, onChange }: {
  label: string
  kind: string
  options: readonly T[]
  names: Record<T, string>
  titles?: Record<T, string>
  value: T
  onChange: (next: T) => void
}) {
  return (
    <div className="hist-seg-group" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={o}
          type="button"
          role="radio"
          aria-checked={o === value}
          className={o === value ? 'is-active' : ''}
          title={titles?.[o]}
          data-testid={tid(kind, o)}
          onClick={() => { if (o !== value) onChange(o) }}
        >
          {names[o]}
        </button>
      ))}
    </div>
  )
}

/** The headline numbers for the range, each against the period before it. */
function Tiles({ view, metric }: { view: HistoryView; metric: HistoryMetric }) {
  const { totals, previous, active } = view
  const peak = view.peak[metric]
  const perActive = active.count > 0 ? (metric === 'tokens' ? totals.tokens : totals.value) / active.count : 0
  return (
    <div className="hist-tiles">
      <Tile label="Tokens out" value={compactNumber(totals.tokens)}>
        <Delta current={totals.tokens} previous={previous?.tokens} label={previous?.label} fallback={view.range === 'all' ? `since ${dateLabel(view.since)}` : 'nothing earlier to compare'} />
      </Tile>
      <Tile
        label="Estimated value"
        value={`~${usd(totals.value)}${totals.valueComplete ? '' : '*'}`}
        title={totals.valueComplete ? undefined : 'Some models in this period have no known price, so this is a partial estimate'}
      >
        <Delta current={totals.value} previous={previous?.value} label={previous?.label} fallback={view.range === 'all' ? `since ${dateLabel(view.since)}` : 'nothing earlier to compare'} />
      </Tile>
      {totals.apiValue > 0 && (
        <Tile label="API spend" value={usd(totals.apiValue)}>actual, billed to the organization</Tile>
      )}
      <Tile label={`Peak ${UNIT_NOUN[view.unit]}`} value={peak ? fmt(metric, peak[metric]) : '—'}>
        {peak ? (view.range === '1d' ? hourLabel(Number(peak.key.slice(11))) : peak.title) : 'no activity'}
      </Tile>
      <Tile label={`Active ${active.unit}s`} value={`${active.count} of ${active.of}`}>
        {active.count > 0 ? `${fmt(metric, perActive)} per active ${active.unit}` : 'no activity'}
      </Tile>
    </div>
  )
}

function Tile({ label, value, title, children }: { label: string; value: string; title?: string; children?: ReactNode }) {
  return (
    <div className="hist-tile" title={title}>
      <span className="hist-tile-label">{label}</span>
      <span className="hist-tile-value">{value}</span>
      <span className="hist-tile-sub">{children}</span>
    </div>
  )
}

/** Up or down against the period before. Direction only: more usage is neither good nor bad. */
function Delta({ current, previous, label, fallback }: { current: number; previous?: number; label?: string; fallback: string }) {
  const delta = previous === undefined ? null : deltaOf(current, previous)
  if (delta === null || !label) return <>{fallback}</>
  const pct = Math.abs(delta) * 100
  const text = pct >= 1000 ? '999%+' : `${pct >= 10 ? Math.round(pct) : pct.toFixed(1)}%`
  return <><span className="hist-delta">{delta >= 0 ? '▲' : '▼'} {text}</span> vs {label}</>
}
