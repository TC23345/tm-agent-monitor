import {
  Code2, Columns3, Folder, FolderOpen, FolderPlus, Globe, Keyboard, LayoutGrid, LayoutTemplate, ListRestart, Minus, Monitor, PanelLeft, PanelRight, Play, Plus, Power, RefreshCw, Rss, Ruler, Save, Search, Sparkles, SquareTerminal, Terminal, Trash2, X
} from 'lucide-react'
import { Settings } from './Icons'
import mark from './assets/icon.png'
import { MenuCheckItem, MenuItem, MenuPop } from './Menu'
import { MAX_PANES, PANE_KINDS, type PaneCols, type PaneInstance, type PaneKind } from './panes'
import type { ProjectCommand, ProviderHealth, ProviderId, SizeMode, TerminalLaunch } from '@shared/types'
import { overallStatus } from '@shared/health.mjs'
import type { FolderEntry } from '@shared/startPage.mjs'
import { ProviderBadge } from './ProviderBadge'
import { REBUILD_HINT } from './StatusBar'
import { useNow } from './useNow'
import { tid } from './testid'

/** Provider health rolled up for the title bar — ticks so "silent for 12m"
 * stays true between snapshots, and only this chip re-renders for it. */
export interface HealthInput {
  providers: Partial<Record<ProviderId, ProviderHealth>> | undefined
  mock: boolean
}

export function ConnChip({ health }: { health: HealthInput }) {
  const now = useNow()
  const conn = overallStatus(health.providers, now, health.mock)
  return (
    <span className={`conn is-${conn.state}`} title={conn.title} data-testid="conn-chip">
      <span className="conn-dot" />
      {conn.label}
    </span>
  )
}

/** The title-bar menus. There is no View menu: what panes and sidebar sections
 * show, the workspace size, columns, and saved layouts are *state*, and state
 * lives in the status bar's popovers (StatusBar.tsx). Menus hold verbs. */
export type MenuName = 'file' | 'layout' | 'terminal' | 'user'

interface Props {
  waiting: number
  waitingOnly: boolean
  onWaitingOnly: () => void
  /** Focus the next waiting session (the chip's click). */
  onRouteWaiting: () => void
  health: HealthInput
  panes: PaneInstance[]
  /** The folder launches and project commands use right now (the selected project badge). */
  context: { cwd?: string; label?: string }
  onNewTerminal: (launch: TerminalLaunch) => void
  /** A chat pane: the extension's conversation with the CLI, in the grid. */
  onNewChat: (provider: 'claude' | 'codex') => void
  onNewProject: () => void
  /** File → New pane: a start page (0.4.77). */
  onNewStart: () => void
  /** File → Open folder…: the OS picker, then a folder pane. */
  onOpenFolder: () => void
  /** File → Open's recent rows (`tm.folders.v1`, newest first). */
  recentFolders: FolderEntry[]
  onOpenRecent: (cwd: string) => void
  /** The Layout menu (the status bar's popover until 0.4.74, the user's call): workspace size (persisted; also the
   * half-view side), grid columns, the sidebar, pace streaks, saved layouts, and the dragged sizes' way back. */
  sizeMode: SizeMode
  onSizeMode: (mode: SizeMode) => void
  paneCols: PaneCols
  onPaneCols: (cols: PaneCols) => void
  canResetSizes: boolean
  onResetSizes: () => void
  fieldOn: boolean
  onToggleField: () => void
  sidebarHidden: boolean
  onToggleSidebar: () => void
  layouts: string[]
  onSaveLayout: () => void
  onApplyLayout: (name: string) => void
  onDeleteLayout: (name: string) => void
  /** This folder's `.tm.json` commands and npm scripts — Terminal → Run. */
  commands: ProjectCommand[]
  onRunCommand: (command: ProjectCommand) => void
  canResetOrder: boolean
  onResetOrder: () => void
  onSettings: () => void
  /** Settings → Keyboard shortcuts, Legend tab (F1). */
  onKeys: () => void
  /** Which dropdown is open. Owned by App so Escape can close it before hiding. */
  openMenu: MenuName | null
  onOpenMenu: (menu: MenuName | null) => void
  /** The command center: opens the palette. */
  onPalette: () => void
  /** Window controls at the far right: a real minimize (the workspace stays in
   * the taskbar and Alt+Tab; the hotkey restores it) and hide-to-tray. */
  onMinimize: () => void
  onHide: () => void
  /** User → Spend / Insights / History: open the pane, or bring the open one forward. */
  onOpenPane: (kind: PaneKind) => void
  /** User → Activity: the sidebar's activity stream, shown and opened up. */
  onActivity: () => void
  /** Root sessions near their context limit and still climbing. */
  hot: { id: string; project: string; pct: number }[]
  onFocusAgent: (id: string) => void
  /** Rebuild & relaunch (File menu): shared busy state with the status bar's Update chip. */
  rebuild: { busy: boolean; msg: string | null }
  onRebuild: () => void
}

