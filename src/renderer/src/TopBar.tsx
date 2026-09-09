import {
  Code2, Folder, FolderPlus, Globe, ListRestart, Minus, Play, Power, RefreshCw, Search, SquareTerminal, Terminal
} from 'lucide-react'
import { Settings } from './Icons'
import mark from './assets/icon.png'
import { MenuItem, MenuPop } from './Menu'
import { MAX_PANES, PANE_KINDS, type PaneInstance, type PaneKind } from './panes'
import type { ProjectCommand, ProviderHealth, ProviderId, TerminalLaunch } from '@shared/types'
import { overallStatus } from '@shared/health.mjs'
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
export type MenuName = 'file' | 'terminal' | 'user'

interface Props {
  waiting: number
  waitingOnly: boolean
  onWaitingOnly: () => void
  health: HealthInput
  panes: PaneInstance[]
  /** The folder launches and project commands use right now (the launch nav's target). */
  context: { cwd?: string; label?: string }
  onNewTerminal: (launch: TerminalLaunch) => void
  onNewProject: () => void
  /** This folder's `.tm.json` commands and npm scripts — Terminal → Run. */
  commands: ProjectCommand[]
  onRunCommand: (command: ProjectCommand) => void
  canResetOrder: boolean
  onResetOrder: () => void
  onSettings: () => void
  /** Which dropdown is open. Owned by App so Escape can close it before hiding. */
  openMenu: MenuName | null
  onOpenMenu: (menu: MenuName | null) => void
  /** The command center: opens the palette. */
  onPalette: () => void
  /** User → Spend / Insights / History / Activity: open the pane, or bring the open one forward. */
  onOpenPane: (kind: PaneKind) => void
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
    waiting, waitingOnly, onWaitingOnly, health, panes, context, onNewTerminal, onNewProject, commands, onRunCommand,
    canResetOrder, onResetOrder, onSettings, openMenu, onOpenMenu, onPalette, onOpenPane, hot, onFocusAgent,
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
              <MenuItem icon={<FolderPlus strokeWidth={2} />} label="New project…" hint="Create a project folder and open it in Cursor" onClick={run(onNewProject)} />
              <MenuItem icon={<Folder strokeWidth={2} />} label="Open Projects folder" hint="Open the Projects folder in File Explorer" onClick={run(() => window.watch.openProjectsDir())} />
              <div className="menu-sep" />
              <MenuItem icon={<Code2 strokeWidth={2} />} label="Open in Cursor" hint={context.cwd ? `Open ${where} in Cursor` : 'Open a new Cursor window'} onClick={run(() => window.watch.openCursor(context.cwd))} />
              <MenuItem icon={<Globe strokeWidth={2} />} label="Open Chrome" hint="Open a new Chrome window" onClick={run(() => window.watch.openChrome())} />
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
          {menuButton('terminal', 'Terminal')}
          {openMenu === 'terminal' && (
            <MenuPop {...away}>
              {/* Agents first: starting one is the reason the workspace exists. */}
              <MenuItem icon={<ProviderBadge provider="claude" />} label="New Claude Code" hint={`Start Claude Code in a terminal pane in ${where}`} onClick={run(() => onNewTerminal('claude'))} />
              <MenuItem icon={<ProviderBadge provider="codex" />} label="New Codex" hint={`Start Codex in a terminal pane in ${where}`} onClick={run(() => onNewTerminal('codex'))} />
              <MenuItem icon={<Terminal strokeWidth={2} />} label="New terminal" hint={paneFull ? 'All six panes are open — opens a window instead' : `Open a PowerShell terminal in a pane in ${where} (Ctrl+Shift+\`)`} onClick={run(() => onNewTerminal('shell'))} />
              <div className="menu-sep" />
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
              {PANE_KINDS.filter((k) => k.id === 'spend' || k.id === 'insights' || k.id === 'history' || k.id === 'activity').map((k) => {
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
        <ConnChip health={health} />
      </div>
    </header>
  )
}
