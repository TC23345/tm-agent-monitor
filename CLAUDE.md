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
- `src/renderer` groups roots by canonical cwd, nests children, renders provider badges/health/usage, and labels trends against real local calendar dates. Layout is the agent sidebar (agent list plus toggleable stacked data views) and a main pane grid of launcher + embedded terminals; `Escape` closes an open menu or dialog, otherwise hides the workspace — unless focus is inside a terminal pane, where Escape belongs to the CLI.
- `src/main/terminals.ts` owns embedded terminal sessions: real ConPTY shells via `node-pty` (native, prebuilds, `asarUnpack`'d), bounded scrollback for reattach, killed on quit. The renderer side is `TerminalPane.tsx` (xterm.js); `term:*` IPC routes are validated like everything else. Sessions survive hide/show and pane remounts, never an app restart.
- `src/renderer/src/panes.ts` owns the layout contract: main-frame panes are instances (`{id, kind}`, `MAX_PANES = 6`) — `launcher` unique, `terminal` repeatable with per-pane launch config — plus the `SidebarView` catalog (limits, spend, windows, insights) stacked under the agent list and toggled from the sidebar menu. Both persist to localStorage. Uniqueness (and the sidebar toggle) is what keeps `windows:list` from being polled twice.
- `src/renderer/src/TopBar.tsx` is the app chrome: a standard File / Terminal / View / User menu strip under the logo owns every app action; the top right holds passive status only (waiting count, connection health). The sidebar and panes stay pure content — do not reintroduce a footer action strip or a top-right button cluster. Shared dropdown pieces (gliding-highlight `MenuPop`, `MenuItem`, `MenuCheckItem`) live in `Menu.tsx`.
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

## Invariants and gotchas

- Pure ESM. `electron-updater` is CommonJS: import its default and destructure.
- Unknown models have no value estimate. Never fall back across providers.
- Actual Anthropic organization spend stays separate from estimated agent value.
- `Stop` completes a turn; only `SessionEnd` removes a root. `SubagentStop` affects only its identified child.
- Provider hooks are the live authority. Private SQLite, experimental App Server, and OTel are not v1 dependencies.
- The renderer is sandboxed. Expose the smallest preload API and runtime-validate mutable IPC.
- `koffi` and `node-pty` remain `asarUnpack`'d. Packaged hook resources and native focus resources must stay in `electron-builder.yml`.
- Icon generation is offline and deterministic: `scripts/build-icon.mjs` derives ignored `build/icon.ico` from tracked `resources/icon.png`. Distribution commands run it automatically.
- The window fills the work area of the cursor's display (`positionWorkspace`) — full screen minus the taskbar. Bounds never track content: there is deliberately no content-size IPC, no `setContentSize` call, and no renderer `ResizeObserver`. The `.app` card fills the window and each scroll region (`.pane-scroll`, `.gpane-body`) absorbs its own overflow. Do not reintroduce content-driven window sizing.
- Show/hide is animated in the renderer, not by moving the window. Main shows first and sends `window:phase` `enter`; on hide it sends `exit` and hides after `EXIT_MS` via a timeout that fires even if the renderer never responds. The `.app` card transitions a `translateY` — an animated `setBounds` loop is not smooth on Windows and must not replace it.
- Actions that surface another window (`agent:focus`, `windows:focus`, terminal/Cursor/Chrome/Explorer launches) call `stepAside()` — a full-screen always-on-top workspace would otherwise cover what it just opened.
- Releasing requires the tag **and** the GitHub release to exist before `npm run publish`. electron-builder starts one publisher per artifact; they race to create the release, the loser returns 422, and that abort skips the `latest.yml` upload — leaving installers with no update feed. Re-running publish against an existing release uploads all four assets and overwrites the binaries so feed and exe stay consistent. Verify with `gh release view <tag> --json assets`; never trust the exit code through a pipe.
- Tags in this repo are lightweight. `tag.gpgsign=true` makes even a bare `git tag` fail on a passphrase-protected key, so use `git tag --no-sign`.
- MongoDB absence/failure must never block live monitoring. Quit performs a bounded awaited final flush.
- Verification commands may create ignored output, but must not modify tracked files.
