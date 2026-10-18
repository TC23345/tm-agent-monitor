# Window shell: creation, positioning, show/hide animation

Sources:
- https://www.electronjs.org/docs/latest/api/browser-window
- https://www.electronjs.org/docs/latest/api/screen
- https://www.electronjs.org/docs/latest/tutorial/security

## 1. Create hidden, show deliberately

Upstream ([browser-window, "Using the `ready-to-show` event"](https://www.electronjs.org/docs/latest/api/browser-window)):

```js
const { BrowserWindow } = require('electron')
const win = new BrowserWindow({ show: false })
win.once('ready-to-show', () => {
  win.show()
})
```

**In this project** we go further: the window is created with `show: false` and
is *never* shown by `ready-to-show`. A tray app decides its own moment — first
launch (unless started with `--hidden` or at login), the hotkey, or the tray
click. See `createWindow()` and `showWindow()` in `src/main/index.ts`. The
quick picker (`createPicker()` in `src/main/picker.ts`) is created hidden the
same way and shown only by its chord or the tray.

The security-relevant half of the constructor ([security, "Good"](https://www.electronjs.org/docs/latest/tutorial/security)):

```js
// Good
const mainWindow = new BrowserWindow({
  webPreferences: {
    preload: path.join(app.getAppPath(), 'preload.js')
  }
})
```

This repo also sets `sandbox: true` and `contextIsolation: true` explicitly, on
both windows. Never set `nodeIntegration: true` — the docs list that exact
combination as the "Bad" example. Only the workspace sets `webviewTag: true`,
for web panes, and every guest is locked down at attach time (see
`multi-view-panes.md`).

## 2. Position against the display the user is on

Upstream ([screen](https://www.electronjs.org/docs/latest/api/screen)) uses
`screen.getAllDisplays()` and picks an external display by bounds:

```js
const { app, BrowserWindow, screen } = require('electron')

app.whenReady().then(() => {
  const displays = screen.getAllDisplays()
  const externalDisplay = displays.find((display) => {
    return display.bounds.x !== 0 || display.bounds.y !== 0
  })
  if (externalDisplay) {
    win = new BrowserWindow({
      x: externalDisplay.bounds.x + 50,
      y: externalDisplay.bounds.y + 50
    })
  }
})
```

**In this project** the display is chosen by *where the cursor is*, and we use
`workArea` rather than `bounds`:

```ts
function positionWorkspace(): void {
  if (!win) return
  const cursor = screen.getCursorScreenPoint()
  const { x, y, width, height } = screen.getDisplayNearestPoint(cursor).workArea
  if (viewMode === 'half') {
    const half = Math.floor(width / 2)
    win.setBounds({ x: halfSide() === 'right' ? x + (width - half) : x, y, width: half, height })
  } else {
    win.setBounds({ x, y, width, height })
  }
}
```

`workArea` excludes the taskbar. Using `bounds` here would put the card *under*
the taskbar and break the slide-up, since the animation's resting position is
the work-area bottom edge. Bounds are recomputed before every show, so moving
to another monitor and hitting the hotkey does the right thing. The size-mode
model (`viewMode`, `halfSide()`, the persisted `sizeMode`) is the
`workspace-layout` skill's.

## 3. Animate show/hide without moving the window

**Do not** animate `setBounds` — it is not smooth on Windows. Animate a
GPU-composited transform in the renderer and let main sequence it.

Main (`src/main/index.ts`):

```ts
const EXIT_MS = 190
let pendingHide: NodeJS.Timeout | null = null

function showWindow(): void {
  if (!win) return
  if (pendingHide) { clearTimeout(pendingHide); pendingHide = null }
  // Minimized (the title-bar button, `window:minimize`) counts as visible to
  // Windows, so restore first or show()/focus() leave it in the taskbar.
  if (win.isMinimized()) win.restore()
  positionWorkspace()
  win.show()
  win.focus()
  sendPhase('enter')   // after show, so the transition runs against painted frames
}

function hideWindow(): void {
  if (!win || !win.isVisible() || pendingHide) return
  sendPhase('exit')
  // Fires regardless of what the renderer does, so an unresponsive page can
  // never strand the window on screen.
  pendingHide = setTimeout(() => { pendingHide = null; win?.hide() }, EXIT_MS)
}
```

Renderer (`src/renderer/src/App.tsx`) — the mount frame covers the very first
show, whose event predates the listener:

```tsx
useEffect(() => {
  const raf = requestAnimationFrame(() => setOpen(true))
  const off = window.watch.onWindowPhase((phase) => {
    if (phase === 'exit') setOpen(false)
    else requestAnimationFrame(() => setOpen(true))
  })
  return () => { cancelAnimationFrame(raf); off() }
}, [])
```

CSS (`styles.css`) — start off-screen so the first painted frame is already
correct, and honour reduced motion:

```css
.app {
  transform: translateY(100%);
  opacity: 0;
  transition: transform 0.28s cubic-bezier(0.16, 0.84, 0.28, 1), opacity 0.18s ease-out;
  will-change: transform;
}
.app.is-open { transform: translateY(0); opacity: 1; }
@media (prefers-reduced-motion: reduce) {
  .app { transition: opacity 0.12s linear; transform: none; }
}
```

**Verifying it.** A screenshot at rest proves nothing about a transition.
Capture mid-flight by shortening the delay (`CLAUDE_WATCH_CAPTURE_DELAY_MS`) or
by driving a real hide → show cycle and capturing ~90 ms in. A correct frame
shows the card partway up the screen and partially transparent.

## Frameless / transparent notes

`frame: false` + `transparent: true` + `hasShadow: false` gives the floating
card look. Consequences:

- Transparent margins still capture mouse events — they are not click-through
  unless you call `setIgnoreMouseEvents`.
- With no OS title bar there is no drag affordance. Add one with
  `-webkit-app-region: drag` on a header element
  ([custom title bar](https://www.electronjs.org/docs/latest/tutorial/custom-title-bar)),
  and `no-drag` on every interactive child. This project deliberately has **no**
  drag region: the window is pinned to the work area, so dragging it would only
  ever put it in the wrong place.
- There is no OS resize border either: `resizable: true` plus `will-resize`
  never fired on a transparent window (probed 2026-09-15). Resizing is the
  renderer's job — 8 px grip strips that report pointer travel over IPC — and
  main decides the geometry: the workspace's `EdgeGrip` → `window:edge-drag` →
  `commitEdgeDrag` flips the size mode, never stretches; the picker's grips →
  `picker:resize` → `resizePickerBy` (`pickerPlace.mjs` `resizePicker`).
- The workspace leaves `skipTaskbar` off (electron `SKILL.md` gotcha 16), so
  while visible it has a taskbar button that carries the waiting count.

## Backdrop material

`backgroundMaterial: 'mica'` (the `windowMaterial` setting: `none | mica |
acrylic`) is set at creation and changed live with `setBackgroundMaterial`
(`applyWindowMaterial`); main then sends `window:material` so the renderer sets
`data-material` on the root and the `.app` card goes translucent. It is a no-op
before Windows 11 22H2. Keep `backgroundColor: '#00000000'` beside it. Because
the card may be translucent, a fade over scrolling content is a `mask-image`
(the project strip's), never a painted gradient in the background colour.

## The second window: the quick picker

`src/main/picker.ts` is a popup, so it breaks two workspace rules on purpose:
`alwaysOnTop: true` and `skipTaskbar: true`, and blur hides it. It is the card
plus a 28 px transparent margin for the shadow, placed at the cursor by
`placePicker` (`src/shared/pickerPlace.mjs`, tested: flipped near an edge,
clamped to that display's `workArea`) at the remembered `pickerSize`. Open and
close run the same pattern as the workspace — a renderer transform sequenced by
`picker:phase` (`enter` / `exit`), with its own `EXIT_MS` (160) main-side hide
timeout — never an animated `setBounds`. It loads the same renderer bundle as
`index.html?window=picker` with its own preload (`src/preload/picker.ts`).
