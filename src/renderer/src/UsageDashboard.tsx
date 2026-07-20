import { Fragment } from 'react'
import type { ProviderId, UsageAccount, UsageSummary } from '@shared/types'
import { clockTime } from './format'
import { PROVIDER_NAME, ProviderBadge, QuotaBar, byProvider } from './usageShared'

/**
 * The at-a-glance block: limit bars only, one stack per provider, and nothing
 * collapsible. Token counts, per-project breakdowns, and actual spend live in
 * the spend view, so this stays focused on "how close am I to a ceiling now".
 * `budget` is deliberately excluded — it measures spend, not a usage ceiling.
 */
function limitCount(account: UsageAccount): number {
  return (account.session ? 1 : 0) + (account.week ? 1 : 0) + (account.quotas?.length ?? 0)
}

function ProviderLimits({ provider, accounts, now }: { provider: ProviderId; accounts: UsageAccount[]; now: number }) {
  const total = accounts.reduce((sum, account) => sum + limitCount(account), 0)
  // Nothing to plot: surface why, preferring a provider-supplied note.
  const note = accounts.find((a) => !a.available)?.note ?? 'no limits reported'
  return (
    <div className="ulim">
      <div className="ulim-head" title={`${PROVIDER_NAME[provider]} usage limits`}>
        <ProviderBadge provider={provider} />
        <span className="ulim-label">{PROVIDER_NAME[provider]}</span>
      </div>
      {total === 0 ? (
        <div className="uzone-note">{note}</div>
      ) : (
        accounts.map((account) => (
          <Fragment key={account.id}>
            {account.session && <QuotaBar q={account.session} now={now} hint="Provider session usage window" />}
            {account.projectedLimitAt !== undefined && (
              <div className={`pace sev-${account.session?.severity === 'critical' ? 'critical' : 'warning'}`}>
                on pace to hit the limit ~{clockTime(account.projectedLimitAt)}
              </div>
            )}
            {account.week && <QuotaBar q={account.week} now={now} hint="Provider weekly usage window" />}
            {account.quotas?.map((quota) => (
              <QuotaBar key={`${quota.label}:${quota.resetsAt}`} q={quota} now={now} hint="Provider-scoped usage window" />
            ))}
          </Fragment>
        ))
      )}
    </div>
  )
}

export function UsageDashboard({ usage, now }: { usage: UsageSummary; now: number }) {
  return (
    <section className="usage">
      {byProvider(usage.accounts).map((group) => (
        <ProviderLimits key={group.provider} provider={group.provider} accounts={group.accounts} now={now} />
      ))}
    </section>
  )
}
