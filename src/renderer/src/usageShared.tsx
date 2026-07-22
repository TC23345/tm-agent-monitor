import type { ProviderId, Quota, UsageAccount } from '@shared/types'
import { resetsIn } from './format'

// Providers render in a fixed order, and their accounts always read plan → local
// → API spend, so Claude and Codex line up row-for-row instead of appearing in
// whatever order they were discovered in.
export const PROVIDER_ORDER: ProviderId[] = ['claude', 'codex']
export const PROVIDER_NAME: Record<ProviderId, string> = { claude: 'Claude Code', codex: 'Codex' }
const KIND_ORDER: Record<UsageAccount['kind'], number> = { subscription: 0, local: 1, api: 2 }

export interface ProviderAccounts {
  provider: ProviderId
  accounts: UsageAccount[]
}

/** Accounts grouped by provider. A provider with no accounts is omitted. */
export function byProvider(accounts: UsageAccount[]): ProviderAccounts[] {
  return PROVIDER_ORDER
    .map((provider) => ({
      provider,
      accounts: accounts
        .filter((a) => a.provider === provider)
        .sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind])
    }))
    .filter((group) => group.accounts.length > 0)
}

// The provider header already names the provider, so a leading "Claude "/"Codex "
// in an account label is redundant ("Codex local · Team" → "local · Team"). Left
// alone if stripping would empty it, so an unexpected label still shows.
const PROVIDER_PREFIX = /^(claude|codex)\s+/i
export function zoneLabel(label: string): string {
  const stripped = label.replace(PROVIDER_PREFIX, '').trim()
  return stripped.length > 0 ? stripped : label
}

// Section headings carry a provider-coloured dot rather than the C/X letter
// badge: the heading already spells the provider out, so the letter was only
// repeating it. Row-level badges elsewhere still use the lettered variant,
// where there is no room to name the provider.
export function ProviderDot({ provider }: { provider: ProviderId }) {
  return <span className={`prov-dot prov-dot--${provider}`} aria-hidden="true" />
}

export function QuotaBar({ q, now, hint }: { q: Quota; now: number; hint?: string }) {
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

/** True when an account carries anything the spend view would show. */
export function hasSpendDetail(account: UsageAccount): boolean {
  return account.todayTokensOut !== undefined || account.todayCostUsd !== undefined || account.budget !== undefined
}
