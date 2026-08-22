import { useEffect, useState } from 'react'
import type { StatusSnapshot, TerminalLaunch } from '@shared/types'
import { UsageDashboard } from './UsageDashboard'
import { ProjectGroup } from './ProjectGroup'
import { AgentContextMenu, type MenuState } from './AgentContextMenu'
import { NewProject } from './NewProject'
import { groupByProject } from './group'
import { applyOrder, useGroupOrder } from './useGroupOrder'
import { SettingsPanel } from './SettingsPanel'
import { COLLAPSE_ALL_EVENT } from './useCollapse'
import { UsageInsightsView } from './UsageInsightsView'
import { SpendView } from './SpendView'
import { TopBar, type MenuName } from './TopBar'
import { Pane } from './Pane'
import { TerminalPane } from './TerminalPane'
import { MenuCheckItem, MenuPop } from './Menu'
import {
  MAX_PANES, SIDEBAR_VIEWS, defaultPanes, isUniqueKind, loadPanes, loadSidebarCollapsed,
  loadSidebarViews, newPane, savePanes, saveSidebarCollapsed, saveSidebarViews,
  type PaneInstance, type PaneKind, type SidebarView, type TerminalPaneConfig
} from './panes'
import {
  LaunchContextChip, LauncherPane, WindowsPane, WindowsRefreshButton, useDesktopWindows,
  type LaunchContext
} from './WorkspacePanes'
import { ChevronDown, X } from 'lucide-react'

