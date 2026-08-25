import { useCallback, useEffect, useState, type MouseEvent } from 'react'
import type { DesktopWindow, DesktopWindowKind, TerminalLaunch } from '@shared/types'
import { groupWindows } from '@shared/windows.mjs'
import { Bot, Code2, Folder, FolderPlus, Globe, RefreshCw, SquareTerminal } from 'lucide-react'
import { ProviderBadge } from './ProviderBadge'

/** How often the open-window list re-reads Win32 while the workspace is on screen. */
const REFRESH_MS = 4000

const KIND_ICON: Record<DesktopWindowKind, typeof SquareTerminal> = {
  terminal: SquareTerminal,
  editor: Code2,
  browser: Globe,
  assistant: Bot,
  explorer: Folder
}

export interface LaunchContext {
  /** Folder new terminals and editors open in — the active project, or home. */
  cwd?: string
  label?: string
  /** Undefined when no session has reported a folder yet. */
  onToggle?: () => void
}

/** Chip for the pane header showing — and switching — where launches land. */
export function LaunchContextChip({ context }: { context: LaunchContext }) {
  if (!context.onToggle) return null
  return (
    <button
      className={`pane-context ${context.cwd ? 'is-project' : ''}`}
      onClick={context.onToggle}
      title={context.cwd
        ? `Launches open in ${context.cwd} — click to use your home folder instead`
        : 'Launches open in your home folder — click to use the active project instead'}
    >
      {context.cwd ? context.label : 'home'}
    </button>
  )
}

/** Start a terminal, editor, or browser — in the active project or at home.
 * Terminal launches open embedded panes; Shift-click opens an external window. */
export function LauncherPane({ context, onNewProject, onEmbedTerminal }: {
  context: LaunchContext
  onNewProject: () => void
  onEmbedTerminal: (launch: TerminalLaunch) => void
}) {
  const where = context.cwd ? `${context.label ?? context.cwd}` : 'your home folder'
  const inProject = ` in ${where}`
  const launchTerminal = (launch: TerminalLaunch) => (event: MouseEvent<HTMLButtonElement>) => {
    if (event.shiftKey) window.watch.openTerminal(context.cwd, launch)
    else onEmbedTerminal(launch)
  }
  return (
    <div className="launchwrap">
      <div className="launchpad">
        <button className="launch" onClick={launchTerminal('claude')} title={`Start Claude Code in a terminal pane${inProject} — Shift-click for an external window`}>
          <ProviderBadge provider="claude" />
          Claude Code
        </button>
        <button className="launch" onClick={launchTerminal('codex')} title={`Start Codex in a terminal pane${inProject} — Shift-click for an external window`}>
          <ProviderBadge provider="codex" />
          Codex
        </button>
        <button className="launch" onClick={launchTerminal('shell')} title={`Open a PowerShell terminal pane${inProject} — Shift-click for an external window`}>
          <SquareTerminal className="launch-ic" strokeWidth={2} />
          Terminal
        </button>
        <button className="launch" onClick={() => window.watch.openCursor(context.cwd)} title={context.cwd ? `Open ${context.label} in Cursor` : 'Open a new Cursor window'} aria-label="Open Cursor">
          <Code2 className="launch-ic" strokeWidth={2} />
          Cursor
        </button>
        <button className="launch" onClick={() => window.watch.openChrome()} title="Open a new Chrome window">
          <Globe className="launch-ic" strokeWidth={2} />
          Chrome
        </button>
        <button className="launch" onClick={onNewProject} title="Create a project folder and open it in Cursor">
          <FolderPlus className="launch-ic" strokeWidth={2} />
          New project
        </button>
      </div>
      <button className="linkbtn" onClick={() => window.watch.openProjectsDir()} title="Open the Projects folder in File Explorer">
        <Folder className="launch-ic" strokeWidth={2} />
        Projects folder
      </button>
    </div>
  )
}

