import { useState, type DragEvent, type MouseEvent, type ReactNode } from 'react'
import { ChevronDown, ChevronRight, Code2, Folder, FolderPlus, Globe, Play, SquareTerminal } from 'lucide-react'
import type { ProjectCommand, TerminalLaunch } from '@shared/types'
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
  /** Which of this nav's popovers is open. App owns it — see NavMenu. */
  openMenu: NavMenu | null
  onOpenMenu: (menu: NavMenu | null) => void
  onLaunch: (launch: TerminalLaunch, external: boolean) => void
  /** What the split row starts on a plain click — the last thing picked. */
  launchKind: TerminalLaunch
  /** Picking from the popover starts it *and* makes it the row's default. */
  onLaunchKind: (launch: TerminalLaunch) => void
  onNewProject: () => void
  commands: ProjectCommand[]
  onRunCommand: (command: ProjectCommand) => void
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
export function LaunchNav({ context, projects, following, onChoose, openMenu, onOpenMenu, onLaunch, launchKind, onLaunchKind, onNewProject, commands, onRunCommand, onDropFolder }: Props) {
  const [commandsOpen, setCommandsOpen] = useState(false)
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
            <MenuCheckItem
              label="Active session"
              hint="Follow whichever session was most recently active"
              checked={following}
              onClick={() => { onOpenMenu(null); onChoose(null) }}
            />
            <MenuCheckItem
              label="Home folder"
              hint="Launch outside any project"
              checked={!following && !context.cwd}
              onClick={() => { onOpenMenu(null); onChoose({}) }}
            />
            {projects.length > 0 && <div className="menu-sep" />}
            {projects.map((p) => (
              <MenuCheckItem
                key={p.cwd}
                label={p.label ?? p.cwd!}
                hint={p.cwd}
                checked={!following && context.cwd === p.cwd}
                onClick={() => { onOpenMenu(null); onChoose(p) }}
              />
            ))}
          </MenuPop>
        )}
      </div>

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
      <NavRow
        icon={<Code2 strokeWidth={2} />}
        label="Open Cursor"
        title={context.cwd ? `Open ${context.label ?? context.cwd} in Cursor` : 'Open a new Cursor window'}
        onClick={() => window.watch.openCursor(context.cwd)}
        testId="launch-cursor"
      />
      <NavRow
        icon={<Globe strokeWidth={2} />}
        label="Open Chrome"
        title="Open a new Chrome window"
        onClick={() => window.watch.openChrome()}
        testId="launch-chrome"
      />

      {commands.length > 0 && (
        <>
          <button
            className="navgroup"
            onClick={() => setCommandsOpen((v) => !v)}
            aria-expanded={commandsOpen}
            title={`Commands from this folder's .tm.json and package.json scripts`}
            data-testid="launch-commands"
          >
            {commandsOpen ? <ChevronDown className="navgroup-caret" strokeWidth={2} /> : <ChevronRight className="navgroup-caret" strokeWidth={2} />}
            Commands
            <span className="navrow-meta">{commands.length}</span>
          </button>
          {commandsOpen && commands.map((c) => (
            <NavRow
              key={c.command}
              icon={<Play strokeWidth={2} />}
              label={c.label}
              title={`${c.command}\nRuns in a new terminal pane${inWhere}${c.source === 'tm' ? ' · from .tm.json' : ' · npm script'}`}
              onClick={() => onRunCommand(c)}
              testId={tid('launch-cmd', c.label)}
            />
          ))}
        </>
      )}

      <div className="navrule" />
      <NavRow
        icon={<FolderPlus strokeWidth={2} />}
        label="New project"
        title="Create a project folder and open it in Cursor"
        onClick={onNewProject}
        testId="launch-new-project"
      />
      <NavRow
        icon={<Folder strokeWidth={2} />}
        label="Projects folder"
        title="Open the Projects folder in File Explorer"
        onClick={() => window.watch.openProjectsDir()}
        testId="launch-projects-dir"
      />
    </nav>
  )
}
