import { useState, type DragEvent, type MouseEvent, type ReactNode } from 'react'
import { Activity, Check, ChevronDown, Folder, FolderPlus, Home, SquareTerminal } from 'lucide-react'
import type { TerminalLaunch } from '@shared/types'
import { ProviderBadge } from './ProviderBadge'
import { MenuCheckItem, MenuItem, MenuPop } from './Menu'
import { tid } from './testid'

/** Where launches land. `cwd` undefined means the home folder. */
export interface LaunchTarget {
  cwd?: string
  label?: string
}

/** The nav's popover. It lives in App's single `openMenu` state rather than
 * in local state, so only one menu across the whole window is ever open and
 * Escape closes it at the documented point in the chain instead of falling
 * through to hiding the workspace. */
export type NavMenu = 'launch-target'

interface Props {
  /** The folder launches use right now. */
  context: LaunchTarget
  /** Projects the switcher can point at (live sessions, newest first). */
  projects: LaunchTarget[]
  /** True while the target follows whichever session was most recently active. */
  following: boolean
  /** null re-follows the active session; a target pins that folder. */
  onChoose: (target: LaunchTarget | null) => void
  /** Up to three other live projects, newest first — one-click retargets. */
  recent: LaunchTarget[]
  /** Which of this nav's popovers is open. App owns it — see NavMenu. */
  openMenu: NavMenu | null
  onOpenMenu: (menu: NavMenu | null) => void
  onLaunch: (launch: TerminalLaunch, external: boolean) => void
  /** This folder's usual launch — highlighted in the icon row. */
  launchKind: TerminalLaunch
  /** Starting something records it as this folder's usual launch. */
  onLaunchKind: (launch: TerminalLaunch) => void
  onNewProject: () => void
  /** A folder dropped from Explorer becomes the launch target. */
  onDropFolder: (path: string) => void
}

/** The three ways to start a session, in row and menu order. */
const LAUNCHES: { kind: TerminalLaunch; label: string; icon: ReactNode; testId: string; meta?: string; what: string }[] = [
  { kind: 'claude', label: 'New Claude Code', icon: <ProviderBadge provider="claude" />, testId: 'launch-claude', what: 'Claude Code' },
  { kind: 'codex', label: 'New Codex', icon: <ProviderBadge provider="codex" />, testId: 'launch-codex', what: 'Codex' },
  { kind: 'shell', label: 'New terminal', icon: <SquareTerminal strokeWidth={2} />, testId: 'launch-shell', meta: 'Ctrl+Shift+`', what: 'a PowerShell terminal' }
]

/**
 * The head of the sidebar: where launches land, and how to start one.
 *
 * One switcher (which project — following the active session by default),
 * up to three chips for the other live projects, and one row of four icons:
 * Claude Code, Codex, terminal, new project — the activity-bar shape an
 * editor uses. The switcher's popover holds the same starts as a list with
 * names, for anyone who wants words; both record the pick as this folder's
 * usual launch, which the icon row highlights.
 *
 * Dropping a folder from Explorer here retargets every launch at it (the path
 * comes from `webUtils.getPathForFile` in the preload — `File.path` was
 * removed in Electron 32).
 */
