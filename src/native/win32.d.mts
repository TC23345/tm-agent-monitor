export function listWindows(): { hwnd: bigint; pid: number }[]
export function findTerminalWindow(startPid: number): { hwnd: string; pid: number } | null
export function findTerminalWindowForCurrentProcess(): { hwnd: string; pid: number } | null
export function focusHwnd(hwnd: string): boolean
export function focusByPid(pid: number): boolean
export function available(): boolean
