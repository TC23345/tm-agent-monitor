# TaylorMade Agent Monitor (Windows)

A hotkey-summoned Electron panel for local **Claude Code and Codex** work. It groups live roots by project, nests subagents, shows provider health and local usage, and keeps optional daily history. The default toggle is **Ctrl+Alt+W**.

## Current capabilities

- Provider-neutral live lifecycle model with collision-safe identities (`provider:sessionId[:actorId]`).
- Claude and Codex roots grouped together by canonical project path, with provider badges and expandable child rows.
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

Installer writes are atomic, preserve unrelated settings, create `*.tm-agent-monitor.bak`, and remove only handlers carrying the exact ownership marker. After installing Codex hooks, use **Settings → Codex hooks → Review trust**. The app copies `/hooks`, opens Codex in a terminal, and keeps the trust warning visible until a real hook event verifies the bridge. Local Codex desktop, CLI, and IDE surfaces that emit hooks are supported; cloud-only tasks are out of scope.

The app publishes `%APPDATA%\taylormade-agent-monitor\hook-endpoint.json` containing `{schemaVersion, port, token}`. This keeps custom ports synchronized without depending on a hook process inheriting Electron environment variables.

## Data sources

| Source | Purpose | Stability |
|---|---|---|
| Claude/Codex lifecycle hooks | Authoritative live state | Supported provider surface |
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
Claude/Codex hooks -> hooks/bridge.mjs -> authenticated POST /v1/events
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
