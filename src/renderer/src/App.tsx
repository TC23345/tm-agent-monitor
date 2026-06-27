import { useEffect, useState } from 'react'
import type { StatusSnapshot } from '@shared/types'
import { UsageDashboard } from './UsageDashboard'
import { AgentRow } from './AgentRow'
import { Gear } from './Icons'

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

  const agents = snap?.agents ?? []

  return (
    <div className="backdrop">
      <div className="card">
        <header className="header">
          <h1>Claude Agents</h1>
        </header>

        {snap && <UsageDashboard usage={snap.usage} now={now} />}

        <div className="rule" />

        <section className="agents">
          {agents.length === 0 ? (
            <div className="empty">
              {snap?.daemonConnected
                ? 'No active agents. Start Claude Code in a project.'
                : 'Daemon offline — install the hooks to see live agents.'}
            </div>
          ) : (
            agents.map((a) => <AgentRow key={a.id} agent={a} now={now} />)
          )}
        </section>

        <div className="rule" />

        <footer className="footer">
          <div className={`conn ${snap?.daemonConnected ? 'is-on' : 'is-off'}`}>
            <span className="conn-dot" />
            {snap?.mock ? 'mock data' : snap?.daemonConnected ? 'connected' : 'disconnected'}
          </div>
          <div className="footer-actions">
            <button className="iconbtn" title="Settings (coming soon)" onClick={() => window.watch.toggleMock(!snap?.mock)}>
              <Gear className="gear" />
            </button>
            <button className="quit" onClick={() => window.watch.quit()}>Quit</button>
          </div>
        </footer>
      </div>
    </div>
  )
}
