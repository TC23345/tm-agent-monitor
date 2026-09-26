// The quick picker's bridge: the smallest surface that lists, picks and
// closes, edits a row (star, groups, delete, and the Edit… card's title, text,
// note, expansion code and keybind — whose Record may suspend the global
// chords) and opens its keys in Settings. Nothing else from the workspace
// preload — no merge, no clear, no group management, no settings.
import { contextBridge, ipcRenderer } from 'electron'
import type { ClipsListing } from '../shared/types.js'

const api = {
  /** The same listing the Clipboard pane reads (summaries, groups, favorites order). */
  listClips: (): Promise<ClipsListing> => ipcRenderer.invoke('clips:list'),
  /** A thumbnail data URL for an image row. */
  clipImage: (id: string): Promise<string | null> => ipcRenderer.invoke('clips:image', id, true),
  /** Enter: put it on the clipboard and paste it back where the picker opened; Shift+Enter: copy only. */
  pick: (id: string, mode: 'paste' | 'copy') => ipcRenderer.send('picker:pick', id, mode),
  /** A single click on a row: onto the clipboard only — the picker stays open, nothing is pasted back. */
  copyClip: (id: string): Promise<boolean> => ipcRenderer.invoke('clips:copy', id),
  /** Escape or a click on the margin. */
  close: () => ipcRenderer.send('picker:close'),
  /**
   * Star, regroup, or save the Edit… card (title, text, note, expansion code,
   * keybind — null clears the last three) for one clip. Only these fields
   * leave the page; main validates each again (`clips:update`) and answers
   * `true`, `false`, or a plain sentence when a code or keybind is taken.
   */
  updateClip: (id: string, patch: { favorite?: boolean; title?: string | null; text?: string; groups?: string[]; note?: string | null; shortcut?: string | null; hotkey?: string | null }): Promise<boolean | string> => {
    const clean: Record<string, unknown> = {}
    if (typeof patch?.favorite === 'boolean') clean.favorite = patch.favorite
    if (patch?.title === null || typeof patch?.title === 'string') clean.title = patch.title
    if (typeof patch?.text === 'string') clean.text = patch.text
    if (Array.isArray(patch?.groups)) clean.groups = patch.groups
    for (const key of ['note', 'shortcut', 'hotkey'] as const) if (patch?.[key] === null || typeof patch?.[key] === 'string') clean[key] = patch[key]
    return ipcRenderer.invoke('clips:update', id, clean)
  },
  /** The Edit… card's Keybind Record: let go of the global chords while one is pressed (main restores them after 30 s regardless). */
  suspendHotkeys: (on: boolean): void => ipcRenderer.send('hotkeys:suspend', on === true),
  /** The row menu's Delete. */
  deleteClips: (ids: string[]): Promise<number> => ipcRenderer.invoke('clips:delete', ids),
  /** One text clip's full body, for Edit text — the listing carries only a 200-character preview. */
  clipText: (id: string): Promise<{ text: string } | null> => ipcRenderer.invoke('clips:get', id),
  /** Keys → Keyboard shortcuts…: close, and open the workspace at Settings → Keyboard shortcuts. */
  openKeySettings: () => ipcRenderer.send('picker:settings'),
  /** A resize grip's pointer travel since pointer-down (main clamps it and moves the window). */
  resize: (dw: number, dh: number) => ipcRenderer.send('picker:resize', dw, dh),
  /** Pointer-up on a grip: main remembers the size for the next open. */
  resizeEnd: () => ipcRenderer.send('picker:resize-end'),
  /** Keys → Reset size: back to the default card, now and on the next open. */
  resetSize: () => ipcRenderer.send('picker:reset-size'),
  /** Clips → Open Clipboard pane: close, and open the workspace on the Clipboard pane. */
  openClipboardPane: () => ipcRenderer.send('picker:clipboard'),
  /** Clips → Export to JSON…: the same explicit export as the pane (a save dialog; main answers null when cancelled). */
  exportClips: (): Promise<{ path: string; count: number } | null> => ipcRenderer.invoke('clips:export'),
  /** Open/close cue from main, with the pop-in's origin corner, the favorite keys' modifier and whether the size is a remembered one, on `enter`. */
  onPhase: (cb: (phase: 'enter' | 'exit', origin?: string, favoriteModifier?: string, customSize?: boolean) => void) => {
    const listener = (_e: unknown, phase: 'enter' | 'exit', origin?: string, favoriteModifier?: string, customSize?: boolean) => cb(phase, origin, favoriteModifier, customSize === true)
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
