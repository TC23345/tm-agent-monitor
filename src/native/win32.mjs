// Native window focus via koffi FFI to user32/kernel32 — no per-ABI rebuild,
// loads system DLLs at runtime so it survives Electron upgrades and packaging.
//
// Used by both the hook (to discover the terminal window owning a Claude Code
// session) and the Electron main process (to bring that window to the front).
// All entry points are wrapped so a load failure degrades to no-ops rather than
// ever throwing into Claude Code or the UI.

import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
let api = null
let loadTried = false

function load() {
  if (loadTried) return api
  loadTried = true
  if (process.platform !== 'win32') return (api = null)
  try {
    const koffi = require('koffi')
    const user32 = koffi.load('user32.dll')
    const kernel32 = koffi.load('kernel32.dll')

    const EnumProc = koffi.proto('bool __stdcall CW_EnumProc(uintptr_t hwnd, intptr_t lparam)')

    const fns = {
      EnumWindows: user32.func('int __stdcall EnumWindows(CW_EnumProc *proc, intptr_t lparam)'),
      IsWindowVisible: user32.func('int __stdcall IsWindowVisible(uintptr_t hwnd)'),
      IsIconic: user32.func('int __stdcall IsIconic(uintptr_t hwnd)'),
      GetWindowTextLengthW: user32.func('int __stdcall GetWindowTextLengthW(uintptr_t hwnd)'),
      GetWindowThreadProcessId: user32.func('uint32 __stdcall GetWindowThreadProcessId(uintptr_t hwnd, _Out_ uint32 *pid)'),
      GetForegroundWindow: user32.func('uintptr_t __stdcall GetForegroundWindow()'),
      SetForegroundWindow: user32.func('int __stdcall SetForegroundWindow(uintptr_t hwnd)'),
      BringWindowToTop: user32.func('int __stdcall BringWindowToTop(uintptr_t hwnd)'),
      ShowWindow: user32.func('int __stdcall ShowWindow(uintptr_t hwnd, int cmd)'),
      AttachThreadInput: user32.func('int __stdcall AttachThreadInput(uint32 a, uint32 b, int attach)'),
      GetCurrentThreadId: kernel32.func('uint32 __stdcall GetCurrentThreadId()'),
      CreateToolhelp32Snapshot: kernel32.func('uintptr_t __stdcall CreateToolhelp32Snapshot(uint32 flags, uint32 pid)'),
      CloseHandle: kernel32.func('int __stdcall CloseHandle(uintptr_t h)')
    }

    const PROCESSENTRY32W = koffi.struct('CW_PROCESSENTRY32W', {
      dwSize: 'uint32',
      cntUsage: 'uint32',
      th32ProcessID: 'uint32',
      th32DefaultHeapID: 'uintptr_t',
      th32ModuleID: 'uint32',
      cntThreads: 'uint32',
      th32ParentProcessID: 'uint32',
      pcPriClassBase: 'int32',
      dwFlags: 'uint32',
      szExeFile: koffi.array('uint16', 260)
    })
    fns.Process32FirstW = kernel32.func('bool __stdcall Process32FirstW(uintptr_t snap, _Inout_ CW_PROCESSENTRY32W *e)')
    fns.Process32NextW = kernel32.func('bool __stdcall Process32NextW(uintptr_t snap, _Inout_ CW_PROCESSENTRY32W *e)')

    api = { koffi, EnumProc, fns, sizeofEntry: koffi.sizeof(PROCESSENTRY32W) }
  } catch (err) {
    if (process.env.CLAUDE_WATCH_DEBUG) console.error('[win32] load failed:', err.message)
    api = null
  }
  return api
}

/** All visible, titled, top-level windows as [{ hwnd: BigInt, pid: number }]. */
export function listWindows() {
  const a = load()
  if (!a) return []
  const { koffi, EnumProc, fns } = a
  const out = []
  const cb = koffi.register((hwnd) => {
    try {
      if (fns.IsWindowVisible(hwnd) && fns.GetWindowTextLengthW(hwnd) > 0) {
        const pidBox = [0]
        fns.GetWindowThreadProcessId(hwnd, pidBox)
        out.push({ hwnd: BigInt(hwnd), pid: pidBox[0] })
      }
    } catch {
      /* ignore one bad window */
    }
    return true // keep enumerating
  }, koffi.pointer(EnumProc))
  try {
    fns.EnumWindows(cb, 0)
  } finally {
    koffi.unregister(cb)
  }
  return out
}

