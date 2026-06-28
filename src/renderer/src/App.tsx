import { useEffect, useState } from 'react'
import type { StatusSnapshot } from '@shared/types'
import { UsageDashboard } from './UsageDashboard'
import { ProjectGroup } from './ProjectGroup'
import { groupByProject } from './group'
import { Settings } from './Icons'

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

  const groups = groupByProject(snap?.agents ?? [])
  const waiting = snap?.waitingCount ?? 0

  return (
    <div className="app">
      <header className="header">
        <h1>Claude Agents</h1>
        {waiting > 0 && <span className="needs">{waiting} waiting</span>}
      </header>

      {snap && <UsageDashboard usage={snap.usage} now={now} />}

      <div className="rule" />

      <section className="agents">
        {groups.length === 0 ? (
          <div className="empty">
            {snap?.daemonConnected
              ? 'No active agents. Start Claude Code in a project.'
              : 'Daemon offline — install the hooks to see live agents.'}
          </div>
        ) : (
          groups.map((g) => <ProjectGroup key={g.key} group={g} now={now} />)
        )}
      </section>

      <div className="rule" />

      <footer className="footer">
        <div className={`conn ${snap?.daemonConnected ? 'is-on' : 'is-off'}`}>
          <span className="conn-dot" />
          {snap?.mock ? 'mock data' : snap?.daemonConnected ? 'connected' : 'disconnected'}
        </div>
        <div className="footer-actions">
          <button className="iconbtn" title="Toggle mock data" onClick={() => window.watch.toggleMock(!snap?.mock)}>
            <Settings className="gear" strokeWidth={2} />
          </button>
          <button className="quit" onClick={() => window.watch.quit()}>Quit</button>
        </div>
      </footer>
    </div>
  )
}
