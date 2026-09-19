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
export interface WinRect { x: number; y: number; width: number; height: number }
export function windowFrames(hwnd: string): { windowRect: WinRect; frameRect: WinRect | null; minimized: boolean } | null
export function foregroundWindow(): { hwnd: string; pid: number; exe: string } | null
export function setWindowRect(hwnd: string, expectedPid: number, rect: WinRect): boolean
export function restoreWindow(hwnd: string, expectedPid: number): boolean
