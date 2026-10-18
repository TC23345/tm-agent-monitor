---
name: electron
description: Use when building, debugging, packaging, or shipping an Electron desktop app — main/renderer/preload structure, BrowserWindow, `<webview>` and WebContentsView layout, utilityProcess workers, IPC across a sandboxed renderer, tray and global-shortcut summoning, native modules, electron-builder packaging, and auto-update. Also use when a packaged app won't boot, a window won't show or won't animate smoothly, Electron starts as plain Node, a native module fails to load, or you need to embed or control another application's window. Covers this repo's Windows tray-app conventions even if Electron is never named.
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

There are two windows and one helper process. The workspace
(`createWindow()` in `src/main/index.ts`, preload `src/preload/index.ts` →
`window.watch`) and the clipboard quick picker (`src/main/picker.ts`, preload
`src/preload/picker.ts` → `window.picker`, the same renderer bundle as
`index.html?window=picker`). The usage worker (`src/main/usageWorker.ts`) is a
`utilityProcess` main forks for the synchronous JSONL parsing (gotcha 14).
Main also owns every PTY (`TerminalManager`) and chat CLI (`ChatManager`).

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
   directory, then verify with `scripts/verify-asar-deps.mjs`. Claude Code's
   `EnterWorktree` checkouts (`.claude/worktrees/<name>/`) get a `node_modules`
   symlink to the main checkout's — fine for typecheck, tests and `build`, but
   `dist`, `debug:app` and anything that packages run from the main checkout
   after fast-forwarding `main` (the Update chip already does).
   The same silent failure happens when a dependency is simply **not
   installed**: electron-vite leaves every `dependencies` entry external, and
   electron-builder packs whatever is in `node_modules` without comment. 0.4.58
   shipped without the Agent SDK and `ws` (a merge added them; nobody ran
   `npm install`) and died with `ERR_MODULE_NOT_FOUND`. `scripts/check-deps.mjs`
   now runs first in `dist`, `dist:dir` and `publish` and refuses when a
   non-dev lockfile package is absent, and Rebuild & relaunch runs
   `npm install` before `npm run dist`.
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
   windows instead. Embedded **web** content is a different matter: the `web`
   pane (`WebPane.tsx`) is a `<webview>` guest on the workspace window, the
   only window with `webviewTag: true`, locked down in main by
   `installWebPaneGuards` (`src/main/webPanes.ts`). See
   `examples/multi-view-panes.md`.
