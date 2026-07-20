import type { Quota, UsageAccount, UsageSummary } from '@shared/types'
import { clockTime, compactNumber, money, resetsIn } from './format'
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
      <div className="quota-track"><div className={`quota-fill quota-fill--${q.tone} sev-${sev}`} style={{ width: `${Math.min(100, q.usedPct)}%` }} /></div>
    </div>
  )
}

function AccountZone({ account, now }: { account: UsageAccount; now: number }) {
  const [collapsed, toggle] = useCollapse(`usage.${account.id}`, account.kind === 'api')
  const [projectsCollapsed, toggleProjects] = useCollapse(`usage.${account.id}.projects`, true)
  const Chevron = collapsed ? ChevronRight : ChevronDown
  const ProjectChevron = projectsCollapsed ? ChevronRight : ChevronDown
  const byProject = account.todayByProject ?? []
  const valuePrefix = account.actualSpend ? '' : '~'
  const valueSuffix = account.valueComplete === false ? ' partial' : ''
  const summary = [
    account.todayTokensOut !== undefined ? `${compactNumber(account.todayTokensOut)} out` : undefined,
    account.todayCostUsd !== undefined ? `${valuePrefix}${money(account.todayCostUsd)}${valueSuffix}` : undefined
  ].filter(Boolean).join(' · ')

  return (
    <div className="uzone">
      <button className="uzone-toggle" onClick={toggle} title={`${account.provider} usage · ${account.provenance ?? 'unknown'} provenance`}>
        <Chevron className="uzone-chevron" strokeWidth={2} />
        <span className={`provider-badge provider-badge--${account.provider}`}>{account.provider === 'claude' ? 'C' : 'X'}</span>
        <span className="uzone-label">{account.label}</span>
        {collapsed && <span className="uzone-summary">{summary || account.note || 'unavailable'}</span>}
      </button>
      {!collapsed && (
        <>
          {account.available ? (
            <>
              {account.session && <QuotaBar q={account.session} now={now} hint="Provider session usage window" />}
              {account.projectedLimitAt !== undefined && (
                <div className={`pace sev-${account.session?.severity === 'critical' ? 'critical' : 'warning'}`}>
                  on pace to hit the limit ~{clockTime(account.projectedLimitAt)}
                </div>
              )}
              {account.week && <QuotaBar q={account.week} now={now} hint="Provider weekly usage window" />}
              {account.quotas?.map((quota) => <QuotaBar key={`${quota.label}:${quota.resetsAt}`} q={quota} now={now} hint="Provider-scoped usage window" />)}
              {account.todayTokensOut !== undefined && (
                <>
                  <button className="today today--toggle" onClick={toggleProjects} disabled={byProject.length === 0}>
                    <span className="today-label">{byProject.length > 0 && <ProjectChevron className="today-chevron" strokeWidth={2} />}Today</span>
                    <span className="today-val">
                      {compactNumber(account.todayTokensOut)} tokens out
                      {account.todayCostUsd !== undefined && ` · ${valuePrefix}${money(account.todayCostUsd)}${valueSuffix}`}
                    </span>
                  </button>
                  {!projectsCollapsed && byProject.length > 0 && (
                    <div className="today-projects">
                      {byProject.map((p) => (
                        <div className="tproj" key={p.project}>
                          <span className="tproj-name">{p.project}</span>
                          <span className="tproj-tokens">{compactNumber(p.tokensOut)}</span>
                          <span className="tproj-cost">~{money(p.costUsd)}{p.valueComplete === false ? '*' : ''}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
              {account.budget && <QuotaBar q={account.budget} now={now} hint="Actual spend against configured budget" />}
            </>
          ) : <div className="uzone-note">{account.note ?? 'unavailable'}</div>}
        </>
      )}
    </div>
  )
}

function summaryLine(usage: UsageSummary): string {
  const tokens = usage.accounts.reduce((sum, account) => sum + (account.todayTokensOut ?? 0), 0)
  const value = usage.accounts.filter((account) => !account.actualSpend).reduce((sum, account) => sum + (account.todayCostUsd ?? 0), 0)
  return `${compactNumber(tokens)} out · ~${money(value)}`
}

export function UsageDashboard({ usage, now }: { usage: UsageSummary; now: number }) {
  const [collapsed, toggle] = useCollapse('usage', false)
  const Chevron = collapsed ? ChevronRight : ChevronDown
  return (
    <section className="usage">
      <button className="usage-toggle" onClick={toggle} title="Provider usage, local tokens, and API-equivalent value">
        <Chevron className="usage-chevron" strokeWidth={2.5} />
        <span className="usage-title">Usage</span>
        {collapsed && <span className="usage-summary">{summaryLine(usage)}</span>}
      </button>
      {!collapsed && <div className="usage-body">{usage.accounts.map((account) => <AccountZone key={account.id} account={account} now={now} />)}</div>}
    </section>
  )
}
