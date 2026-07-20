// Unit tests for the pure terminal-window picker. Run: npm test  (node --test)
// These exercise pickWindowFromTree without loading koffi, so they run anywhere.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { focusHwndWithApi, focusOwnershipMatches, pickWindowFromTree } from './win32.mjs'

const M = (obj) => new Map(Object.entries(obj).map(([k, v]) => [Number(k), v]))

test('finds the editor window up the tree (Cursor / VS Code)', () => {
  // hook node(100) -> claude(90) -> pwsh(80) -> Cursor(50, owns window) -> explorer(40)
  const byPid = M({ 50: 5001n }) // only Cursor owns a visible window
  const parents = M({ 100: 90, 90: 80, 80: 50, 50: 40 })
  const exeOf = M({ 100: 'node.exe', 90: 'node.exe', 80: 'pwsh.exe', 50: 'cursor.exe', 40: 'explorer.exe' })
  assert.deepEqual(pickWindowFromTree(100, byPid, parents, exeOf), { hwnd: '5001', pid: 50 })
})

test('finds Windows Terminal through the ConPTY host', () => {
  // pwsh(80) -> OpenConsole(70, no window) -> WindowsTerminal(30, owns window)
  const byPid = M({ 30: 3001n })
  const parents = M({ 100: 80, 80: 70, 70: 30, 30: 5 })
  const exeOf = M({ 100: 'node.exe', 80: 'pwsh.exe', 70: 'openconsole.exe', 30: 'windowsterminal.exe' })
  assert.deepEqual(pickWindowFromTree(100, byPid, parents, exeOf), { hwnd: '3001', pid: 30 })
})

test('returns null for a classic console (window owned by a conhost CHILD)', () => {
  // pwsh(80) launched from explorer(40); its console window belongs to conhost(60),
  // a CHILD of pwsh that the upward walk never visits -> null (caller uses consoleWindow()).
  const byPid = M({ 60: 6001n, 40: 4001n }) // conhost + explorer own windows
  const parents = M({ 100: 80, 80: 40, 40: 5 }) // conhost(60) is NOT in the chain
  const exeOf = M({ 100: 'node.exe', 80: 'pwsh.exe', 60: 'conhost.exe', 40: 'explorer.exe' })
  assert.equal(pickWindowFromTree(100, byPid, parents, exeOf), null)
})

test('skips Explorer rather than focusing the desktop', () => {
  const byPid = M({ 40: 4001n }) // only explorer owns a window in the chain
  const parents = M({ 100: 80, 80: 40, 40: 5 })
  const exeOf = M({ 100: 'node.exe', 80: 'pwsh.exe', 40: 'explorer.exe' })
  assert.equal(pickWindowFromTree(100, byPid, parents, exeOf), null)
})

test('returns the start process window when it owns one directly', () => {
  const byPid = M({ 100: 1001n })
  const parents = M({ 100: 40 })
  const exeOf = M({ 100: 'windowsterminal.exe', 40: 'explorer.exe' })
  assert.deepEqual(pickWindowFromTree(100, byPid, parents, exeOf), { hwnd: '1001', pid: 100 })
})

test('returns null on a broken chain with no windowed ancestor', () => {
  const byPid = M({ 999: 9001n }) // unrelated window
  const parents = M({ 100: 80 }) // chain ends at 80
  const exeOf = M({ 100: 'node.exe', 80: 'pwsh.exe' })
  assert.equal(pickWindowFromTree(100, byPid, parents, exeOf), null)
})

test('does not loop forever on a cyclic parent map', () => {
  const byPid = M({}) // no windows
  const parents = M({ 100: 90, 90: 100 }) // cycle
  const exeOf = M({ 100: 'node.exe', 90: 'node.exe' })
  assert.equal(pickWindowFromTree(100, byPid, parents, exeOf), null) // depth cap saves us
})

test('accepts numeric hwnds too (stringifies them)', () => {
  const byPid = M({ 50: 5001 }) // number, not bigint
  const parents = M({ 100: 50, 50: 40 })
  const exeOf = M({ 100: 'node.exe', 50: 'code.exe', 40: 'explorer.exe' })
  assert.deepEqual(pickWindowFromTree(100, byPid, parents, exeOf), { hwnd: '5001', pid: 50 })
})

test('prefers the foreground window when the same pid owns several (multi-window Cursor)', () => {
  // Cursor(50) owns two windows; byPid kept the Z-topmost (5001) but the user is
  // typing in 5002, which holds the foreground -> capture 5002.
  const byPid = M({ 50: 5001n })
  const parents = M({ 100: 90, 90: 50, 50: 40 })
  const exeOf = M({ 100: 'node.exe', 90: 'pwsh.exe', 50: 'cursor.exe', 40: 'explorer.exe' })
  const fg = { hwnd: 5002n, pid: 50 }
  assert.deepEqual(pickWindowFromTree(100, byPid, parents, exeOf, undefined, fg), { hwnd: '5002', pid: 50 })
})

test('ignores a foreground window owned by an unrelated process', () => {
  const byPid = M({ 50: 5001n })
  const parents = M({ 100: 50, 50: 40 })
  const exeOf = M({ 100: 'node.exe', 50: 'code.exe', 40: 'explorer.exe' })
  const fg = { hwnd: 9001n, pid: 999 } // some other app holds the foreground
  assert.deepEqual(pickWindowFromTree(100, byPid, parents, exeOf, undefined, fg), { hwnd: '5001', pid: 50 })
})

test('focus ownership requires the exact positive process id', () => {
  assert.equal(focusOwnershipMatches(42, 42), true)
  assert.equal(focusOwnershipMatches(42, 41), false)
  assert.equal(focusOwnershipMatches(0, 0), false)
  assert.equal(focusOwnershipMatches(1.5, 1.5), false)
})

test('detaches every attached input queue when focusing throws', () => {
  const calls = []
  const fns = {
    IsIconic: () => 0,
    ShowWindow: () => 1,
    GetForegroundWindow: () => 99n,
    GetCurrentThreadId: () => 10,
    GetWindowThreadProcessId: (hwnd, pidBox) => {
      pidBox[0] = hwnd === 50n ? 500 : 900
      return hwnd === 50n ? 50 : 90
    },
    AttachThreadInput: (current, target, attach) => {
      calls.push([current, target, attach])
      return 1
    },
    BringWindowToTop: () => { throw new Error('simulated Win32 failure') },
    SetForegroundWindow: () => 1
  }
  assert.throws(() => focusHwndWithApi(fns, 50n), /simulated/)
  assert.deepEqual(calls, [
    [10, 90, 1], [10, 50, 1],
    [10, 50, 0], [10, 90, 0]
  ])
})

test('attaches a shared target/foreground input queue only once', () => {
  const calls = []
  const fns = {
    IsIconic: () => 0,
    ShowWindow: () => 1,
    GetForegroundWindow: () => 99n,
    GetCurrentThreadId: () => 10,
    GetWindowThreadProcessId: (_hwnd, pidBox) => { pidBox[0] = 500; return 50 },
    AttachThreadInput: (current, target, attach) => { calls.push([current, target, attach]); return 1 },
    BringWindowToTop: () => 1,
    SetForegroundWindow: () => 1
  }
  assert.equal(focusHwndWithApi(fns, 50n), true)
  assert.deepEqual(calls, [[10, 50, 1], [10, 50, 0]])
})
