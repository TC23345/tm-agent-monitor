import { useEffect, useState } from 'react'
import type { DailyUsageDay } from '@shared/types'
import { historySeries, modelMix, dayKey, type HistoryDay } from '@shared/history.mjs'
import { compactNumber, modelShort, money } from './format'
import { PROVIDER_NAME } from './usageShared'

const REFRESH_MS = 5 * 60_000
const DAYS = 30

/**
 * Thirty days of tokens and value per provider, then the model mix — the
 * history the app has always written and never drawn. Polls `history:recent`
 * every five minutes while visible (the Mongo read is cheap; the live-day
 * overlay is what keeps today current).
 */
export function HistorySection() {
  const [days, setDays] = useState<DailyUsageDay[] | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let alive = true
    let timer: number | null = null
    const load = () => window.watch.getHistory()
      .then((list) => { if (alive) { setDays(list); setFailed(false) } })
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
  }, [])

  if (failed) return <div className="empty">History is unavailable right now.</div>
  if (!days) return <div className="empty">Loading history…</div>

  const series = historySeries(days, { count: DAYS })
  const today = dayKey()
  const monthMix = modelMix(days, { since: series.days[0]?.date })
  const todayMix = modelMix(days, { since: today })
  const { totals } = series
  const providers = Object.entries(totals.byProvider) as [keyof typeof PROVIDER_NAME, { tokens: number; value: number }][]

  return (
    <div className="hist" data-testid="history-section">
      <div className="hist-summary">
        <span className="hist-summary-label">Last {DAYS} days · {totals.recordedDays} with activity</span>
        <span className="hist-summary-total">
          {compactNumber(totals.tokens)} tokens out · ~{money(totals.value)}
          {totals.apiValue > 0 && ` · ${money(totals.apiValue)} API`}
        </span>
      </div>
      <div className="hist-bars" role="img" aria-label={`Daily tokens over the last ${DAYS} days`}>
        {series.days.map((d) => <Bar key={d.date} day={d} max={series.maxTokens} today={d.date === today} />)}
      </div>
      <div className="hist-axis">
        <span>{series.days[0]?.date.slice(5)}</span>
        <span>{series.days[Math.floor(series.days.length / 2)]?.date.slice(5)}</span>
        <span>today</span>
      </div>
      {providers.length > 0 && (
        <div className="hist-providers">
          {providers.map(([p, t]) => (
            <span key={p} className="hist-prov">
              <span className={`hist-swatch is-${p}`} />
              {PROVIDER_NAME[p] ?? p} · {compactNumber(t.tokens)} · ~{money(t.value)}
            </span>
          ))}
        </div>
      )}
      <Mix title="Models · today" rows={todayMix} />
      <Mix title={`Models · ${DAYS} days`} rows={monthMix} />
    </div>
  )
}

function Bar({ day, max, today }: { day: HistoryDay; max: number; today: boolean }) {
  const scale = max > 0 ? 100 / max : 0
  const claude = day.providers.claude?.tokens ?? 0
  const codex = day.providers.codex?.tokens ?? 0
  const other = Math.max(0, day.tokens - claude - codex)
  const title = day.recorded
    ? `${day.date}: ${compactNumber(day.tokens)} tokens · ~${money(day.value)}${day.valueComplete ? '' : ' (partial)'}${day.apiValue ? ` · ${money(day.apiValue)} API` : ''}`
    : `${day.date}: no activity recorded`
  return (
    <span className={`hist-bar ${today ? 'is-today' : ''} ${day.recorded ? '' : 'is-empty'}`} title={title}>
      <span className="hist-seg is-codex" style={{ height: `${codex * scale}%` }} />
      <span className="hist-seg is-claude" style={{ height: `${claude * scale}%` }} />
      {other > 0 && <span className="hist-seg is-other" style={{ height: `${other * scale}%` }} />}
    </span>
  )
}

function Mix({ title, rows }: { title: string; rows: ReturnType<typeof modelMix> }) {
  if (rows.length === 0) return null
  const top = rows[0]
  return (
    <div className="hist-mix">
      <div className="hist-mix-head">
        <span>{title}</span>
        {top.share >= 0.7 && rows.length > 1 && (
          <span className="hist-mix-flag" title="One model carries most of the estimated value — worth checking it is the intended one">
            {Math.round(top.share * 100)}% on {modelShort(top.model) ?? top.model}
          </span>
        )}
      </div>
      {rows.slice(0, 6).map((r) => (
        <div className="hist-mix-row" key={r.model} title={r.model}>
          <span className="hist-mix-name">{modelShort(r.model) ?? r.model}</span>
          <span className="hist-mix-track"><span className="hist-mix-fill" style={{ width: `${Math.max(1, r.share * 100)}%` }} /></span>
          <span className="hist-mix-num">{compactNumber(r.tokens)}</span>
          <span className="hist-mix-num">~{money(r.value)}{r.valueComplete ? '' : '*'}</span>
          <span className="hist-mix-pct">{Math.round(r.share * 100)}%</span>
        </div>
      ))}
    </div>
  )
}
