import { useEffect, useRef, useState } from 'react'
import type { StatusSnapshot } from '@shared/types'
import { UsageDashboard } from './UsageDashboard'
import { ProjectGroup } from './ProjectGroup'
import { groupByProject } from './group'
import { Settings } from './Icons'
import logo from './assets/logo.png'

export function App() {
  const [snap, setSnap] = useState<StatusSnapshot | null>(null)
  const [now, setNow] = useState(Date.now())

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
  // Add back the agent list's scrolled-away overflow so the desired height isn't
  // capped by the current (possibly too-small) window.
  const appRef = useRef<HTMLDivElement>(null)
  const agentsRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const app = appRef.current
    if (!app) return
    let raf = 0
    const measure = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        const a = agentsRef.current
        const overflow = a ? Math.max(0, a.scrollHeight - a.clientHeight) : 0
        window.watch.reportHeight(app.offsetHeight + overflow)
      })
    }
    const ro = new ResizeObserver(measure)
    ro.observe(app)
    if (agentsRef.current) ro.observe(agentsRef.current)
    return () => {
      ro.disconnect()
      cancelAnimationFrame(raf)
    }
  }, [])

  const groups = groupByProject(snap?.agents ?? [])
  const waiting = snap?.waitingCount ?? 0
  const connTitle = snap?.mock
    ? 'Showing sample (mock) data — toggle with the gear'
    : snap?.daemonConnected
      ? 'Local daemon connected — receiving live agent updates'
      : 'Daemon offline — run the hook installer to see live agents'

  return (
    <div className="app" ref={appRef}>
      <header className="header" title="TaylorMade Agent Monitor — live Claude Code agents and your usage · drag here to move">
        <img className="brand" src={logo} alt="TaylorMade Solutions" draggable={false} />
        {waiting > 0 && (
          <span className="needs" title="Agents waiting for your input right now">{waiting} waiting</span>
        )}
      </header>

      {snap && <UsageDashboard usage={snap.usage} now={now} />}

      <div className="rule" />

      <section className="agents" ref={agentsRef}>
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
      </section>

      <div className="rule" />

      <footer className="footer">
        <div className={`conn ${snap?.daemonConnected ? 'is-on' : 'is-off'}`} title={connTitle}>
          <span className="conn-dot" />
          {snap?.mock ? 'mock data' : snap?.daemonConnected ? 'connected' : 'disconnected'}
        </div>
        <div className="footer-actions">
          <button className="iconbtn" title="Toggle sample (mock) data on/off" onClick={() => window.watch.toggleMock(!snap?.mock)}>
            <Settings className="gear" strokeWidth={2} />
          </button>
          <button className="quit" title="Quit TaylorMade Agent Monitor (closes the tray app)" onClick={() => window.watch.quit()}>Quit</button>
        </div>
      </footer>
    </div>
  )
}
