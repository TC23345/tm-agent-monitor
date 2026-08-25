import { ChartColumn, Coins, History } from 'lucide-react'
import type { UsageSummary } from '@shared/types'
import { SpendView } from './SpendView'
import { UsageInsightsView } from './UsageInsightsView'
import { HistorySection } from './HistorySection'

/**
 * The Usage pane: today's spend, then local usage insights, as one scrolling
 * column (the `.gpane-body` scrolls). Both views are reused untouched — Spend
 * needs the status snapshot, Insights owns its own visibility-gated poll — so
 * this is only the frame that stacks them. `usage` is undefined until the
 * first snapshot lands.
 */
export function UsagePane({ usage }: { usage: UsageSummary | undefined }) {
  return (
    <div className="usagepane">
      <section className="usagepane-section">
        <div className="usagepane-head">
          <Coins className="gpane-ic" strokeWidth={2} />
          <span className="titletype">Spend</span>
        </div>
        {usage ? <SpendView usage={usage} /> : <div className="empty">Connecting…</div>}
      </section>
      <section className="usagepane-section">
        <div className="usagepane-head">
          <ChartColumn className="gpane-ic" strokeWidth={2} />
          <span className="titletype">Insights</span>
        </div>
        <UsageInsightsView />
      </section>
      <section className="usagepane-section">
        <div className="usagepane-head">
          <History className="gpane-ic" strokeWidth={2} />
          <span className="titletype">History</span>
        </div>
        <HistorySection />
      </section>
    </div>
  )
}
