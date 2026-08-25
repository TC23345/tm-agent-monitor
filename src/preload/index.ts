import { contextBridge, ipcRenderer } from 'electron'
import type { ActivityEvent, StatusSnapshot, AppSettings, AppSettingsPatch, DailyUsageDay, DesktopWindow, GitStatus, ProjectCommand, ProviderId, SystemDiagnostic, TerminalAttachResult, TerminalCreateRequest, UsageInsights, WorkspaceCommand } from '../shared/types.js'

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
  copyText: (t: string) => ipcRenderer.send('text:copy', t),
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
  getHistory: (): Promise<DailyUsageDay[]> => ipcRenderer.invoke('history:recent'),
  /** Per-folder facts: `.tm.json` + package.json scripts, and git branch/dirty state. */
  getProjectCommands: (cwd: string): Promise<ProjectCommand[]> => ipcRenderer.invoke('project:commands', cwd),
  getGitStatus: (cwd: string): Promise<GitStatus | null> => ipcRenderer.invoke('git:status', cwd),
  /** The activity feed: attention-worthy moments across sessions, newest first. */
  getEvents: (): Promise<ActivityEvent[]> => ipcRenderer.invoke('agent:events'),
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
