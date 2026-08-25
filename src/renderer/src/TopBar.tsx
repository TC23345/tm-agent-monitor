import {
  ChevronsDownUp, ChevronsUpDown, Code2, Coins, Columns3, Filter, Folder, FolderPlus, Globe,
  LayoutTemplate, ListRestart, Minus, Monitor, PanelLeft, PanelRight, Power, Rss, Ruler, Save, Search, SquarePlus,
  SquareTerminal, Terminal, Trash2
} from 'lucide-react'
import { Settings } from './Icons'
import mark from './assets/icon.png'
import { MenuCheckItem, MenuItem, MenuPop } from './Menu'
import { MAX_PANES, PANE_KINDS, isUniqueKind, type PaneCols, type PaneInstance, type PaneKind } from './panes'
import type { ProviderHealth, ProviderId, SizeMode, TerminalLaunch } from '@shared/types'
import { overallStatus } from '@shared/health.mjs'
import { ProviderBadge } from './ProviderBadge'
import { useNow } from './useNow'
import { tid } from './testid'

/** Provider health rolled up for the title bar — ticks so "silent for 12m"
 * stays true between snapshots, and only this chip re-renders for it. */
export interface HealthInput {
  providers: Partial<Record<ProviderId, ProviderHealth>> | undefined
  mock: boolean
  version: string | undefined
}

export function ConnChip({ health }: { health: HealthInput }) {
  const now = useNow()
  const conn = overallStatus(health.providers, now, health.version, health.mock)
  return (
    <span className={`conn is-${conn.state}`} title={conn.title} data-testid="conn-chip">
      <span className="conn-dot" />
      {conn.label}
    </span>
  )
}

export type MenuName = 'file' | 'terminal' | 'view' | 'user'

interface Props {
  waiting: number
  waitingOnly: boolean
  onWaitingOnly: () => void
  canCollapse: boolean
  allCollapsed: boolean
  onCollapseAll: () => void
  health: HealthInput
  /** CDP port when the app was launched for automation; shown so an agent can find it. */
  debugPort?: number
  panes: PaneInstance[]
  onAddPane: (kind: PaneKind) => void
  onNewTerminal: (launch: TerminalLaunch) => void
  onNewProject: () => void
  canResetOrder: boolean
  onResetOrder: () => void
  onSettings: () => void
  /** Persisted workspace size — the default view and the half-view side. */
  sizeMode: SizeMode
  onSizeMode: (mode: SizeMode) => void
  paneCols: PaneCols
  onPaneCols: (cols: PaneCols) => void
  /** Drag-resized sidebar / column widths, and the way back to the defaults. */
  canResetSizes: boolean
  onResetSizes: () => void
  /** Which dropdown is open. Owned by App so Escape can close it before hiding. */
  openMenu: MenuName | null
  onOpenMenu: (menu: MenuName | null) => void
  /** The command center: opens the palette. */
  onPalette: () => void
  /** User → Usage / Activity: open the pane, or bring the open one forward. */
  onUsage: () => void
  onActivity: () => void
  /** Named layouts (View → Layouts). */
  layouts: string[]
  onSaveLayout: () => void
  onApplyLayout: (name: string) => void
  onDeleteLayout: (name: string) => void
  /** Root sessions near their context limit and still climbing. */
  hot: { id: string; project: string; pct: number }[]
  onFocusAgent: (id: string) => void
}

/**
 * The app chrome as one title bar, IDE-style: the brand mark and the File /
 * Terminal / View / User menus at the left, the command center in the middle,
 * and passive status (waiting count, connection health) at the right. Every
 * app action lives in the menus and the palette; the sidebar and panes below
 * stay pure content.
 */
