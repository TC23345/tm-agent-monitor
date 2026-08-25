import { useEffect, useState } from 'react'
import { BellRing, CheckCircle2, LogIn, LogOut, Shrink } from 'lucide-react'
import type { ActivityEvent, ProviderId } from '@shared/types'
import { ProviderBadge } from './ProviderBadge'
import { clockTime } from './format'
import { useNow } from './useNow'
import { tid } from './testid'

const REFRESH_MS = 5_000

const KIND: Record<ActivityEvent['kind'], { label: string; icon: typeof BellRing; cls: string }> = {
  waiting: { label: 'needs input', icon: BellRing, cls: 'is-waiting' },
  finished: { label: 'finished a turn', icon: CheckCircle2, cls: 'is-finished' },
  started: { label: 'session started', icon: LogIn, cls: 'is-started' },
  ended: { label: 'session ended', icon: LogOut, cls: 'is-ended' },
  compacted: { label: 'compacted context', icon: Shrink, cls: 'is-compacted' }
}

function relative(at: number, now: number): string {
  const s = Math.max(0, Math.round((now - at) / 1000))
  if (s < 60) return `${s}s ago`
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  return h < 48 ? `${h}h ago` : clockTime(at)
}

/**
 * The activity feed: attention events across every session, newest first —
 * questions asked, permissions requested, turns finished, sessions started
 * and ended, compactions. Rows jump to the session. A project filter turns
 * it into one session's timeline. Polled while visible; the ring lives in
 * the store, so this shows what happened before the pane was opened too.
 */
export function ActivityPane({ onFocusAgent }: { onFocusAgent: (id: string) => void }) {
  const [events, setEvents] = useState<ActivityEvent[] | null>(null)
  const [filter, setFilter] = useState<string | null>(null)
  const now = useNow()

  useEffect(() => {
    let alive = true
    let timer: number | null = null
    const load = () => window.watch.getEvents().then((list) => { if (alive) setEvents(list) }).catch(() => {})
    const start = () => {
      if (timer !== null) return
      load()
      timer = window.setInterval(load, REFRESH_MS)
    }
    const stop = () => {
      if (timer === null) return
      window.clearInterval(timer)
      timer = null
    }
    const onVisibility = () => (document.hidden ? stop() : start())
    if (!document.hidden) start()
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      alive = false
      stop()
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [])

  if (!events) return <div className="empty">Loading activity…</div>
  const projects = [...new Set(events.map((e) => e.project))].sort((a, b) => a.localeCompare(b))
  const shown = filter ? events.filter((e) => e.project === filter) : events
  return (
    <div className="feed" data-testid="activity-feed">
      <div className="feed-filters">
        <button className={`feed-chip ${filter === null ? 'is-active' : ''}`} onClick={() => setFilter(null)}>All</button>
        {projects.map((p) => (
          <button key={p} className={`feed-chip ${filter === p ? 'is-active' : ''}`} onClick={() => setFilter(filter === p ? null : p)} data-testid={tid('feed-filter', p)}>{p}</button>
        ))}
      </div>
      {shown.length === 0 && <div className="empty">Nothing yet — events appear here as sessions ask, finish, start, and end.</div>}
      {shown.map((e) => {
        const meta = KIND[e.kind]
        const Icon = meta.icon
        return (
          <button key={`${e.agentId}:${e.at}:${e.kind}`} className={`feed-row ${meta.cls}`} onClick={() => onFocusAgent(e.agentId)} title={`${e.project} · ${meta.label} · ${clockTime(e.at)}\nClick to focus this session`}>
            <Icon className="feed-ic" strokeWidth={2} />
            <ProviderBadge provider={e.provider as ProviderId} />
            <span className="feed-project">{e.project}</span>
            <span className="feed-text">{e.text ?? meta.label}</span>
            <span className="feed-when">{relative(e.at, now)}</span>
          </button>
        )
      })}
    </div>
  )
}
