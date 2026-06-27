import type { Quota, UsageSummary } from '@shared/types'
import { compactNumber, resetsIn } from './format'

function QuotaBar({ q, now }: { q: Quota; now: number }) {
  const sev = q.severity ?? 'normal'
  return (
    <div className="quota">
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

function Zone({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="uzone">
      <div className="uzone-label">{title}</div>
      {children}
    </div>
  )
}

export function UsageDashboard({ usage, now }: { usage: UsageSummary; now: number }) {
  const { personal, org, api } = usage
  return (
    <section className="usage">
      <Zone title={personal.label}>
        {personal.available ? (
          <>
            {personal.session && <QuotaBar q={personal.session} now={now} />}
            {personal.week && <QuotaBar q={personal.week} now={now} />}
            {personal.todayTokensOut !== undefined && (
              <div className="today">
                <span className="today-label">Today</span>
                <span className="today-val">{compactNumber(personal.todayTokensOut)} tokens out</span>
              </div>
            )}
          </>
        ) : (
          <div className="uzone-note">{personal.note ?? 'not connected'}</div>
        )}
      </Zone>

      <Zone title={`${org.label} · Team`}>
        {org.available ? (
          <>
            {org.session && <QuotaBar q={org.session} now={now} />}
            {org.week && <QuotaBar q={org.week} now={now} />}
          </>
        ) : (
          <div className="uzone-note">{org.note ?? 'not connected'}</div>
        )}
      </Zone>

      <Zone title={`${api.label} · API`}>
        {api.available ? (
          <>
            <div className="today">
              <span className="today-label">Today</span>
              <span className="today-val">
                {compactNumber(api.todayTokensOut ?? 0)} tokens
                {api.todayCostUsd !== undefined ? ` · $${api.todayCostUsd.toFixed(2)}` : ''}
              </span>
            </div>
            {api.budget && <QuotaBar q={api.budget} now={now} />}
          </>
        ) : (
          <div className="uzone-note">no admin key</div>
        )}
      </Zone>
    </section>
  )
}
