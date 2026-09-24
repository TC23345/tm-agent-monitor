// The quick picker's bridge: the smallest surface that lists, picks and
// closes. Nothing else from the workspace preload — a popup that can only
// read history and hand a clip back has nothing to expose.
import { contextBridge, ipcRenderer } from 'electron'
import type { ClipsListing } from '../shared/types.js'

const api = {
  /** The same listing the Clipboard pane reads (summaries, groups, favorites order). */
  listClips: (): Promise<ClipsListing> => ipcRenderer.invoke('clips:list'),
  /** A thumbnail data URL for an image row. */
  clipImage: (id: string): Promise<string | null> => ipcRenderer.invoke('clips:image', id, true),
  /** Enter: put it on the clipboard and paste it back where the picker opened; Shift+Enter: copy only. */
  pick: (id: string, mode: 'paste' | 'copy') => ipcRenderer.send('picker:pick', id, mode),
  /** Escape or a click on the margin. */
  close: () => ipcRenderer.send('picker:close'),
  /** Open/close cue from main, with the pop-in's origin corner on `enter`. */
  onPhase: (cb: (phase: 'enter' | 'exit', origin?: string) => void) => {
    const listener = (_e: unknown, phase: 'enter' | 'exit', origin?: string) => cb(phase, origin)
    ipcRenderer.on('picker:phase', listener)
    return () => {
      ipcRenderer.removeListener('picker:phase', listener)
    }
  },
  /** A refused paste-back, shown as an amber line while the picker stays open. */
  onNotice: (cb: (text: string) => void) => {
    const listener = (_e: unknown, text: string) => cb(text)
    ipcRenderer.on('picker:notice', listener)
    return () => {
      ipcRenderer.removeListener('picker:notice', listener)
    }
  },
  /** History changed; re-list (both windows read back, none holds a copy). */
  onClipsChanged: (cb: () => void) => {
    const listener = () => cb()
    ipcRenderer.on('clips:changed', listener)
    return () => {
      ipcRenderer.removeListener('clips:changed', listener)
    }
  }
}

contextBridge.exposeInMainWorld('picker', api)

export type PickerApi = typeof api
