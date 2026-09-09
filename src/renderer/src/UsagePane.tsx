import type { UsageSummary } from '@shared/types'
import { SpendView } from './SpendView'
import { UsageInsightsView } from './UsageInsightsView'
import { HistorySection } from './HistorySection'

/**
 * The three usage panes — Spend, Insights, History — each a unique pane kind
 * picked from the status bar's Panes popover. They used to be one stacked
 * Usage pane; as three, each can sit where it earns its space. The views are
 * reused untouched: Spend needs the status snapshot (`usage` is undefined
 * until the first one lands), Insights owns its own visibility-gated poll,
 * History is the only consumer of `getHistory()`. Uniqueness is what keeps a
 * second `UsageInsightsView` from doubling the local session scans.
 */
export function SpendPane({ usage }: { usage: UsageSummary | undefined }) {
  return (
    <div className="usagepane">
      <section className="usagepane-section">
        {usage ? <SpendView usage={usage} /> : <div className="empty">Connecting…</div>}
      </section>
    </div>
  )
}

export function InsightsPane() {
  return (
    <div className="usagepane">
      <section className="usagepane-section">
        <UsageInsightsView />
      </section>
    </div>
  )
}

export function HistoryPane() {
  return (
    <div className="usagepane">
      <section className="usagepane-section">
        <HistorySection />
      </section>
    </div>
  )
}
