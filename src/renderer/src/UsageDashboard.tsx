import type { Quota, UsageSummary } from '@shared/types'
import { compactNumber, resetsIn } from './format'
import { ChevronDown, ChevronRight } from './Icons'
import { useCollapse } from './useCollapse'

function QuotaBar({ q, now, hint }: { q: Quota; now: number; hint?: string }) {
  const sev = q.severity ?? 'normal'
  return (
    <div className="quota" title={hint}>
      <div className="quota-head">
        <span className="quota-label">{q.label}</span>
        <span className="quota-reset">{resetsIn(q.resetsAt, now)}</span>
        <span className={`quota-pct sev-${sev}`}>{Math.round(q.usedPct)}%</span>
      </div>
      <div className="quota-track">
        <div
          className={`quota-fill quota-fill--${q.tone} sev-${sev}`}
          style={{ width: `${Math.min(100, q.usedPct)}%` }}
        />
      </div>
    </div>
  )
}

/** A usage section. Pass `collapseKey` to make its label a collapse toggle. */
function Zone({
  title,
  hint,
  collapseKey,
  summary,
  children
}: {
  title: string
  hint?: string
  collapseKey?: string
  summary?: React.ReactNode
  children: React.ReactNode
}) {
  const [collapsed, toggle] = useCollapse(collapseKey ?? 'usage._fixed', false)
  const Chevron = collapsed ? ChevronRight : ChevronDown
  return (
    <div className="uzone">
      {collapseKey ? (
        <button className="uzone-toggle" onClick={toggle} title={hint}>
          <Chevron className="uzone-chevron" strokeWidth={2} />
          <span className="uzone-label">{title}</span>
          {collapsed && summary !== undefined && <span className="uzone-summary">{summary}</span>}
        </button>
      ) : (
        <div className="uzone-label" title={hint}>{title}</div>
      )}
      {(!collapseKey || !collapsed) && children}
    </div>
  )
}

function summaryLine(usage: UsageSummary): string {
  const p = usage.personal
  const parts: string[] = []
  if (p.session) parts.push(`5h ${Math.round(p.session.usedPct)}%`)
  if (p.week) parts.push(`wk ${Math.round(p.week.usedPct)}%`)
  if (p.todayTokensOut !== undefined) parts.push(`${compactNumber(p.todayTokensOut)} out`)
  return parts.join('   ·   ')
}

export function UsageDashboard({ usage, now }: { usage: UsageSummary; now: number }) {
  const [collapsed, toggle] = useCollapse('usage', false)
  const { personal, api } = usage
  const Chevron = collapsed ? ChevronRight : ChevronDown

  const apiSummary = api.available
    ? `${compactNumber(api.todayTokensOut ?? 0)} tokens${api.todayCostUsd !== undefined ? ` · $${api.todayCostUsd.toFixed(2)}` : ''}`
    : 'no admin key'

  return (
    <section className="usage">
      <button
        className="usage-toggle"
        onClick={toggle}
        title="Your plan usage and today's token totals — click to collapse/expand"
      >
        <Chevron className="usage-chevron" strokeWidth={2.5} />
        <span className="usage-title">Usage</span>
        {collapsed && <span className="usage-summary">{summaryLine(usage)}</span>}
      </button>

      {!collapsed && (
        <div className="usage-body">
          <Zone
            title={personal.label}
            hint="Your personal Claude Max subscription — powers all your Claude Code (terminal, VS Code, and the desktop app's Claude Code tab)"
          >
            {personal.available ? (
              <>
                {personal.session && (
                  <QuotaBar q={personal.session} now={now} hint="Your Max plan's 5-hour rolling usage limit — resets at the time shown" />
                )}
                {personal.week && (
                  <QuotaBar q={personal.week} now={now} hint="Your Max plan's weekly usage limit" />
                )}
                {personal.todayTokensOut !== undefined && (
                  <div className="today" title="Output tokens your Claude Code sessions produced today (summed from local transcripts)">
                    <span className="today-label">Today</span>
                    <span className="today-val">{compactNumber(personal.todayTokensOut)} tokens out</span>
                  </div>
                )}
              </>
            ) : (
              <div className="uzone-note">{personal.note ?? 'not connected'}</div>
            )}
          </Zone>

          <Zone
            title={`${api.label} · API`}
            hint="Your organization's API-key usage — pay-per-use, a separate account from your subscription (no 5-hour window) · click to collapse/expand"
            collapseKey="usage.api"
            summary={apiSummary}
          >
            {api.available ? (
              <>
                <div className="today" title="API tokens used today (and cost, if available) across the org's keys">
                  <span className="today-label">Today</span>
                  <span className="today-val">
                    {compactNumber(api.todayTokensOut ?? 0)} tokens
                    {api.todayCostUsd !== undefined ? ` · $${api.todayCostUsd.toFixed(2)}` : ''}
                  </span>
                </div>
                {api.budget && (
                  <QuotaBar q={api.budget} now={now} hint="Today's API spend vs your configured daily budget" />
                )}
              </>
            ) : (
              <div className="uzone-note">no admin key</div>
            )}
          </Zone>
        </div>
      )}
    </section>
  )
}
