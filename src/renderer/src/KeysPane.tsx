import { useEffect, useState } from 'react'
import type { AppSettings } from '@shared/types'
import { KeyLegend } from './KeyLegend'

/**
 * The Keys pane (unique kind `keys`, status bar → Panes, F1): the same legend
 * as Settings → Keyboard shortcuts → Legend, kept open beside the work. The
 * global chords come from settings — read on mount, when `refresh` changes
 * (App passes whether Settings is open, so closing it re-reads) and whenever
 * the workspace comes back into view.
 */
export function KeysPane({ refresh }: { refresh?: unknown }) {
  const [s, setS] = useState<AppSettings | null>(null)
  useEffect(() => {
    window.watch.getSettings().then(setS).catch(() => {})
  }, [refresh])
  useEffect(() => {
    const load = () => { window.watch.getSettings().then(setS).catch(() => {}) }
    const onVisible = () => { if (!document.hidden) load() }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', load)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', load)
    }
  }, [])
  return (
    <div className="pane-scroll keys-pane" data-testid="keys-pane">
      {s ? <KeyLegend shortcuts={s.shortcuts} pickerModifier={s.pickerFavoriteModifier} /> : <div className="empty">Loading…</div>}
    </div>
  )
}