7. **Native code must be unpacked from the asar.** `asarUnpack` in
   `electron-builder.yml` lists `koffi`, `node-pty` and
   `@anthropic-ai/claude-agent-sdk-win32-x64` (the SDK's bundled `claude.exe`,
   the chat pane's fallback CLI); a `.node` or an `.exe` inside an asar cannot
   be loaded. Same for any packaged resource read by path. `npmRebuild: false`
   is deliberate: both native deps ship prebuilt binaries, and electron-builder's
   rebuild step compiles node-pty from source and fails without
   Spectre-mitigated VS libraries (MSB8040).
8. **Renderer feature detection lies about visibility.** `document.hidden`
   *does* flip when a window hides — use it to stop polling, but never assume
   the window is visible just because the renderer is alive.
9. **Gate a poller on its consumer, not just on uniqueness.** In a pane layout
   the hook usually lives in the parent, so it keeps running after the pane
   showing it is closed. Uniqueness stops it running *twice*; only an explicit
   `enabled` flag stops it running *at all*. Cheap-looking polls are not cheap:
   the window list is a full `EnumWindows` plus a process-table snapshot, which
   is why it is no longer polled at all — the palette fetches it once per open
   (`listWindows` in `App.tsx`).
10. **The same component can be mounted twice.** A pane layout lets one view
    appear in two places. State held per instance over a shared `localStorage`
    key then desyncs — toggling one leaves the other stale until remount. Prefer
    one place at a time (the agent list is the sidebar's Agents section *or* the
    Agents pane; App closes one when the other opens). Where two instances are
    unavoidable, broadcast changes on a custom event and have instances read the
    stored value back (never re-set it, or they loop). See `useCollapse`.
11. **The workspace layers like a normal window — do not make it
    always-on-top.** It once was, which forced a `stepAside()` hide after every
    launch or focus and a `keepOpen` opt-out for callers inside dialogs; both
    were removed with the de-layering (commit `4d592db`). Anything it launches
    now simply appears in front, and the hotkey raises a buried workspace
    (`toggleWindowMode`). The picker is the one always-on-top window: it is a
    popup that hides on blur.
12. **An npm bin shim is not `node <file>`.** A package whose bin entry lacks a
    `#!/usr/bin/env node` line runs fine as `node dist/index.js` and dies as
    `npx <pkg>` on any machine whose npm `script-shell` is Git Bash (`npm config
    get script-shell`): the sh shim *sources* the bundle. Spawning `.cmd` shims
    without a shell fails too (Node refuses since the 2024 CVE fix). For
    anything an agent must launch reliably — MCP servers, `electron` itself —
    resolve the real entry and run it under node (`scripts/mcp-electron-debug.mjs`,
    `scripts/debug-app.mjs`, which spawns the binary `require('electron')`
    returns).
13. **A new skill is not discoverable mid-session.** Adding
    `<repo>/.claude/skills/<name>/` does not register it in a running session —
    `Skill(name)` fails with "Unknown skill". Install it to
    `~/.claude/skills/<name>/` (see "Maintaining this skill") and it resolves
    immediately.
14. **Synchronous parsing belongs in a `utilityProcess`, not main.** Main is the
    IPC hub for six xterm panes and the 1 Hz snapshot; a heavy JSONL day
    hitched all of it. The ledgers, Codex rollout scan and insights scan run in
    `src/main/usageWorker.ts`, built as a second main input in
    `electron.vite.config.ts` (`out/main/usageWorker.js`, imports no Electron)
    and forked lazily by `ensureUsageWorker()`. Main keeps only the read side
    (`LocalUsageView`), `callWorker` adds a 60 s timeout per call, a dead worker
    re-forks under the renderer reload budget, and quit kills it only after the
    final flush. The contract is `src/shared/usageWorkerProtocol.mjs` (tested).
15. **A dead renderer must not take the shells with it.** Main owns the PTYs,
    so `render-process-gone` and a 10 s `unresponsive` reload the page
    (`recoverRenderer`, bounded by `reloadBudget` in `crashPolicy.mjs`: three
    per five minutes, then a notification whose click reloads); panes reattach
    to their sessions by stored id.
16. **`skipTaskbar` is not what it looks like on Windows.** Electron implements
    it with `ITaskbarList::DeleteTab`, so a visible window stays in Alt+Tab and
    only loses its taskbar button. The workspace does not set it (since 0.4.7):
    while visible its button carries the waiting count (`setOverlayIcon`) and
    flashes once on 0→N (`flashFrame`), both decided by `attentionTransition`
    (`attentionSignal.mjs`) in `updateTray`. Do not reintroduce it on the
    workspace; the picker sets it because it is a popup.
17. **A `detached` child dies with the app.** Electron's main process sits in a
    Windows job object and a detached spawn inherits it, so a helper meant to
    outlive the app (the Rebuild & relaunch installer waiter) is killed on
    exit. Create it through WMI `Win32_Process.Create` instead (`app:reinstall`
    in `src/main/index.ts`).

## Recipes

### Verify a packaged build before handing it over

Building is not verifying. Script paths below are relative to this skill's base
directory, which is printed when the skill loads (the repo copy lives at
`.claude/skills/electron/`, the installed copy at `~/.claude/skills/electron/`):

```bash
node <skill>/scripts/verify-asar-deps.mjs dist/win-unpacked
node <skill>/scripts/capture-window.mjs --packaged --out /tmp/shot.png
```

`verify-asar-deps` walks the production dependency closure from `package.json`
and fails if any package is missing from the asar — the exact failure in gotcha
2. It parses the asar header directly, so it needs no network and no `npx`.
`capture-window` boots the app with an isolated user-data dir (gotcha 3) and
proves it renders.

Check exit codes **without a pipe**. In PowerShell, `$LASTEXITCODE` reflects the
last command in a pipeline, so `script | Select-Object` reports 0 even when the
script failed:

```powershell
node <skill>/scripts/verify-asar-deps.mjs dist\win-unpacked > $null 2>&1
"exit=$LASTEXITCODE"
```

### Review an existing app

Audit against the gotchas above — most are a one-line grep, and the ones that
are not are where the bugs live:

| Gotcha | How to check |
| --- | --- |
| 2 packaging | `scripts/verify-asar-deps.mjs`; confirm `node_modules` is not a link |
| 4 updater | `grep -n "electron-updater" src/main/*.ts` — must be a default import |
| 5 animation | `grep -rn "setBounds" src/main` — none inside a timer/loop |
| 7 native | `ls dist/win-unpacked/resources/app.asar.unpacked/node_modules` |
| 8, 9 polling | find every `setInterval` in the renderer: is it gated on both `document.hidden` **and** its consumer being mounted? |
| 10 duplicates | can any view render in two places at once? then no per-instance state over a shared key |
| 11 layering | `grep -rn "alwaysOnTop" src/main` — only `picker.ts` |
| 14 main stalls | any synchronous file parsing on main's hot path? move it to the worker |
| 16 taskbar | `grep -rn "skipTaskbar" src/main` — only `picker.ts` |

Then run the gates below. Finish with a screenshot, because typecheck passing
says nothing about whether the UI renders.

### Drive the live app from an agent — reach for this first

The `electron-debug` MCP server (four tools) is the primary way to look at the
running app: verifying a change, seeing what rendered, clicking through a
flow, reading console output. Screenshots alone prove rendering; these prove
behaviour.

1. `npm run debug:app` — launches the built app with `--remote-debugging-port`,
   mock data, a throwaway `--user-data-dir` (gotcha 3), and daemon port 7460 so
   the installed app's hooks stay untouched. It also strips
   `TM_AGENT_MONITOR_ENDPOINT_FILE` and `TM_TERMINAL_ID`: run from inside one of
   the installed app's panes, an inherited endpoint path made the debug app
   publish its port over the installed app's file and capture every hook on the
   machine. `--real` for live hooks, `--packaged` for `dist/win-unpacked`. The
   picker is a second CDP page target (`?window=picker`).
2. `get_electron_window_info` — confirms the attach (`automationReady: true`).
3. `send_command_to_electron` `get_page_structure` — every button/select with
   its text, aria-label, and class; pick targets from this, not from memory.
4. Act: `click_by_text`, `click_by_selector`, `fill_input`,
   `send_keyboard_shortcut`, or `eval` for anything else.
5. `take_screenshot` — no args returns the PNG inline; a **relative**
   `outputPath` (`dist/shot.png`) writes a file. Absolute Windows paths,
   `%TEMP%` included, are rejected as "restricted".
6. `read_electron_logs` for console output.

Caveats: at the configured `SECURITY_LEVEL=balanced`, `eval` executes but
reports only `executed` — it is for actions; read state through
`get_page_structure`, `get_body_text`, or a screenshot. `fill_input` sets
`.value` without an input event, so a React-controlled input ignores it —
`eval` the native setter
(`Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el, text)`)
and dispatch `new Event('input', { bubbles: true })`; likewise dispatch
`KeyboardEvent`s on the element for Enter/arrow handling. `send_keyboard_shortcut`
never reached this app's `window` keydown listener (Escape did nothing); for
app-wide keys, `eval` a
`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`
— verified to un-zoom a pane. The launch/close/build
tools are hidden at that level. The server writes an audit log to `./logs/`
(gitignored). It is launched through `scripts/mcp-electron-debug.mjs`, not
`npx` (gotcha 12). Without the MCP server, the same flag lets you hit
`http://127.0.0.1:9222/json` and drive CDP by hand.

### When the live app can't answer

Electron publishes no `llms.txt`, MCP server, or agent skill, and
`electron/electron`'s own `.claude/skills` are maintainer workflows (Chromium
upgrades, PR triage). For packaging and update semantics the shipped source is
authoritative — `node_modules/electron-updater/out/*.js` and
`node_modules/app-builder-lib/templates/nsis/*.nsh`; Context7
(`/websites/electronjs`, `/electron-userland/electron-builder`) is the fallback
for API questions. Never answer either from memory.

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

