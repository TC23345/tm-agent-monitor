// Unit tests for the pure terminal-window picker. Run: npm test  (node --test)
// These exercise pickWindowFromTree without loading koffi, so they run anywhere.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pickWindowFromTree } from './win32.mjs'

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
