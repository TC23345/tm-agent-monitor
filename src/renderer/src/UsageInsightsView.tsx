import { useEffect, useState } from 'react'
import type { ProviderId, UsageInsightMetric, UsageInsightPeriod, UsageInsightRow, UsageInsights } from '@shared/types'
import { compactNumber } from './format'
import { ProviderBadge } from './ProviderBadge'

type PeriodKey = 'day' | 'week'

const METRIC_COPY: Record<UsageInsightMetric['id'], { title: string; detail: string }> = {
  'large-context': {
    title: 'of local token volume was at >150k context',
    detail: 'Longer contexts are more expensive even when cached. Compact mid-task, or start fresh when switching work.'
  },
  'subagent-heavy': {
    title: 'of local token volume came from sessions using subagents',
    detail: 'Each subagent runs its own requests. Spawn deliberately, and use a cheaper model for simpler delegated work.'
  },
  'long-running': {
    title: 'of local token volume came from sessions active for 8+ hours',
    detail: 'These are often background or loop sessions. Continuous usage can add up quickly, so make sure it is intentional.'
  }
}

function percent(value: number): string {
  if (value > 0 && value < 1) return '<1%'
  return `${Math.round(value)}%`
}

function ProviderBadges({ providers }: { providers: ProviderId[] }) {
  return (
    <span className="ins-provider-badges" aria-label={providers.join(' and ')}>
      {providers.map((provider) => (
        <ProviderBadge key={provider} provider={provider} />
      ))}
    </span>
  )
}

function Callout({ metric }: { metric: UsageInsightMetric }) {
  const copy = METRIC_COPY[metric.id]
  if (metric.usedPct <= 0) return null
  return (
    <div className="ins-callout">
      <div className="ins-callout-title"><strong>{percent(metric.usedPct)}</strong> {copy.title}</div>
      <div className="ins-callout-detail">{copy.detail}</div>
    </div>
  )
}

function Breakdown({ title, rows }: { title: string; rows: UsageInsightRow[] }) {
  if (rows.length === 0) return null
  return (
    <section className="ins-breakdown">
      <div className="ins-breakdown-head"><span>{title}</span><span>% of local tokens</span></div>
      {rows.map((row) => (
        <div className="ins-row" key={`${title}:${row.name}`}>
          <span className="ins-row-name"><ProviderBadges providers={row.providers} />{row.name}</span>
          <span className="ins-row-pct">{percent(row.usedPct)}</span>
        </div>
      ))}
    </section>
  )
}

function Period({ data, kind }: { data: UsageInsightPeriod; kind: PeriodKey }) {
  if (data.totalTokens <= 0) {
    return <div className="empty ins-empty">No local token events found for {kind === 'day' ? 'today' : 'the last 7 days'}.</div>
  }
  const topMcp = data.mcpServers[0]
  return (
    <>
      <div className="ins-period-summary">
        <span className="ins-period-label">{kind === 'day' ? 'Today' : 'Last 7 days'}</span>
        <strong>{compactNumber(data.totalTokens)} tokens · {data.sessions} {data.sessions === 1 ? 'session' : 'sessions'}</strong>
      </div>
      <div className="ins-provider-totals">
        {(['claude', 'codex', 'cursor'] as const).filter((provider) => (data.byProvider[provider] ?? 0) > 0).map((provider) => (
          <span key={provider}>
            <ProviderBadge provider={provider} />
            <span>{provider === 'claude' ? 'Claude' : provider === 'codex' ? 'Codex' : 'Cursor'} · {compactNumber(data.byProvider[provider] ?? 0)}</span>
          </span>
        ))}
      </div>
      <div className="ins-callouts">
        {data.metrics.map((metric) => <Callout key={metric.id} metric={metric} />)}
        {topMcp && topMcp.usedPct > 0 && (
          <div className="ins-callout">
            <div className="ins-callout-title"><strong>{percent(topMcp.usedPct)}</strong> of local token volume came from sessions using MCP server “{topMcp.name}”</div>
            <div className="ins-callout-detail">MCP results remain in context. Compact after large results, or disable servers you do not need.</div>
          </div>
        )}
      </div>
      <Breakdown title="Skills" rows={data.skills} />
      <Breakdown title="Subagents" rows={data.subagents} />
      <Breakdown title="MCP servers" rows={data.mcpServers} />
    </>
  )
}

export function UsageInsightsView() {
  const [insights, setInsights] = useState<UsageInsights | null>(null)
  const [period, setPeriod] = useState<PeriodKey>('day')

  // Mounting is the consumer gate (the section unmounts when hidden or rolled
  // up); visibility is the other half — a workspace hidden to the tray must
  // not keep re-scanning local sessions every 30s. Electron marks the
  // document hidden the moment the window hides.
  useEffect(() => {
    let alive = true
    let refresh: number | null = null
    const load = () => window.watch.getUsageInsights().then((value) => { if (alive) setInsights(value) }).catch(() => {})
    const start = () => {
      if (refresh !== null) return
      load()
      refresh = window.setInterval(load, 30_000)
    }
    const stop = () => {
      if (refresh === null) return
      window.clearInterval(refresh)
      refresh = null
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

  if (!insights) return <div className="empty">Analyzing local sessions…</div>
  return (
    <div className="insights">
      <div className="ins-heading">
        <div className="ins-title">Usage insights</div>
        <span className="ins-local">Local · Claude + Codex</span>
      </div>
      <div className="ins-section-title">What’s contributing to local usage?</div>
      <div className="ins-tabs" role="tablist" aria-label="Usage insights period">
        <button id="insights-day-tab" className={period === 'day' ? 'is-active' : ''} onClick={() => setPeriod('day')} role="tab" aria-controls="insights-panel" aria-selected={period === 'day'}>Day</button>
        <button id="insights-week-tab" className={period === 'week' ? 'is-active' : ''} onClick={() => setPeriod('week')} role="tab" aria-controls="insights-panel" aria-selected={period === 'week'}>Week</button>
      </div>
      <p className="ins-note">Approximate, based on local sessions from this machine. Characteristics overlap, so their percentages do not add to 100%.</p>
      {insights.note && <div className="uzone-note">{insights.note}</div>}
      <div id="insights-panel" role="tabpanel" aria-labelledby={`insights-${period}-tab`}>
        <Period data={insights[period]} kind={period} />
      </div>
    </div>
  )
}