export function LaunchNav({ context, projects, following, onChoose, recent, openMenu, onOpenMenu, onLaunch, launchKind, onLaunchKind, onNewProject, onDropFolder }: Props) {
  const [dropHot, setDropHot] = useState(false)
  const switcherOpen = openMenu === 'launch-target'

  const where = context.cwd ? (context.label ?? context.cwd) : 'Home folder'
  const inWhere = context.cwd ? ` in ${context.label ?? context.cwd}` : ' in your home folder'
  const start = (kind: TerminalLaunch) => (event: MouseEvent<HTMLButtonElement>) => {
    onOpenMenu(null)
    onLaunchKind(kind)
    onLaunch(kind, event.shiftKey)
  }

  const onDrop = (event: DragEvent) => {
    event.preventDefault()
    setDropHot(false)
    const file = event.dataTransfer.files?.[0]
    if (!file) return
    const path = window.watch.pathForFile(file)
    if (path) onDropFolder(path)
  }

  return (
    <nav
      className={`launchnav ${dropHot ? 'is-drop' : ''}`}
      data-testid="launch-nav"
      onDragOver={(event) => {
        if (!event.dataTransfer.types.includes('Files')) return
        event.preventDefault()
        event.dataTransfer.dropEffect = 'copy'
        if (!dropHot) setDropHot(true)
      }}
      onDragLeave={(event) => {
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) return
        setDropHot(false)
      }}
      onDrop={onDrop}
    >
      <div className="navswitch-wrap">
        <button
          className="navswitch"
          onClick={() => onOpenMenu(switcherOpen ? null : 'launch-target')}
          aria-expanded={switcherOpen}
          title={`Launches open ${context.cwd ? `in ${context.cwd}` : 'in your home folder'}${following ? ' — following the active session' : ''}\nDrop a folder here to launch there instead`}
          data-testid="launch-target"
        >
          <Folder className="navswitch-ic" strokeWidth={2} />
          <span className="navswitch-name">{where}</span>
          {following && <span className="navswitch-follow" title="Following whichever session was active last">auto</span>}
          <ChevronDown className="sidebar-caret" strokeWidth={2} />
        </button>
        {switcherOpen && (
          <MenuPop onAway={() => onOpenMenu(null)} ignoreSelector=".navswitch-wrap">
            <div className="menu-label"><Activity className="menu-label-ic" strokeWidth={2} />Follow</div>
            <MenuCheckItem
              icon={<Activity strokeWidth={2} />}
              label="Active session"
              hint="Follow whichever session was most recently active"
              checked={following}
              onClick={() => { onOpenMenu(null); onChoose(null) }}
            />
            <MenuCheckItem
              icon={<Home strokeWidth={2} />}
              label="Home folder"
              hint="Launch outside any project"
              checked={!following && !context.cwd}
              onClick={() => { onOpenMenu(null); onChoose({}) }}
            />
            {projects.length > 0 && (
              <>
                <div className="menu-sep" />
                <div className="menu-label"><Folder className="menu-label-ic" strokeWidth={2} />Live projects</div>
                {/* Name over path: two projects can share a name, never a path. */}
                {projects.map((p) => {
                  const current = !following && context.cwd === p.cwd
                  return (
                    <button
                      key={p.cwd}
                      className="menu-item navpick"
                      onClick={() => { onOpenMenu(null); onChoose(p) }}
                      title={`Launch in ${p.cwd}`}
                      aria-pressed={current}
                      data-testid={tid('pick', p.label ?? p.cwd)}
                    >
                      <span className="menu-item-ic"><Folder strokeWidth={2} /></span>
                      <span className="navpick-text">
                        <span className="navpick-name">{p.label ?? p.cwd}</span>
                        <span className="navpick-path">{p.cwd}</span>
                      </span>
                      <span className={`menu-check ${current ? '' : 'menu-check--off'}`}><Check strokeWidth={2.5} /></span>
                    </button>
                  )
                })}
              </>
            )}
            <div className="menu-sep" />
            <div className="menu-label"><SquareTerminal className="menu-label-ic" strokeWidth={2} />Start{context.cwd ? ` in ${context.label ?? context.cwd}` : ' at home'}</div>
            {LAUNCHES.map((l) => (
              <MenuCheckItem
                key={l.kind}
                icon={l.icon}
                label={l.label}
                hint={`Start ${l.what}${inWhere}${l.meta ? ` (${l.meta})` : ''} — Shift-click for an external window`}
                checked={l.kind === launchKind}
                testId={tid('menu', l.label)}
                onClick={start(l.kind)}
              />
            ))}
            <MenuItem icon={<FolderPlus strokeWidth={2} />} label="New project…" hint="Create a project folder and open it in Cursor" onClick={() => { onOpenMenu(null); onNewProject() }} />
          </MenuPop>
        )}
      </div>

      {/* The other live projects, one click each; the dropdown keeps the
          full list, home, and dropped folders. Nothing to show costs no space. */}
      {recent.length > 0 && (
        <div className="navrecent" data-testid="nav-recent">
          {recent.map((p) => (
            <button key={p.cwd} className="navchip" onClick={() => onChoose(p)} title={`Point launches at ${p.cwd}`} data-testid={tid('recent', p.label ?? p.cwd)}>
              {p.label ?? p.cwd}
            </button>
          ))}
        </div>
      )}

      {/* The activity row: the three starts and a new project. The folder's
          usual launch sits on a square, the way an editor marks the active
          activity. Shift-click a start for an external window. */}
      <div className="navicons" role="toolbar" aria-label="Start" data-testid="nav-icons">
        {LAUNCHES.map((l) => (
          <button
            key={l.kind}
            className={`naviconbtn ${l.kind === launchKind ? 'is-usual' : ''}`}
            onClick={start(l.kind)}
            title={`${l.label}${inWhere}${l.meta ? ` (${l.meta})` : ''}${l.kind === launchKind ? ' — this folder’s usual' : ''}\nShift-click for an external window`}
            aria-label={l.label}
            aria-pressed={l.kind === launchKind}
            data-testid={l.testId}
          >
            {l.icon}
          </button>
        ))}
        <span className="navicons-gap" />
        <button
          className="naviconbtn"
          onClick={onNewProject}
          title="New project — create a project folder and open it in Cursor"
          aria-label="New project"
          data-testid="launch-new-project"
        >
          <FolderPlus strokeWidth={2} />
        </button>
      </div>
    </nav>
  )
}
