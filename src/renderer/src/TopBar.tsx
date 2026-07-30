import { ChevronsDownUp, ChevronsUpDown, FolderOpen, Minus, SquarePlus } from 'lucide-react'
import { Settings } from './Icons'
import logo from './assets/logo.png'

interface Props {
  waiting: number
  waitingOnly: boolean
  onWaitingOnly: () => void
  canCollapse: boolean
  allCollapsed: boolean
  onCollapseAll: () => void
  conn: { state: 'on' | 'warn' | 'off'; label: string; title: string }
  canAddPane: boolean
  onAddPane: () => void
  onProjects: () => void
  onSettings: () => void
}

/**
 * The single control strip. Session state, connection health, layout, and every
 * app action live here — the sidebar and panes below stay pure content.
 */
export function TopBar({
  waiting, waitingOnly, onWaitingOnly, canCollapse, allCollapsed, onCollapseAll,
  conn, canAddPane, onAddPane, onProjects, onSettings
}: Props) {
  return (
    <header className="topbar">
      <img className="brand" src={logo} alt="TaylorMade Solutions" draggable={false} />

      <div className="topbar-right">
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

        <span className="tb-sep" />

        {canCollapse && (
          <button
            className="iconbtn"
            title={allCollapsed ? 'Expand all projects' : 'Collapse all projects'}
            aria-label={allCollapsed ? 'Expand all projects' : 'Collapse all projects'}
            onClick={onCollapseAll}
          >
            {allCollapsed
              ? <ChevronsUpDown className="gear" strokeWidth={2} />
              : <ChevronsDownUp className="gear" strokeWidth={2} />}
          </button>
        )}
        <button
          className="iconbtn"
          title={canAddPane ? 'Add a pane to the main frame' : 'All six panes are open'}
          aria-label="Add a pane"
          onClick={onAddPane}
          disabled={!canAddPane}
        >
          <SquarePlus className="gear" strokeWidth={2} />
        </button>
        <button className="iconbtn" title="Projects — new project, open Cursor, open the Projects folder" aria-label="Projects" onClick={onProjects}>
          <FolderOpen className="gear" strokeWidth={2} />
        </button>
        <button className="iconbtn" title="Settings — hotkey, notifications, startup, updates" aria-label="Settings" onClick={onSettings}>
          <Settings className="gear" strokeWidth={2} />
        </button>

        <span className="tb-sep" />

        <button className="iconbtn" title="Hide to the tray (Esc)" aria-label="Hide to the tray" onClick={() => window.watch.hide()}>
          <Minus className="gear" strokeWidth={2} />
        </button>
        <button className="quit" title="Quit TaylorMade Agent Monitor (closes the tray app)" onClick={() => window.watch.quit()}>Quit</button>
      </div>
    </header>
  )
}