export function TopBar(props: Props) {
  const {
    waiting, waitingOnly, onWaitingOnly, canCollapse, allCollapsed, onCollapseAll, health, debugPort,
    panes, onAddPane, onNewTerminal, onNewProject, canResetOrder, onResetOrder, onSettings,
    sizeMode, onSizeMode, paneCols, onPaneCols, canResetSizes, onResetSizes, openMenu, onOpenMenu, onPalette, onUsage,
    layouts, onSaveLayout, onApplyLayout, onDeleteLayout, hot, onFocusAgent, onActivity
  } = props

  const paneFull = panes.length >= MAX_PANES
  const hasUsage = panes.some((p) => p.kind === 'usage')
  const hasActivity = panes.some((p) => p.kind === 'activity')
  const canAdd = (kind: PaneKind) =>
    !paneFull && (!isUniqueKind(kind) || !panes.some((p) => p.kind === kind))

  const run = (action: () => void) => () => {
    onOpenMenu(null)
    action()
  }

  const away = { onAway: () => onOpenMenu(null), ignoreSelector: '.menubar' }

  const menuButton = (name: MenuName, label: string) => (
    <button
      className={`menu-btn ${openMenu === name ? 'menu-btn--open' : ''}`}
      data-testid={tid('menu-btn', name)}
      onClick={() => onOpenMenu(openMenu === name ? null : name)}
      onMouseEnter={() => { if (openMenu && openMenu !== name) onOpenMenu(name) }}
    >
      {label}
    </button>
  )

  return (
    <header className="titlebar">
      <nav className="menubar">
        <img className="brand-mark" src={mark} alt="" draggable={false} title="TaylorMade Agent Monitor" />
        <div className="menu-wrap">
          {menuButton('file', 'File')}
          {openMenu === 'file' && (
            <MenuPop {...away}>
              <MenuItem icon={<FolderPlus strokeWidth={2} />} label="New project…" hint="Create a project folder and open it in Cursor" onClick={run(onNewProject)} />
              <MenuItem icon={<Folder strokeWidth={2} />} label="Open Projects folder" hint="Open the Projects folder in File Explorer" onClick={run(() => window.watch.openProjectsDir())} />
              {canResetOrder && (
                <MenuItem icon={<ListRestart strokeWidth={2} />} label="Reset project order" hint="Forget the dragged order and sort projects by attention again" onClick={run(onResetOrder)} />
              )}
              <div className="menu-sep" />
              <MenuItem icon={<Minus strokeWidth={2} />} label="Hide to tray" hint="Esc" onClick={run(() => window.watch.hide())} />
              <MenuItem icon={<Power strokeWidth={2} />} label="Quit" hint="Quit TaylorMade Agent Monitor (closes the tray app)" onClick={run(() => window.watch.quit())} />
            </MenuPop>
          )}
        </div>

        <div className="menu-wrap">
          {menuButton('terminal', 'Terminal')}
          {openMenu === 'terminal' && (
            <MenuPop {...away}>
              <MenuItem icon={<Terminal strokeWidth={2} />} label="New terminal" hint={paneFull ? 'All six panes are open — opens a window instead' : 'Open a PowerShell terminal in a pane (Ctrl+Shift+`)'} onClick={run(() => onNewTerminal('shell'))} />
              <MenuItem icon={<ProviderBadge provider="claude" />} label="New Claude Code" hint="Start Claude Code in a terminal pane" onClick={run(() => onNewTerminal('claude'))} />
              <MenuItem icon={<ProviderBadge provider="codex" />} label="New Codex" hint="Start Codex in a terminal pane" onClick={run(() => onNewTerminal('codex'))} />
              <div className="menu-sep" />
              <MenuItem icon={<SquareTerminal strokeWidth={2} />} label="Open external terminal" hint="Open Windows Terminal outside the app" onClick={run(() => window.watch.openTerminal(undefined, 'shell'))} />
              <MenuItem icon={<Code2 strokeWidth={2} />} label="Open Cursor" onClick={run(() => window.watch.openCursor())} />
              <MenuItem icon={<Globe strokeWidth={2} />} label="Open Chrome" onClick={run(() => window.watch.openChrome())} />
            </MenuPop>
          )}
        </div>

        <div className="menu-wrap">
          {menuButton('view', 'View')}
          {openMenu === 'view' && (
            <MenuPop {...away}>
              <MenuItem icon={<Search strokeWidth={2} />} label="Command palette…" hint="Ctrl+Shift+P" onClick={run(onPalette)} />
              <div className="menu-sep" />
              <div className="menu-label"><SquarePlus className="menu-label-ic" strokeWidth={2} />Add pane</div>
              {PANE_KINDS.map((p) => (
                <MenuItem
                  key={p.id}
                  icon={<p.icon strokeWidth={2} />}
                  label={p.label}
                  hint={p.hint}
                  disabled={!canAdd(p.id)}
                  onClick={run(() => onAddPane(p.id))}
                />
              ))}
              <div className="menu-sep" />
              <MenuItem
                icon={allCollapsed ? <ChevronsUpDown strokeWidth={2} /> : <ChevronsDownUp strokeWidth={2} />}
                label={allCollapsed ? 'Expand all projects' : 'Collapse all projects'}
                disabled={!canCollapse}
                onClick={run(onCollapseAll)}
              />
              <MenuItem
                icon={<Filter strokeWidth={2} />}
                label={waitingOnly ? 'Show all sessions' : 'Show waiting only'}
                disabled={waiting === 0 && !waitingOnly}
                onClick={run(onWaitingOnly)}
              />
              <div className="menu-sep" />
              {/* Radio groups stay open like the sidebar's check toggles, so a
                  choice can be compared and re-picked without reopening. */}
              <div className="menu-label"><Monitor className="menu-label-ic" strokeWidth={2} />Workspace size</div>
              <MenuCheckItem icon={<Monitor strokeWidth={2} />} label="Full screen" hint="Fill the work area (default)" checked={sizeMode === 'full'} onClick={() => onSizeMode('full')} />
              <MenuCheckItem icon={<PanelLeft strokeWidth={2} />} label="Left half" hint="Take the left half, leaving the right visible" checked={sizeMode === 'left'} onClick={() => onSizeMode('left')} />
              <MenuCheckItem icon={<PanelRight strokeWidth={2} />} label="Right half" hint="Take the right half, leaving the left visible" checked={sizeMode === 'right'} onClick={() => onSizeMode('right')} />
              <div className="menu-sep" />
              <div className="menu-label"><Columns3 className="menu-label-ic" strokeWidth={2} />Columns</div>
              <MenuCheckItem label="Auto" hint="Up to three columns, as panes fit" checked={paneCols === 'auto'} onClick={() => onPaneCols('auto')} />
              <MenuCheckItem label="1 column" checked={paneCols === 1} onClick={() => onPaneCols(1)} />
              <MenuCheckItem label="2 columns" checked={paneCols === 2} onClick={() => onPaneCols(2)} />
              <MenuCheckItem label="3 columns" checked={paneCols === 3} onClick={() => onPaneCols(3)} />
              <div className="menu-sep" />
              <div className="menu-label"><LayoutTemplate className="menu-label-ic" strokeWidth={2} />Layouts</div>
              <MenuItem icon={<Save strokeWidth={2} />} label="Save current layout…" hint="Panes, sizes, and sidebar views under a name" onClick={run(onSaveLayout)} />
              {layouts.map((name) => (
                <MenuItem key={`apply:${name}`} icon={<LayoutTemplate strokeWidth={2} />} label={name} hint={`Apply layout “${name}”`} onClick={run(() => onApplyLayout(name))} />
              ))}
              {layouts.length > 0 && <div className="menu-label"><Trash2 className="menu-label-ic" strokeWidth={2} />Delete layout</div>}
              {layouts.map((name) => (
                <MenuItem key={`delete:${name}`} icon={<Trash2 strokeWidth={2} />} label={name} hint={`Forget layout “${name}”`} onClick={run(() => onDeleteLayout(name))} />
              ))}
              <div className="menu-sep" />
              <MenuItem
                icon={<Ruler strokeWidth={2} />}
                label="Reset pane sizes"
                hint="Sidebar width and dragged column widths back to their defaults"
                disabled={!canResetSizes}
                onClick={run(onResetSizes)}
              />
            </MenuPop>
          )}
        </div>

        <div className="menu-wrap">
          {menuButton('user', 'User')}
          {openMenu === 'user' && (
            <MenuPop {...away}>
              <MenuItem
                icon={<Coins strokeWidth={2} />}
                label="Usage: spend & insights"
                hint={hasUsage ? 'Zoom the open Usage pane' : paneFull ? 'All six panes are open' : 'Open today’s spend and local usage insights in a pane'}
                disabled={!hasUsage && paneFull}
                onClick={run(onUsage)}
              />
              <MenuItem
                icon={<Rss strokeWidth={2} />}
                label="Activity feed"
                hint={hasActivity ? 'Zoom the open Activity pane' : paneFull ? 'All six panes are open' : 'What sessions asked, finished, started, and ended — in a pane'}
                disabled={!hasActivity && paneFull}
                onClick={run(onActivity)}
              />
              <div className="menu-sep" />
              <MenuItem icon={<Settings strokeWidth={2} />} label="Settings…" hint="Hotkey, notifications, startup, updates, hooks (Ctrl+,)" onClick={run(onSettings)} />
              <div className="menu-sep" />
              <div className="menu-status">
                <ConnChip health={health} />
              </div>
            </MenuPop>
          )}
        </div>
      </nav>

      {/* The command center: the palette's front door, where an IDE keeps its
          search box. Ctrl+Shift+P always opens it; Ctrl+P too, unless a
          terminal pane has focus and the key belongs to the shell. */}
      <button className="cmdcenter" onClick={onPalette} title="Search commands, agents, and open windows (Ctrl+Shift+P)" data-testid="cmdcenter">
        <Search className="cmdcenter-ic" strokeWidth={2} />
        <span className="cmdcenter-label">Search commands, agents, windows</span>
        <span className="cmdcenter-keys"><kbd>Ctrl</kbd><kbd>Shift</kbd><kbd>P</kbd></span>
      </button>

      <div className="topbar-status">
        {hot.length > 0 && (
          <button
            className="needs needs--hot"
            onClick={() => onFocusAgent(hot[0].id)}
            title={hot.map((h) => `${h.project}: ${h.pct}% of context used and rising`).join('\n') + '\nClick to focus — /compact soon, or start fresh'}
            data-testid="hot-chip"
          >
            {hot.length === 1 ? `${hot[0].project} · ${hot[0].pct}% ctx ↑` : `${hot.length} sessions near context limit`}
          </button>
        )}
        {waiting > 0 && (
          <button
            className={`needs ${waitingOnly ? 'needs--active' : ''}`}
            onClick={onWaitingOnly}
            title={waitingOnly ? 'Showing waiting sessions only — click to show all' : 'Agents waiting for your input — click to show only them'}
          >
            {waiting} waiting
          </button>
        )}
        {debugPort && (
          <span className="conn conn--cdp" title={`Chrome DevTools Protocol on 127.0.0.1:${debugPort} — an agent can attach here (electron-debug MCP)`} data-testid="cdp-chip">
            CDP :{debugPort}
          </span>
        )}
        <ConnChip health={health} />
      </div>
    </header>
  )
}