Beware *when* the capture timer starts. Here it is registered after the startup
awaits, so by the time it fires the summon animation is long finished and a
short delay still yields a resting frame. To catch a transition, drive a real
hide → show cycle and capture ~90 ms in.

`CLAUDE_WATCH_CAPTURE_VIEW` seeds `tm.sidebar.v3` and `tm.panes.v3`, then
reloads. It takes the sidebar sections `limits` and `agents` and the pane kinds
that open with no config: `terminal` (a plain shell), `spend`, `insights`,
`history`, `notes`, `clipboard` and `keys`. `usage` still means Spend, and
`insights-week` opens Insights on its Week tab. Web, file and chat panes need a
URL, a path or a live CLI, so for those drive the app through the
electron-debug tools above instead.

## Maintaining this skill

The canonical copy is committed at `.claude/skills/electron/`; the invocable
copy is `~/.claude/skills/electron/`. They drift. After editing the repo copy:

```bash
cp -r .claude/skills/electron/. ~/.claude/skills/electron/
```

## Examples

Read the one that matches the task; each pairs the upstream doc example with
what this project does differently and why.

| File | Read when |
| --- | --- |
| `examples/window-shell.md` | Creating/positioning a window, frameless or transparent, show/hide animation, the picker window, backdrop material |
| `examples/ipc-and-preload.md` | Adding an IPC route, exposing preload API, validating renderer input, picker-only routes |
| `examples/multi-view-panes.md` | Splitting a window into panes, embedding web content (`<webview>`), or asked to embed another app |
| `examples/tray-hotkey-lifecycle.md` | Tray icon, global shortcuts, single-instance and `tm` argv, app lifecycle, crash recovery |
| `examples/native-modules.md` | Calling Win32 / any native module, or a `.node` fails to load |
| `examples/packaging-and-update.md` | electron-builder config, asar, auto-update, installing a local build, releasing |

## Verification gates

There is no linter here. Before calling Electron work done:

```bash
npm run typecheck && npm test && npm run build && git diff --check
```

For anything user-visible, add a screenshot via `scripts/capture-window.mjs` —
typecheck passing says nothing about whether the UI renders.
