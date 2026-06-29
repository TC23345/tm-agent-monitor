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
      GetConsoleWindow: kernel32.func('uintptr_t __stdcall GetConsoleWindow()'),
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

// Foreground-window fallback allowlist. Windows Terminal (esp. as the default
// terminal) reparents the shell, so WindowsTerminal.exe isn't an ancestor and the
// process-tree walk misses it. When the hook fires on a user prompt the terminal
// is the foreground window — capture it if it's a recognized terminal.
const TERMINAL_EXES = new Set([
  'windowsterminal.exe', 'wt.exe', 'openconsole.exe',
  'powershell.exe', 'pwsh.exe', 'cmd.exe',
  'code.exe', 'cursor.exe', 'windsurf.exe',
  'alacritty.exe', 'wezterm-gui.exe', 'hyper.exe',
  'conemu64.exe', 'conemu.exe', 'mintty.exe', 'tabby.exe'
])

/**
 * Walk up the process tree from `startPid` and return the first ancestor (or
 * startPid itself) that owns a visible top-level window — i.e. the terminal /
 * editor window hosting the session. Returns { hwnd: string, pid } | null.
 */
/**
 * Pure, testable walk: from `startPid`, climb the parent chain and return the
 * first ancestor that owns a window — skipping `nonTerminal` exes (Explorer, the
 * desktop shell). `byPid` maps pid -> hwnd, `parents` maps pid -> parentPid,
 * `exeOf` maps pid -> lowercased exe name. Returns { hwnd: string, pid } | null.
 */
export function pickWindowFromTree(startPid, byPid, parents, exeOf, nonTerminal = NON_TERMINAL_EXES) {
  let pid = startPid
  for (let depth = 0; depth < 20 && pid && pid > 4; depth++) {
    const hwnd = byPid.get(pid)
    if (hwnd !== undefined && !nonTerminal.has(exeOf.get(pid))) {
      return { hwnd: typeof hwnd === 'bigint' ? hwnd.toString() : String(hwnd), pid }
    }
    pid = parents.get(pid)
    if (pid === undefined) break
  }
  return null
}

export function findTerminalWindow(startPid) {
  if (!load()) return null
  const windows = listWindows()
  if (!windows.length) return null
  const byPid = new Map()
  for (const w of windows) if (!byPid.has(w.pid)) byPid.set(w.pid, w.hwnd)
  const { parents, exeOf } = processSnapshot()
  return pickWindowFromTree(startPid, byPid, parents, exeOf)
}

/** Diagnostic: every visible titled window with its owning process exe. */
export function debugWindows() {
  if (!load()) return []
  const { exeOf } = processSnapshot()
  return listWindows().map((w) => ({ hwnd: w.hwnd.toString(), pid: w.pid, exe: exeOf.get(w.pid) ?? '?' }))
}

/**
 * The console window hosting the CURRENT process, if it's a classic console
 * (conhost) terminal — e.g. a standalone PowerShell / cmd window. The window is
 * owned by a conhost.exe *child* of the shell, so the upward process-tree walk
 * can't see it; GetConsoleWindow returns it directly. Returns null for ConPTY
 * terminals (Windows Terminal, VS Code/Cursor) where it's an invisible
 * pseudo-console — those are found by findTerminalWindow instead.
 */
export function consoleWindow() {
  const a = load()
  if (!a) return null
  try {
    const hwnd = a.fns.GetConsoleWindow()
    if (!hwnd || BigInt(hwnd) === 0n) return null
    // Skip the hidden ConPTY pseudo-console; only a real, titled console window counts.
    if (!a.fns.IsWindowVisible(hwnd) || a.fns.GetWindowTextLengthW(hwnd) <= 0) return null
    const pidBox = [0]
    a.fns.GetWindowThreadProcessId(hwnd, pidBox)
    return { hwnd: BigInt(hwnd).toString(), pid: pidBox[0] }
  } catch {
    return null
  }
}

/**
 * The current foreground window, if it belongs to a recognized terminal. Used as
 * a last resort for terminals the process-tree walk can't reach (notably Windows
 * Terminal as the default terminal). Valid because the hook fires the instant the
 * user submits a prompt, when their terminal still holds the foreground.
 */
export function foregroundTerminalWindow() {
  const a = load()
  if (!a) return null
  try {
    const hwnd = a.fns.GetForegroundWindow()
    if (!hwnd || BigInt(hwnd) === 0n) return null
    if (!a.fns.IsWindowVisible(hwnd) || a.fns.GetWindowTextLengthW(hwnd) <= 0) return null
    const pidBox = [0]
    a.fns.GetWindowThreadProcessId(hwnd, pidBox)
    const exe = processSnapshot().exeOf.get(pidBox[0])
    if (exe && TERMINAL_EXES.has(exe)) return { hwnd: BigInt(hwnd).toString(), pid: pidBox[0] }
    return null
  } catch {
    return null
  }
}

/** Discover the window for the process tree the CURRENT process lives in. */
export function findTerminalWindowForCurrentProcess() {
  return consoleWindow() ?? findTerminalWindow(process.pid) ?? foregroundTerminalWindow()
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
