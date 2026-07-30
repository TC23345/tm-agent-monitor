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
launch (unless started with `--hidden`), the hotkey, or the tray click. See
`createWindow()` and `showWindow()` in `src/main/index.ts`.

The security-relevant half of the constructor ([security, "Good"](https://www.electronjs.org/docs/latest/tutorial/security)):

```js
// Good
const mainWindow = new BrowserWindow({
  webPreferences: {
    preload: path.join(app.getAppPath(), 'preload.js')
  }
})
```

This repo also sets `sandbox: true` and `contextIsolation: true` explicitly.
Never set `nodeIntegration: true` — the docs list that exact combination as the
"Bad" example.

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
  win.setBounds({ x, y, width, height })
}
```

`workArea` excludes the taskbar. Using `bounds` here would put the card *under*
the taskbar and break the slide-up, since the animation's resting position is
the work-area bottom edge. Bounds are recomputed before every show, so moving
to another monitor and hitting the hotkey does the right thing.

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
card look. Two consequences:

- Transparent margins still capture mouse events — they are not click-through
  unless you call `setIgnoreMouseEvents`.
- With no OS title bar there is no drag affordance. Add one with
  `-webkit-app-region: drag` on a header element
  ([custom title bar](https://www.electronjs.org/docs/latest/tutorial/custom-title-bar)),
  and `no-drag` on every interactive child. This project deliberately has **no**
  drag region: the window is pinned to the work area, so dragging it would only
  ever put it in the wrong place.
