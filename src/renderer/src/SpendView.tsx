import type { UsageAccount, UsageSummary } from '@shared/types'
import { compactNumber, money } from './format'
import { PROVIDER_NAME, ProviderDot, QuotaBar, byProvider, hasSpendDetail, zoneLabel } from './usageShared'

/**
 * Today's tokens and value, broken out per provider and per project. Split out
 * of the top usage block so that block can stay focused on limit bars.
 * Estimated API-equivalent value and actual organization spend stay separate —
 * they are never summed together.
 */
function AccountSpend({ account }: { account: UsageAccount }) {
  const byProject = account.todayByProject ?? []
  const prefix = account.actualSpend ? '' : '~'
  const suffix = account.valueComplete === false ? ' partial' : ''
  return (
    <div className="spend-zone">
      <div className="spend-row">
        <span className="spend-name">{zoneLabel(account.label)}</span>
        <span className="spend-total">
          {account.todayTokensOut !== undefined ? `${compactNumber(account.todayTokensOut)} tokens out` : '—'}
          {account.todayCostUsd !== undefined && ` · ${prefix}${money(account.todayCostUsd)}${suffix}`}
        </span>
      </div>
      {byProject.length > 0 && (
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
      {account.budget && <QuotaBar q={account.budget} hint="Actual spend against configured budget" />}
    </div>
  )
}

export function SpendView({ usage }: { usage: UsageSummary }) {
  const groups = byProvider(usage.accounts)
    .map((group) => ({ ...group, accounts: group.accounts.filter(hasSpendDetail) }))
    .filter((group) => group.accounts.length > 0)

  const shown = groups.flatMap((g) => g.accounts)
  const tokens = shown.reduce((sum, a) => sum + (a.todayTokensOut ?? 0), 0)
  const estimated = shown.filter((a) => !a.actualSpend).reduce((sum, a) => sum + (a.todayCostUsd ?? 0), 0)
  const actual = shown.filter((a) => a.actualSpend).reduce((sum, a) => sum + (a.todayCostUsd ?? 0), 0)

  if (groups.length === 0) return <div className="empty">No usage recorded today.</div>

  return (
    <div className="spend">
      <div className="spend-head">
        <span className="spend-head-label">Today</span>
        <span className="spend-head-total">
          {compactNumber(tokens)} tokens out · ~{money(estimated)}
          {actual > 0 && ` · ${money(actual)} API`}
        </span>
      </div>
      {groups.map((group) => (
        <div className="spend-prov" key={group.provider}>
          <div className="spend-prov-head">
            <ProviderDot provider={group.provider} />
            <span className="titletype">{PROVIDER_NAME[group.provider]}</span>
          </div>
          {group.accounts.map((account) => (
            <AccountSpend key={account.id} account={account} />
          ))}
        </div>
      ))}
      <p className="spend-foot">
        Estimated API-equivalent value (~) is not subscription billing. Actual organization spend is shown separately.
        A <span className="spend-star">*</span> marks a partial estimate — some messages used models with no known price.
      </p>
    </div>
  )
}
