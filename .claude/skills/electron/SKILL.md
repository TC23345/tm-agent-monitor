---
name: electron
description: Use when building, debugging, packaging, or shipping an Electron desktop app — main/renderer/preload structure, BrowserWindow and WebContentsView layout, IPC across a sandboxed renderer, tray and global-shortcut summoning, native modules, electron-builder packaging, and auto-update. Also use when a packaged app won't boot, a window won't show or won't animate smoothly, Electron starts as plain Node, a native module fails to load, or you need to embed or control another application's window. Covers this repo's Windows tray-app conventions even if Electron is never named.
---

# Electron

Electron work in this repo, grounded in the docs and in the failures this
project actually hit. Read the gotchas first — they are the part that is not
guessable from the API surface.

## Orientation

Three processes, one rule each ([process model](https://www.electronjs.org/docs/latest/tutorial/process-model)):

| Process | Owns | Never |
| --- | --- | --- |
| **main** (`src/main/`) | windows, tray, hotkeys, native FFI, all OS access | renders UI |
| **preload** (`src/preload/`) | the *only* bridge, via `contextBridge` | exposes `ipcRenderer` wholesale |
| **renderer** (`src/renderer/`) | React UI, sandboxed | touches Node or `require` |

In this project `src/shared/` holds pure `.mjs` modules with `.d.mts` types,
imported by both main and renderer. Put logic there whenever both sides need
it — it is also the only part that is unit-testable under plain `node --test`.

## Gotchas

These defy assumption. Each one cost real debugging time here.

1. **`ELECTRON_RUN_AS_NODE` breaks Electron silently.** VS Code / Claude Code
   shells set it, and Electron then boots as plain Node:
   `does not provide an export named 'BrowserWindow'`. Always clear it before
   launching: `Remove-Item Env:ELECTRON_RUN_AS_NODE`. `scripts/capture-window.mjs`
   does this for you.
2. **A symlinked or junctioned `node_modules` silently breaks packaging.**
   electron-builder cannot resolve transitive deps through it and logs only
   `cannot find path for dependency  dependencies=["…@undefined"]`. The build
   *succeeds* and produces an installer whose asar contains your direct deps but
   none of their dependencies — the app then dies on first `import`. Never
   package from a linked `node_modules`; run a real `npm install` in that
   directory, then verify with `scripts/verify-asar-deps.mjs`.
3. **`requestSingleInstanceLock()` is app-scoped, not path-scoped.** A freshly
   built copy exits instantly (code 0, no window) while an installed build of
   the same app is running. To test a packaged build side by side, give it its
   own `--user-data-dir`.
4. **`electron-updater` is CommonJS.** A named ESM import fails at runtime with
   `Named export 'autoUpdater' not found`. Import the default and destructure:
   `import electronUpdater from 'electron-updater'; const { autoUpdater } = electronUpdater`.
5. **Do not animate `setBounds` on Windows.** It is not smooth. Animate a CSS
   `transform` in the renderer and let main *sequence* it over IPC — and always
   back the hide with a main-side timeout so an unresponsive renderer cannot
   strand a window on screen. See `examples/window-shell.md`.
6. **You cannot embed another app's window.** There is no Electron API
   ([electron/electron#10547](https://github.com/electron/electron/issues/10547),
   open since 2017). `SetParent` reparenting mangles input, focus, and DPI *in
   the captured window* — i.e. the user's real editor. Launch and focus real
   windows instead; use `WebContentsView` when you need embedded **web** panes.
7. **Native modules must be unpacked from the asar.** `koffi` is listed under
   `asarUnpack` in `electron-builder.yml`; a native `.node` inside an asar
   cannot be loaded. Same for any packaged resource read by path.
8. **Renderer feature detection lies about visibility.** `document.hidden`
   *does* flip when a window hides — use it to stop polling, but never assume
   the window is visible just because the renderer is alive.

## Recipes

### Verify a packaged build before handing it over

Building is not verifying. Run all three:

```bash
node .claude/skills/electron/scripts/verify-asar-deps.mjs dist/win-unpacked
node .claude/skills/electron/scripts/capture-window.mjs --packaged --out /tmp/shot.png
```

`verify-asar-deps` walks the production dependency closure from `package.json`
and fails if any package is missing from the asar — the exact failure in gotcha
2. `capture-window` boots the app with an isolated user-data dir (gotcha 3) and
proves it renders.

### Position a window on the right display

`screen.getCursorScreenPoint()` + `getDisplayNearestPoint().workArea` gives the
display the user is actually on, minus the taskbar. `workArea` — not `bounds` —
is what keeps a full-screen window off the taskbar. See `examples/window-shell.md`.

### Add an IPC route

Every mutable route is runtime-validated in main; the preload stays a thin,
typed surface. Follow `examples/ipc-and-preload.md` — it shows the four-file
change (shared type → main handler → preload method → renderer call) and the
validation shape this repo uses.

### Screenshot the UI to check a visual change

`scripts/capture-window.mjs`. The app supports `CLAUDE_WATCH_CAPTURE`,
`CLAUDE_WATCH_CAPTURE_VIEW`, and `CLAUDE_WATCH_CAPTURE_DELAY_MS` — the last one
lets you catch an animation mid-flight rather than at rest, which is the only
way to actually verify a transition.

## Examples

Read the one that matches the task; each pairs the upstream doc example with
what this project does differently and why.

| File | Read when |
| --- | --- |
| `examples/window-shell.md` | Creating/positioning a window, frameless or transparent, show/hide animation |
| `examples/ipc-and-preload.md` | Adding an IPC route, exposing preload API, validating renderer input |
| `examples/multi-view-panes.md` | Splitting a window into panes, or asked to embed another app |
| `examples/tray-hotkey-lifecycle.md` | Tray icon, global shortcut, single-instance, app lifecycle |
| `examples/native-modules.md` | Calling Win32 / any native module, or a `.node` fails to load |
| `examples/packaging-and-update.md` | electron-builder config, asar, auto-update, releasing |

## Verification gates

There is no linter here. Before calling Electron work done:

```bash
npm run typecheck && npm test && npm run build && git diff --check
```

For anything user-visible, add a screenshot via `scripts/capture-window.mjs` —
typecheck passing says nothing about whether the UI renders.
