// The quick picker (PRD §5.3): a second, small BrowserWindow opened at the
// cursor by a global hotkey, over whatever the user is doing. It is built like
// the workspace (created hidden and shown deliberately, sandboxed, its own
// small preload) but *is* a popup — always on top, out of the taskbar — the
// rules that keep the workspace off always-on-top are about the workspace.
// Open and close are a CSS transform in its renderer sequenced from here,
// with a main-side hide timeout, never an animated setBounds.
//
// Paste-back: the foreground window is remembered *before* the picker shows;
// on Enter the clip goes on the clipboard through the adapter, the picker
// hides, that window gets the foreground back (ownership re-checked against
// the PID recorded then — HWNDs are recycled), and Ctrl+V is sent. The picker
// hides itself only; the workspace is untouched.
import { BrowserWindow, screen } from 'electron'
import { placePicker, PICKER_CARD, PICKER_SHADOW } from '../shared/pickerPlace.mjs'
import { focusHwnd, foregroundWindowInfo, hwndOwnedByPid, sendPasteKeys } from '../native/win32.mjs'

export interface PickerDeps {
  preload: string
  /** Load the renderer with `?window=picker` (dev URL or the built index.html). */
  load: (win: BrowserWindow) => void
  /** Put a clip on the clipboard (text, file list, or the image); false when it is gone. */
  copyClip: (id: string) => Promise<boolean>
  /** Alt or Control: the modifier of the picker's own favorite keys, read on every open. */
  favoriteModifier: () => 'Alt' | 'Control'
  log: (line: string) => void
}

const EXIT_MS = 160
/** A blur that lands within this of the show is the show itself settling, not the user leaving. */
const BLUR_GRACE_MS = 250

let deps: PickerDeps | null = null
let win: BrowserWindow | null = null
let pendingHide: NodeJS.Timeout | null = null
let shownAt = 0
/** The window that had the foreground when the picker opened: where a paste goes back to. */
let target: { hwnd: string; pid: number; exe: string; title: string } | null = null

export function createPicker(d: PickerDeps): void {
  deps = d
  win = new BrowserWindow({
    width: PICKER_CARD.width + 2 * PICKER_SHADOW,
    height: PICKER_CARD.height + 2 * PICKER_SHADOW,
    show: false,
    frame: false,
    transparent: true,
    hasShadow: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    focusable: true,
    title: 'Clipboard picker',
    backgroundColor: '#00000000',
    webPreferences: { preload: d.preload, sandbox: true, contextIsolation: true }
  })
  win.setVisibleOnAllWorkspaces(true)
  win.setMenuBarVisibility(false)
  d.load(win)
  win.on('blur', () => {
    if (Date.now() - shownAt > BLUR_GRACE_MS) hidePicker()
  })
  win.on('closed', () => { win = null })
}

export function pickerWindow(): BrowserWindow | null {
  return win && !win.isDestroyed() ? win : null
}

export function isPickerOpen(): boolean {
  return !!win && !win.isDestroyed() && win.isVisible() && !pendingHide
}

export function showPicker(): void {
  if (!win || win.isDestroyed()) return
  if (pendingHide) { clearTimeout(pendingHide); pendingHide = null }
  // Before our window takes the foreground: this is where Enter pastes back to.
  target = foregroundWindowInfo()
  const cursor = screen.getCursorScreenPoint()
  const { workArea } = screen.getDisplayNearestPoint(cursor)
  const place = placePicker({ cursor, workArea })
  win.setBounds({ x: place.x, y: place.y, width: place.width, height: place.height })
  win.show()
  win.focus()
  shownAt = Date.now()
  // After show, so the pop-in runs against painted frames. The favorite keys'
  // modifier rides along, so a Settings change reaches the next open.
  win.webContents.send('picker:phase', 'enter', place.origin, deps?.favoriteModifier() ?? 'Alt')
}

export function hidePicker(): void {
  if (!win || win.isDestroyed() || !win.isVisible() || pendingHide) return
  win.webContents.send('picker:phase', 'exit')
  // Fires regardless of what the renderer does.
  pendingHide = setTimeout(() => {
    pendingHide = null
    if (win && !win.isDestroyed()) win.hide()
  }, EXIT_MS)
}

export function togglePicker(): void {
  if (isPickerOpen()) hidePicker()
  else showPicker()
}

function notice(text: string): void {
  if (win && !win.isDestroyed()) win.webContents.send('picker:notice', text)
}

/**
 * The user chose a clip. `copy` leaves it on the clipboard and closes;
 * `paste` also hands the foreground back to the window the picker opened
 * over and sends Ctrl+V. A target that is gone (closed, or its HWND now
 * belongs to another process) is refused with a notice and the picker stays
 * open — the clip is on the clipboard either way.
 */
export async function pickClip(id: string, mode: 'paste' | 'copy'): Promise<void> {
  if (!deps) return
  const copied = await deps.copyClip(id)
  if (!copied) { notice('That clip is gone'); return }
  if (mode === 'copy') { hidePicker(); return }
  const t = target
  if (!t || !hwndOwnedByPid(t.hwnd, t.pid)) {
    notice('That window is gone — copied instead. Paste it yourself.')
    return
  }
  hidePicker()
  setTimeout(() => {
    const ok = focusHwnd(t.hwnd, t.pid)
    if (!ok) { deps?.log(`[picker] could not return focus to ${t.exe} — clip left on the clipboard`); return }
    // The window needs a beat to take the foreground before the keystroke.
    setTimeout(() => { if (!sendPasteKeys()) deps?.log('[picker] Ctrl+V could not be sent') }, 60)
  }, EXIT_MS + 20)
}

export function destroyPicker(): void {
  if (pendingHide) { clearTimeout(pendingHide); pendingHide = null }
  if (win && !win.isDestroyed()) win.destroy()
  win = null
}
