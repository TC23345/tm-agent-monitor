# Tray, global shortcut, and app lifecycle

Sources:
- https://www.electronjs.org/docs/latest/api/tray
- https://www.electronjs.org/docs/latest/api/global-shortcut
- https://www.electronjs.org/docs/latest/api/app

## Global shortcut

Upstream ([global-shortcut](https://www.electronjs.org/docs/latest/api/global-shortcut)):

```js
const { app, globalShortcut } = require('electron')

app.whenReady().then(() => {
  const ret = globalShortcut.register('CommandOrControl+X', () => {
    console.log('CommandOrControl+X is pressed')
  })
  if (!ret) console.log('registration failed')
  console.log(globalShortcut.isRegistered('CommandOrControl+X'))
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
})
```

Two facts the example encodes and that matter: **registration can fail** (another
app owns the combo) and you **must unregister on `will-quit`**.

**In this project** failure is expected, not exceptional — the user's installed
build may already own `Ctrl+Alt+W` — so `registerHotkey()` walks a fallback list
and reports which one won:

```ts
function registerHotkey(): void {
  const candidates = [hotkeyPref, ...HOTKEY_FALLBACKS.filter((h) => h !== hotkeyPref)]
  for (const acc of candidates) {
    let ok = false
    try { ok = globalShortcut.register(acc, toggleWindow) } catch { ok = false }
    if (ok && globalShortcut.isRegistered(acc)) { activeHotkey = acc; return }
    globalShortcut.unregister(acc)
  }
  activeHotkey = null
}
```

`register()` returning true is not sufficient — the code re-checks with
`isRegistered()`, because a claimed-but-dead binding is a real outcome.
Changing the hotkey at runtime is `unregisterAll()` then re-register.

## Tray

Upstream builds the menu once. **In this project** `buildTrayMenu()` runs on
every right-click, so checkbox items reflect live state (mock mode,
launch-at-login, whether an update is staged) instead of whatever was true at
startup. Build the menu lazily whenever items are stateful.

Tray icon loading is defensive: `trayImage()` falls back to an inline base64
PNG if the packaged resource is missing, because a `Tray` constructed with an
empty image throws and takes the app down at boot.

## Single-instance lock — and how it bites you

Upstream ([app.requestSingleInstanceLock](https://www.electronjs.org/docs/latest/api/app)):

```js
const gotTheLock = app.requestSingleInstanceLock(additionalData)

if (!gotTheLock) {
  app.quit()
} else {
  app.on('second-instance', (event, commandLine, workingDirectory, additionalData) => {
    if (myWindow) {
      if (myWindow.isMinimized()) myWindow.restore()
      myWindow.focus()
    }
  })
}
```

This project maps `second-instance` to `toggleWindow()` — relaunching the app
acts like the hotkey.

**The gotcha:** the lock is keyed on the app (userData path), *not* the
executable path. A freshly built copy launched while an installed build is
running will exit immediately with code 0 and no window, which looks exactly
like a crash. To smoke-test a packaged build beside an installed one, give it
its own profile:

```powershell
Start-Process ".\dist\win-unpacked\TaylorMade Agents.exe" -ArgumentList "--user-data-dir=$env:TEMP\probe"
```

## Lifecycle

- `window-all-closed` is a **no-op** here — closing the window must not quit a
  tray app.
- `before-quit` is preempted (`event.preventDefault()`) to run a bounded final
  flush, then `app.quit()` is called again behind a `quitReady` guard. Any async
  shutdown work needs this shape, plus a timeout race so a hung flush cannot
  block quit forever.
- `will-quit` unregisters shortcuts and stops the daemon.

## Notifications

`Notification.isSupported()` is checked before constructing, and mock/capture
modes suppress notifications entirely — a screenshot run must never fire real
desktop toasts. Clicking a toast focuses the relevant window and falls back to
showing the app when that fails.
