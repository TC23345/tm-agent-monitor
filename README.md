# TaylorMade Agent Monitor (Windows)

A hotkey-summoned Electron workspace for local **Claude Code, Codex, and Cursor** work. It groups live roots by project, nests subagents, shows provider health and local usage, embeds real terminals, launches and switches the windows you drive agents from, and keeps optional daily history. The default toggle is **Ctrl+Alt+W**; **Alt+Q** summons a half-screen view.

The workspace fills the work area of whichever display the cursor is on — or one half of it, per the View menu — and slides up from the taskbar when summoned. It is sticky: it stays open until the hotkey or tray toggles it closed or `Escape` is pressed. It is deliberately *not* always-on-top, so anything it launches or focuses simply appears in front while the workspace waits behind; the hotkey raises a buried workspace and only dismisses one that is already focused.

An IDE-style title bar, an agent sidebar, and a pane grid:

- **Title bar** — the brand mark and the File / Terminal / View / User menus at the left, the **command center** in the middle, and the waiting count and provider connection at the right. The command center (or **Ctrl+Shift+P**, or Ctrl+P outside a terminal) opens the **command palette**: every command, every live agent (focus its window), and every open window (raise it), fuzzy-searched — `>` narrows to commands, `@` to agents, `#` to windows, `Tab` cycles those.
- **Sidebar (left)** — coding-agent details: live sessions grouped by project with nested subagents, plus toggleable data views. **Open windows** and **Limits** pin above the agent list (Open windows starts rolled up); **Spend** and **Insights** stack below. Each section collapses to its header.
- **Main frame** — up to **six panes**: the **Launch** pane and embedded **Terminal** panes (PowerShell, Claude Code, or Codex, in the active project's folder). Each pane header is an editor title bar: the kind, a folder chip, and that kind's tools — a terminal has split (another shell in the same folder), clear, restart, open external terminal here, and open folder; the launcher has new project and Projects folder — then zoom and close. Panes drag to reorder; the View menu picks the column count. Ctrl+Shift+` opens a new terminal pane; Ctrl+, opens Settings.

**Everything resizes.** Drag the splitter between the sidebar and the grid, or the gutters between columns and rows. Double-click a splitter (or press `Home` on it) to reset it, or View → *Reset pane sizes* to reset everything. Sizes are remembered separately for the full and half workspace. Double-click a pane header (or its zoom button) to fill the grid with that pane; `Escape` restores the grid without disturbing the shells in the other panes.

**Launch** starts a Claude Code, Codex, or plain terminal in a pane (Shift-click for an external window), or Cursor, Chrome, or a new project — in the active project's folder or your home folder, switchable from the chip in the pane header. **Open windows** lists your open terminals, editors, browsers, and Explorer windows; click one to bring it to the front. Windows owned by a tracked session are marked with that provider's badge.

Panes host this app's own content — the embedded terminal is our xterm over our ConPTY — and *switch to* your real windows rather than embedding them: Electron has no supported way to host a foreign native window ([electron/electron#10547](https://github.com/electron/electron/issues/10547) is still open), and reparenting a live HWND breaks input, focus, and DPI in the window being captured.

See [CHANGELOG.md](./CHANGELOG.md) for what each version added.

## Current capabilities

- Provider-neutral live lifecycle model with collision-safe identities (`provider:sessionId[:actorId]`).
- Claude Code, Codex, and Cursor roots grouped together by canonical project path, with provider badges and expandable child rows.
- Embedded ConPTY terminals (`node-pty` + xterm.js) that survive hide/show and pane remounts, killed on quit.
- A resizable, persisted layout: draggable sidebar, column and row splitters, per-view sizes, pane zoom, drag-to-reorder panes and projects.
- A command palette over every app action, live agent, and open window, with prefix filters and keyboard navigation.
- Sidebar data views: limit bars only in **Limits** (Claude and Codex separately) so it stays scannable; token counts and spend in **Spend**; local usage patterns in **Insights**.
- Workspace launchers and a Win32 window switcher for terminals, editors, browsers, and Explorer, launched in the active project's folder or your home folder.
- Per-provider install/reporting/trust health. Codex user hooks require an explicit review in `/hooks`.
- Claude subscription windows, deduplicated local Claude transcript totals, best-effort isolated Codex rollout totals, and actual Anthropic organization API spend.
- Provider/model-specific API-equivalent value. Unknown models retain tokens and mark combined value partial; estimates are not subscription bills.
- Optional MongoDB schema-v2 history with aggregate compatibility fields and `byProvider` breakdowns.
- Native Windows focus, resolving the stored agent ID in main and validating HWND/PID ownership before raising a window.
- Sandbox-enabled renderer, runtime-validated IPC, authenticated loopback ingestion, and a per-install discovery token.
- Auto-update from GitHub Releases, and Settings → **Rebuild & relaunch** to reinstall from the local checkout without cutting a release.

Windows can raise the Codex/ChatGPT desktop window, but public Win32 APIs cannot select a specific task tab.

## Development

```powershell
npm install
npm run dev
npm run typecheck
npm test
npm run build
```

Use `electron . --mock` (or `CLAUDE_WATCH_MOCK=1` in development) for provider-rich sample data. The `--mock` flag has highest precedence so packaged captures cannot silently touch real data.

## Hook setup

The shared bridge reads stdin, normalizes provider events to `AgentEventV1`, and performs one authenticated loopback request. It has no retry loop and caps delivery at 250 ms.

```powershell
npm run hooks:install             # Claude user hooks
npm run hooks:codex               # Codex user hooks
node hooks/install.mjs --all --status
node hooks/install.mjs --all --repair
node hooks/install.mjs --all --remove
```

Installer writes are atomic, preserve unrelated settings, create `*.tm-agent-monitor.bak`, and remove only handlers carrying the exact ownership marker. Claude Code, Codex, and Cursor have separate provider registrations. After installing Codex hooks, use **Settings → Codex hooks → Review trust**. The app copies `/hooks`, opens Codex in a terminal, and keeps the trust warning visible until a real hook event verifies the bridge. Local surfaces that emit hooks are supported; cloud-only tasks are out of scope.

The app publishes `%APPDATA%\taylormade-agent-monitor\hook-endpoint.json` containing `{schemaVersion, port, token}`. This keeps custom ports synchronized without depending on a hook process inheriting Electron environment variables.

## Data sources

| Source | Purpose | Stability |
|---|---|---|
| Claude/Codex/Cursor lifecycle hooks | Authoritative live state | Supported provider surface |
| `~/.claude/projects` JSONL | Claude daily tokens/value | Local transcript data |
| `~/.codex/sessions` rollouts | Codex tokens, context, quota windows | Best effort; parser drift disables only Codex usage |
| Claude OAuth usage endpoint | Personal subscription windows | Best effort local account data |
| Anthropic Admin API | Actual organization token/cost report | Optional admin key |
| MongoDB `token_board.daily_usage` | Optional durable history | Additive schema v2 |

Claude transcript scanning uses per-file/per-message ledgers. It scans retained-day data in bounded chunks, replaces duplicate contributions, rebuilds after truncation/rewrite, removes vanished files, serializes refreshes, and publishes aggregates atomically.

## Configuration

Configuration is bootstrapped before provider services are constructed. Precedence is process environment, installed `userData/.env`, legacy `%APPDATA%\claude-watch\.env`, then project `.env` in development only. Open the canonical config folder from Settings.

| Variable | Default | Purpose |
|---|---|---|
| `CLAUDE_WATCH_HOTKEY` | `Control+Alt+W` | Global toggle |
| `CLAUDE_WATCH_NOTIFICATIONS` | `0` | Attention notifications |
| `CLAUDE_WATCH_PORT` | `7459` | Loopback daemon port |
| `CLAUDE_WATCH_MOCK` | `0` | Development mock mode |
| `ANTHROPIC_ADMIN_KEY` | – | Anthropic Admin API report |
| `CLAUDE_WATCH_ORG_NAME` | `Growth Saloon` | Admin-spend label |
| `CLAUDE_WATCH_DAILY_BUDGET_USD` | – | Optional daily actual-spend budget |
| `CLAUDE_WATCH_PROJECTS_DIR` | `~/.claude/projects` | Claude transcript root |
| `CLAUDE_WATCH_NEW_PROJECT_DIR` | `~/Projects` | New-project folder |
| `MONGODB_URI` | – | Optional history sync (`CLAUDE_WATCH_MONGODB_URI` also works) |
| `TM_AGENT_MONITOR_ENDPOINT_FILE` | app-data path above | Bridge discovery override |

## Architecture

```text
Claude/Codex/Cursor hooks -> hooks/bridge.mjs -> authenticated POST /v1/events
                                             |
Claude transcript ledger --------------------+--> provider-neutral AgentStore
Codex rollout parser ------------------------+--> UsageAccount[] / DailyUsageDay
OAuth + Anthropic Admin APIs ----------------+--> Electron IPC -> React renderer
                                                          |
                                              optional MongoDB schema v2
```

The compatibility `POST /report` route remains for bounded Claude legacy payloads, but it is authenticated and schema-validated. `/health` and `/status` diagnostics also require the bearer token. All routes are exact-match and JSON ingestion rejects wrong content types, oversized bodies, future/non-finite timestamps, excessive strings, invalid enums, and cardinality overflow.

## Build and package

```powershell
npm run dist:dir
npm run dist
```

Every distribution/publish command regenerates `build/icon.ico` offline from tracked `resources/icon.png`. A clean checkout does not depend on ignored local icon assets or a network font. Packaged resources include the shared bridge/installer and native focus module. Builds are unsigned.

`npm run dist` produces two Windows executables in `dist/`: the `*-x64.exe` installer opens the setup wizard, while `*-portable.exe` runs without installation. Pass `--publish never` for a purely local build (`npm run dist -- --publish never`) — the config declares a GitHub publisher.

### Installing a local build over the installed app

Quit the running app (tray → Quit, or File → Quit), then hand the installer the same arguments `electron-updater` uses for `quitAndInstall({ isSilent: true, isForceRunAfter: true })`:

```powershell
Start-Process .\dist\tm-agent-monitor-0.3.1-x64.exe -ArgumentList '--updated', '/S', '--force-run'
```

`--updated` marks an in-place update (the assisted installer skips its pages and passes `--updated` to the relaunched app), `/S` is NSIS silent mode, and `--force-run` makes the silent install start the app afterwards, as your user, so nothing needs to know the install directory. `scripts\reinstall-local.ps1` wraps this (add `-SkipBuild` to install what `dist\` already holds), and Settings → **Rebuild & relaunch** does the whole thing from inside the app.

Before trusting a local build, verify it the way a release is verified — a green build is not a working app:

```powershell
node .claude\skills\electron\scripts\verify-asar-deps.mjs dist\win-unpacked   # every production dep is in the asar
node scripts\debug-app.mjs --packaged                                         # it boots, driveable over CDP
```

### Publishing a release

Auto-update reads `latest.yml` from GitHub Releases, so the repo must stay public.

```powershell
$env:GH_TOKEN = gh auth token
git tag --no-sign v0.0.0; git push origin v0.0.0   # tags here are lightweight
npm run publish
```

The tag **and** the release must exist before publishing. electron-builder starts one publisher per artifact and they race to create the release; the loser gets `422`, and that abort skips the `latest.yml` upload — producing a release with installers but no update feed, which clients see as a 404. If that happens, simply run `npm run publish` again against the now-existing release: it uploads all four assets and overwrites the binaries so the feed and the exe stay consistent.

Verify against GitHub rather than the exit code (a pipe masks npm's status):

```powershell
gh release view v0.0.0 --json assets    # expect latest.yml, both .exe, and .blockmap
```

`latest.yml`'s `size:` must equal the hosted `*-x64.exe` asset size, or the updater downloads the installer and fails its sha512 check.

```powershell
npm run typecheck
npm test
npm run build
npm run dist:dir
npm audit
git status --short
```

## Agent tooling

Electron publishes no official MCP server, agent skill, or `llms.txt` (the `.claude/skills` in `electron/electron` are for Chromium-upgrade and PR-triage maintainers). What this repo uses instead:

- **Driving the live app (use this first)** — [`.mcp.json`](./.mcp.json) registers [`electron-mcp-server`](https://github.com/halilural/electron-mcp-server) (MIT), which attaches over the Chrome DevTools Protocol to take screenshots, click, type, evaluate JS, and read console/network logs. It is launched through `scripts/mcp-electron-debug.mjs` rather than `npx` because the package's entry has no shebang — on a machine whose npm `script-shell` is Git Bash the bin shim sources the bundle and dies on line 1; the wrapper runs the package's main under node directly (devDependency first, else the npx cache). It needs an app started with `--remote-debugging-port`: `npm run debug:app` launches the built app that way with mock data, a throwaway user-data dir (the single-instance lock would otherwise exit it), and daemon port 7460 so the installed app's hooks are untouched. `--real` uses your live hooks; `--packaged` runs `dist\win-unpacked`. Give `take_screenshot` a *relative* `outputPath` (or none, for an inline image) — its validator rejects absolute Windows paths — and read page state with `get_page_structure` / `get_body_text`, since `eval` at the configured security level performs actions but returns only `executed`.
- **Docs, when the live app can't answer** — the shipped source is authoritative for packaging and updates: `node_modules/electron-updater/out/*.js` and `node_modules/app-builder-lib/templates/nsis/*.nsh`; Context7 mirrors (`/websites/electronjs`, `/electron-userland/electron-builder`) are the fallback for API questions.
- **Repo skills** — `.claude/skills/electron` (process model, packaging, auto-update, the failures this project hit) and `.claude/skills/workspace-layout` (window sizing, layering, persisted layout). Copy them to `~/.claude/skills/` to invoke them.

## Scope after provider-neutral monitoring

Broader Claude/Codex configuration management (MCP servers, skills, plugins, safe diff editors) remains a later roadmap. See `docs/CLAUDE-CODE-MANAGEMENT-PLAN.md`; the stable monitoring and hook-management foundation described here is already implemented.
