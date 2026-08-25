# CLAUDE.md

Repository guidance for every coding agent.

## What this is

TaylorMade Agent Monitor is a Windows-only Electron + TypeScript + React tray app for local Claude Code and Codex activity, presented as a hotkey-summoned full-screen multi-pane workspace. It uses stable lifecycle hooks for live state, provider-qualified identities, provider-specific usage/value, optional MongoDB history, and native Win32 launch/focus for the terminals, editors, and browsers you drive agents from.

## Commands

```powershell
npm run dev
$env:CLAUDE_WATCH_MOCK=1; npm run dev
npm run typecheck
npm test
npm run build
npm run dist:dir
npm run dist
npm run publish
npm run hooks:install
npm run hooks:codex
npm run icons
```

`npm test` discovers every `*.test.mjs`; do not restore a hard-coded list. There is no linter, so typecheck, tests, build, and `git diff --check` are the normal gates.

## Architecture

```text
Claude/Codex/Cursor hooks -> hooks/bridge.mjs -> authenticated /v1/events -> AgentStore
Claude JSONL ledgers ---------------------------------------------> UsageAccount[]
Codex rollout parser (best effort, isolated) --------------------> UsageAccount[]
OAuth/Admin APIs ------------------------------------------------> UsageAccount[]
AgentStore + usage + history -> StatusSnapshot -> preload IPC -> React
```

