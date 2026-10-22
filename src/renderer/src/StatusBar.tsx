import { ChevronUp, LayoutGrid, Pause, RefreshCw } from 'lucide-react'
import { MenuCheckItem, MenuPop } from './Menu'
import { MAX_PANES, PANE_KINDS, SIDEBAR_VIEWS, isUniqueKind, type PaneInstance, type PaneKind, type SidebarView } from './panes'
import { tid } from './testid'

/** The status bar's popovers. Held in App's single `openMenu`, like every menu. */
export type StatusMenu = 'panes'

interface Props {
  /** Rebuild & relaunch: shared busy state and main's last reply. */
  rebuild: { busy: boolean; msg: string | null }
  onRebuild: () => void
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

export const REBUILD_HINT = 'Quit, rebuild the installer from the local checkout (npm run dist), silently reinstall, and relaunch'

/**
 * The IDE-style status bar under the workspace. The title-bar menus hold
 * verbs; this bar holds *state*. Left: the one build action (Update) with
 * main's last reply beside it, then the **Panes** popover (which unique panes
 * and sidebar sections show). Right: passive facts (CDP port, version). The
 * Layout popover lived here until 0.4.74; it is the title bar's *Layout* menu
 * now (the user's call).
 */
export function StatusBar(props: Props) {
  const {
    rebuild, onRebuild, panes, onAddPane, onClosePane, sidebarViews, onToggleSidebarView,
    openMenu, onOpenMenu, version, debugPort, clipsPaused, onResumeClips
  } = props
  const full = panes.length >= MAX_PANES
  const warn = rebuild.msg ? /failed|no repo|no installer|dev build|could not/.test(rebuild.msg) : false
  const toggle = (menu: StatusMenu) => () => onOpenMenu(openMenu === menu ? null : menu)

  return (
    <footer className="statusbar" data-testid="statusbar">
      <div className="statusbar-left">
        <button
          className={`update-btn ${rebuild.busy ? 'is-busy' : ''}`}
          onClick={onRebuild}
          disabled={rebuild.busy}
          title={REBUILD_HINT}
          data-testid="update-chip"
        >
          <RefreshCw className="update-ic" strokeWidth={2} />
          {rebuild.busy ? 'Building…' : 'Update'}
        </button>
        {rebuild.msg && (
          <span className={`update-msg ${warn ? 'is-warn' : ''}`} title={rebuild.msg} data-testid="update-msg">
            {rebuild.msg}
          </span>
        )}

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
