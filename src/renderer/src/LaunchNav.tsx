import { useState, type DragEvent, type MouseEvent, type ReactNode } from 'react'
import { Activity, Check, ChevronDown, Folder, FolderPlus, Home, SquareTerminal } from 'lucide-react'
import type { TerminalLaunch } from '@shared/types'
import { ProviderBadge } from './ProviderBadge'
import { MenuCheckItem, MenuPop } from './Menu'
import { tid } from './testid'

/** Where launches land. `cwd` undefined means the home folder. */
export interface LaunchTarget {
  cwd?: string
  label?: string
}

/** The nav's two popovers. They live in App's single `openMenu` state rather
 * than in local state, so only one menu across the whole window is ever open
 * and Escape closes them at the documented point in the chain instead of
 * falling through to hiding the workspace. */
export type NavMenu = 'launch-target' | 'launch-pick'

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
  /** What the split row starts on a plain click — the last thing picked. */
  launchKind: TerminalLaunch
  /** Picking from the popover starts it *and* makes it the row's default. */
  onLaunchKind: (launch: TerminalLaunch) => void
  onNewProject: () => void
  /** A folder dropped from Explorer becomes the launch target. */
  onDropFolder: (path: string) => void
}

/**
 * The three ways to start a session, in popover order. They are one row rather
 * than three: the verb is identical and only the agent differs, so listing them
 * separately spent a third of the nav on one decision. The row runs the last
 * one picked, so the common case is still one click.
 */
const LAUNCHES: { kind: TerminalLaunch; label: string; icon: ReactNode; testId: string; meta?: string; what: string }[] = [
  { kind: 'claude', label: 'New Claude Code', icon: <ProviderBadge provider="claude" />, testId: 'launch-claude', what: 'Claude Code' },
  { kind: 'codex', label: 'New Codex', icon: <ProviderBadge provider="codex" />, testId: 'launch-codex', what: 'Codex' },
  { kind: 'shell', label: 'New terminal', icon: <SquareTerminal strokeWidth={2} />, testId: 'launch-shell', meta: 'Ctrl+Shift+`', what: 'a PowerShell terminal' }
]

function NavRow({ icon, label, meta, title, onClick, testId }: {
  icon: ReactNode
  label: string
  meta?: string
  title?: string
  onClick: (event: MouseEvent<HTMLButtonElement>) => void
  testId?: string
}) {
  return (
    <button className="navrow" onClick={onClick} title={title} data-testid={testId}>
      <span className="navrow-ic">{icon}</span>
      <span className="navrow-label">{label}</span>
      {meta && <span className="navrow-meta">{meta}</span>}
    </button>
  )
}

/**
 * The head of the sidebar: what to start, and where it lands — a workspace
 * switcher over a short list of actions, the shape a chat app uses for "new
 * chat" plus a couple of pages. It replaced the Launch pane, so the grid holds
 * only work (terminals, reports) and starting something never costs a pane.
 *
 * Starting a session is one split row rather than three: the button runs the
 * last thing picked (so the common case stays one click) and the chevron opens
 * the popover for the other two. Opening an app — Cursor, Chrome — is a
 * different verb and keeps its own row.
 *
 * Dropping a folder from Explorer here retargets every launch at it (the path
 * comes from `webUtils.getPathForFile` in the preload — `File.path` was
 * removed in Electron 32).
 */
export function LaunchNav({ context, projects, following, onChoose, recent, openMenu, onOpenMenu, onLaunch, launchKind, onLaunchKind, onNewProject, onDropFolder }: Props) {
  const [dropHot, setDropHot] = useState(false)
  const switcherOpen = openMenu === 'launch-target'
  const launchOpen = openMenu === 'launch-pick'
  const toggle = (menu: NavMenu) => () => onOpenMenu(openMenu === menu ? null : menu)

  const where = context.cwd ? (context.label ?? context.cwd) : 'Home folder'
  const inWhere = context.cwd ? ` in ${context.label ?? context.cwd}` : ' in your home folder'
  const primary = LAUNCHES.find((l) => l.kind === launchKind) ?? LAUNCHES[0]
  // `.navsplit-wrap` wraps the popover as well as its trigger, so a pointerdown
  // on a row is not "away" — otherwise the row would unmount before its click
  // landed. The cost is that the buttons close the popover themselves.
  const launch = (kind: TerminalLaunch) => (event: MouseEvent<HTMLButtonElement>) => {
    onOpenMenu(null)
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
          onClick={toggle('launch-target')}
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
      <div className="navsplit-wrap">
        <div className="navsplit">
          <button
            className="navrow navsplit-go"
            onClick={launch(primary.kind)}
            title={`Start ${primary.what} in a terminal pane${inWhere} — Shift-click for an external window`}
            data-testid="launch-new"
          >
            <span className="navrow-ic">{primary.icon}</span>
            <span className="navrow-label">{primary.label}</span>
            {primary.meta && <span className="navrow-meta">{primary.meta}</span>}
          </button>
          <button
            className="navsplit-pick"
            onClick={toggle('launch-pick')}
            aria-expanded={launchOpen}
            aria-label="Choose what to start"
            title="Choose what to start"
            data-testid="launch-pick"
          >
            <ChevronDown className="sidebar-caret" strokeWidth={2} />
          </button>
        </div>
        {launchOpen && (
          <MenuPop onAway={() => onOpenMenu(null)} ignoreSelector=".navsplit-wrap">
            {LAUNCHES.map((l) => (
              <MenuCheckItem
                key={l.kind}
                icon={l.icon}
                label={l.label}
                hint={`Start ${l.what}${inWhere}, and make it what this row starts${l.meta ? ` (${l.meta} always opens a terminal)` : ''} — Shift-click for an external window`}
                checked={l.kind === primary.kind}
                testId={l.testId}
                onClick={(event) => { onLaunchKind(l.kind); launch(l.kind)(event) }}
              />
            ))}
          </MenuPop>
        )}
      </div>
      {/* Nothing else on the launch path. Open in Cursor, Open Chrome, and the
          Projects folder are File-menu verbs (and palette items); the folder's
          scripts are Terminal → Run. New project stays: it is how a project
          starts existing. */}
      <div className="navrule" />
      <NavRow
        icon={<FolderPlus strokeWidth={2} />}
        label="New project"
        title="Create a project folder and open it in Cursor"
        onClick={onNewProject}
        testId="launch-new-project"
      />
    </nav>
  )
}
