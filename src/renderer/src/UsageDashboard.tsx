import type { UsageSummary } from '@shared/types'
import { compactNumber, resetsIn } from './format'

function QuotaBar({
  label, pct, resetsAt, tone, now
}: { label: string; pct: number; resetsAt: number | null; tone: 'amber' | 'blue'; now: number }) {
  const high = tone === 'amber' && pct >= 60
  return (
    <div className="quota">
      <div className="quota-head">
        <span className="quota-label">{label}</span>
        <span className="quota-reset">{resetsIn(resetsAt, now)}</span>
        <span className={`quota-pct ${high ? 'is-amber' : ''}`}>{Math.round(pct)}%</span>
      </div>
      <div className="quota-track">
        <div className={`quota-fill quota-fill--${tone}`} style={{ width: `${Math.min(100, pct)}%` }} />
      </div>
    </div>
  )
}

export function UsageDashboard({ usage, now }: { usage: UsageSummary; now: number }) {
  return (
    <section className="usage">
      {usage.session && (
        <>
          <QuotaBar label="Session" pct={usage.session.usedPct} resetsAt={usage.session.resetsAt} tone="amber" now={now} />
          {usage.etaToLimitMin !== undefined && (
            <div className="burn">~{usage.etaToLimitMin}m to limit</div>
          )}
        </>
      )}
      {usage.week && (
        <QuotaBar label="Week" pct={usage.week.usedPct} resetsAt={usage.week.resetsAt} tone="blue" now={now} />
      )}
      {usage.todayTokensOut !== undefined && (
        <div className="today">
          <span className="today-label">Today</span>
          <span className="today-val">{compactNumber(usage.todayTokensOut)} tokens out</span>
        </div>
      )}
    </section>
  )
}
