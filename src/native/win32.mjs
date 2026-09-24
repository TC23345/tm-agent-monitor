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
    // LRESULT WndProc(HWND, UINT, WPARAM, LPARAM) — a registered callback, so
    // Chromium's UI message pump may dispatch to it long after registration.
    const WndProc = koffi.proto('intptr_t __stdcall CW_WndProc(uintptr_t hwnd, uint32 msg, uintptr_t wParam, intptr_t lParam)')
    const WNDCLASSEXW = koffi.struct('CW_WNDCLASSEXW', {
      cbSize: 'uint32',
      style: 'uint32',
      lpfnWndProc: koffi.pointer(WndProc),
      cbClsExtra: 'int',
      cbWndExtra: 'int',
      hInstance: 'uintptr_t',
      hIcon: 'uintptr_t',
      hCursor: 'uintptr_t',
      hbrBackground: 'uintptr_t',
      lpszMenuName: 'str16',
      lpszClassName: 'str16',
      hIconSm: 'uintptr_t'
    })

    const fns = {
      EnumWindows: user32.func('int __stdcall EnumWindows(CW_EnumProc *proc, intptr_t lparam)'),
      IsWindowVisible: user32.func('int __stdcall IsWindowVisible(uintptr_t hwnd)'),
      IsIconic: user32.func('int __stdcall IsIconic(uintptr_t hwnd)'),
      GetWindowTextLengthW: user32.func('int __stdcall GetWindowTextLengthW(uintptr_t hwnd)'),
      GetWindowTextW: user32.func('int __stdcall GetWindowTextW(uintptr_t hwnd, _Out_ uint16 *text, int count)'),
      GetWindowThreadProcessId: user32.func('uint32 __stdcall GetWindowThreadProcessId(uintptr_t hwnd, _Out_ uint32 *pid)'),
      GetForegroundWindow: user32.func('uintptr_t __stdcall GetForegroundWindow()'),
      SetForegroundWindow: user32.func('int __stdcall SetForegroundWindow(uintptr_t hwnd)'),
      BringWindowToTop: user32.func('int __stdcall BringWindowToTop(uintptr_t hwnd)'),
      ShowWindow: user32.func('int __stdcall ShowWindow(uintptr_t hwnd, int cmd)'),
      AttachThreadInput: user32.func('int __stdcall AttachThreadInput(uint32 a, uint32 b, int attach)'),
      GetCurrentThreadId: kernel32.func('uint32 __stdcall GetCurrentThreadId()'),
      GetConsoleWindow: kernel32.func('uintptr_t __stdcall GetConsoleWindow()'),
      CreateToolhelp32Snapshot: kernel32.func('uintptr_t __stdcall CreateToolhelp32Snapshot(uint32 flags, uint32 pid)'),
      CloseHandle: kernel32.func('int __stdcall CloseHandle(uintptr_t h)'),
      GetModuleHandleW: kernel32.func('uintptr_t __stdcall GetModuleHandleW(str16 name)'),
      GetLastError: kernel32.func('uint32 __stdcall GetLastError()'),
      // Clipboard change notification (a message-only window) and the reads
      // the clipboard watcher needs. Nothing here opens the clipboard.
      RegisterClassExW: user32.func('uint16 __stdcall RegisterClassExW(CW_WNDCLASSEXW *wc)'),
      CreateWindowExW: user32.func('uintptr_t __stdcall CreateWindowExW(uint32 exStyle, str16 cls, str16 name, uint32 style, int x, int y, int w, int h, intptr_t parent, uintptr_t menu, uintptr_t inst, uintptr_t param)'),
      DestroyWindow: user32.func('int __stdcall DestroyWindow(uintptr_t hwnd)'),
      DefWindowProcW: user32.func('intptr_t __stdcall DefWindowProcW(uintptr_t hwnd, uint32 msg, uintptr_t wParam, intptr_t lParam)'),
      AddClipboardFormatListener: user32.func('int __stdcall AddClipboardFormatListener(uintptr_t hwnd)'),
      RemoveClipboardFormatListener: user32.func('int __stdcall RemoveClipboardFormatListener(uintptr_t hwnd)'),
      GetClipboardSequenceNumber: user32.func('uint32 __stdcall GetClipboardSequenceNumber()'),
      GetClipboardOwner: user32.func('uintptr_t __stdcall GetClipboardOwner()'),
      RegisterClipboardFormatW: user32.func('uint32 __stdcall RegisterClipboardFormatW(str16 name)'),
      IsClipboardFormatAvailable: user32.func('int __stdcall IsClipboardFormatAvailable(uint32 format)'),
      // Raw format bytes (CF_HDROP file lists, the exclusion DWORDs) — the one
      // path here that opens the clipboard, held for microseconds.
      OpenClipboard: user32.func('int __stdcall OpenClipboard(uintptr_t owner)'),
      CloseClipboard: user32.func('int __stdcall CloseClipboard()'),
      GetClipboardData: user32.func('uintptr_t __stdcall GetClipboardData(uint32 format)'),
      // Synthetic keys for paste-back (the picker and Shift+Alt+n). keybd_event
      // is the old API, but four calls need no INPUT union layout.
      keybd_event: user32.func('void __stdcall keybd_event(uint8 vk, uint8 scan, uint32 flags, uintptr_t extra)'),
      GlobalLock: kernel32.func('void * __stdcall GlobalLock(uintptr_t h)'),
      GlobalUnlock: kernel32.func('int __stdcall GlobalUnlock(uintptr_t h)'),
      GlobalSize: kernel32.func('size_t __stdcall GlobalSize(uintptr_t h)')
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

    api = { koffi, EnumProc, WndProc, fns, sizeofEntry: koffi.sizeof(PROCESSENTRY32W), sizeofWndClass: koffi.sizeof(WNDCLASSEXW) }
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
  'windowsterminal.exe', 'wt.exe', 'openconsole.exe', 'conhost.exe',
  'powershell.exe', 'pwsh.exe', 'cmd.exe',
  'code.exe', 'cursor.exe', 'windsurf.exe',
  'claude.exe', // Claude desktop app — its Code tab sessions live in its window
  'codex.exe', 'chatgpt.exe', 'openai.chatgpt.exe',
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
export function pickWindowFromTree(startPid, byPid, parents, exeOf, nonTerminal = NON_TERMINAL_EXES, fg = null) {
  let pid = startPid
  for (let depth = 0; depth < 20 && pid && pid > 4; depth++) {
    const hwnd = byPid.get(pid)
    if (hwnd !== undefined && !nonTerminal.has(exeOf.get(pid))) {
      // Multi-window editors (Cursor/VS Code) own ALL their windows from one pid;
      // byPid keeps whichever came first in Z-order. When the foreground window
      // belongs to that same pid it's the one the user is typing in — prefer it.
      if (fg && fg.pid === pid && fg.hwnd !== undefined) {
        return { hwnd: String(fg.hwnd), pid }
      }
      return { hwnd: typeof hwnd === 'bigint' ? hwnd.toString() : String(hwnd), pid }
    }
    pid = parents.get(pid)
    if (pid === undefined) break
  }
  return null
}

export function findTerminalWindow(startPid) {
  const a = load()
  if (!a) return null
  const windows = listWindows()
  if (!windows.length) return null
  const byPid = new Map()
  for (const w of windows) if (!byPid.has(w.pid)) byPid.set(w.pid, w.hwnd)
  const { parents, exeOf } = processSnapshot()
  let fg = null
  try {
    const fgHwnd = a.fns.GetForegroundWindow()
    if (fgHwnd && BigInt(fgHwnd) !== 0n) {
      const pidBox = [0]
      a.fns.GetWindowThreadProcessId(fgHwnd, pidBox)
      fg = { hwnd: BigInt(fgHwnd), pid: pidBox[0] }
    }
  } catch {
    /* foreground preference is best-effort */
  }
  return pickWindowFromTree(startPid, byPid, parents, exeOf, NON_TERMINAL_EXES, fg)
}

/** Diagnostic: every visible titled window with its owning process exe. */
export function debugWindows() {
  if (!load()) return []
  const { exeOf } = processSnapshot()
  return listWindows().map((w) => ({ hwnd: w.hwnd.toString(), pid: w.pid, exe: exeOf.get(w.pid) ?? '?' }))
}

const TITLE_MAX = 512

/** Title of a window, or '' when it has none / the read fails. */
function windowTitle(fns, hwnd) {
  try {
    const buf = new Uint16Array(TITLE_MAX)
    const n = fns.GetWindowTextW(hwnd, buf, TITLE_MAX)
    if (!n || n < 0) return ''
    return String.fromCharCode(...buf.subarray(0, Math.min(n, TITLE_MAX - 1))).replace(/\0.*$/, '')
  } catch {
    return ''
  }
}

/**
 * Every visible titled top-level window with its title and owning exe — the raw
 * feed for the workspace window switcher. Classification and filtering live in
 * src/main/windowsCore.mjs; this only reads Win32. Never throws.
 */
export function listDesktopWindows() {
  const a = load()
  if (!a) return []
  try {
    const { exeOf } = processSnapshot()
    return listWindows().map((w) => ({
      hwnd: w.hwnd.toString(),
      pid: w.pid,
      exe: exeOf.get(w.pid) ?? '',
      title: windowTitle(a.fns, w.hwnd)
    }))
  } catch (err) {
    if (process.env.CLAUDE_WATCH_DEBUG) console.error('[win32] window list failed:', err.message)
    return []
  }
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

/** Pure ownership check shared by the native boundary and tests. */
export function focusOwnershipMatches(expectedPid, actualPid) {
  return Number.isInteger(expectedPid) && expectedPid > 0 && expectedPid <= 0xffffffff &&
    Number.isInteger(actualPid) && actualPid === expectedPid
}

/** Re-check that a persisted HWND still belongs to the process that reported it. */
export function hwndOwnedByPid(hwndStr, expectedPid) {
  const a = load()
  if (!a || !hwndStr || !Number.isInteger(expectedPid)) return false
  try {
    const hwnd = BigInt(hwndStr)
    if (hwnd <= 0n || !a.fns.IsWindowVisible(hwnd) || a.fns.GetWindowTextLengthW(hwnd) <= 0) return false
    const pidBox = [0]
    a.fns.GetWindowThreadProcessId(hwnd, pidBox)
    return focusOwnershipMatches(expectedPid, pidBox[0])
  } catch {
    return false
  }
}

/**
 * Native focus body, exported for deterministic failure-path tests. Any input
 * queues successfully attached here are detached in `finally`, even if a later
 * Win32 call throws.
 */
export function focusHwndWithApi(fns, hwnd) {
  const attached = []
  const SW_RESTORE = 9, SW_SHOW = 5
  let currentThread = 0
  try {
    if (fns.IsIconic(hwnd)) fns.ShowWindow(hwnd, SW_RESTORE)

    const fg = fns.GetForegroundWindow()
    const cur = fns.GetCurrentThreadId()
    currentThread = cur
    const tBox = [0], fBox = [0]
    const targetThread = fns.GetWindowThreadProcessId(hwnd, tBox)
    const fgThread = fns.GetWindowThreadProcessId(BigInt(fg), fBox)

    for (const thread of new Set([fgThread, targetThread])) {
      if (thread && thread !== cur && fns.AttachThreadInput(cur, thread, 1)) attached.push(thread)
    }
    fns.BringWindowToTop(hwnd)
    const ok = fns.SetForegroundWindow(hwnd)
    fns.ShowWindow(hwnd, SW_SHOW)
    return !!ok
  } finally {
    for (let i = attached.length - 1; i >= 0; i--) {
      try { fns.AttachThreadInput(currentThread, attached[i], 0) } catch { /* best-effort detach */ }
    }
  }
}

/** Force a window to the foreground, working around the foreground lock. */
export function focusHwnd(hwndStr, expectedPid) {
  const a = load()
  if (!a || !hwndStr) return false
  const { fns } = a
  try {
    if (expectedPid !== undefined && !hwndOwnedByPid(hwndStr, expectedPid)) return false
    const hwnd = BigInt(hwndStr)
    return focusHwndWithApi(fns, hwnd)
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

// ---- clipboard ------------------------------------------------------------
// Reads and the change listener only. What to keep, dedupe, or redact is
// decided in src/shared/clips.mjs; the watcher in src/main/clipboardWatch.ts
// picks between the listener and the sequence-number poll.

const WM_CLIPBOARDUPDATE = 0x031d
const HWND_MESSAGE = -3

/** The clipboard sequence number (bumps on every change), or null when Win32 is unavailable. */
export function clipboardSequence() {
  const a = load()
  if (!a) return null
  try {
    return a.fns.GetClipboardSequenceNumber() >>> 0
  } catch {
    return null
  }
}

/**
 * Register a message-only window for WM_CLIPBOARDUPDATE. `onUpdate` runs on
 * the JS thread whenever Windows posts the message — which only happens if the
 * thread's message loop dispatches to windows koffi created (the M1.1 probe).
 * Returns { hwnd, stop } or null when any step fails; never throws.
 */
export function clipboardListen(onUpdate) {
  const a = load()
  if (!a) return null
  const { koffi, WndProc, fns } = a
  let cb = null
  let hwnd = 0n
  try {
    cb = koffi.register((h, msg, wParam, lParam) => {
      if (msg === WM_CLIPBOARDUPDATE) {
        try { onUpdate() } catch { /* the watcher logs its own failures */ }
        return 0
      }
      return fns.DefWindowProcW(h, msg, wParam, lParam)
    }, koffi.pointer(WndProc))
    const hInstance = fns.GetModuleHandleW(null)
    const className = `TMClipboardListener.${process.pid}`
    const atom = fns.RegisterClassExW({
      cbSize: a.sizeofWndClass,
      style: 0,
      lpfnWndProc: cb,
      cbClsExtra: 0,
      cbWndExtra: 0,
      hInstance,
      hIcon: 0,
      hCursor: 0,
      hbrBackground: 0,
      lpszMenuName: null,
      lpszClassName: className,
      hIconSm: 0
    })
    if (!atom) throw new Error(`RegisterClassExW failed (${fns.GetLastError()})`)
    hwnd = BigInt(fns.CreateWindowExW(0, className, 'TaylorMade clipboard listener', 0, 0, 0, 0, 0, HWND_MESSAGE, 0, hInstance, 0))
    if (hwnd === 0n) throw new Error(`CreateWindowExW failed (${fns.GetLastError()})`)
    if (!fns.AddClipboardFormatListener(hwnd)) throw new Error(`AddClipboardFormatListener failed (${fns.GetLastError()})`)
  } catch (err) {
    if (process.env.CLAUDE_WATCH_DEBUG) console.error('[win32] clipboard listener failed:', err.message)
    try { if (hwnd !== 0n) fns.DestroyWindow(hwnd) } catch { /* best effort */ }
    try { if (cb) koffi.unregister(cb) } catch { /* best effort */ }
    return null
  }
  let stopped = false
  return {
    hwnd: hwnd.toString(),
    stop() {
      if (stopped) return
      stopped = true
      try { fns.RemoveClipboardFormatListener(hwnd) } catch { /* best effort */ }
      try { fns.DestroyWindow(hwnd) } catch { /* best effort */ }
      try { koffi.unregister(cb) } catch { /* best effort */ }
    }
  }
}

/** The window that last set the clipboard, resolved to its process. Null when unknown. */
export function clipboardOwner() {
  const a = load()
  if (!a) return null
  try {
    const hwnd = a.fns.GetClipboardOwner()
    if (!hwnd || BigInt(hwnd) === 0n) return null
    const pidBox = [0]
    a.fns.GetWindowThreadProcessId(hwnd, pidBox)
    const pid = pidBox[0]
    if (!pid) return null
    return { hwnd: BigInt(hwnd).toString(), pid, exe: processSnapshot().exeOf.get(pid) ?? '', title: windowTitle(a.fns, hwnd) }
  } catch {
    return null
  }
}

const formatIds = new Map()

/** A clipboard format id: a standard CF_* number, or a registered name (cached). 0 when unknown. */
function formatId(a, format) {
  if (typeof format === 'number') return format >>> 0
  if (typeof format !== 'string' || !format) return 0
  let id = formatIds.get(format)
  if (id === undefined) {
    id = a.fns.RegisterClipboardFormatW(format) >>> 0
    if (id) formatIds.set(format, id)
  }
  return id
}

/** Whether a registered clipboard format (by name) is on the clipboard right now. */
export function hasClipboardFormat(name) {
  const a = load()
  if (!a) return false
  try {
    const id = formatId(a, name)
    return id !== 0 && a.fns.IsClipboardFormatAvailable(id) !== 0
  } catch {
    return false
  }
}

const MAX_FORMAT_BYTES = 4 * 1024 * 1024

/**
 * The raw bytes of one clipboard format (a CF_* id or a registered name) as a
 * Buffer copy, or null when it is absent, oversized, or the clipboard is held
 * by another app right now. Opens the clipboard for the copy only.
 */
export function clipboardData(format) {
  const a = load()
  if (!a) return null
  const { koffi, fns } = a
  let id
  try {
    id = formatId(a, format)
    if (!id || !fns.IsClipboardFormatAvailable(id)) return null
    if (!fns.OpenClipboard(0)) return null
  } catch {
    return null
  }
  let handle = 0n
  try {
    handle = BigInt(fns.GetClipboardData(id))
    if (handle === 0n) return null
    const size = Number(fns.GlobalSize(handle))
    if (!size || size > MAX_FORMAT_BYTES) return null
    const ptr = fns.GlobalLock(handle)
    if (!ptr) return null
    try {
      return Buffer.from(koffi.decode(ptr, 'uint8_t', size))
    } finally {
      fns.GlobalUnlock(handle)
    }
  } catch (err) {
    if (process.env.CLAUDE_WATCH_DEBUG) console.error('[win32] clipboard read failed:', err.message)
    return null
  } finally {
    try { fns.CloseClipboard() } catch { /* best effort */ }
  }
}

const VK_SHIFT = 0x10, VK_CONTROL = 0x11, VK_MENU = 0x12, VK_LWIN = 0x5b, VK_RWIN = 0x5c, VK_V = 0x56
const KEYEVENTF_KEYUP = 0x0002

/**
 * Send Ctrl+V to the foreground window. Any modifier the user still holds
 * from the hotkey that got us here (Shift+Alt+1, Ctrl+Alt+V) is released
 * first, or the paste would arrive as Ctrl+Shift+Alt+V. Never throws.
 */
export function sendPasteKeys() {
  const a = load()
  if (!a) return false
  const { fns } = a
  try {
    for (const vk of [VK_SHIFT, VK_MENU, VK_LWIN, VK_RWIN, VK_CONTROL]) fns.keybd_event(vk, 0, KEYEVENTF_KEYUP, 0)
    fns.keybd_event(VK_CONTROL, 0, 0, 0)
    fns.keybd_event(VK_V, 0, 0, 0)
    fns.keybd_event(VK_V, 0, KEYEVENTF_KEYUP, 0)
    fns.keybd_event(VK_CONTROL, 0, KEYEVENTF_KEYUP, 0)
    return true
  } catch (err) {
    if (process.env.CLAUDE_WATCH_DEBUG) console.error('[win32] paste keys failed:', err.message)
    return false
  }
}

/** The foreground window with its owning process — provenance for a copy whose clipboard owner is null. */
export function foregroundWindowInfo() {
  const a = load()
  if (!a) return null
  try {
    const hwnd = a.fns.GetForegroundWindow()
    if (!hwnd || BigInt(hwnd) === 0n) return null
    const pidBox = [0]
    a.fns.GetWindowThreadProcessId(hwnd, pidBox)
    const pid = pidBox[0]
    if (!pid) return null
    return { hwnd: BigInt(hwnd).toString(), pid, exe: processSnapshot().exeOf.get(pid) ?? '', title: windowTitle(a.fns, hwnd) }
  } catch {
    return null
  }
}

export const available = () => load() !== null
