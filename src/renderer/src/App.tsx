import { useCallback, useEffect, useRef, useState } from 'react'
import type { StatusSnapshot } from '@shared/types'
import { UsageDashboard } from './UsageDashboard'
import { ProjectGroup } from './ProjectGroup'
import { groupByProject } from './group'
import { Settings } from './Icons'
import { SettingsPanel } from './SettingsPanel'
import logo from './assets/logo.png'

export function App() {
  const [snap, setSnap] = useState<StatusSnapshot | null>(null)
  const [now, setNow] = useState(Date.now())
  const [settingsOpen, setSettingsOpen] = useState(false)

  useEffect(() => {
    window.watch.getStatus().then(setSnap)
    const off = window.watch.onStatus(setSnap)
    return off
  }, [])

  // Tick once a second so durations / reset countdowns stay live between pushes.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])

  // Report the card's natural height so main can size the window to fit content.
  // Desired height = the (possibly capped) card height + the agent list's
  // scrolled-away overflow, so the window grows to fit instead of scrolling.
  const appRef = useRef<HTMLDivElement>(null)
  const agentsRef = useRef<HTMLDivElement>(null) // scroll container — for the overflow read
  const agentsInnerRef = useRef<HTMLDivElement>(null) // natural-height list — what we observe
  const rafRef = useRef(0)
  const measure = useCallback(() => {
    const app = appRef.current
    if (!app) return
    cancelAnimationFrame(rafRef.current)
    rafRef.current = requestAnimationFrame(() => {
      const a = agentsRef.current
      const overflow = a ? Math.max(0, a.scrollHeight - a.clientHeight) : 0
      window.watch.reportHeight(app.offsetHeight + overflow)
    })
  }, [])
  useEffect(() => {
    const app = appRef.current
    if (!app) return
    // Observe the card AND the natural-height inner list. Once the window is
    // capped, the scroll container's box stops changing — only the inner list
    // grows when terminals are added, so observing it is what re-fires the resize.
    const ro = new ResizeObserver(measure)
    ro.observe(app)
    if (agentsInnerRef.current) ro.observe(agentsInnerRef.current)
    return () => {
      ro.disconnect()
      cancelAnimationFrame(rafRef.current)
    }
  }, [measure])
  // Belt-and-suspenders: re-measure whenever the snapshot changes (agents added,
  // closed, or changing state) in case a layout change didn't trip the observer.
  useEffect(() => {
    measure()
  }, [snap, measure])

  const groups = groupByProject(snap?.agents ?? [])
  const waiting = snap?.waitingCount ?? 0
  const connTitle = snap?.mock
    ? 'Showing sample (mock) data — change in Settings'
    : snap?.daemonConnected
      ? 'Local daemon connected — receiving live agent updates'
      : 'Daemon offline — run the hook installer to see live agents'

  return (
    <div className="app" ref={appRef}>
      <header className="header" title="Claude Code agent monitor · drag here to move">
        <span className="appname">Claude Code</span>
        <div className="header-right">
          {waiting > 0 && (
            <span className="needs" title="Agents waiting for your input right now">{waiting} waiting</span>
          )}
          <img className="brand" src={logo} alt="TaylorMade Solutions" draggable={false} />
        </div>
      </header>

      {snap && <UsageDashboard usage={snap.usage} now={now} />}

      <div className="rule" />

      <section className="agents" ref={agentsRef}>
        <div className="agents-inner" ref={agentsInnerRef}>
          {!snap ? (
            <div className="empty">Connecting…</div>
          ) : groups.length === 0 ? (
            <div className="empty">
              {snap.daemonConnected
                ? 'No active agents yet. Start Claude Code in a project.'
                : 'Daemon offline — run the hook installer to see live agents.'}
            </div>
          ) : (
            groups.map((g) => <ProjectGroup key={g.key} group={g} now={now} />)
          )}
        </div>
      </section>

      <div className="rule" />

      <footer className="footer">
        <div className={`conn ${snap?.daemonConnected ? 'is-on' : 'is-off'}`} title={connTitle}>
          <span className="conn-dot" />
          {snap?.mock ? 'mock data' : snap?.daemonConnected ? 'connected' : 'disconnected'}
        </div>
        <div className="footer-actions">
          <button className="iconbtn" title="Settings — hotkey, notifications, startup, mock data" onClick={() => setSettingsOpen(true)}>
            <Settings className="gear" strokeWidth={2} />
          </button>
          <button className="quit" title="Quit TaylorMade Agent Monitor (closes the tray app)" onClick={() => window.watch.quit()}>Quit</button>
        </div>
      </footer>

      {settingsOpen && <SettingsPanel onClose={() => setSettingsOpen(false)} />}
    </div>
  )
}
