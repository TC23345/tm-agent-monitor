# Panes: WebContentsView, and why foreign windows cannot be embedded

Sources:
- https://www.electronjs.org/docs/latest/api/web-contents-view
- https://www.electronjs.org/docs/latest/api/base-window
- https://github.com/electron/electron/issues/10547

## Multiple web views in one window

`BrowserView` is **deprecated**. `WebContentsView` (Electron 30+, this app is
on 42) is the replacement. Upstream
([web-contents-view](https://www.electronjs.org/docs/latest/api/web-contents-view)):

```js
const { BaseWindow, WebContentsView } = require('electron')

const win = new BaseWindow({ width: 800, height: 400 })

const view1 = new WebContentsView()
win.contentView.addChildView(view1)
view1.webContents.loadURL('https://electronjs.org')
view1.setBounds({ x: 0, y: 0, width: 400, height: 400 })

const view2 = new WebContentsView()
win.contentView.addChildView(view2)
view2.webContents.loadURL('https://github.com/electron/electron')
view2.setBounds({ x: 400, y: 0, width: 400, height: 400 })
```

Two things to note: it is `BaseWindow` (not `BrowserWindow`) hosting a
`contentView` tree, and **you position each view yourself in pixels** —
`setBounds` on every view, re-applied on every window resize. There is no
layout engine.

**In this project** the pane grid is *not* built this way. All six panes are
our own React content, so they are DOM elements in a single renderer using CSS
grid — one process, real layout, no manual bounds math:

```tsx
<main className="grid" style={{ gridTemplateColumns: `repeat(${Math.min(panes.length, 3)}, minmax(0, 1fr))` }}>
```

Reach for `WebContentsView` only when a pane must host **web content you do not
control** (a live site, a docs viewer, an OAuth flow). That is the one case DOM
panes cannot cover, because such content needs its own process and session.
Cost: manual bounds, a second webContents to secure, and its own preload.

## You cannot embed another application's window

This comes up constantly ("put my terminal / editor / browser in a pane").
The answer is no, and it is worth knowing precisely why.

- There is **no Electron API**.
  [electron/electron#10547 "Embed External Native Windows"](https://github.com/electron/electron/issues/10547)
  has been open since 2017 and is still open, with 40+ comments.
- The workaround people reach for is Win32 `SetParent`: strip `WS_POPUP` /
  `WS_CAPTION`, add `WS_CHILD`, reparent the HWND. It requires a native module,
  and it breaks **input routing, focus, and DPI in the window being captured** —
  which is the user's real editor or terminal, not a throwaway surface.
- The direction discussed upstream is importing a native window handle as a
  shared texture: display-only, no input, no event system.

**So the pattern is launch-and-focus, not embed.** This project enumerates real
windows over Win32, lists them, and raises the one you click:

```ts
ipcMain.handle('windows:list', (): DesktopWindow[] => {
  if (mockMode) return mockWindows()
  return buildWindowList(listDesktopWindows(), {
    agents: daemon.store.snapshot(),
    excludePids: [process.pid]
  }) as DesktopWindow[]
})
```

Because the app is full-screen and always-on-top, anything that surfaces
another window then calls `stepAside()` — otherwise the workspace covers what
it just raised. That single call is what makes launch-and-focus *feel* like
window management.

## Pane state belongs to the renderer

Pane layout (which kinds, what order) is renderer state persisted in
`localStorage` — see `src/renderer/src/panes.ts`. It deliberately does **not**
round-trip through main:

- no IPC surface to validate,
- no settings-schema migration,
- and the layout is per-view preference, not app configuration.

Keep data-view kinds unique (`MAX_PANES = 6`). That stops an expensive poller
like `windows:list` running *twice*. Terminal panes are the deliberate
exception: they repeat (one embedded PTY per pane), which is why panes are
instances (`{id, kind}`) rather than a bare list of kinds. An embedded terminal
does not contradict the no-foreign-windows rule below — it is this app's own
xterm.js over a main-process ConPTY (`node-pty`), not a captured window.

**It does not stop it running at all.** The hook lives in the parent, so it
keeps polling after the pane is closed — a full `EnumWindows` plus a
process-table snapshot every 4 seconds for a pane nobody is looking at. Gate it
on the consumer as well as on visibility:

```tsx
// App.tsx — only enumerate windows while a pane is showing them.
const desktop = useDesktopWindows(panes.includes('windows'))
```

```tsx
// the hook
useEffect(() => {
  if (!enabled) { setWindows(null); return }
  // …visibilitychange-gated interval…
}, [enabled, refresh])
```

Same trap for any parent-owned subscription behind a togglable child.

## Two places, one state

A pane layout lets one view appear twice — here the agent list is both the
sidebar and an optional `agents` pane. Any state held *per instance* over a
shared key then desyncs: collapsing a project group in the sidebar left the pane
showing it expanded until remount, because `useCollapse` keeps React state per
instance over one `localStorage` key.

Broadcast on change and let the other instances read the stored value back:

```ts
const set = useCallback((next: boolean) => {
  setCollapsed(next)
  localStorage.setItem(storageKey, next ? '1' : '0')
  window.dispatchEvent(new CustomEvent(COLLAPSE_SYNC_EVENT, { detail: storageKey }))
}, [storageKey])

// listener calls setCollapsed (not set), so it cannot re-dispatch and loop
```

Before shipping a pane layout, ask of every view: can this be on screen twice?
If yes, its state must be shared or synced.
