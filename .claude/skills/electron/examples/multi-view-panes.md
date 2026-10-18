# Panes: DOM panes, `<webview>` for web content, and why foreign windows cannot be embedded

Sources:
- https://www.electronjs.org/docs/latest/api/web-contents-view
- https://www.electronjs.org/docs/latest/api/webview-tag
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
layout engine, and the view is a native layer above the whole page.

**In this project** the pane grid is *not* built this way. Panes are our own
React content — DOM elements in a single renderer on a CSS grid. Columns and
rows are fractions with a 10 px gutter track between each pair for the
splitter, and slots are placed explicitly (`App.tsx`, maths in
`src/shared/layout.mjs`):

```tsx
gridTemplateColumns: zoomed ? '1fr' : columnTemplate(colFracs, GRID_GUTTER),
gridTemplateRows: zoomed ? '1fr' : columnTemplate(rowFracs, GRID_GUTTER),
```

## Web content you do not control: `<webview>`, not `WebContentsView`

The `web` pane (`src/renderer/src/WebPane.tsx`) hosts a live site. It is a
`<webview>` guest, chosen over `WebContentsView` because it is DOM: it sits in
the grid, zooms and hides with the other panes, and the app's menus and
palette draw over it — a `WebContentsView` would float above all of them and
need manual bounds.

The cost is that the guest is a second webContents to secure, and the renderer
asks for it. Main trusts none of the element's attributes —
`installWebPaneGuards` (`src/main/webPanes.ts`) runs before the workspace
window exists:

- only the workspace sets `webviewTag: true`;
- `will-attach-webview` refuses any guest not on the `persist:web` partition
  or not on an http(s) URL, deletes its preload, and forces `sandbox`,
  `contextIsolation`, no Node, `webSecurity`;
- navigation and redirects stay http(s); same-site popups open in the pane,
  others in the default browser (`setWindowOpenHandler`);
- the partition refuses every permission but clipboard writes and fullscreen,
  and sends a plain Chrome user agent (Google sign-in refuses an "embedded
  browser" UA);
- keys typed into a guest never reach the renderer's keydown handler, so
  `before-input-event` takes back the workspace keys that work inside a
  terminal and sends them as `web:key`.

A new kind of embedded web content gets the same treatment: one partition,
attach-time lockdown in main, nothing trusted from the renderer.

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
windows over Win32 and raises the one you pick (the palette's `#` prefix):

```ts
ipcMain.handle('windows:list', (): DesktopWindow[] => {
  if (mockMode) return mockWindows()
  return buildWindowList(listDesktopWindows(), {
    agents: daemon.store.snapshot(),
    excludePids: [process.pid]
  }) as DesktopWindow[]
})
```

The workspace is not always-on-top, so a raised window simply appears in front
while the workspace waits behind; the hotkey raises it again. (The old
always-on-top workspace had to `stepAside()` after every focus — removed, do
not bring it back.)

## Pane state belongs to the renderer

Pane layout (which kinds, what order) is renderer state persisted in
`localStorage` (`tm.panes.v3`) — see `src/renderer/src/panes.ts`, parsing in
`src/shared/panes.mjs`. It deliberately does **not** round-trip through main:

- no IPC surface to validate,
- no settings-schema migration,
- and the layout is per-view preference, not app configuration.

Panes are instances (`{id, kind}`, `MAX_PANES = 6`). Data views are unique
(`isUniqueKind`) — that stops an expensive consumer like the Insights scan
running twice. `terminal`, `web`, `file` and `chat` repeat, one PTY, site,
file or conversation each, carrying their config on the instance (`term`,
`web`, `file`, `chat`). An embedded terminal does not contradict the
no-foreign-windows rule — it is this app's own xterm.js over a main-process
ConPTY (`node-pty`); a chat pane is our UI over the user's CLI, run by
`ChatManager` in main.

**Uniqueness does not stop a poller running at all.** A hook that lives in the
parent keeps running after the pane showing it is closed. Gate it on its
consumer as well as on visibility — or, when the data is only needed on
demand, do not poll. The window list used to be a 4-second poll for a
switcher; it is now fetched once each time the palette opens:

```tsx
// App.tsx — only when the palette opens, never on a timer.
useEffect(() => {
  if (!palette) return
  let live = true
  window.watch.listWindows().then((list) => { if (live) setPaletteWindows(list) }).catch(() => {})
  return () => { live = false }
}, [palette])
```

Same trap for any parent-owned subscription behind a togglable child.

## Two places, one state

A pane layout invites one view into two places. The agent list could once be
both the sidebar and an `agents` pane, and collapsing a project group in one
left the other stale until remount, because `useCollapse` keeps React state
per instance over one `localStorage` key. The list now lives in one place at a
time (`addPane('agents')` turns the sidebar section off, and turning the
section on closes the pane), which is the first fix to reach for.

Where two instances are unavoidable, broadcast on change and let the others
read the stored value back:

```ts
const set = useCallback((next: boolean) => {
  setCollapsed(next)
  localStorage.setItem(storageKey, next ? '1' : '0')
  window.dispatchEvent(new CustomEvent(COLLAPSE_SYNC_EVENT, { detail: storageKey }))
}, [storageKey])

// listener calls setCollapsed (not set), so it cannot re-dispatch and loop
```

Before shipping a pane layout, ask of every view: can this be on screen twice?
If yes, its state must be shared or synced. Across windows (the picker and the
Clipboard pane), neither holds a copy: both re-read through IPC on the change
push.
