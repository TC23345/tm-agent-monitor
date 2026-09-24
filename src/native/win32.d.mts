export function listWindows(): { hwnd: bigint; pid: number }[]
export function listDesktopWindows(): { hwnd: string; pid: number; exe: string; title: string }[]
export function findTerminalWindow(startPid: number): { hwnd: string; pid: number } | null
export function findTerminalWindowForCurrentProcess(): { hwnd: string; pid: number } | null
export function focusOwnershipMatches(expectedPid: number, actualPid: number): boolean
export function hwndOwnedByPid(hwnd: string, expectedPid: number): boolean
export function focusHwndWithApi(fns: Record<string, (...args: any[]) => any>, hwnd: bigint): boolean
export function focusHwnd(hwnd: string, expectedPid?: number): boolean
export function focusByPid(pid: number): boolean
export function available(): boolean

/** Clipboard: the change sequence number, or null when Win32 is unavailable. */
export function clipboardSequence(): number | null
/** A message-only window listening for WM_CLIPBOARDUPDATE; null when it could not be set up. */
export function clipboardListen(onUpdate: () => void): { hwnd: string; stop: () => void } | null
/** The window that last set the clipboard, resolved to its process. */
export function clipboardOwner(): { hwnd: string; pid: number; exe: string; title: string } | null
/** Whether a registered clipboard format (by name) is on the clipboard right now. */
export function hasClipboardFormat(name: string): boolean
/** Raw bytes of one clipboard format (CF_* id or registered name), or null. */
export function clipboardData(format: number | string): Buffer | null
/** The foreground window resolved to its process (provenance fallback). */
export function foregroundWindowInfo(): { hwnd: string; pid: number; exe: string; title: string } | null
