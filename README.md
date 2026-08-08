# TaylorMade Agent Monitor (Windows)

A hotkey-summoned Electron workspace for local **Claude Code and Codex** work. It groups live roots by project, nests subagents, shows provider health and local usage, launches and switches the windows you drive agents from, and keeps optional daily history. The default toggle is **Ctrl+Alt+W**.

The workspace fills the work area of whichever display the cursor is on and slides up from the taskbar when summoned. It is sticky — it stays open until the hotkey or tray toggles it closed, `Escape` is pressed, or it steps aside for a window it just launched or focused.

A control strip, an agent sidebar, and a pane grid:

- **Top bar** — waiting count, provider connection, collapse all, add pane, projects, settings, hide, and quit.
- **Sidebar (left)** — coding agent details: live Claude and Codex sessions grouped by project, with nested subagents. Always visible, whatever the panes show.
- **Main frame** — up to **six panes**, laid out as three vertical columns that grow to a second row. Each pane's title is its content picker, and each kind appears at most once: **Launch**, **Open windows**, **Limits**, **Spend**, **Insights**, **Agents**. The layout persists across summons.

**Launch** starts a Claude Code, Codex, or plain terminal, Cursor, Chrome, or a new project — in the active project's folder or your home folder, switchable from the chip in the pane header. **Open windows** lists your open terminals, editors, browsers, and Explorer windows; click one to bring it to the front. Windows owned by a tracked session are marked with that provider's badge.

Panes host this app's own content and *switch to* your real windows rather than embedding them: Electron has no supported way to host a foreign native window ([electron/electron#10547](https://github.com/electron/electron/issues/10547) is still open), and reparenting a live HWND breaks input, focus, and DPI in the window being captured.

## Current capabilities

- Provider-neutral live lifecycle model with collision-safe identities (`provider:sessionId[:actorId]`).
- Claude Code, Codex, and Cursor roots grouped together by canonical project path, with provider badges and expandable child rows.
- Six pane kinds — launch, open windows, limits, spend, insights, agents — composed into up to six panes and remembered between summons.
- The limits pane shows limit bars only — Claude and Codex separately — so it stays scannable; token counts and spend live in the spend pane.
- Workspace launchers and a Win32 window switcher for terminals, editors, browsers, and Explorer, launched in the active project's folder or your home folder.
- Per-provider install/reporting/trust health. Codex user hooks require an explicit review in `/hooks`.
- Claude subscription windows, deduplicated local Claude transcript totals, best-effort isolated Codex rollout totals, and actual Anthropic organization API spend.
- Provider/model-specific API-equivalent value. Unknown models retain tokens and mark combined value partial; estimates are not subscription bills.
- Optional MongoDB schema-v2 history with aggregate compatibility fields and `byProvider` breakdowns.
- Native Windows focus, resolving the stored agent ID in main and validating HWND/PID ownership before raising a window.
- Sandbox-enabled renderer, runtime-validated IPC, authenticated loopback ingestion, and a per-install discovery token.

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

`npm run dist` produces two Windows executables in `dist/`: the `*-x64.exe` installer opens the setup wizard, while `*-portable.exe` runs without installation. From a fresh PowerShell window, the newest locally built installer can be launched with:

```powershell
Start-Process (Get-ChildItem .\dist\tm-agent-monitor-*-x64.exe | Sort-Object LastWriteTime -Descending | Select-Object -First 1)
```

Add `/S` to install silently without the wizard.

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

## Scope after provider-neutral monitoring

Broader Claude/Codex configuration management (MCP servers, skills, plugins, safe diff editors) remains a later roadmap. See `docs/CLAUDE-CODE-MANAGEMENT-PLAN.md`; the stable monitoring and hook-management foundation described here is already implemented.
