import {
  ChevronsDownUp, ChevronsUpDown, Code2, Columns3, Filter, Folder, FolderPlus, Globe,
  ListRestart, Minus, Monitor, PanelLeft, PanelRight, Power, SquarePlus, SquareTerminal, Terminal
} from 'lucide-react'
import { Settings } from './Icons'
import logo from './assets/logo.png'
import { MenuCheckItem, MenuItem, MenuPop } from './Menu'
import { MAX_PANES, PANE_KINDS, isUniqueKind, type PaneCols, type PaneInstance, type PaneKind } from './panes'
import type { SizeMode, TerminalLaunch } from '@shared/types'
import { ProviderBadge } from './ProviderBadge'

export type MenuName = 'file' | 'terminal' | 'view' | 'user'

interface Props {
  waiting: number
  waitingOnly: boolean
  onWaitingOnly: () => void
  canCollapse: boolean
  allCollapsed: boolean
  onCollapseAll: () => void
  conn: { state: 'on' | 'warn' | 'off'; label: string; title: string }
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
  /** Which dropdown is open. Owned by App so Escape can close it before hiding. */
  openMenu: MenuName | null
  onOpenMenu: (menu: MenuName | null) => void
}

/**
 * The app chrome: brand row, then a standard File / Terminal / View / User menu
 * strip under the logo. Every app action lives in these menus — the top right
 * keeps only passive status (waiting count, connection health). The sidebar and
 * panes below stay pure content.
 */
export function TopBar(props: Props) {
  const {
    waiting, waitingOnly, onWaitingOnly, canCollapse, allCollapsed, onCollapseAll, conn,
    panes, onAddPane, onNewTerminal, onNewProject, canResetOrder, onResetOrder, onSettings,
    sizeMode, onSizeMode, paneCols, onPaneCols, openMenu, onOpenMenu
  } = props

  const paneFull = panes.length >= MAX_PANES
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
      onClick={() => onOpenMenu(openMenu === name ? null : name)}
      onMouseEnter={() => { if (openMenu && openMenu !== name) onOpenMenu(name) }}
    >
      {label}
    </button>
  )

  return (
    <header className="topbar">
      <div className="topbar-brandrow">
        <img className="brand" src={logo} alt="TaylorMade Solutions" draggable={false} />
        <div className="topbar-status">
          {waiting > 0 && (
            <button
              className={`needs ${waitingOnly ? 'needs--active' : ''}`}
              onClick={onWaitingOnly}
              title={waitingOnly ? 'Showing waiting sessions only — click to show all' : 'Agents waiting for your input — click to show only them'}
            >
              {waiting} waiting
            </button>
          )}
          <div className={`conn is-${conn.state}`} title={conn.title}>
            <span className="conn-dot" />
            {conn.label}
          </div>
        </div>
      </div>

      <nav className="menubar">
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
              <MenuItem icon={<Terminal strokeWidth={2} />} label="New terminal" hint={paneFull ? 'All six panes are open — opens a window instead' : 'Open a PowerShell terminal in a pane'} onClick={run(() => onNewTerminal('shell'))} />
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
            </MenuPop>
          )}
        </div>

        <div className="menu-wrap">
          {menuButton('user', 'User')}
          {openMenu === 'user' && (
            <MenuPop {...away}>
              <MenuItem icon={<Settings strokeWidth={2} />} label="Settings…" hint="Hotkey, notifications, startup, updates, hooks" onClick={run(onSettings)} />
              <div className="menu-sep" />
              <div className="menu-status" title={conn.title}>
                <span className={`conn is-${conn.state}`}><span className="conn-dot" />{conn.label}</span>
              </div>
            </MenuPop>
          )}
        </div>
      </nav>
    </header>
  )
}
