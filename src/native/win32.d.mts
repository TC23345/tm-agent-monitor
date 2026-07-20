export function listWindows(): { hwnd: bigint; pid: number }[]
export function findTerminalWindow(startPid: number): { hwnd: string; pid: number } | null
export function findTerminalWindowForCurrentProcess(): { hwnd: string; pid: number } | null
export function focusOwnershipMatches(expectedPid: number, actualPid: number): boolean
export function hwndOwnedByPid(hwnd: string, expectedPid: number): boolean
export function focusHwndWithApi(fns: Record<string, (...args: any[]) => any>, hwnd: bigint): boolean
export function focusHwnd(hwnd: string, expectedPid?: number): boolean
export function focusByPid(pid: number): boolean
export function available(): boolean
