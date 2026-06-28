import { contextBridge, ipcRenderer } from 'electron'
import type { StatusSnapshot } from '../shared/types.js'

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
  hide: () => ipcRenderer.send('window:hide'),
  reportHeight: (h: number) => ipcRenderer.send('window:content-height', h),
  quit: () => ipcRenderer.send('app:quit')
}

contextBridge.exposeInMainWorld('watch', api)

export type WatchApi = typeof api
