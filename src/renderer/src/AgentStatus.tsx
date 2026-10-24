import { useEffect, useState, type ReactNode } from 'react'
import { ChevronUp, Server, SlidersHorizontal } from 'lucide-react'
import { Settings } from './Icons'
import { MenuItem, MenuPop } from './Menu'
import { ProviderBadge } from './ProviderBadge'
import { useNow } from './useNow'
import { overallStatus, providerLabel, providerStatus } from '@shared/health.mjs'
import type { AppSettings, ProviderId } from '@shared/types'
import type { HealthInput } from './TopBar'

/** App's `openMenu` name for this popover. */
export type AgentStatusMenu = 'agent-status'

type Tone = 'on' | 'warn' | 'off' | 'idle'
interface Row { id: string; name: string; tone: Tone; detail: string; action?: { label: string; run: () => void; busy?: boolean } }

/**
 * The sidebar's foot (0.4.78, the user's call): a dot and **Agent settings**, where the title bar's
 * "Claude Code live" chip used to sit. The dot is the same roll-up (`overallStatus`); a click opens the status of
 * everything the app depends on — each provider's hooks (with Install / Repair right there), the hook server,
 * history sync, the API key, the Chrome extension, clipboard capture, the global keys, notifications — and the way
 * into Settings. Facts that live in settings are read when it opens, never polled.
 */
