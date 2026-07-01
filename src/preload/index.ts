import { contextBridge, ipcRenderer } from 'electron'
import type { StatusSnapshot, AppSettings } from '../shared/types.js'

const api = {
  getStatus: (): Promise<StatusSnapshot> => ipcRenderer.invoke('status:get'),
  onStatus: (cb: (snap: StatusSnapshot) => void) => {
    const listener = (_e: unknown, snap: StatusSnapshot) => cb(snap)
    ipcRenderer.on('status:update', listener)
    return () => {
      ipcRenderer.removeListener('status:update', listener)
    }
  },
  toggleMock: (on: boolean): Promise<boolean> => ipcRenderer.invoke('mock:toggle', on),
  getMock: (): Promise<boolean> => ipcRenderer.invoke('mock:state'),
  focusAgent: (id: string, hwnd?: string, pid?: number) => ipcRenderer.send('agent:focus', id, hwnd, pid),
  openPath: (p: string) => ipcRenderer.send('path:open', p),
  copyText: (t: string) => ipcRenderer.send('text:copy', t),
  openTerminal: (cwd?: string) => ipcRenderer.send('terminal:open', cwd),
  openCursor: () => ipcRenderer.send('cursor:open'),
  createProject: (name: string): Promise<{ ok: boolean; path?: string; error?: string }> =>
    ipcRenderer.invoke('project:create', name),
  hide: () => ipcRenderer.send('window:hide'),
  reportHeight: (h: number) => ipcRenderer.send('window:content-height', h),
  reportFirstRow: (off: { x: number; y: number }) => ipcRenderer.send('window:first-row', off),
  getSettings: (): Promise<AppSettings> => ipcRenderer.invoke('settings:get'),
  setSettings: (patch: Partial<AppSettings>): Promise<AppSettings> => ipcRenderer.invoke('settings:set', patch),
  quit: () => ipcRenderer.send('app:quit')
}

contextBridge.exposeInMainWorld('watch', api)

export type WatchApi = typeof api
