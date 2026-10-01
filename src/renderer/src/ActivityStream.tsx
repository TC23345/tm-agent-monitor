import { useEffect, useState } from 'react'
import { BellRing, CheckCircle2, Clipboard, FilePen, LogIn, LogOut, Shrink } from 'lucide-react'
import type { ActivityEvent, ProviderId } from '@shared/types'
import { ProviderBadge } from './ProviderBadge'
import { clockTime } from './format'
import { useNow } from './useNow'

const REFRESH_MS = 4_000

const KIND: Record<ActivityEvent['kind'], { label: string; icon: typeof BellRing; cls: string }> = {
  waiting: { label: 'needs input', icon: BellRing, cls: 'is-waiting' },
  finished: { label: 'finished a turn', icon: CheckCircle2, cls: 'is-finished' },
  started: { label: 'session started', icon: LogIn, cls: 'is-started' },
  ended: { label: 'session ended', icon: LogOut, cls: 'is-ended' },
  compacted: { label: 'compacted context', icon: Shrink, cls: 'is-compacted' },
  clip: { label: 'put something on your clipboard', icon: Clipboard, cls: 'is-clip' },
  edited: { label: 'edited files', icon: FilePen, cls: 'is-edited' }
}

/** Two-to-four characters: the stream is a narrow column. */
function ago(at: number, now: number): string {
  const s = Math.max(0, Math.round((now - at) / 1000))
  if (s < 10) return 'now'
  if (s < 60) return `${s}s`
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.round(m / 60)
  return h < 24 ? `${h}h` : clockTime(at)
}

/**
 * The store's attention ring (`agent:events`), newest first — polled while
 * the workspace is visible, so it also holds what happened before it opened.
 * Unchanged polls keep the same array, so nothing downstream re-renders.
 */
export function useActivityEvents(): ActivityEvent[] | null {
  const [events, setEvents] = useState<ActivityEvent[] | null>(null)
  useEffect(() => {
    let alive = true
    let timer: number | null = null
    const load = () => window.watch.getEvents().then((list) => {
      if (!alive) return
      setEvents((prev) => {
        if (prev && prev.length === list.length && prev.every((e, i) => e.at === list[i].at && e.kind === list[i].kind && e.agentId === list[i].agentId && e.text === list[i].text)) return prev
        return list
      })
    }).catch(() => {})
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
  return events
}

/**
 * The activity stream under the project badges: what every session asked,
 * edited, finished, started and ended, newest first. A row jumps to its
 * session. Its height is the sidebar's to set (the splitter under it).
 */
export function ActivityStream({ events, height, onFocusAgent }: {
  events: ActivityEvent[] | null
  height: number
  onFocusAgent: (id: string) => void
}) {
  const now = useNow()
  return (
    <div className="stream" style={{ height }} data-testid="activity-stream" role="log" aria-label="Project activity">
      {!events && <div className="stream-empty">Loading activity…</div>}
      {events && events.length === 0 && <div className="stream-empty">Nothing yet — questions, edits and finished turns show up here.</div>}
      {events?.map((e) => {
        const meta = KIND[e.kind] ?? KIND.started
        const Icon = meta.icon
        const what = e.text ?? meta.label
        const files = e.kind === 'edited' && e.files?.length ? `\n${e.files.join(', ')}` : ''
        return (
          <button
            key={`${e.agentId}:${e.kind}:${e.at}`}
            className={`stream-row ${meta.cls}`}
            onClick={() => onFocusAgent(e.agentId)}
            title={`${e.cwd ?? e.project}\n${what} · ${clockTime(e.at)}${files}\nClick to go to this session`}
          >
            <Icon className="stream-ic" strokeWidth={2} />
            <ProviderBadge provider={e.provider as ProviderId} />
            <span className="stream-project">{e.project}</span>
            <span className="stream-text">{what}</span>
            <span className="stream-when">{ago(e.at, now)}</span>
          </button>
        )
      })}
    </div>
  )
}