export function App() {
  const [snap, setSnap] = useState<StatusSnapshot | null>(null)
  const [now, setNow] = useState(Date.now())
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [newProjectOpen, setNewProjectOpen] = useState(false)
  const [menu, setMenu] = useState<MenuState | null>(null)
  const [openMenu, setOpenMenu] = useState<MenuName | 'sidebar' | null>(null)
  const [waitingOnly, setWaitingOnly] = useState(false)
  const [allCollapsed, setAllCollapsed] = useState(false)
  const { order, save: saveOrder, clear: clearOrder } = useGroupOrder()
  const [dragKey, setDragKey] = useState<string | null>(null)
  const [drop, setDrop] = useState<{ key: string; after: boolean } | null>(null)
  // Main-frame layout: the launcher plus embedded terminal panes, drag-
  // reorderable, up to six. Persisted locally so a summoned workspace comes
  // back as you left it.
  const [panes, setPanes] = useState<PaneInstance[]>(loadPanes)
  const [paneDrag, setPaneDrag] = useState<string | null>(null)
  const [paneDrop, setPaneDrop] = useState<{ id: string; after: boolean } | null>(null)
  // Data views stacked in the sidebar, toggled from the sidebar menu. Each
  // section can also roll up to just its header.
  const [sidebarViews, setSidebarViews] = useState<SidebarView[]>(loadSidebarViews)
  const [sidebarCollapsed, setSidebarCollapsed] = useState<SidebarView[]>(loadSidebarCollapsed)
  // Launch actions start in the active project by default; the header chip toggles
  // back to the home folder so a launch target is never a surprise.
  const [useProjectContext, setUseProjectContext] = useState(true)
  // Drives the slide-up / slide-down transition. Starts closed so the very first
  // painted frame is already off-screen and the card rises into place.
  const [open, setOpen] = useState(false)
  // Only enumerate windows while the sidebar section is actually showing them —
  // a collapsed section stops the polling just like a hidden one.
  const desktop = useDesktopWindows(sidebarViews.includes('windows') && !sidebarCollapsed.includes('windows'))

  useEffect(() => {
    window.watch.getStatus().then(setSnap)
    const off = window.watch.onStatus(setSnap)
    return off
  }, [])

  useEffect(() => savePanes(panes), [panes])
  useEffect(() => saveSidebarViews(sidebarViews), [sidebarViews])
  useEffect(() => saveSidebarCollapsed(sidebarCollapsed), [sidebarCollapsed])

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
  // no longer auto-hides on blur, so this is the fast keyboard way out). Keys
  // inside an embedded terminal belong to the shell — Escape there interrupts
  // the CLI, it must never also hide the workspace.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if ((e.target as HTMLElement)?.closest?.('.termpane')) return
      if (menu) setMenu(null)
      else if (openMenu) setOpenMenu(null)
      else if (newProjectOpen) setNewProjectOpen(false)
      else if (!settingsOpen) window.watch.hide()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [menu, settingsOpen, newProjectOpen, openMenu])

  const agents = snap?.agents ?? []
  const waitingParents = new Set(agents.filter((a) => a.state === 'waiting' && a.parentId).map((a) => a.parentId!))
  const visibleAgents = waitingOnly
    ? agents.filter((a) => a.state === 'waiting' || waitingParents.has(a.id))
    : agents
  const groups = applyOrder(groupByProject(visibleAgents), order)
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

  const commitDrop = () => {
    if (dragKey && drop && dragKey !== drop.key) {
      const keys = groups.map((group) => group.key).filter((key) => key !== dragKey)
      const at = keys.indexOf(drop.key)
      keys.splice(at + (drop.after ? 1 : 0), 0, dragKey)
      saveOrder([...keys, ...order.filter((key) => !keys.includes(key))])
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
  const providerCount = providerHealth.length
  const awaitingTrust = providerHealth.some(([, health]) => health.awaitingTrust)
  const noHooks = !!snap && !snap.mock && reportingCount === 0
  const conn = {
    state: (noHooks ? 'off' : awaitingTrust ? 'warn' : 'on') as 'on' | 'warn' | 'off',
    label: snap?.mock ? 'mock data' : noHooks ? 'no reports' : awaitingTrust ? `${reportingCount}/${providerCount} · trust` : `${reportingCount}/${providerCount} providers`,
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
        : 'No active agents. Start Claude Code, Codex, or Cursor in a project.'}
    </div>
  ) : (
    groups.map((group) => (
      <div
        key={group.key}
        className={`group-slot ${dragKey === group.key ? 'is-dragging' : ''} ${
          drop?.key === group.key && dragKey && dragKey !== group.key ? (drop.after ? 'drop-after' : 'drop-before') : ''
        }`}
        onDragOver={(event) => {
          if (!dragKey) return
          event.preventDefault()
          event.dataTransfer.dropEffect = 'move'
          const rect = event.currentTarget.getBoundingClientRect()
          const after = event.clientY > rect.top + rect.height / 2
          setDrop((current) => current?.key === group.key && current.after === after ? current : { key: group.key, after })
        }}
        onDrop={(event) => {
          event.preventDefault()
          commitDrop()
        }}
      >
        <ProjectGroup
          group={group}
          now={now}
          onRowMenu={setMenu}
          forceWaitingOpen={waitingOnly}
          dragHandle={{
            draggable: true,
            onDragStart: (event) => {
              event.dataTransfer.effectAllowed = 'move'
              event.dataTransfer.setData('text/plain', group.key)
              setDragKey(group.key)
            },
            onDragEnd: () => {
              setDragKey(null)
              setDrop(null)
            }
          }}
        />
      </div>
    ))
  )

  /** Add a pane of `kind` if the layout allows it. Terminals repeat; others don't. */
  const addPane = (kind: PaneKind, term?: TerminalPaneConfig) => {
    if (panes.length >= MAX_PANES) return
    if (isUniqueKind(kind) && panes.some((p) => p.kind === kind)) return
    setPanes([...panes, newPane(kind, term)])
  }

  /** Embedded launch: a terminal pane in the current context. When the grid is
   * full it degrades to the old behavior — an external window. */
  const newTerminal = (launch: TerminalLaunch) => {
    if (panes.length >= MAX_PANES) {
      window.watch.openTerminal(context.cwd, launch)
      return
    }
    addPane('terminal', { launch, cwd: context.cwd, label: context.label })
  }

  const updateTerm = (paneId: string, patch: Partial<TerminalPaneConfig>) =>
    setPanes((current) => current.map((p) =>
      p.id === paneId && p.term ? { ...p, term: { ...p.term, ...patch } } : p
    ))

  const setPaneKind = (paneId: string, kind: PaneKind) => {
    const changing = panes.find((p) => p.id === paneId)
    if (!changing || changing.kind === kind) return
    // Leaving a terminal kills its shell; nothing should keep running unseen.
    if (changing.term?.sessionId) window.watch.disposeTerminal(changing.term.sessionId)
    setPanes(panes.map((p) => p.id === paneId
      ? newPane(kind, kind === 'terminal' ? { launch: 'shell', cwd: context.cwd, label: context.label } : undefined)
      : p
    ))
  }

  const closePane = (paneId: string) => {
    const closing = panes.find((p) => p.id === paneId)
    if (closing?.term?.sessionId) window.watch.disposeTerminal(closing.term.sessionId)
    const next = panes.filter((p) => p.id !== paneId)
    setPanes(next.length ? next : defaultPanes())
  }

  const commitPaneDrop = () => {
    if (paneDrag && paneDrop && paneDrag !== paneDrop.id) {
      const moving = panes.find((p) => p.id === paneDrag)
      if (moving) {
        const rest = panes.filter((p) => p.id !== paneDrag)
        const at = rest.findIndex((p) => p.id === paneDrop.id)
        rest.splice(at + (paneDrop.after ? 1 : 0), 0, moving)
        setPanes(rest)
      }
    }
    setPaneDrag(null)
    setPaneDrop(null)
  }

  const paneBody = (pane: PaneInstance) => {
    switch (pane.kind) {
      case 'launcher':
        return <LauncherPane context={context} onNewProject={() => setNewProjectOpen(true)} onEmbedTerminal={newTerminal} />
      case 'terminal':
        return <TerminalPane config={pane.term!} onConfig={(patch) => updateTerm(pane.id, patch)} />
    }
  }

  const paneActions = (pane: PaneInstance) => {
    if (pane.kind === 'launcher') return <LaunchContextChip context={context} />
    if (pane.kind === 'terminal' && pane.term) {
      const label = pane.term.launch === 'shell' ? null : pane.term.launch === 'codex' ? 'Codex' : 'Claude Code'
      const where = pane.term.label ?? (pane.term.cwd ? pane.term.cwd.split(/[\\/]/).pop() : null)
      if (!label && !where) return null
      return <span className="pane-context is-project" title={pane.term.cwd ?? 'Home folder'}>{[label, where].filter(Boolean).join(' · ')}</span>
    }
    return null
  }

  const toggleSidebarView = (view: SidebarView) =>
    setSidebarViews((current) => current.includes(view)
      ? current.filter((v) => v !== view)
      : [...current, view]
    )

  const toggleSidebarCollapsed = (view: SidebarView) =>
    setSidebarCollapsed((current) => current.includes(view)
      ? current.filter((v) => v !== view)
      : [...current, view]
    )

  const sidebarBody = (view: SidebarView) => {
    switch (view) {
      case 'limits':
        return snap ? <UsageDashboard usage={snap.usage} now={now} /> : <div className="empty">Connecting…</div>
      case 'spend':
        return snap ? <SpendView usage={snap.usage} now={now} /> : <div className="empty">Connecting…</div>
      case 'windows':
        return <WindowsPane windows={desktop.windows} />
      case 'insights':
        return <UsageInsightsView />
    }
  }

  const sideSection = (v: (typeof SIDEBAR_VIEWS)[number], top = false) => {
    const rolled = sidebarCollapsed.includes(v.id)
    return (
      <section className={`sideview ${top ? 'sideview--top' : ''} ${rolled ? 'is-collapsed' : ''}`} key={v.id}>
        <div className="pane-head sideview-head">
          <button
            className="sidebar-title"
            onClick={() => toggleSidebarCollapsed(v.id)}
            aria-expanded={!rolled}
            title={rolled ? `Show ${v.label}` : `Collapse ${v.label}`}
          >
            <v.icon className="gpane-ic" strokeWidth={2} />
            <span className="pane-title">{v.label}</span>
            <ChevronDown className={`sidebar-caret ${rolled ? 'is-closed' : ''}`} strokeWidth={2} />
          </button>
          <span className="gpane-actions">
            {v.id === 'windows' && !rolled && <WindowsRefreshButton refreshing={desktop.refreshing} refresh={desktop.refresh} />}
            <button className="iconbtn iconbtn--sm" onClick={() => toggleSidebarView(v.id)} title="Hide this view" aria-label={`Hide ${v.label}`}>
              <X className="gear gear--sm" strokeWidth={2} />
            </button>
          </span>
        </div>
        {!rolled && <div className="sideview-body">{sidebarBody(v.id)}</div>}
      </section>
    )
  }

  // Sections render in the fixed catalog order so toggling never reshuffles.
  // Limits pins above the agent list; everything else stacks below it.
  const activeViews = SIDEBAR_VIEWS.filter((v) => sidebarViews.includes(v.id))
  const limitsView = activeViews.find((v) => v.id === 'limits')
  const belowViews = activeViews.filter((v) => v.id !== 'limits')

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
        panes={panes}
        onAddPane={addPane}
        onNewTerminal={newTerminal}
        onNewProject={() => setNewProjectOpen(true)}
        canResetOrder={order.length > 0}
        onResetOrder={clearOrder}
        onSettings={() => setSettingsOpen(true)}
        openMenu={openMenu === 'sidebar' ? null : openMenu}
        onOpenMenu={setOpenMenu}
      />

      <div className="frame">
        <aside className="sidebar">
          {limitsView && sideSection(limitsView, true)}
          <div className="pane-head sidebar-head">
            <button
              className="sidebar-title"
              onClick={() => setOpenMenu(openMenu === 'sidebar' ? null : 'sidebar')}
              aria-expanded={openMenu === 'sidebar'}
              title="Choose which views stack below the agent list"
            >
              <span className="pane-title">Coding agents</span>
              <ChevronDown className="sidebar-caret" strokeWidth={2} />
            </button>
            {agents.length > 0 && <span className="pane-count">{agents.filter((a) => !a.parentId).length}</span>}
            {openMenu === 'sidebar' && (
              <MenuPop onAway={() => setOpenMenu(null)} ignoreSelector=".sidebar-head">
                {SIDEBAR_VIEWS.map((v) => (
                  <MenuCheckItem
                    key={v.id}
                    icon={<v.icon strokeWidth={2} />}
                    label={v.label}
                    hint={v.hint}
                    checked={sidebarViews.includes(v.id)}
                    onClick={() => toggleSidebarView(v.id)}
                  />
                ))}
              </MenuPop>
            )}
          </div>
          <div className="pane-scroll">
            <div className="agents-inner">{agentList}</div>
          </div>
          {belowViews.map((v) => sideSection(v))}
        </aside>

        <main className="grid" style={{ gridTemplateColumns: `repeat(${Math.min(panes.length, 3)}, minmax(0, 1fr))` }}>
          {panes.map((pane) => (
            <div
              key={pane.id}
              className={`pane-slot ${paneDrag === pane.id ? 'is-dragging' : ''} ${
                paneDrop?.id === pane.id && paneDrag && paneDrag !== pane.id ? (paneDrop.after ? 'pane-drop-after' : 'pane-drop-before') : ''
              }`}
              onDragOver={(event) => {
                if (!paneDrag) return
                event.preventDefault()
                event.dataTransfer.dropEffect = 'move'
                const rect = event.currentTarget.getBoundingClientRect()
                const after = event.clientX > rect.left + rect.width / 2
                setPaneDrop((current) => current?.id === pane.id && current.after === after ? current : { id: pane.id, after })
              }}
              onDrop={(event) => {
                event.preventDefault()
                commitPaneDrop()
              }}
            >
              <Pane
                kind={pane.kind}
                taken={panes.filter((p) => p.id !== pane.id).map((p) => p.kind)}
                onKind={(next) => setPaneKind(pane.id, next)}
                onClose={() => closePane(pane.id)}
                actions={paneActions(pane)}
                dragHandle={{
                  draggable: true,
                  onDragStart: (event) => {
                    event.dataTransfer.effectAllowed = 'move'
                    event.dataTransfer.setData('text/plain', pane.id)
                    setPaneDrag(pane.id)
                  },
                  onDragEnd: () => {
                    setPaneDrag(null)
                    setPaneDrop(null)
                  }
                }}
              >
                {paneBody(pane)}
              </Pane>
            </div>
          ))}
        </main>
      </div>

      {settingsOpen && <SettingsPanel onClose={() => setSettingsOpen(false)} />}
      {newProjectOpen && <NewProject onClose={() => setNewProjectOpen(false)} />}
      {menu && <AgentContextMenu menu={menu} onClose={() => setMenu(null)} />}
    </div>
  )
}