/**
 * Live list of the windows you drive agents from. Electron cannot host a foreign
 * native window (electron/electron#10547 is still open), so this switches to them
 * with Win32 focus rather than embedding them.
 */
/** Equal enough that nothing rendered from the list would change. */
function sameWindows(a: DesktopWindow[] | null, b: DesktopWindow[]): boolean {
  if (!a || a.length !== b.length) return false
  return a.every((w, i) => {
    const o = b[i]
    return w.hwnd === o.hwnd && w.pid === o.pid && w.title === o.title && w.app === o.app && w.kind === o.kind
      && w.agentId === o.agentId && w.agentProvider === o.agentProvider
  })
}

export function useDesktopWindows(enabled: boolean) {
  const [windows, setWindows] = useState<DesktopWindow[] | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  const refresh = useCallback(() => {
    setRefreshing(true)
    window.watch.listWindows()
      // Keep the old reference when nothing changed: every poll is a fresh
      // array from main, and a new reference re-renders the sidebar for nothing.
      .then((list) => setWindows((prev) => (sameWindows(prev, list) ? prev : list)))
      .catch(() => setWindows([]))
      .finally(() => setRefreshing(false))
  }, [])

  // Poll only when a pane is actually showing the list AND the workspace is on
  // screen. Each poll is a full EnumWindows plus a process-table snapshot, so
  // running it for a closed pane — or a dismissed window — is pure waste.
  // Electron marks the document hidden the moment the window hides.
  useEffect(() => {
    if (!enabled) {
      setWindows(null)
      return
    }
    let timer: ReturnType<typeof setInterval> | null = null
    const start = () => {
      if (timer !== null) return
      refresh()
      timer = setInterval(refresh, REFRESH_MS)
    }
    const stop = () => {
      if (timer === null) return
      clearInterval(timer)
      timer = null
    }
    const onVisibility = () => (document.hidden ? stop() : start())
    if (!document.hidden) start()
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      stop()
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [enabled, refresh])

  return { windows, refreshing, refresh }
}

export function WindowsRefreshButton({ refreshing, refresh }: { refreshing: boolean; refresh: () => void }) {
  return (
    <button className="iconbtn iconbtn--sm" onClick={refresh} title="Rescan open windows" aria-label="Rescan open windows">
      <RefreshCw className={`gear gear--sm ${refreshing ? 'is-spinning' : ''}`} strokeWidth={2} />
    </button>
  )
}

export function WindowsPane({ windows }: { windows: DesktopWindow[] | null }) {
  const groups = groupWindows(windows ?? [])
  if (windows === null) return <div className="wlist-empty">Scanning…</div>
  if (groups.length === 0) return <div className="wlist-empty">No terminals, editors or browsers open.</div>
  return (
    <div className="wlist">
      {groups.map((group) => {
        const Icon = KIND_ICON[group.kind]
        // One app in the group? Name it once in the heading and give every row its
        // full width for the title instead of repeating the app on each line.
        const soleApp = group.windows.every((w) => w.app === group.windows[0].app) ? group.windows[0].app : null
        return (
          <div className="wgroup" key={group.kind}>
            <div className="wgroup-head">
              <Icon className="wgroup-ic" strokeWidth={2} />
              {soleApp ?? group.label}
              <span className="wgroup-count">{group.windows.length}</span>
            </div>
            {group.windows.map((w) => (
              <button
                key={w.hwnd}
                className={`wrow ${w.agentId ? 'wrow--agent' : ''}`}
                onClick={() => window.watch.focusWindow(w.hwnd, w.pid)}
                title={`${w.app} — ${w.title}\nClick to bring this window to the front`}
              >
                {!soleApp && <span className="wrow-app">{w.app}</span>}
                <span className="wrow-title">{w.title}</span>
                {w.agentProvider && <ProviderBadge provider={w.agentProvider} />}
              </button>
            ))}
          </div>
        )
      })}
    </div>
  )
}
