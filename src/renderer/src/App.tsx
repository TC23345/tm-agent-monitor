import { useEffect, useState } from 'react'
import type { StatusSnapshot } from '@shared/types'
import { UsageDashboard } from './UsageDashboard'
import { ProjectGroup } from './ProjectGroup'
import { AgentContextMenu, type MenuState } from './AgentContextMenu'
import { NewProject } from './NewProject'
import { groupByProject } from './group'
import { applyOrder, useGroupOrder } from './useGroupOrder'
import { Settings } from './Icons'
import { SettingsPanel } from './SettingsPanel'
import { COLLAPSE_ALL_EVENT } from './useCollapse'
import { UsageInsightsView } from './UsageInsightsView'
import { SpendView } from './SpendView'
import { Folder, FolderOpen, FolderPlus, ChevronsDownUp, ChevronsUpDown, ChartColumn, Coins, ListRestart } from 'lucide-react'
import logo from './assets/logo.png'

export function App() {
  const [snap, setSnap] = useState<StatusSnapshot | null>(null)
  const [now, setNow] = useState(Date.now())
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [newProjectOpen, setNewProjectOpen] = useState(false)
  const [menu, setMenu] = useState<MenuState | null>(null)
  const [folderMenu, setFolderMenu] = useState(false)
  const [waitingOnly, setWaitingOnly] = useState(false)
  const [allCollapsed, setAllCollapsed] = useState(false)
  const [view, setView] = useState<'agents' | 'insights' | 'spend'>('agents')
  const { order, save: saveOrder, clear: clearOrder } = useGroupOrder()
  const [dragKey, setDragKey] = useState<string | null>(null)
  const [drop, setDrop] = useState<{ key: string; after: boolean } | null>(null)

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

  // Escape closes an open context menu, otherwise dismisses the panel (the panel
  // no longer auto-hides on blur, so this is the fast keyboard way out).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (menu) setMenu(null)
      else if (folderMenu) setFolderMenu(false)
      else if (newProjectOpen) setNewProjectOpen(false)
      else if (view !== 'agents') setView('agents')
      else if (!settingsOpen) window.watch.hide()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [menu, settingsOpen, newProjectOpen, folderMenu, view])

  const agents = snap?.agents ?? []
  const waitingParents = new Set(agents.filter((a) => a.state === 'waiting' && a.parentId).map((a) => a.parentId!))
  const visibleAgents = waitingOnly
    ? agents.filter((a) => a.state === 'waiting' || waitingParents.has(a.id))
    : agents
  const groups = applyOrder(groupByProject(visibleAgents), order)
  const waiting = snap?.waitingCount ?? 0

  // When the last waiting session resolves, drop the filter so the list never
  // strands empty with no chip left to click.
  useEffect(() => {
    if (waitingOnly && waiting === 0) setWaitingOnly(false)
  }, [waitingOnly, waiting])

  // Commit a drag: rebuild the full key order from what's on screen, keeping
  // any groups hidden by the waiting filter at the end of the saved order.
  const commitDrop = () => {
    if (dragKey && drop && dragKey !== drop.key) {
      const keys = groups.map((g) => g.key).filter((k) => k !== dragKey)
      const at = keys.indexOf(drop.key)
      keys.splice(at + (drop.after ? 1 : 0), 0, dragKey)
      saveOrder([...keys, ...order.filter((k) => !keys.includes(k))])
    }
    setDragKey(null)
    setDrop(null)
  }

  const collapseAll = () => {
    const next = !allCollapsed
    setAllCollapsed(next)
    window.dispatchEvent(new CustomEvent(COLLAPSE_ALL_EVENT, { detail: next }))
  }
  const providerHealth = snap ? Object.entries(snap.providers) : []
  const reportingCount = providerHealth.filter(([, health]) => health.reporting).length
  const awaitingTrust = providerHealth.some(([, health]) => health.awaitingTrust)
  const noHooks = !!snap && !snap.mock && reportingCount === 0
  const connTitle = snap?.mock
    ? 'Showing sample (mock) data — change in Settings'
    : providerHealth.map(([provider, health]) => `${provider}: ${health.reporting ? 'reporting' : health.awaitingTrust ? 'awaiting trust' : health.installed ? 'installed, silent' : 'not installed'}`).join('\n')

  return (
    <div className="app">
      <header className="header" title="Claude and Codex agent monitor · drag here to move">
        <img className="brand" src={logo} alt="TaylorMade Solutions" draggable={false} />
        <div className="header-right">
          {waiting > 0 && (
            <button
              className={`needs ${waitingOnly ? 'needs--active' : ''}`}
              onClick={() => setWaitingOnly((v) => !v)}
              title={waitingOnly ? 'Showing waiting sessions only — click to show all' : 'Agents waiting for your input — click to show only them'}
            >
              {waiting} waiting
            </button>
          )}
        </div>
      </header>

      {view === 'agents' && snap && <UsageDashboard usage={snap.usage} now={now} />}

      <div className="rule" />

      <section className="agents">
        <div className="agents-inner">
          {view === 'insights' ? (
            <UsageInsightsView />
          ) : view === 'spend' ? (
            snap ? <SpendView usage={snap.usage} now={now} /> : <div className="empty">Connecting…</div>
          ) : !snap ? (
            <div className="empty">Connecting…</div>
          ) : groups.length === 0 ? (
            <div className="empty">
              {noHooks
                ? 'No provider reports yet. Install hooks and review Codex trust in /hooks.'
                : 'No active agents. Start Claude Code or Codex in a project.'}
            </div>
          ) : (
            groups.map((g) => (
              <div
                key={g.key}
                className={`group-slot ${dragKey === g.key ? 'is-dragging' : ''} ${
                  drop?.key === g.key && dragKey && dragKey !== g.key ? (drop.after ? 'drop-after' : 'drop-before') : ''
                }`}
                onDragOver={(e) => {
                  if (!dragKey) return
                  e.preventDefault()
                  e.dataTransfer.dropEffect = 'move'
                  const r = e.currentTarget.getBoundingClientRect()
                  const after = e.clientY > r.top + r.height / 2
                  setDrop((d) => (d && d.key === g.key && d.after === after ? d : { key: g.key, after }))
                }}
                onDrop={(e) => {
                  e.preventDefault()
                  commitDrop()
                }}
              >
                <ProjectGroup
                  group={g}
                  now={now}
                  onRowMenu={setMenu}
                  forceWaitingOpen={waitingOnly}
                  dragHandle={{
                    draggable: true,
                    onDragStart: (e) => {
                      e.dataTransfer.effectAllowed = 'move'
                      e.dataTransfer.setData('text/plain', g.key)
                      setDragKey(g.key)
                    },
                    onDragEnd: () => {
                      setDragKey(null)
                      setDrop(null)
                    }
                  }}
                />
              </div>
            ))
          )}
        </div>
      </section>

      <div className="rule" />

      <footer className="footer">
        <div
          className={`conn ${noHooks ? 'is-off' : awaitingTrust ? 'is-warn' : 'is-on'}`}
          title={connTitle}
        >
          <span className="conn-dot" />
          {snap?.mock ? 'mock data' : noHooks ? 'no reports' : awaitingTrust ? `${reportingCount}/2 · trust` : `${reportingCount}/2 providers`}
        </div>
        <div className="footer-actions">
          {view === 'agents' && groups.length > 1 && (
            <button
              className="iconbtn"
              title={allCollapsed ? 'Expand all projects' : 'Collapse all projects'}
              onClick={collapseAll}
            >
              {allCollapsed
                ? <ChevronsUpDown className="gear" strokeWidth={2} />
                : <ChevronsDownUp className="gear" strokeWidth={2} />}
            </button>
          )}
          <button
            className={`iconbtn ${view === 'spend' ? 'iconbtn--active' : ''}`}
            aria-label={view === 'spend' ? 'Back to agent monitor' : 'Open today’s usage and spend'}
            title={view === 'spend' ? 'Back to agent monitor' : 'Today’s tokens and value — per provider and project'}
            onClick={() => setView((v) => (v === 'spend' ? 'agents' : 'spend'))}
          >
            <Coins className="gear" strokeWidth={2} />
          </button>
          <button
            className={`iconbtn ${view === 'insights' ? 'iconbtn--active' : ''}`}
            aria-label={view === 'insights' ? 'Back to agent monitor' : 'Open Usage Insights'}
            title={view === 'insights' ? 'Back to agent monitor' : 'Open Usage Insights — local Claude and Codex patterns'}
            onClick={() => setView((v) => (v === 'insights' ? 'agents' : 'insights'))}
          >
            <ChartColumn className="gear" strokeWidth={2} />
          </button>
          <button className="iconbtn" title="Projects — new project, open Cursor, open the Projects folder" onClick={() => setFolderMenu(true)}>
            <FolderOpen className="gear" strokeWidth={2} />
          </button>
          <button className="iconbtn" title="Settings — hotkey, notifications, startup, updates" onClick={() => setSettingsOpen(true)}>
            <Settings className="gear" strokeWidth={2} />
          </button>
          <button className="quit" title="Quit TaylorMade Agent Monitor (closes the tray app)" onClick={() => window.watch.quit()}>Quit</button>
        </div>
      </footer>

      {folderMenu && (
        <div className="ctxmenu-overlay" onClick={() => setFolderMenu(false)} onContextMenu={(e) => { e.preventDefault(); setFolderMenu(false) }}>
          <div className="ctxmenu ctxmenu--footer" onClick={(e) => e.stopPropagation()}>
            <button className="ctxmenu-item" onClick={() => { setFolderMenu(false); setNewProjectOpen(true) }}>
              <FolderPlus className="ctxmenu-ic" strokeWidth={2} />
              New project…
            </button>
            <button className="ctxmenu-item" onClick={() => { setFolderMenu(false); window.watch.openCursor() }}>
              <FolderOpen className="ctxmenu-ic" strokeWidth={2} />
              Open Cursor
            </button>
            <button className="ctxmenu-item" onClick={() => { setFolderMenu(false); window.watch.openProjectsDir() }}>
              <Folder className="ctxmenu-ic" strokeWidth={2} />
              Open Projects folder
            </button>
            {order.length > 0 && (
              <button className="ctxmenu-item" title="Forget the dragged order and sort projects by attention again" onClick={() => { setFolderMenu(false); clearOrder() }}>
                <ListRestart className="ctxmenu-ic" strokeWidth={2} />
                Reset project order
              </button>
            )}
          </div>
        </div>
      )}
      {settingsOpen && <SettingsPanel onClose={() => setSettingsOpen(false)} />}
      {newProjectOpen && <NewProject onClose={() => setNewProjectOpen(false)} />}
      {menu && <AgentContextMenu menu={menu} onClose={() => setMenu(null)} />}
    </div>
  )
}
