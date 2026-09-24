import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { NoteMeta, NoteOrder } from '../shared/notes.mjs'
import type { ActivityEvent, StatusSnapshot, AppSettings, AppSettingsPatch, ClipCaptureSettings, ClipsListing, DailyUsageDay, DesktopWindow, GitStatus, ProjectCommand, ProviderId, SizeMode, SystemDiagnostic, TerminalAttachResult, TerminalCreateRequest, UsageInsights, WorkspaceCommand } from '../shared/types.js'

const api = {
  getStatus: (): Promise<StatusSnapshot> => ipcRenderer.invoke('status:get'),
  onStatus: (cb: (snap: StatusSnapshot) => void) => {
    const listener = (_e: unknown, snap: StatusSnapshot) => cb(snap)
    ipcRenderer.on('status:update', listener)
    return () => {
      ipcRenderer.removeListener('status:update', listener)
    }
  },
  focusAgent: (id: string) => ipcRenderer.send('agent:focus', id),
  openPath: (p: string) => ipcRenderer.send('path:open', p),
  /** `hint` names the terminal pane a copy-on-select came from, for the clip's provenance. */
  copyText: (t: string, hint?: { terminalId?: string; cwd?: string }) => ipcRenderer.send('text:copy', t, hint),
  /** What Ctrl+V in a terminal pane should do: the clipboard's text, or whether
   * it holds an image the CLI should be asked to fetch itself. */
  readClipboard: (): Promise<{ text: string; hasImage: boolean }> => ipcRenderer.invoke('clipboard:read'),
  openTerminal: (cwd?: string, provider?: ProviderId | 'shell') => ipcRenderer.send('terminal:open', cwd, provider),
  /** Embedded terminals: main-owned PTY sessions rendered by xterm panes. */
  createTerminal: (req: TerminalCreateRequest): Promise<{ id: string } | null> => ipcRenderer.invoke('term:create', req),
  attachTerminal: (id: string): Promise<TerminalAttachResult> => ipcRenderer.invoke('term:attach', id),
  termInput: (id: string, data: string) => ipcRenderer.send('term:input', id, data),
  termResize: (id: string, cols: number, rows: number) => ipcRenderer.send('term:resize', id, cols, rows),
  disposeTerminal: (id: string) => ipcRenderer.send('term:dispose', id),
  onTermData: (cb: (id: string, data: string) => void) => {
    const listener = (_e: unknown, id: string, data: string) => cb(id, data)
    ipcRenderer.on('term:data', listener)
    return () => {
      ipcRenderer.removeListener('term:data', listener)
    }
  },
  onTermExit: (cb: (id: string, exitCode: number) => void) => {
    const listener = (_e: unknown, id: string, exitCode: number) => cb(id, exitCode)
    ipcRenderer.on('term:exit', listener)
    return () => {
      ipcRenderer.removeListener('term:exit', listener)
    }
  },
  /** The window backdrop setting changed; the root's `data-material` follows it. */
  onWindowMaterial: (cb: (material: string) => void) => {
    const listener = (_e: unknown, material: string) => cb(material)
    ipcRenderer.on('window:material', listener)
    return () => {
      ipcRenderer.removeListener('window:material', listener)
    }
  },
  /** Main changed the workspace size itself (an edge drag); the Layout chip follows. */
  onSizeMode: (cb: (mode: SizeMode) => void) => {
    const listener = (_e: unknown, mode: SizeMode) => cb(mode)
    ipcRenderer.on('window:size-mode', listener)
    return () => {
      ipcRenderer.removeListener('window:size-mode', listener)
    }
  },
  /** The shell reported a new working directory (its prompt hook). */
  onTermCwd: (cb: (id: string, cwd: string) => void) => {
    const listener = (_e: unknown, id: string, cwd: string) => cb(id, cwd)
    ipcRenderer.on('term:cwd', listener)
    return () => {
      ipcRenderer.removeListener('term:cwd', listener)
    }
  },
  openCursor: (cwd?: string) => ipcRenderer.send('cursor:open', cwd),
  openChrome: () => ipcRenderer.send('chrome:open'),
  listWindows: (): Promise<DesktopWindow[]> => ipcRenderer.invoke('windows:list'),
  focusWindow: (hwnd: string, pid: number) => ipcRenderer.send('windows:focus', hwnd, pid),
  /** Show/hide animation cue from main, so the workspace can slide in and out. */
  onWindowPhase: (cb: (phase: 'enter' | 'exit') => void) => {
    const listener = (_e: unknown, phase: 'enter' | 'exit') => cb(phase)
    ipcRenderer.on('window:phase', listener)
    return () => {
      ipcRenderer.removeListener('window:phase', listener)
    }
  },
  openProjectsDir: () => ipcRenderer.send('projects:open'),
  openConfigDir: () => ipcRenderer.send('config:open'),
  checkUpdates: (): Promise<string> => ipcRenderer.invoke('update:check'),
  /** Build the installer from the local repo, silently reinstall, relaunch. */
  reinstallApp: (): Promise<string> => ipcRenderer.invoke('app:reinstall'),
  manageHooks: (provider: ProviderId, action: 'install' | 'repair' | 'remove' | 'status'): Promise<{ ok: boolean; message: string; settings: AppSettings }> =>
    ipcRenderer.invoke('hooks:manage', provider, action),
  reviewCodexHookTrust: (): Promise<{ ok: boolean; message: string }> =>
    ipcRenderer.invoke('hooks:review-codex-trust'),
  createProject: (name: string): Promise<{ ok: boolean; path?: string; error?: string }> =>
    ipcRenderer.invoke('project:create', name),
  hide: () => ipcRenderer.send('window:hide'),
  /** The grip strip on a side edge was pulled `delta` screen px; main decides whether that flips the size mode. */
  edgeDrag: (edge: 'left' | 'right', delta: number) => ipcRenderer.send('window:edge-drag', edge, delta),
  /** A real minimize: the workspace stays in the taskbar and Alt+Tab; the hotkey restores it. */
  minimize: () => ipcRenderer.send('window:minimize'),
  getHistory: (): Promise<DailyUsageDay[]> => ipcRenderer.invoke('history:recent'),
  /** Per-folder facts: `.tm.json` + package.json scripts, and git branch/dirty state. */
  getProjectCommands: (cwd: string): Promise<ProjectCommand[]> => ipcRenderer.invoke('project:commands', cwd),
  getGitStatus: (cwd: string): Promise<GitStatus | null> => ipcRenderer.invoke('git:status', cwd),
  /** The path behind a dropped File. `File.path` was removed in Electron 32;
   * `webUtils.getPathForFile` is the supported replacement, and it must run
   * here in the preload — the sandboxed renderer never sees the raw object. */
  pathForFile: (file: File): string => {
    try {
      return webUtils.getPathForFile(file)
    } catch {
      return ''
    }
  },
  /** A dropped path as a folder: the directory itself, or a file's parent. */
  describePath: (path: string): Promise<{ dir: string; label: string } | null> => ipcRenderer.invoke('path:describe', path),
  /** The activity feed: attention-worthy moments across sessions, newest first. */
  getEvents: (): Promise<ActivityEvent[]> => ipcRenderer.invoke('agent:events'),
  /** The shared notepad (Notes pane): Markdown files in the notes folder. */
  /** Notes carry their path relative to the notes folder ('/'-separated); folders are listed even when empty. */
  listNotes: (): Promise<{ dir: string; notes: NoteMeta[]; folders: string[]; order: NoteOrder }> => ipcRenderer.invoke('notes:list'),
  /** Drag and drop: into `toFolder` ('' = top level), placed at `index` among `visible` when given. */
  moveNoteEntry: (from: string, toFolder: string, index?: number, visible?: string[]): Promise<{ ok: boolean; path?: string; error?: string; renamed?: string }> =>
    ipcRenderer.invoke('notes:move', from, toFolder, index, visible),
  /** Naming convention: a placeholder date name takes the note's title. Answers the (possibly new) path. */
  retitleNote: (path: string): Promise<string | null> => ipcRenderer.invoke('notes:retitle', path),
  readNote: (name: string): Promise<string | null> => ipcRenderer.invoke('notes:read', name),
  writeNote: (name: string, text: string): Promise<boolean> => ipcRenderer.invoke('notes:write', name, text),
  createNote: (template?: string, folder?: string): Promise<string | null> => ipcRenderer.invoke('notes:create', template, folder),
  deleteNote: (name: string): Promise<boolean> => ipcRenderer.invoke('notes:delete', name),
  /** A free "New folder" inside `parent` ('' = top level); answers its path. */
  createNoteFolder: (parent: string): Promise<string | null> => ipcRenderer.invoke('notes:mkdir', parent),
  /** Rename a note or folder in place; `to` is the new last segment. Answers the new path. */
  renameNoteEntry: (from: string, to: string): Promise<string | null> => ipcRenderer.invoke('notes:rename', from, to),
  /** Remove an empty folder (refused when it has anything in it). */
  deleteNoteFolder: (path: string): Promise<boolean> => ipcRenderer.invoke('notes:rmdir', path),
  revealNoteFolder: (path: string): Promise<boolean> => ipcRenderer.invoke('notes:reveal', path),
  openNotesFolder: (): Promise<string> => ipcRenderer.invoke('notes:open-folder'),
  /** Open a web or mail link in the default app (a note preview's links). */
  openExternal: (url: string): Promise<boolean> => ipcRenderer.invoke('shell:open-external', url),
  /** Something in the notes folder changed on disk (an agent wrote a note). */
  onNotesChanged: (cb: () => void) => {
    const listener = () => cb()
    ipcRenderer.on('notes:changed', listener)
    return () => {
      ipcRenderer.removeListener('notes:changed', listener)
    }
  },
  /** Clipboard history (the Clipboard pane). Bodies are fetched one at a time. */
  listClips: (): Promise<ClipsListing> => ipcRenderer.invoke('clips:list'),
  /** Just the flags (paused, mode, count) — what the status bar chip needs, without the summaries. */
  clipsState: (): Promise<{ paused: boolean; pausedUntil: number; mode: string; count: number }> => ipcRenderer.invoke('clips:state'),
  getClip: (id: string): Promise<{ text: string } | null> => ipcRenderer.invoke('clips:get', id),
  /** Put a clip back on the clipboard (text, file list as text, or the image). */
  copyClip: (id: string): Promise<boolean> => ipcRenderer.invoke('clips:copy', id),
  updateClip: (id: string, patch: { title?: string | null; text?: string; groups?: string[]; favorite?: boolean }): Promise<boolean> => ipcRenderer.invoke('clips:update', id, patch),
  deleteClips: (ids: string[]): Promise<number> => ipcRenderer.invoke('clips:delete', ids),
  /** Everything unpinned, or everything when `all`. Answers how many went. */
  clearClips: (all?: boolean): Promise<number> => ipcRenderer.invoke('clips:clear', all === true),
  mergeClips: (ids: string[]): Promise<string | null> => ipcRenderer.invoke('clips:merge', ids),
  addClip: (input: { text: string; title?: string; groups?: string[] }): Promise<string | null> => ipcRenderer.invoke('clips:add', input),
  /** The full list of named groups; a dropped name leaves every clip that carried it. */
  setClipGroups: (names: string[]): Promise<string[] | null> => ipcRenderer.invoke('clips:groups', names),
  setFavoritesOrder: (ids: string[]): Promise<boolean> => ipcRenderer.invoke('clips:favorites-order', ids),
  /** `minutes` > 0 pauses for that long, 0 pauses until resumed, null resumes. */
  pauseClips: (minutes: number | null): Promise<boolean> => ipcRenderer.invoke('clips:pause', minutes),
  setClipSettings: (patch: Partial<ClipCaptureSettings>): Promise<boolean> => ipcRenderer.invoke('clips:settings', patch),
  /** Explicit export to a JSON file the user picks (never automatic); answers the path, or null when cancelled. */
  exportClips: (): Promise<{ path: string; count: number } | null> => ipcRenderer.invoke('clips:export'),
  /** Import a backup the user picks: ours, or the old Chrome extension's. Duplicates are skipped; its text shortcuts become snippet notes. */
  importClips: (): Promise<{ ok: boolean; added?: number; skipped?: number; snippets?: number; source?: string; error?: string } | null> => ipcRenderer.invoke('clips:import'),
  /** A data URL for an image clip: the thumbnail (default) or the full PNG. */
  clipImage: (id: string, thumb = true): Promise<string | null> => ipcRenderer.invoke('clips:image', id, thumb),
  /** The history changed (a capture, an edit, a pause). Re-list to follow it. */
  onClipsChanged: (cb: () => void) => {
    const listener = () => cb()
    ipcRenderer.on('clips:changed', listener)
    return () => {
      ipcRenderer.removeListener('clips:changed', listener)
    }
  },
  /** A command a second instance sent (`tm open …`); the renderer re-validates it. */
  onCommand: (cb: (command: WorkspaceCommand) => void) => {
    const listener = (_e: unknown, command: WorkspaceCommand) => cb(command)
    ipcRenderer.on('workspace:command', listener)
    return () => {
      ipcRenderer.removeListener('workspace:command', listener)
    }
  },
  getUsageInsights: (): Promise<UsageInsights> => ipcRenderer.invoke('usage:insights'),
  getSettings: (): Promise<AppSettings> => ipcRenderer.invoke('settings:get'),
  diagnoseSystem: (id?: string): Promise<SystemDiagnostic[]> => ipcRenderer.invoke('system:diagnose', id),
  setSettings: (patch: AppSettingsPatch): Promise<AppSettings> => ipcRenderer.invoke('settings:set', patch),
  quit: () => ipcRenderer.send('app:quit')
}

contextBridge.exposeInMainWorld('watch', api)

export type WatchApi = typeof api