export function AgentStatus({ health, open, onOpen, onSettings, hooks, onHooks, clipsPaused, onResumeClips, version, debugPort }: {
  health: HealthInput
  open: boolean
  onOpen: (open: boolean) => void
  onSettings: (section?: 'system') => void
  /** The first-run hook installer's state, shared with the Agents list's empty state. */
  hooks: { busy: 'claude' | 'codex' | null; msg: string | null }
  onHooks: (provider: 'claude' | 'codex', action: 'install' | 'repair') => void
  clipsPaused: boolean
  onResumeClips: () => void
  version?: string
  debugPort?: number
}) {
  const now = useNow()
  const conn = overallStatus(health.providers, now, health.mock)
  const [s, setS] = useState<AppSettings | null>(null)
  useEffect(() => {
    if (!open) return
    let live = true
    window.watch.getSettings().then((next) => { if (live) setS(next) }).catch(() => {})
    return () => { live = false }
  }, [open])

  const providers: Row[] = (['claude', 'codex', 'cursor'] as ProviderId[]).map((id) => {
    const h = health.providers?.[id]
    const st = providerStatus(h, now)
    const fixable = (id === 'claude' || id === 'codex') && !health.mock && (h?.needsRepair || !h?.installed)
    return {
      id, name: providerLabel(id), tone: health.mock ? 'on' : st.tone as Tone, detail: health.mock ? 'mock data' : st.reason,
      action: fixable ? { label: h?.needsRepair ? 'Repair' : 'Install', busy: hooks.busy === id, run: () => onHooks(id as 'claude' | 'codex', h?.needsRepair ? 'repair' : 'install') } : undefined
    }
  })

  const app: Row[] = []
  if (s) {
    app.push({ id: 'server', name: 'Hook server', tone: 'on', detail: `listening on 127.0.0.1:${s.port}` })
    const hs = s.historySync
    app.push({
      id: 'history', name: 'History sync',
      tone: hs.state === 'ok' ? 'on' : hs.state === 'error' ? 'warn' : hs.state === 'connecting' ? 'idle' : 'off',
      detail: hs.state === 'off' ? 'off — no MongoDB URI' : hs.state === 'ok' ? (hs.lastFlushAt ? `ok · last flush ${new Date(hs.lastFlushAt).toLocaleTimeString()}` : 'ok') : `${hs.state}${hs.detail ? ` — ${hs.detail}` : ''}`
    })
    app.push({ id: 'api', name: 'API spend', tone: s.hasAdminKey ? 'on' : 'off', detail: s.hasAdminKey ? 'Admin API key set' : 'no Admin API key — organization spend hidden' })
    const ext = s.extension
    app.push({ id: 'extension', name: 'Chrome extension', tone: ext.needsRepair ? 'warn' : ext.hostInstalled ? 'on' : 'off', detail: ext.needsRepair ? 'host points at another copy — repair in Settings' : ext.hostInstalled ? 'native host registered' : 'not installed' })
    const failed = s.shortcuts.filter((r) => !r.clipId && r.preferred && r.active !== r.preferred)
    const appRows = s.shortcuts.filter((r) => !r.clipId)
    app.push({ id: 'keys', name: 'Global keys', tone: failed.length ? 'warn' : 'on', detail: failed.length ? `${failed.length} not registered — ${failed[0].label}${failed[0].note ? `: ${failed[0].note}` : ''}` : `${appRows.length} registered` })
    app.push({ id: 'notify', name: 'Notifications', tone: s.notifications ? 'on' : 'off', detail: s.notifications ? 'on' : 'off' })
  }
  app.push({
    id: 'clips', name: 'Clipboard capture', tone: clipsPaused ? 'warn' : 'on', detail: clipsPaused ? 'paused' : 'capturing',
    action: clipsPaused ? { label: 'Resume', run: onResumeClips } : undefined
  })
  if (debugPort) app.push({ id: 'cdp', name: 'Remote debugging', tone: 'on', detail: `CDP on 127.0.0.1:${debugPort}` })

  const row = (r: Row, icon?: ReactNode) => (
    <div key={r.id} className="astat-row" data-testid={`agent-status:${r.id}`} title={`${r.name}: ${r.detail}`}>
      <span className={`astat-dot is-${r.tone}`} aria-hidden />
      {icon && <span className="astat-ic">{icon}</span>}
      <span className="astat-name">{r.name}</span>
      <span className="astat-detail">{r.detail}</span>
      {r.action && (
        <button className="astat-act" onClick={r.action.run} disabled={r.action.busy} data-testid={`agent-status-act:${r.id}`}>
          {r.action.busy ? '…' : r.action.label}
        </button>
      )}
    </div>
  )

  return (
    <div className="menu-wrap sidebar-foot">
      <button
        className={`sidebar-foot-btn conn is-${conn.state} ${open ? 'is-open' : ''}`}
        onClick={() => onOpen(!open)}
        title={`${conn.title}\n\nClick for the status of everything`}
        aria-expanded={open}
        data-testid="agent-settings"
      >
        <span className="conn-dot" />
        <span className="sidebar-foot-label">Agent settings</span>
        <span className="sidebar-foot-state">{conn.label}</span>
        <ChevronUp className="status-chev" strokeWidth={2} />
      </button>
      {open && (
        <MenuPop onAway={() => onOpen(false)} ignoreSelector=".sidebar-foot">
          <div className="menu-label">Agents</div>
          {providers.map((r) => row(r, <ProviderBadge provider={r.id as ProviderId} />))}
          {hooks.msg && <div className="astat-note">{hooks.msg}</div>}
          {providers.some((r) => r.id === 'codex' && r.action) && <div className="astat-note">Codex also needs its hooks trusted once: run /hooks inside Codex.</div>}
          <div className="menu-sep" />
          <div className="menu-label"><Server className="menu-label-ic" strokeWidth={2} />This app{version ? ` · v${version}` : ''}</div>
          {!s && <div className="astat-note">Reading settings…</div>}
          {app.map((r) => row(r))}
          <div className="menu-sep" />
          <MenuItem icon={<SlidersHorizontal strokeWidth={2} />} label="System & connections…" hint="Settings' system page: every connection, retested" onClick={() => { onOpen(false); onSettings('system') }} />
          <MenuItem icon={<Settings strokeWidth={2} />} label="Settings…" hint="Hotkey, notifications, startup, hooks (Ctrl+,)" keys={['Ctrl', ',']} onClick={() => { onOpen(false); onSettings() }} />
        </MenuPop>
      )}
    </div>
  )
}
