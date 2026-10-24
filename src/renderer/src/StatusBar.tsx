import { ChevronUp, LayoutGrid, Pause, Plus } from 'lucide-react'
import { MenuCheckItem, MenuPop } from './Menu'
import { MAX_PANES, PANE_KINDS, SIDEBAR_VIEWS, isUniqueKind, type PaneInstance, type PaneKind, type SidebarView } from './panes'
import { tid } from './testid'

/** The status bar's popovers. Held in App's single `openMenu`, like every menu. */
export type StatusMenu = 'panes'

interface Props {
  /** + New pane: a start page in the grid (0.4.78, the user's ask — the page was hard to find behind File → New). */
  onNewPane: () => void
  /** Which panes and sidebar sections are showing, and how to flip each. */
  panes: PaneInstance[]
  onAddPane: (kind: PaneKind) => void
  onClosePane: (paneId: string) => void
  sidebarViews: SidebarView[]
  onToggleSidebarView: (view: SidebarView) => void
  openMenu: StatusMenu | null
  onOpenMenu: (menu: StatusMenu | null) => void
  version?: string
  /** CDP port when the app was launched for automation; shown so an agent can find it. */
  debugPort?: number
  /** Clipboard capture is paused (a warning, not a request): the chip resumes it. */
  clipsPaused?: boolean
  onResumeClips?: () => void
}

/**
 * The IDE-style status bar under the workspace. The title-bar menus hold
 * verbs; this bar holds *state*. Left: the **Panes** popover (which unique
 * panes and sidebar sections show) and **+ New pane** (a start page). Right:
 * passive facts (CDP port, version). The Layout popover lived here until
 * 0.4.74 and Update until 0.4.78; both are in the title bar now (the user's calls).
 */
export function StatusBar(props: Props) {
  const {
    onNewPane, panes, onAddPane, onClosePane, sidebarViews, onToggleSidebarView,
    openMenu, onOpenMenu, version, debugPort, clipsPaused, onResumeClips
  } = props
  const full = panes.length >= MAX_PANES
  const toggle = (menu: StatusMenu) => () => onOpenMenu(openMenu === menu ? null : menu)

  return (
    <footer className="statusbar" data-testid="statusbar">
      <div className="statusbar-left">
        <div className="menu-wrap statusbar-menu">
          <button
            className={`status-btn ${openMenu === 'panes' ? 'status-btn--open' : ''}`}
            onClick={toggle('panes')}
            title="Show or hide panes and sidebar sections"
            data-testid={tid('menu-btn', 'panes')}
          >
            <LayoutGrid className="status-ic" strokeWidth={2} />
            Panes
            <ChevronUp className="status-chev" strokeWidth={2} />
          </button>
          {openMenu === 'panes' && (
            <MenuPop onAway={() => onOpenMenu(null)} ignoreSelector=".statusbar-menu">
              {PANE_KINDS.filter((k) => isUniqueKind(k.id)).map((k) => {
                const showing = panes.find((p) => p.kind === k.id)
                return (
                  <MenuCheckItem
                    key={k.id}
                    icon={<k.icon strokeWidth={2} />}
                    label={k.label}
                    hint={showing ? `Close the ${k.label} pane` : full ? 'All six panes are open' : `Open the ${k.label} pane`}
                    checked={Boolean(showing)}
                    onClick={() => { if (showing) onClosePane(showing.id); else if (!full) onAddPane(k.id) }}
                    testId={tid('pane-toggle', k.id)}
                  />
                )
              })}
              <div className="menu-sep" />
              {SIDEBAR_VIEWS.map((v) => (
                <MenuCheckItem
                  key={v.id}
                  icon={<v.icon strokeWidth={2} />}
                  label={v.label}
                  hint={`${sidebarViews.includes(v.id) ? 'Hide' : 'Show'} ${v.label} in the sidebar`}
                  checked={sidebarViews.includes(v.id)}
                  onClick={() => onToggleSidebarView(v.id)}
                  testId={tid('view-toggle', v.id)}
                />
              ))}
            </MenuPop>
          )}
        </div>
        <button
          className="status-btn"
          onClick={() => { onOpenMenu(null); onNewPane() }}
          disabled={full}
          title={full ? 'All six panes are open' : 'A new pane on the start page — tools, suggested projects and recent folders'}
          data-testid="status-new-pane"
        >
          <Plus className="status-ic" strokeWidth={2} />
          New pane
        </button>
      </div>
      <div className="statusbar-right">
        {clipsPaused && (
          <button className="sb-paused" onClick={onResumeClips} title="Clipboard capture is paused — click to resume" data-testid="clips-paused-chip">
            <Pause className="sb-paused-ic" strokeWidth={2} />
            Clipboard paused
          </button>
        )}
        {debugPort && (
          <span className="conn conn--cdp" title={`Chrome DevTools Protocol on 127.0.0.1:${debugPort} — an agent can attach here (electron-debug MCP)`} data-testid="cdp-chip">
            CDP :{debugPort}
          </span>
        )}
        {version && <span className="status-version" title="Installed version" data-testid="version-chip">v{version}</span>}
      </div>
    </footer>
  )
}
