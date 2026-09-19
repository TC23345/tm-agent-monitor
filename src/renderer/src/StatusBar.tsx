import { AppWindow, ChevronUp, Columns3, LayoutGrid, LayoutTemplate, Magnet, Monitor, PanelLeft, PanelRight, RefreshCw, Ruler, Save, Sparkles, Trash2 } from 'lucide-react'
import { MenuCheckItem, MenuItem, MenuPop } from './Menu'
import { MAX_PANES, PANE_KINDS, SIDEBAR_VIEWS, isUniqueKind, type PaneCols, type PaneInstance, type PaneKind, type SidebarView } from './panes'
import type { SizeMode } from '@shared/types'
import { tid } from './testid'

/** The status bar's popovers. Held in App's single `openMenu`, like every menu. */
export type StatusMenu = 'panes' | 'layout'

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
  /** Workspace size (persisted; also the half-view side), grid columns, and the
   * dragged sizes' way back to defaults. */
  sizeMode: SizeMode
  onSizeMode: (mode: SizeMode) => void
  paneCols: PaneCols
  onPaneCols: (cols: PaneCols) => void
  canResetSizes: boolean
  onResetSizes: () => void
  /** The on-demand GPU effects: pane burst, hover beam, Session-bar streaks. */
  fieldOn: boolean
  onToggleField: () => void
  /** Outside windows: dock the ones we launch, and gather the rest on demand. */
  arrangeWindows: boolean
  onToggleArrange: () => void
  onTidyWindows: () => void
  /** Named layouts: save the current one, apply or forget a saved one. */
  layouts: string[]
  onSaveLayout: () => void
  onApplyLayout: (name: string) => void
  onDeleteLayout: (name: string) => void
  openMenu: StatusMenu | null
  onOpenMenu: (menu: StatusMenu | null) => void
  version?: string
  /** CDP port when the app was launched for automation; shown so an agent can find it. */
  debugPort?: number
}

export const REBUILD_HINT = 'Quit, rebuild the installer from the local checkout (npm run dist), silently reinstall, and relaunch'

const SIZE_LABEL: Record<SizeMode, string> = { full: 'Full', left: 'Left half', right: 'Right half' }

/**
 * The IDE-style status bar under the workspace. The title-bar menus hold
 * verbs; this bar holds *state*. Left: the one build action (Update) with
 * main's last reply beside it, then two popovers — **Panes** (which unique
 * panes and sidebar sections show) and **Layout** (workspace size, columns,
 * saved layouts, reset). Right: passive facts (CDP port, version). The Layout
 * chip's label is the live state, so the bar reads as state even closed.
 */
export function StatusBar(props: Props) {
  const {
    rebuild, onRebuild, panes, onAddPane, onClosePane, sidebarViews, onToggleSidebarView,
    sizeMode, onSizeMode, paneCols, onPaneCols, canResetSizes, onResetSizes, fieldOn, onToggleField,
    arrangeWindows, onToggleArrange, onTidyWindows,
    layouts, onSaveLayout, onApplyLayout, onDeleteLayout, openMenu, onOpenMenu, version, debugPort
  } = props
  const full = panes.length >= MAX_PANES
  const warn = rebuild.msg ? /failed|no repo|no installer|dev build|could not/.test(rebuild.msg) : false
  const toggle = (menu: StatusMenu) => () => onOpenMenu(openMenu === menu ? null : menu)
  const run = (action: () => void) => () => { onOpenMenu(null); action() }

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

        <div className="menu-wrap statusbar-menu">
          <button
            className={`status-btn ${openMenu === 'layout' ? 'status-btn--open' : ''}`}
            onClick={toggle('layout')}
            title="Workspace size, grid columns, saved layouts"
            data-testid={tid('menu-btn', 'layout')}
          >
            <Monitor className="status-ic" strokeWidth={2} />
            {SIZE_LABEL[sizeMode]} · {paneCols === 'auto' ? 'Auto' : `${paneCols} col`}
            <ChevronUp className="status-chev" strokeWidth={2} />
          </button>
          {openMenu === 'layout' && (
            <MenuPop onAway={() => onOpenMenu(null)} ignoreSelector=".statusbar-menu">
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
              <div className="menu-label"><AppWindow className="menu-label-ic" strokeWidth={2} />Outside windows</div>
              <MenuCheckItem
                icon={<Magnet strokeWidth={2} />}
                label="Arrange launched windows"
                hint="Cursor, Chrome, and external terminals open docked right of the sidebar, the same size every time"
                checked={arrangeWindows}
                onClick={onToggleArrange}
              />
              <MenuItem icon={<AppWindow strokeWidth={2} />} label="Tidy windows" hint="Dock every editor, terminal, and browser window on this display right of the sidebar" onClick={run(onTidyWindows)} />
              <div className="menu-sep" />
              <MenuCheckItem
                icon={<Sparkles strokeWidth={2} />}
                label="Attention effects"
                hint="A burst over a pane when its session starts waiting, a beam from a hovered session to its pane, and pace streaks on the Session bar"
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
      </div>
      <div className="statusbar-right">
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
