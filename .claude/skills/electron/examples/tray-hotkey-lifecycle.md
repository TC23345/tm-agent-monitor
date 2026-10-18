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
build may already own `Ctrl+Alt+W` — and there are many global chords: summon,
half view, the clipboard picker, paste favorites 1–3, and one per clip keybind.
Every one goes through `claimChord()`, which refuses a chord another of our
rows already holds and records why a row failed (Settings → Keyboard shortcuts
shows it):

```ts
function claimChord(id: ShortcutId, acc: string, handler: () => void): boolean {
  const chord = normalizeAccelerator(acc) ?? acc
  const holder = claimedChords.get(chord)
  if (holder) { shortcutNotes[id] ??= `used by ${shortcutLabel(holder)}`; return false }
  let ok = false
  try { ok = globalShortcut.register(acc, handler) } catch { ok = false }
  if (ok && globalShortcut.isRegistered(acc)) { claimedChords.set(chord, id); return true }
  globalShortcut.unregister(acc)
  shortcutNotes[id] ??= 'not registered — held by another app'
  return false
}
```

`register()` returning true is not sufficient — the code re-checks with
`isRegistered()`, because a claimed-but-dead binding is a real outcome. Summon
and the picker walk fallback lists (`HOTKEY_FALLBACKS`,
`PICKER_HOTKEY_FALLBACKS`); the others do not. `registerAllHotkeys()` is the
only entry point: `unregisterAll()`, then summon → half → picker → favorites →
clip keybinds, so on a clash the earlier row wins. Any chord in a
`settings:set` patch re-runs it; a clip-store change re-runs it only when the
`id=chord` signature moved (every copy is a store change). While Settings
records a new chord, `hotkeys:suspend` releases ours (a held chord never reaches
the page as a keydown) for at most 30 s. Accelerator spelling is one rule,
`normalizeAccelerator` in `src/shared/hotkeys.mjs`.

## Tray

Upstream builds the menu once. **In this project** `buildTrayMenu()` runs on
every right-click, so labels and checkbox items reflect live state (the chords
that actually registered, mock mode, launch-at-login, whether an update is
staged) instead of whatever was true at startup. Build the menu lazily whenever
items are stateful.

Tray icon loading is defensive: `trayImage()` falls back to an inline base64
PNG if the packaged resource is missing, because a `Tray` constructed with an
empty image throws and takes the app down at boot. The icon also carries the
waiting count: `trayImageFor(count)` draws a red badge into raw BGRA
(`src/shared/trayBadge.mjs`), because `nativeImage` decodes only PNG/JPEG and
main has no canvas. While the workspace is visible the taskbar button carries
the same count (`setOverlayIcon`) and flashes once on 0→N; `updateTray` applies
what `attentionTransition` (`src/shared/attentionSignal.mjs`, tested) decides.

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

This project uses `second-instance` as a command channel. `scripts/tm.mjs`
(`tm open --cwd … --launch claude`, `tm layout <name>`, `tm palette`, …) and
the Windows Jump List relaunch the exe with argv; the running instance parses
it with `parseWorkspaceArgs` (`src/shared/workspaceCommand.mjs`), handles
`show`/`hide` itself, and sends anything else to the renderer as
`workspace:command`, where `isWorkspaceCommand` validates it again. Only a
plain relaunch with no command toggles the window like the hotkey.

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
  flush — usage refresh, history, the clip store — then stops the usage worker
  and calls `app.quit()` again behind a `quitReady` guard (or `quitAndInstall()`
  when an update is staged). Any async shutdown work needs this shape, plus a
  timeout race per step so a hung flush cannot block quit forever. A separate
  `before-quit` listener closes every chat CLI (`chats.closeAll()`).
- `will-quit` unregisters shortcuts, destroys the picker, stops the clipboard
  watcher, disposes every PTY and stops the daemon.
- The usage worker (`utilityProcess`, electron `SKILL.md` gotcha 14) is forked
  on first use and killed only after the final flush, never before.

## Renderer crashes

Main owns the PTYs and chat processes, so a renderer death must not end them.
`render-process-gone` (any reason but `clean-exit`) and an `unresponsive` that
lasts 10 s call `recoverRenderer()`, which reloads the page within
`reloadBudget` (`src/shared/crashPolicy.mjs`: three per five minutes). Past the
budget it shows a notification whose click reloads. Panes reattach to their
sessions by stored id, so shells and scrollback survive. The usage worker
re-forks under the same budget.

## Notifications

`Notification.isSupported()` is checked before constructing, and mock/capture
modes suppress notifications entirely — a screenshot run must never fire real
desktop toasts. Clicking a toast focuses the relevant window and falls back to
showing the app when that fails.