/**
 * The app chrome as one IDE-style title bar: brand mark and the File / Terminal
 * / User menus at the left, the command center in the middle, and passive
 * status (waiting count, connection health) at the right. Every action here is
 * also in the palette; the sidebar and panes stay pure content.
 */
export function TopBar(props: Props) {
  const {
    waiting, waitingOnly, onWaitingOnly, onRouteWaiting, health, panes, context, onNewTerminal, onNewChat, onNewProject, onNewStart, onOpenFolder, recentFolders, onOpenRecent, commands, onRunCommand,
    sizeMode, onSizeMode, paneCols, onPaneCols, canResetSizes, onResetSizes, fieldOn, onToggleField, sidebarHidden, onToggleSidebar, layouts, onSaveLayout, onApplyLayout, onDeleteLayout,
    canResetOrder, onResetOrder, onSettings, onKeys, openMenu, onOpenMenu, onPalette, onMinimize, onHide, onOpenPane, onActivity, hot, onFocusAgent,
    rebuild, onRebuild
  } = props

  const paneFull = panes.length >= MAX_PANES
  const where = context.cwd ? (context.label ?? context.cwd) : 'your home folder'

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
              {/* In sections (0.4.77, the user's call): New, Open, Project, then the app. Claude Code and Codex start as chat panes; a terminal is a plain shell. */}
              <div className="menu-label"><Plus className="menu-label-ic" strokeWidth={2} />New</div>
              <MenuItem icon={<ProviderBadge provider="claude" />} label="New TaylorMade CC" hint={paneFull ? 'All six panes are open' : `A TaylorMade CC pane (Claude Code) in ${where} — pick up any earlier session from its history`} onClick={run(() => onNewChat('claude'))} disabled={paneFull} />
              <MenuItem icon={<ProviderBadge provider="codex" />} label="New TaylorMade Codex" hint={paneFull ? 'All six panes are open' : `A TaylorMade Codex pane in ${where} — pick up any earlier thread from its history`} onClick={run(() => onNewChat('codex'))} disabled={paneFull} />
              <MenuItem icon={<Terminal strokeWidth={2} />} label="New terminal" hint={paneFull ? 'All six panes are open — opens a window instead' : `Open a PowerShell terminal in a pane in ${where} (Ctrl+Shift+\`)`} onClick={run(() => onNewTerminal('shell'))} />
              <MenuItem icon={<LayoutGrid strokeWidth={2} />} label="New pane" hint={paneFull ? 'All six panes are open' : 'A start page: tools, suggested projects and recent folders — pick what the pane becomes'} onClick={run(onNewStart)} disabled={paneFull} />
              <div className="menu-sep" />
              <div className="menu-label"><FolderOpen className="menu-label-ic" strokeWidth={2} />Open</div>
              <MenuItem icon={<FolderOpen strokeWidth={2} />} label="Open folder…" hint="Any folder: its files in a pane, with a chat or a terminal there one click away" onClick={run(onOpenFolder)} />
              {recentFolders.slice(0, 5).map((f) => (
                <MenuItem key={f.cwd} icon={<Folder strokeWidth={2} />} label={f.label} hint={f.cwd} onClick={run(() => onOpenRecent(f.cwd))} />
              ))}
              <MenuItem icon={<Folder strokeWidth={2} />} label="Projects folder" hint="Open the Projects folder in File Explorer" onClick={run(() => window.watch.openProjectsDir())} />
              <MenuItem icon={<Code2 strokeWidth={2} />} label="In Cursor" hint={context.cwd ? `Open ${where} in Cursor` : 'Open a new Cursor window'} onClick={run(() => window.watch.openCursor(context.cwd))} />
              <MenuItem icon={<Globe strokeWidth={2} />} label="Chrome" hint="Open a new Chrome window" onClick={run(() => window.watch.openChrome())} />
              <div className="menu-sep" />
              <div className="menu-label"><FolderPlus className="menu-label-ic" strokeWidth={2} />Project</div>
              <MenuItem icon={<FolderPlus strokeWidth={2} />} label="New project…" hint="Create a project folder and open it in Cursor" onClick={run(onNewProject)} />
              {canResetOrder && (
                <MenuItem icon={<ListRestart strokeWidth={2} />} label="Reset project order" hint="Forget the dragged order and sort projects by attention again" onClick={run(onResetOrder)} />
              )}
              <div className="menu-sep" />
              <MenuItem
                icon={<RefreshCw strokeWidth={2} />}
                label={rebuild.busy ? 'Rebuilding…' : 'Rebuild & relaunch'}
                hint={REBUILD_HINT}
                disabled={rebuild.busy}
                onClick={run(onRebuild)}
              />
              <div className="menu-sep" />
              <MenuItem icon={<Minus strokeWidth={2} />} label="Hide to tray" hint="Esc" onClick={run(() => window.watch.hide())} />
              <MenuItem icon={<Power strokeWidth={2} />} label="Quit" hint="Quit TaylorMade Agent Monitor (closes the tray app)" onClick={run(() => window.watch.quit())} />
            </MenuPop>
          )}
        </div>

        <div className="menu-wrap">
          {menuButton('layout', 'Layout')}
          {openMenu === 'layout' && (
            <MenuPop {...away}>
              {/* Radio groups stay open so a choice can be compared and re-picked. */}
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
              <MenuCheckItem
                icon={<PanelLeft strokeWidth={2} />}
                label="Sidebar"
                hint="Ctrl+B (Alt+S inside a terminal): hide it and let the panes fill the frame"
                checked={!sidebarHidden}
                onClick={onToggleSidebar}
                testId="sidebar-toggle"
              />
              <MenuCheckItem
                icon={<Sparkles strokeWidth={2} />}
                label="Pace streaks"
                hint="Streaks along the Session bar's fill while the app projects when you will hit the limit — faster the quicker you burn"
                checked={fieldOn}
                onClick={onToggleField}
              />
              <div className="menu-sep" />
              <div className="menu-label"><LayoutTemplate className="menu-label-ic" strokeWidth={2} />Saved layouts</div>
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
          {menuButton('terminal', 'Terminal')}
          {openMenu === 'terminal' && (
            <MenuPop {...away}>
              <MenuItem icon={<Terminal strokeWidth={2} />} label="New terminal" hint={paneFull ? 'All six panes are open — opens a window instead' : `Open a PowerShell terminal in a pane in ${where} (Ctrl+Shift+\`)`} onClick={run(() => onNewTerminal('shell'))} />
              <MenuItem icon={<SquareTerminal strokeWidth={2} />} label="Open external terminal" hint={`Open Windows Terminal in ${where}, outside the app`} onClick={run(() => window.watch.openTerminal(context.cwd, 'shell'))} />
              {commands.length > 0 && (
                <>
                  <div className="menu-sep" />
                  {/* This folder's scripts. They run in a new terminal pane here;
                      `.tm.json` entries come first, npm scripts after. */}
                  <div className="menu-label"><Play className="menu-label-ic" strokeWidth={2} />Run in {context.label ?? 'this folder'}</div>
                  {commands.map((c) => (
                    <MenuItem
                      key={c.command}
                      icon={<Play strokeWidth={2} />}
                      label={c.label}
                      hint={`${c.command} — in a new terminal pane${c.source === 'tm' ? ' · from .tm.json' : ' · npm script'}`}
                      disabled={paneFull}
                      onClick={run(() => onRunCommand(c))}
                    />
                  ))}
                </>
              )}
            </MenuPop>
          )}
        </div>

        <div className="menu-wrap">
          {menuButton('user', 'User')}
          {openMenu === 'user' && (
            <MenuPop {...away}>
              {/* The data panes, one row each: open it, or bring the open one forward. */}
              {PANE_KINDS.filter((k) => k.id === 'spend' || k.id === 'insights' || k.id === 'history').map((k) => {
                const open = panes.some((p) => p.kind === k.id)
                return (
                  <MenuItem
                    key={k.id}
                    icon={<k.icon strokeWidth={2} />}
                    label={k.label}
                    hint={open ? `Zoom the open ${k.label} pane` : paneFull ? 'All six panes are open' : `${k.hint} — in a pane`}
                    disabled={!open && paneFull}
                    onClick={run(() => onOpenPane(k.id))}
                  />
                )
              })}
              <MenuItem icon={<Rss strokeWidth={2} />} label="Activity" hint="The activity stream at the top of the sidebar — shows the sidebar and opens the stream up" onClick={run(onActivity)} />
              <div className="menu-sep" />
              <MenuItem icon={<Settings strokeWidth={2} />} label="Settings…" hint="Hotkey, notifications, startup, updates, hooks (Ctrl+,)" onClick={run(onSettings)} />
              <MenuItem icon={<Keyboard strokeWidth={2} />} label="Keyboard shortcuts" hint="The Keys pane on and off — every key the workspace, Claude Code, Codex and the shell use (F1)" onClick={run(onKeys)} />
            </MenuPop>
          )}
        </div>
        {/* New project, at hand in the bar (the user's call, 2026-10-22: it sat on the Activity header). */}
        <button className="menu-btn menu-btn--icon" onClick={() => { onOpenMenu(null); onNewProject() }} title="New project — create a project folder and open it in Cursor" aria-label="New project" data-testid="launch-new-project">
          <FolderPlus strokeWidth={2} />
        </button>
      </nav>

      {/* The command center: the palette's front door, where an IDE keeps its
          search box. Ctrl+K opens it everywhere (Ctrl+P too, unless a terminal pane has
          focus and the key belongs to the CLI; Alt+K and Ctrl+Shift+P work
          everywhere (@shared/keymap.mjs). */}
      <button className="cmdcenter" onClick={onPalette} title="Search commands, agents, and open windows (Ctrl+K)" data-testid="cmdcenter">
        <Search className="cmdcenter-ic" strokeWidth={2} />
        <span className="cmdcenter-label">Search commands, agents, windows</span>
        <span className="cmdcenter-keys"><kbd>Ctrl</kbd><kbd>K</kbd></span>
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
        {/* The chip *goes there*: a click lands you in the next waiting session
            (Alt+J or Ctrl+Shift+W); Shift-click is the list filter for the rare case. */}
        {(waiting > 0 || waitingOnly) && (
          <button
            className={`needs ${waitingOnly ? 'needs--active' : ''}`}
            onClick={(event) => { if (event.shiftKey || waitingOnly) onWaitingOnly(); else onRouteWaiting() }}
            title={waitingOnly ? 'Showing waiting sessions only — click to show all' : `${waiting} waiting for your input — click to go to the next one (Alt+J), Shift-click to show only them`}
            data-testid="waiting-chip"
          >
            {waiting} waiting
          </button>
        )}
        <ConnChip health={health} />
        <div className="winctl">
          <button className="winbtn" onClick={onMinimize} title="Minimize — the hotkey or the taskbar brings it back" aria-label="Minimize" data-testid="win-minimize">
            <Minus strokeWidth={2} />
          </button>
          <button className="winbtn winbtn--close" onClick={onHide} title="Hide to tray (Esc)" aria-label="Hide to tray" data-testid="win-hide">
            <X strokeWidth={2} />
          </button>
        </div>
      </div>
    </header>
  )
}