/** Decode a szExeFile (uint16[260] or pre-decoded string) to a lowercase name. */
function decodeExe(v) {
  try {
    if (typeof v === 'string') return v.replace(/\0.*$/, '').toLowerCase()
    let s = ''
    for (const c of v) {
      if (!c) break
      s += String.fromCharCode(c)
    }
    return s.toLowerCase()
  } catch {
    return ''
  }
}

/** Process snapshot: { parents: pid->parentPid, exeOf: pid->lowercased exe name }. */
function processSnapshot() {
  const a = load()
  if (!a) return { parents: new Map(), exeOf: new Map() }
  const { fns, sizeofEntry } = a
  const parents = new Map()
  const exeOf = new Map()
  const TH32CS_SNAPPROCESS = 0x2
  const INVALID = (1n << 64n) - 1n // INVALID_HANDLE_VALUE
  const snap = fns.CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0)
  if (BigInt(snap) === INVALID || BigInt(snap) === 0n) return { parents, exeOf }
  try {
    const entry = { dwSize: sizeofEntry }
    let ok = fns.Process32FirstW(snap, entry)
    while (ok) {
      parents.set(entry.th32ProcessID, entry.th32ParentProcessID)
      exeOf.set(entry.th32ProcessID, decodeExe(entry.szExeFile))
      ok = fns.Process32NextW(snap, entry)
    }
  } catch {
    /* ignore */
  } finally {
    fns.CloseHandle(snap)
  }
  return { parents, exeOf }
}

// Owns the desktop / taskbar / Explorer windows — never the session's terminal.
const NON_TERMINAL_EXES = new Set(['explorer.exe'])

/**
 * Walk up the process tree from `startPid` and return the first ancestor (or
 * startPid itself) that owns a visible top-level window — i.e. the terminal /
 * editor window hosting the session. Returns { hwnd: string, pid } | null.
 */
export function findTerminalWindow(startPid) {
  if (!load()) return null
  const windows = listWindows()
  if (!windows.length) return null
  const byPid = new Map()
  for (const w of windows) if (!byPid.has(w.pid)) byPid.set(w.pid, w.hwnd)

  const { parents, exeOf } = processSnapshot()
  let pid = startPid
  for (let depth = 0; depth < 20 && pid && pid > 4; depth++) {
    const hwnd = byPid.get(pid)
    // Take the first ancestor that owns a window — but skip Explorer, so a session
    // whose terminal window can't be found doesn't fall through to the desktop shell.
    if (hwnd !== undefined && !NON_TERMINAL_EXES.has(exeOf.get(pid))) {
      return { hwnd: hwnd.toString(), pid }
    }
    pid = parents.get(pid)
    if (pid === undefined) break
  }
  return null
}

/** Discover the window for the process tree the CURRENT process lives in. */
export function findTerminalWindowForCurrentProcess() {
  return findTerminalWindow(process.pid)
}

/** Force a window to the foreground, working around the foreground lock. */
export function focusHwnd(hwndStr) {
  const a = load()
  if (!a || !hwndStr) return false
  const { fns } = a
  try {
    const hwnd = BigInt(hwndStr)
    const SW_RESTORE = 9, SW_SHOW = 5
    if (fns.IsIconic(hwnd)) fns.ShowWindow(hwnd, SW_RESTORE)

    const fg = fns.GetForegroundWindow()
    const cur = fns.GetCurrentThreadId()
    const tBox = [0], fBox = [0]
    const targetThread = fns.GetWindowThreadProcessId(hwnd, tBox)
    const fgThread = fns.GetWindowThreadProcessId(BigInt(fg), fBox)

    if (fgThread && fgThread !== cur) fns.AttachThreadInput(cur, fgThread, 1)
    if (targetThread && targetThread !== cur) fns.AttachThreadInput(cur, targetThread, 1)
    fns.BringWindowToTop(hwnd)
    const ok = fns.SetForegroundWindow(hwnd)
    fns.ShowWindow(hwnd, SW_SHOW)
    if (targetThread && targetThread !== cur) fns.AttachThreadInput(cur, targetThread, 0)
    if (fgThread && fgThread !== cur) fns.AttachThreadInput(cur, fgThread, 0)
    return !!ok
  } catch (err) {
    if (process.env.CLAUDE_WATCH_DEBUG) console.error('[win32] focus failed:', err.message)
    return false
  }
}

/** Focus the most likely window for a pid (re-resolves the tree). */
export function focusByPid(pid) {
  const found = findTerminalWindow(pid)
  return found ? focusHwnd(found.hwnd) : false
}

export const available = () => load() !== null
