import { contextBridge, ipcRenderer } from 'electron'
import type { StatusSnapshot, AppSettings, AppSettingsPatch, DailyUsageDay, ProviderId, UsageInsights } from '../shared/types.js'

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
  openTerminal: (cwd?: string, provider?: ProviderId) => ipcRenderer.send('terminal:open', cwd, provider),
  openCursor: () => ipcRenderer.send('cursor:open'),
  openProjectsDir: () => ipcRenderer.send('projects:open'),
  openConfigDir: () => ipcRenderer.send('config:open'),
  checkUpdates: (): Promise<string> => ipcRenderer.invoke('update:check'),
  manageHooks: (provider: ProviderId, action: 'install' | 'repair' | 'remove' | 'status'): Promise<{ ok: boolean; message: string; settings: AppSettings }> =>
    ipcRenderer.invoke('hooks:manage', provider, action),
  reviewCodexHookTrust: (): Promise<{ ok: boolean; message: string }> =>
    ipcRenderer.invoke('hooks:review-codex-trust'),
  createProject: (name: string): Promise<{ ok: boolean; path?: string; error?: string }> =>
    ipcRenderer.invoke('project:create', name),
  hide: () => ipcRenderer.send('window:hide'),
  reportHeight: (h: number) => ipcRenderer.send('window:content-height', h),
  getHistory: (): Promise<DailyUsageDay[]> => ipcRenderer.invoke('history:recent'),
  getUsageInsights: (): Promise<UsageInsights> => ipcRenderer.invoke('usage:insights'),
  getSettings: (): Promise<AppSettings> => ipcRenderer.invoke('settings:get'),
  setSettings: (patch: AppSettingsPatch): Promise<AppSettings> => ipcRenderer.invoke('settings:set', patch),
  quit: () => ipcRenderer.send('app:quit')
}

contextBridge.exposeInMainWorld('watch', api)

export type WatchApi = typeof api
