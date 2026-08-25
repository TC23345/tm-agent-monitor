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

interface Props {
  /** The folder launches use right now. */
  context: LaunchTarget
  /** Projects the switcher can point at (live sessions, newest first). */
  projects: LaunchTarget[]
  /** True while the target follows whichever session was most recently active. */
  following: boolean
  /** null re-follows the active session; a target pins that folder. */
  onChoose: (target: LaunchTarget | null) => void
  onLaunch: (launch: TerminalLaunch, external: boolean) => void
  onNewProject: () => void
  commands: ProjectCommand[]
  onRunCommand: (command: ProjectCommand) => void
  /** A folder dropped from Explorer becomes the launch target. */
  onDropFolder: (path: string) => void
}

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
 * Dropping a folder from Explorer here retargets every launch at it (the path
 * comes from `webUtils.getPathForFile` in the preload — `File.path` was
 * removed in Electron 32).
 */
export function LaunchNav({ context, projects, following, onChoose, onLaunch, onNewProject, commands, onRunCommand, onDropFolder }: Props) {
  const [switcherOpen, setSwitcherOpen] = useState(false)
  const [commandsOpen, setCommandsOpen] = useState(false)
  const [dropHot, setDropHot] = useState(false)

  const where = context.cwd ? (context.label ?? context.cwd) : 'Home folder'
  const inWhere = context.cwd ? ` in ${context.label ?? context.cwd}` : ' in your home folder'
  const launch = (kind: TerminalLaunch) => (event: MouseEvent<HTMLButtonElement>) => onLaunch(kind, event.shiftKey)

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
          onClick={() => setSwitcherOpen((v) => !v)}
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
          <MenuPop onAway={() => setSwitcherOpen(false)} ignoreSelector=".navswitch-wrap">
            <MenuCheckItem
              label="Active session"
              hint="Follow whichever session was most recently active"
              checked={following}
              onClick={() => { setSwitcherOpen(false); onChoose(null) }}
            />
            <MenuCheckItem
              label="Home folder"
              hint="Launch outside any project"
              checked={!following && !context.cwd}
              onClick={() => { setSwitcherOpen(false); onChoose({}) }}
            />
            {projects.length > 0 && <div className="menu-sep" />}
            {projects.map((p) => (
              <MenuCheckItem
                key={p.cwd}
                label={p.label ?? p.cwd!}
                hint={p.cwd}
                checked={!following && context.cwd === p.cwd}
                onClick={() => { setSwitcherOpen(false); onChoose(p) }}
              />
            ))}
          </MenuPop>
        )}
      </div>

      <NavRow
        icon={<ProviderBadge provider="claude" />}
        label="New Claude Code"
        title={`Start Claude Code in a terminal pane${inWhere} — Shift-click for an external window`}
        onClick={launch('claude')}
        testId="launch-claude"
      />
      <NavRow
        icon={<ProviderBadge provider="codex" />}
        label="New Codex"
        title={`Start Codex in a terminal pane${inWhere} — Shift-click for an external window`}
        onClick={launch('codex')}
        testId="launch-codex"
      />
      <NavRow
        icon={<SquareTerminal strokeWidth={2} />}
        label="New terminal"
        meta="Ctrl+Shift+`"
        title={`Open a PowerShell terminal pane${inWhere} — Shift-click for an external window`}
        onClick={launch('shell')}
        testId="launch-shell"
      />
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