- `src/shared/types.ts` owns provider-neutral contracts: `ProviderId`, `AgentEventV1`, provider-qualified `Agent`, `ProviderHealth`, `UsageAccount[]`, schema-v2 `DailyUsageDay`, and the mutable-only `AppSettingsPatch`.
- `src/main/store.ts` is the reducer. It deduplicates event IDs, rejects older actor events, keeps child identities separate, persists idle transitions, and prices each message with its original model.
- `src/main/daemon.ts` exposes exact authenticated loopback routes. Every route, payload, timestamp, enum, number, string, and cardinality is runtime validated.
- `hooks/bridge.mjs` is the shared short-lived Claude/Codex/Cursor bridge. It discovers port/token from the app-data endpoint file and performs one bounded request. It must never retry or fail the provider command. Cursor imports compatible Claude hooks, so Cursor-originated Claude compatibility invocations must be ignored to avoid duplicate sessions.
- `hooks/install.mjs` atomically merges/removes exactly-owned user hooks with backups. Claude and Codex use nested hook groups; Cursor uses direct version-1 handlers. Codex still requires the user to review trust in `/hooks`.
- `src/main/localUsageCore.mjs` keeps per-file/per-message Claude ledgers and performs serialized bounded full scans.
- `src/main/codexUsage.mjs` is the only place allowed to understand unstable Codex rollout JSONL. Drift disables only Codex usage, never live hooks.
- `src/main/usageCore.mjs` parses Anthropic Admin usage/cost pagination, including decimal-string cents and UTC buckets.
- `src/main/history.ts` serializes Mongo operations, writes schema v2 `byProvider`, reads legacy documents as Claude, attributes API spend to its exact UTC date, and is optional/failure-isolated.
- `src/native/win32.mjs` loads system DLLs through koffi. Main resolves focus by agent ID and passes the stored PID so HWND ownership is checked before foreground calls.
- `src/renderer` groups roots by canonical cwd, nests children, renders provider badges/health/usage, and labels trends against real local calendar dates. Layout is the agent sidebar (agent list plus toggleable stacked data views) and a main pane grid of launcher + embedded terminals; `Escape` closes an open menu, the palette, or a dialog, then un-zooms a zoomed pane, otherwise hides the workspace — unless focus is inside a terminal pane, where Escape belongs to the CLI. Zoom (pane header button or double-click) hides the other panes with `display: none` rather than unmounting them, so a running shell is never disturbed.
- `src/main/terminals.ts` owns embedded terminal sessions: real ConPTY shells via `node-pty` (native, prebuilds, `asarUnpack`'d), bounded scrollback for reattach, killed on quit. The renderer side is `TerminalPane.tsx` (xterm.js); `term:*` IPC routes are validated like everything else. Sessions survive hide/show and pane remounts, never an app restart.
- `src/renderer/src/panes.ts` owns the layout contract: main-frame panes are instances (`{id, kind}`, `MAX_PANES = 6`) — `launcher` unique, `terminal` repeatable with per-pane launch config — plus the `SidebarView` catalog (windows, limits, spend, insights) toggled from the sidebar menu — `SIDEBAR_TOP` (Open windows, then Limits) pins above the agent list, the rest stack below, and each section rolls up to its header (Open windows starts collapsed, so it costs one header row). Views, collapse state, panes, and the `tm.layout.v1` sizes all persist to localStorage; `tm.layout.v1` is read and written through one merge helper so a new size never drops an old one. Sizes (sidebar width, column fractions, row fractions) are stored per view bucket — `{sizes: {full, half}}` — because a split tuned for the full screen is wrong at half the width. Uniqueness (and the sidebar toggle/collapse) is what keeps `windows:list` from being polled twice or while rolled up.
- `src/shared/layout.mjs` owns the resize arithmetic — sidebar clamping (`clampSidebarWidth`, `defaultSidebarWidth`), track fractions (`normalizeFractions`, `resizeFractions` with a per-axis minimum, `columnTemplate`), and `viewportBucket` — as pure functions with tests, so nothing about a legal drag is decided in a component. `Splitter.tsx` is the handle: it reports pixels moved since pointer-down along its axis (pointer capture, arrow keys, double-click reset) and owns no geometry. Column and row splitters live in real gutter tracks, which is why pane slots are placed explicitly (`gridColumn`/`gridRow`) instead of auto-flowing, and why both grid gaps are 0 — the gutter *is* the gap. Drag start measures the used `grid-template-columns`/`-rows` rather than assuming padding and gap. `viewportBucket` reads the live viewport, never the persisted `sizeMode`, so the transient Alt+Q half view loads half-view sizes instead of overwriting full-view ones.
- `src/renderer/src/TopBar.tsx` is the app chrome as one IDE-style title bar: the brand mark (`assets/icon.png`, the tray icon) and the File / Terminal / View / User menus at the left, the command center in the middle, passive status (waiting count, connection health) at the right. Every app action lives in the menus *and* the palette; the sidebar and panes stay pure content — do not reintroduce a wordmark row, a footer action strip, or a top-right button cluster. Shared dropdown pieces (gliding-highlight `MenuPop`, `MenuItem`, `MenuCheckItem`) live in `Menu.tsx`.
- `src/renderer/src/CommandPalette.tsx` is the quick-open: every command (mirroring the menus, built in `App.paletteItems`), every root agent (focus), and every open window (raise), ranked by `src/shared/palette.mjs` (`fuzzyScore`, `rankItems`, `>`/`@`/`#` prefixes — pure, tested). Ctrl+Shift+P always opens it; Ctrl+P too, unless a terminal pane has focus, where Ctrl+P belongs to the shell. The window keydown listener runs in the **capture** phase so app chords win before xterm swallows them; only Ctrl+Shift chords (palette, Ctrl+Shift+` new terminal) reach past a focused terminal. Escape order: context menu → menu → palette → dialog → un-zoom → hide.
- `src/renderer/src/Pane.tsx` is an editor-title bar, not a content picker: kind icon + fixed title, a context chip (launcher folder / terminal launch·folder), then a per-kind tool strip (`tools`) before zoom and close. A pane's kind is fixed for its life — swapping a terminal into a launcher would kill its shell, so a different kind is a new pane. Terminal tools come through `TerminalPaneHandle` (`clear`, `restart`, `focus`) via `forwardRef`; split adds a sibling terminal in the same folder.
- `src/renderer/src/WorkspacePanes.tsx` holds the launch pane and the open-windows switcher. Terminal launches open embedded panes (Shift-click for an external window, and a full grid degrades to external). `useDesktopWindows` polls `windows:list` only while the document is visible, so a dismissed workspace stops enumerating.
- Panes render this app's own content — the embedded terminal is our xterm over our PTY, not a captured window. Electron cannot host a foreign native window (electron/electron#10547 is open with no API), and reparenting a live HWND via `SetParent` breaks input/focus/DPI in the captured window — so the switcher raises real windows instead (Cursor stays launch-and-focus). `WebContentsView` (Electron 30+) is the supported route if a pane ever needs embedded *web* content.
- `src/shared/windows.mjs` is the pure classification layer: which executables the switcher shows, their display names, title cleanup, and grouping. `src/native/win32.mjs` only reads Win32 and stays dumb about presentation.
- `src/renderer/src/usageShared.tsx` owns provider grouping for usage: fixed provider order, accounts sorted plan → local → API spend, and the shared quota bar. `UsageDashboard` renders limit bars only; `SpendView` owns token counts, per-project breakdowns, and budget/actual spend.

## Configuration

`src/main/configCore.mjs` is the only bootstrap. It must run before constructing usage, history, daemon, or provider services. Precedence:

1. process environment;
2. Electron `userData/.env` (canonical installed config);
3. legacy `%APPDATA%/claude-watch/.env`;
4. project `.env` in development only.

`--mock` has highest precedence. Do not add module-scope environment reads back into provider services.

The daemon publishes `%APPDATA%/taylormade-agent-monitor/hook-endpoint.json` by default. Custom ports belong there; hook processes must not depend on inherited environment state.

Settings → "Rebuild & relaunch" (`app:reinstall`) is the dev loop without a release: it runs `npm run dist` in the local checkout (`CLAUDE_WATCH_REPO`, default `~/Projects/claude-watch`), then a detached PowerShell waits for the app to exit and runs the built NSIS installer with `--updated /S --force-run` — the exact arguments `electron-updater`'s `NsisUpdater` passes on `quitAndInstall({ isSilent: true, isForceRunAfter: true })`, so the silent install relaunches the app itself, as the user, without anyone knowing the install directory. `scripts/reinstall-local.ps1` is the same flow from a terminal. Packaged builds only; the auto-update feed stays the release path. Do not reintroduce a hard-coded install path or a manual `Start-Process` of the exe.

## Agent tooling

- **Use the `electron-debug` MCP tools first** (`get_electron_window_info`, `take_screenshot`, `send_command_to_electron`, `read_electron_logs`) for anything about the running app — verifying a change, checking what rendered, clicking through a flow, reading console output. Start the target with `npm run debug:app`, confirm with `get_electron_window_info`, then drive it: `get_page_structure` to see what is clickable, `click_by_text` / `click_by_selector` / `fill_input` / `send_keyboard_shortcut` to act, `take_screenshot` to see the result. At the configured `SECURITY_LEVEL=balanced`, `eval` runs code but reports only `executed` — use it for actions, and read state through `get_page_structure`, `get_body_text`, or a screenshot. `fill_input` sets the DOM value without an input event, so React-controlled inputs (the palette) ignore it — `eval` the native value setter (`Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, text)`) then dispatch `new Event('input', { bubbles: true })`. Give `take_screenshot` a relative `outputPath` or none (absolute Windows paths are rejected). `send_keyboard_shortcut` does not reach window-level listeners (Escape did nothing) — for app-wide keys use `eval` with `window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`, which does.
- Electron ships no official MCP server, agent skill, or `llms.txt`; `electron/electron`'s `.claude/skills` are maintainer workflows (Chromium/Node upgrades, PR triage), not app guidance. Do not answer packaging or updater questions from memory: the shipped source is authoritative — `node_modules/electron-updater/out/NsisUpdater.js` and `node_modules/app-builder-lib/templates/nsis/*.nsh` are where the reinstall flags above came from.
- `.mcp.json` registers that server (`electron-mcp-server`, CDP-based) via `scripts/mcp-electron-debug.mjs`, not `npx`: the package's entry has no shebang, and with npm's `script-shell` set to Git Bash here the bin shim sources the webpack bundle and dies on line 1 — the wrapper requires the package's main under node (devDependency first, else the npx cache through `npm exec`). It attaches to an app started with `--remote-debugging-port`; `npm run debug:app` launches the built app that way (mock data, throwaway `--user-data-dir` because the single-instance lock is app-scoped, daemon port 7460). Prefer it over hand-rolled `webContents.sendInputEvent` probes for verifying interaction.
- Repo skills live in `.claude/skills/` (`electron`, `workspace-layout`); the invocable copies are `~/.claude/skills/`. After editing a repo copy, `cp -r .claude/skills/<name>/. ~/.claude/skills/<name>/`.

## Invariants and gotchas

- Pure ESM. `electron-updater` is CommonJS: import its default and destructure.
- Unknown models have no value estimate. Never fall back across providers.
- Actual Anthropic organization spend stays separate from estimated agent value.
- `Stop` completes a turn; only `SessionEnd` removes a root. `SubagentStop` affects only its identified child.
- Provider hooks are the live authority. Private SQLite, experimental App Server, and OTel are not v1 dependencies.
- The renderer is sandboxed. Expose the smallest preload API and runtime-validate mutable IPC.
- `koffi` and `node-pty` remain `asarUnpack`'d. Packaged hook resources and native focus resources must stay in `electron-builder.yml`.
- Icon generation is offline and deterministic: `scripts/build-icon.mjs` derives ignored `build/icon.ico` from tracked `resources/icon.png`. Distribution commands run it automatically.
- The window covers the work area of the cursor's display (`positionWorkspace`) — full, or one half of it at full height per the persisted `sizeMode` setting ('full' | 'left' | 'right'), which is also the side the transient Alt+Q half view uses. Bounds never track content: there is deliberately no content-size IPC, no `setContentSize` call, and no renderer `ResizeObserver`. The `.app` card fills the window and each scroll region (`.pane-scroll`, `.gpane-body`) absorbs its own overflow; the grid's column count is capped in `colCap()` (App.tsx) and the sidebar width in `clampSidebarWidth` (`@shared/layout.mjs`), never by media queries, so an explicit choice (View-menu columns, a dragged width) composes with the viewport instead of being silently overridden. Do not reintroduce content-driven window sizing, and keep the single `resize` listener the only measurement — it fires on real bounds changes only.
- Show/hide is animated in the renderer, not by moving the window. Main shows first and sends `window:phase` `enter`; on hide it sends `exit` and hides after `EXIT_MS` via a timeout that fires even if the renderer never responds. The `.app` card transitions a `translateY` — an animated `setBounds` loop is not smooth on Windows and must not replace it.
- The workspace is deliberately not always-on-top: anything it launches or focuses (`agent:focus`, `windows:focus`, terminal/Cursor/Chrome/Explorer) simply appears in front while the workspace waits behind — no route hides it. The hotkey raises a visible-but-buried workspace and only dismisses one that is already focused. Do not reintroduce `alwaysOnTop` or launch-time hiding (`stepAside`).
- Releasing requires the tag **and** the GitHub release to exist before `npm run publish`. electron-builder starts one publisher per artifact; they race to create the release, the loser returns 422, and that abort skips the `latest.yml` upload — leaving installers with no update feed. Re-running publish against an existing release uploads all four assets and overwrites the binaries so feed and exe stay consistent. Verify with `gh release view <tag> --json assets`; never trust the exit code through a pipe.
- Tags in this repo are lightweight. `tag.gpgsign=true` makes even a bare `git tag` fail on a passphrase-protected key, so use `git tag --no-sign`.
- MongoDB absence/failure must never block live monitoring. Quit performs a bounded awaited final flush.
- Verification commands may create ignored output, but must not modify tracked files.
