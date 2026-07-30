import test from 'node:test'
import assert from 'node:assert/strict'
import { buildWindowList, cleanWindowTitle, classifyWindow, groupWindows } from './windows.mjs'

test('classifies known shells, editors and browsers regardless of exe case', () => {
  assert.deepEqual(classifyWindow('WindowsTerminal.exe'), { app: 'Windows Terminal', kind: 'terminal' })
  assert.deepEqual(classifyWindow('cursor.exe'), { app: 'Cursor', kind: 'editor' })
  assert.deepEqual(classifyWindow('chrome.exe'), { app: 'Chrome', kind: 'browser' })
  assert.equal(classifyWindow('notepad.exe'), null)
  assert.equal(classifyWindow(undefined), null)
})

test('trims the app suffix from titles without eating the window name', () => {
  assert.equal(cleanWindowTitle('Anthropic status - Google Chrome', 'Chrome'), 'Anthropic status')
  assert.equal(cleanWindowTitle('index.ts - claude-watch - Cursor', 'Cursor'), 'index.ts - claude-watch')
  assert.equal(cleanWindowTitle('(3) Inbox - Google Chrome', 'Chrome'), 'Inbox')
  // A window titled exactly like its app keeps its name rather than going blank.
  assert.equal(cleanWindowTitle('Cursor', 'Cursor'), 'Cursor')
})

test('keeps only known apps, drops our own pid, and dedupes by hwnd', () => {
  const list = buildWindowList([
    { hwnd: '11', pid: 100, exe: 'WindowsTerminal.exe', title: 'pwsh' },
    { hwnd: '11', pid: 100, exe: 'WindowsTerminal.exe', title: 'pwsh' },
    { hwnd: '12', pid: 999, exe: 'chrome.exe', title: 'Docs - Google Chrome' },
    { hwnd: '13', pid: 101, exe: 'notepad.exe', title: 'notes.txt' },
    { hwnd: '14', pid: 102, exe: 'explorer.exe', title: 'Program Manager' },
    { hwnd: '15', pid: 103, exe: 'cursor.exe', title: '   ' }
  ], { excludePids: [999] })
  assert.deepEqual(list.map((w) => w.hwnd), ['11'])
  assert.equal(list[0].app, 'Windows Terminal')
})

test('tags the window a session reported, by hwnd first then by pid', () => {
  const agents = [
    { id: 'claude:a1', provider: 'claude', focusHwnd: '20', focusPid: 200 },
    { id: 'codex:a2', provider: 'codex', focusPid: 300 }
  ]
  const list = buildWindowList([
    { hwnd: '21', pid: 400, exe: 'chrome.exe', title: 'Zed - Google Chrome' },
    { hwnd: '20', pid: 200, exe: 'WindowsTerminal.exe', title: 'claude-watch' },
    { hwnd: '30', pid: 300, exe: 'cursor.exe', title: 'api - Cursor' }
  ], { agents })
  const byHwnd = Object.fromEntries(list.map((w) => [w.hwnd, w]))
  assert.equal(byHwnd['20'].agentId, 'claude:a1')
  assert.equal(byHwnd['20'].agentProvider, 'claude')
  assert.equal(byHwnd['30'].agentId, 'codex:a2')
  assert.equal(byHwnd['21'].agentId, undefined)
  // Agent-owned windows sort ahead of the rest.
  assert.equal(list[list.length - 1].hwnd, '21')
})

test('groups in a fixed order and omits empty groups', () => {
  const groups = groupWindows(buildWindowList([
    { hwnd: '1', pid: 1, exe: 'chrome.exe', title: 'Docs - Google Chrome' },
    { hwnd: '2', pid: 2, exe: 'pwsh.exe', title: 'pwsh' }
  ]))
  assert.deepEqual(groups.map((g) => g.kind), ['terminal', 'browser'])
  assert.deepEqual(groups.map((g) => g.windows.length), [1, 1])
})

test('survives missing, malformed, and non-array input', () => {
  assert.deepEqual(buildWindowList(null), [])
  assert.deepEqual(buildWindowList([{ hwnd: '0', pid: 1, exe: 'pwsh.exe', title: 'x' }]), [])
  assert.deepEqual(buildWindowList([{ pid: 1, exe: 'pwsh.exe', title: 'x' }]), [])
  assert.deepEqual(groupWindows(undefined), [])
})
