import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_DOCK_INSET, REUSE_AFTER_MS, centreInside, dockRect, outerRectFor, pickLaunchedWindow } from './placement.mjs'

const area = { x: 0, y: 0, width: 2560, height: 1400 }

test('the dock is the work area right of the sidebar', () => {
  assert.deepEqual(dockRect(area, 400), { x: 400, y: 0, width: 2160, height: 1400 })
  assert.deepEqual(dockRect({ x: -1920, y: 40, width: 1920, height: 1040 }, 360), { x: -1560, y: 40, width: 1560, height: 1040 })
  assert.deepEqual(dockRect(area), { x: DEFAULT_DOCK_INSET, y: 0, width: 2560 - DEFAULT_DOCK_INSET, height: 1400 })
})

test('a dock too narrow to use covers the whole work area', () => {
  assert.deepEqual(dockRect({ x: 0, y: 0, width: 800, height: 600 }, 400), { x: 0, y: 0, width: 800, height: 600 })
  assert.deepEqual(dockRect(area, -5), area)
  assert.deepEqual(dockRect(area, Number.NaN), area)
  assert.equal(dockRect({ x: 0, y: 0, width: 0, height: 10 }, 10), null)
})

test('invisible resize borders are added back so the visible frame lands on target', () => {
  const target = { x: 400, y: 0, width: 2160, height: 1400 }
  // Typical Win11 window: 7px invisible border left/right/bottom, none on top.
  const windowRect = { x: 93, y: 100, width: 1014, height: 707 }
  const frameRect = { x: 100, y: 100, width: 1000, height: 700 }
  assert.deepEqual(outerRectFor(target, windowRect, frameRect), { x: 393, y: 0, width: 2174, height: 1407 })
  // Frameless or unreadable: place as given.
  assert.deepEqual(outerRectFor(target, frameRect, frameRect), target)
  assert.deepEqual(outerRectFor(target, null, frameRect), target)
  // An absurd difference (a bad DWM read) is ignored rather than trusted.
  assert.deepEqual(outerRectFor(target, { x: 0, y: 0, width: 3000, height: 3000 }, { x: 500, y: 500, width: 100, height: 100 }), target)
  assert.equal(outerRectFor(null, windowRect, frameRect), null)
})

test('a launch picks the new window of its app', () => {
  const rows = [
    { hwnd: '10', pid: 1, exe: 'Cursor.exe' },
    { hwnd: '11', pid: 2, exe: 'chrome.exe' },
    { hwnd: '12', pid: 1, exe: 'cursor.exe' }
  ]
  assert.deepEqual(pickLaunchedWindow({ rows, before: new Set(['10']), exes: ['cursor.exe'] }), { hwnd: '12', pid: 1 })
  assert.equal(pickLaunchedWindow({ rows, before: ['10', '12'], exes: ['cursor.exe'] }), null)
  assert.deepEqual(pickLaunchedWindow({ rows, before: [], exes: ['chrome.exe'] }), { hwnd: '11', pid: 2 })
})

test('a reused window counts only once it has taken the foreground and time has passed', () => {
  const rows = [{ hwnd: '10', pid: 1, exe: 'cursor.exe' }]
  const foreground = { hwnd: '10', pid: 1, exe: 'cursor.exe' }
  const base = { rows, before: ['10'], exes: ['cursor.exe'], foreground }
  assert.equal(pickLaunchedWindow({ ...base, elapsedMs: 200 }), null)
  assert.deepEqual(pickLaunchedWindow({ ...base, elapsedMs: REUSE_AFTER_MS }), { hwnd: '10', pid: 1 })
  // The workspace itself in front is never a launch result.
  assert.equal(pickLaunchedWindow({ ...base, foreground: { hwnd: '99', pid: 5, exe: 'taylormade agent monitor.exe' }, elapsedMs: 5000 }), null)
})

test('tidy gathers a window by where its centre is', () => {
  assert.equal(centreInside({ x: 100, y: 100, width: 800, height: 600 }, area), true)
  assert.equal(centreInside({ x: 2400, y: 100, width: 800, height: 600 }, area), false)
  assert.equal(centreInside({ x: -1900, y: 0, width: 1000, height: 800 }, area), false)
  assert.equal(centreInside(null, area), false)
})
