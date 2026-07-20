import type { ProviderId, Quota, UsageAccount, UsageSummary } from '@shared/types'
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

// The group header already names the provider, so a leading "Claude "/"Codex "
// in the zone label is redundant ("Codex local · Team" → "local · Team"). Left
// alone if stripping would empty the label, so an unexpected label still shows.
const PROVIDER_PREFIX = /^(claude|codex)\s+/i
function zoneLabel(label: string): string {
  const stripped = label.replace(PROVIDER_PREFIX, '').trim()
  return stripped.length > 0 ? stripped : label
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
        <span className="uzone-label">{zoneLabel(account.label)}</span>
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

function summaryLine(accounts: UsageAccount[]): string {
  const tokens = accounts.reduce((sum, account) => sum + (account.todayTokensOut ?? 0), 0)
  const value = accounts.filter((account) => !account.actualSpend).reduce((sum, account) => sum + (account.todayCostUsd ?? 0), 0)
  return `${compactNumber(tokens)} out · ~${money(value)}`
}

// Providers render in a fixed order, and their zones always read plan → local →
// API spend, so Claude and Codex line up row-for-row instead of appearing in
// whatever order the accounts were discovered in.
const PROVIDER_ORDER: ProviderId[] = ['claude', 'codex']
const PROVIDER_NAME: Record<ProviderId, string> = { claude: 'Claude Code', codex: 'Codex' }
const KIND_ORDER: Record<UsageAccount['kind'], number> = { subscription: 0, local: 1, api: 2 }

function ProviderGroup({ provider, accounts, now }: { provider: ProviderId; accounts: UsageAccount[]; now: number }) {
  const [collapsed, toggle] = useCollapse(`usage.provider.${provider}`, false)
  const Chevron = collapsed ? ChevronRight : ChevronDown
  const zones = [...accounts].sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind])
  return (
    <div className="uprov">
      <button className="uprov-toggle" onClick={toggle} title={`${PROVIDER_NAME[provider]} usage across plan, local ledger, and API spend`}>
        <Chevron className="uprov-chevron" strokeWidth={2.5} />
        <span className={`provider-badge provider-badge--${provider}`}>{provider === 'claude' ? 'C' : 'X'}</span>
        <span className="uprov-label">{PROVIDER_NAME[provider]}</span>
        {collapsed && <span className="uprov-summary">{summaryLine(zones)}</span>}
      </button>
      {!collapsed && (
        <div className="uprov-body">
          {zones.map((account) => <AccountZone key={account.id} account={account} now={now} />)}
        </div>
      )}
    </div>
  )
}

export function UsageDashboard({ usage, now }: { usage: UsageSummary; now: number }) {
  const [collapsed, toggle] = useCollapse('usage', false)
  const Chevron = collapsed ? ChevronRight : ChevronDown
  // A provider with no accounts at all is omitted rather than shown as empty.
  const groups = PROVIDER_ORDER
    .map((provider) => ({ provider, accounts: usage.accounts.filter((a) => a.provider === provider) }))
    .filter((g) => g.accounts.length > 0)
  return (
    <section className="usage">
      <button className="usage-toggle" onClick={toggle} title="Provider usage, local tokens, and API-equivalent value">
        <Chevron className="usage-chevron" strokeWidth={2.5} />
        <span className="usage-title">Usage</span>
        {collapsed && <span className="usage-summary">{summaryLine(usage.accounts)}</span>}
      </button>
      {!collapsed && (
        <div className="usage-body">
          {groups.map((g) => <ProviderGroup key={g.provider} provider={g.provider} accounts={g.accounts} now={now} />)}
        </div>
      )}
    </section>
  )
}
