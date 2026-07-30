import { useEffect, useState } from 'react'
import type { StatusSnapshot } from '@shared/types'
import { UsageDashboard } from './UsageDashboard'
import { ProjectGroup } from './ProjectGroup'
import { AgentContextMenu, type MenuState } from './AgentContextMenu'
import { NewProject } from './NewProject'
import { groupByProject } from './group'
import { SettingsPanel } from './SettingsPanel'
import { COLLAPSE_ALL_EVENT } from './useCollapse'
import { UsageInsightsView } from './UsageInsightsView'
import { SpendView } from './SpendView'
import { TopBar } from './TopBar'
import { Pane } from './Pane'
import { DEFAULT_PANES, MAX_PANES, PANE_KINDS, loadPanes, savePanes, type PaneKind } from './panes'
import {
  LaunchContextChip, LauncherPane, WindowsPane, WindowsRefreshButton, useDesktopWindows,
  type LaunchContext
} from './WorkspacePanes'
import { Folder, FolderOpen, FolderPlus } from 'lucide-react'

export function App() {
  const [snap, setSnap] = useState<StatusSnapshot | null>(null)
  const [now, setNow] = useState(Date.now())
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [newProjectOpen, setNewProjectOpen] = useState(false)
  const [menu, setMenu] = useState<MenuState | null>(null)
  const [folderMenu, setFolderMenu] = useState(false)
  const [waitingOnly, setWaitingOnly] = useState(false)
  const [allCollapsed, setAllCollapsed] = useState(false)
  // Main-frame layout: three vertical columns to start, up to six panes, one per
  // kind. Persisted locally so a summoned workspace comes back as you left it.
  const [panes, setPanes] = useState<PaneKind[]>(loadPanes)
  // Launch actions start in the active project by default; the header chip toggles
  // back to the home folder so a launch target is never a surprise.
  const [useProjectContext, setUseProjectContext] = useState(true)
  // Drives the slide-up / slide-down transition. Starts closed so the very first
  // painted frame is already off-screen and the card rises into place.
  const [open, setOpen] = useState(false)
  // Only enumerate windows while a pane is showing them.
  const desktop = useDesktopWindows(panes.includes('windows'))

  useEffect(() => {
    window.watch.getStatus().then(setSnap)
    const off = window.watch.onStatus(setSnap)
    return off
  }, [])

  useEffect(() => savePanes(panes), [panes])

  // Main sequences the animation: it shows the window then sends 'enter', and on
  // hide sends 'exit' and waits for the slide-down before the window disappears.
  // The mount frame covers the very first show, whose event predates this listener.
  useEffect(() => {
    const raf = requestAnimationFrame(() => setOpen(true))
    const off = window.watch.onWindowPhase((phase) => {
      if (phase === 'exit') setOpen(false)
      else requestAnimationFrame(() => setOpen(true))
    })
    return () => {
      cancelAnimationFrame(raf)
      off()
    }
  }, [])

  // Tick once a second so durations / reset countdowns stay live between pushes.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])

  // Escape closes an open menu or dialog, otherwise dismisses the workspace (it
  // no longer auto-hides on blur, so this is the fast keyboard way out).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (menu) setMenu(null)
      else if (folderMenu) setFolderMenu(false)
      else if (newProjectOpen) setNewProjectOpen(false)
      else if (!settingsOpen) window.watch.hide()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [menu, settingsOpen, newProjectOpen, folderMenu])

  const agents = snap?.agents ?? []
  const waitingParents = new Set(agents.filter((a) => a.state === 'waiting' && a.parentId).map((a) => a.parentId!))
  const visibleAgents = waitingOnly
    ? agents.filter((a) => a.state === 'waiting' || waitingParents.has(a.id))
    : agents
  const groups = groupByProject(visibleAgents)
  const waiting = snap?.waitingCount ?? 0

  // The root session touched most recently — the default folder for launches.
  const recent = [...agents]
    .filter((a) => a.cwd && !a.parentId)
    .sort((a, b) => b.updatedAt - a.updatedAt)[0]
  const context: LaunchContext = {
    cwd: useProjectContext ? recent?.cwd : undefined,
    label: useProjectContext ? recent?.project : undefined,
    onToggle: recent?.cwd ? () => setUseProjectContext((v) => !v) : undefined
  }

  // When the last waiting session resolves, drop the filter so the list never
  // strands empty with no chip left to click.
  useEffect(() => {
    if (waitingOnly && waiting === 0) setWaitingOnly(false)
  }, [waitingOnly, waiting])

  const collapseAll = () => {
    const next = !allCollapsed
    setAllCollapsed(next)
    window.dispatchEvent(new CustomEvent(COLLAPSE_ALL_EVENT, { detail: next }))
  }
  const providerHealth = snap ? Object.entries(snap.providers) : []
  const reportingCount = providerHealth.filter(([, health]) => health.reporting).length
  const awaitingTrust = providerHealth.some(([, health]) => health.awaitingTrust)
  const noHooks = !!snap && !snap.mock && reportingCount === 0
  const conn = {
    state: (noHooks ? 'off' : awaitingTrust ? 'warn' : 'on') as 'on' | 'warn' | 'off',
    label: snap?.mock ? 'mock data' : noHooks ? 'no reports' : awaitingTrust ? `${reportingCount}/2 · trust` : `${reportingCount}/2 providers`,
    title: snap?.mock
      ? 'Showing sample (mock) data — change in Settings'
      : providerHealth.map(([provider, health]) => `${provider}: ${health.reporting ? 'reporting' : health.awaitingTrust ? 'awaiting trust' : health.installed ? 'installed, silent' : 'not installed'}`).join('\n')
  }

  const agentList = !snap ? (
    <div className="empty">Connecting…</div>
  ) : groups.length === 0 ? (
    <div className="empty">
      {noHooks
        ? 'No provider reports yet. Install hooks and review Codex trust in /hooks.'
        : 'No active agents. Start Claude Code or Codex in a project.'}
    </div>
  ) : (
    groups.map((g) => (
      <ProjectGroup key={g.key} group={g} now={now} onRowMenu={setMenu} forceWaitingOpen={waitingOnly} />
    ))
  )

  const paneBody = (kind: PaneKind) => {
    switch (kind) {
      case 'launcher':
        return <LauncherPane context={context} onNewProject={() => setNewProjectOpen(true)} />
      case 'windows':
        return <WindowsPane windows={desktop.windows} />
      case 'limits':
        return snap ? <UsageDashboard usage={snap.usage} now={now} /> : <div className="empty">Connecting…</div>
      case 'spend':
        return snap ? <SpendView usage={snap.usage} now={now} /> : <div className="empty">Connecting…</div>
      case 'insights':
        return <UsageInsightsView />
      case 'agents':
        return <div className="agents-inner">{agentList}</div>
    }
  }

  const paneActions = (kind: PaneKind) => {
    if (kind === 'launcher') return <LaunchContextChip context={context} />
    if (kind === 'windows') return <WindowsRefreshButton refreshing={desktop.refreshing} refresh={desktop.refresh} />
    return null
  }

  const addPane = () => {
    const next = PANE_KINDS.find((p) => !panes.includes(p.id))
    if (next && panes.length < MAX_PANES) setPanes([...panes, next.id])
  }
  const setPaneKind = (index: number, kind: PaneKind) =>
    setPanes(panes.map((current, i) => (i === index ? kind : current)))
  const closePane = (index: number) => {
    const next = panes.filter((_, i) => i !== index)
    setPanes(next.length ? next : [...DEFAULT_PANES])
  }

  return (
    <div className={`app ${open ? 'is-open' : ''}`}>
      <TopBar
        waiting={waiting}
        waitingOnly={waitingOnly}
        onWaitingOnly={() => setWaitingOnly((v) => !v)}
        canCollapse={groups.length > 1}
        allCollapsed={allCollapsed}
        onCollapseAll={collapseAll}
        conn={conn}
        canAddPane={panes.length < MAX_PANES}
        onAddPane={addPane}
        onProjects={() => setFolderMenu(true)}
        onSettings={() => setSettingsOpen(true)}
      />

      <div className="frame">
        <aside className="sidebar">
          <div className="pane-head">
            <span className="pane-title">Coding agents</span>
            {agents.length > 0 && <span className="pane-count">{agents.filter((a) => !a.parentId).length}</span>}
          </div>
          <div className="pane-scroll">
            <div className="agents-inner">{agentList}</div>
          </div>
        </aside>

        <main className="grid" style={{ gridTemplateColumns: `repeat(${Math.min(panes.length, 3)}, minmax(0, 1fr))` }}>
          {panes.map((kind, index) => (
            <Pane
              key={kind}
              kind={kind}
              taken={panes}
              onKind={(next) => setPaneKind(index, next)}
              onClose={() => closePane(index)}
              actions={paneActions(kind)}
            >
              {paneBody(kind)}
            </Pane>
          ))}
        </main>
      </div>

      {folderMenu && (
        <div className="ctxmenu-overlay" onClick={() => setFolderMenu(false)} onContextMenu={(e) => { e.preventDefault(); setFolderMenu(false) }}>
          <div className="ctxmenu ctxmenu--topbar" onClick={(e) => e.stopPropagation()}>
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
          </div>
        </div>
      )}
      {settingsOpen && <SettingsPanel onClose={() => setSettingsOpen(false)} />}
      {newProjectOpen && <NewProject onClose={() => setNewProjectOpen(false)} />}
      {menu && <AgentContextMenu menu={menu} onClose={() => setMenu(null)} />}
    </div>
  )
}
