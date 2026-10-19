# TaylorMade Agent Monitor (Windows)

A hotkey-summoned Electron workspace for local **Claude Code, Codex, and Cursor** work. It shows every live session grouped by project, with subagents nested under them, along with provider health, usage limits, spend and history. It hosts real terminals and chat panes for the CLIs, keeps a searchable history of everything you copy, and gives agents a local API to see and drive the workspace. **Ctrl+Alt+W** summons it; **Alt+Q** summons a half-screen view.

The workspace fills the work area of whichever display the cursor is on, or one half of it (status bar → *Layout*, or pull a side edge in or out), and slides up from the taskbar when summoned. It stays open until the hotkey, the tray, the close button or `Escape` hides it. It is deliberately *not* always-on-top. Anything it launches or focuses appears in front while the workspace waits behind, and the hotkey raises a buried workspace and only dismisses one that is already focused. While visible it has a taskbar button that carries the waiting count.

See [CHANGELOG.md](./CHANGELOG.md) for what each version added, and [CLAUDE.md](./CLAUDE.md) for the architecture in detail.

## The workspace

- **Title bar.** The brand mark and the **File / Terminal / User** menus are at the left, the **command center** is in the middle, and the waiting count and provider connection sit at the right. Menus hold verbs. Workspace state lives in the status bar.
- **Sidebar.** The **Activity** head shows a badge for every project you worked in over the last four hours. A red dot means a session there is waiting on you; a blue dot means one is working. Below the badges is a stream of what sessions asked, finished, started, ended and edited. Left-click a badge to make it the launch target and swap the stream for that project's **file tree**. Right-click a badge for its menu: *New Claude Code chat*, *New Codex chat*, *New terminal*, and web links (the File menu starts with the same three). Under the Activity head sit **Limits** (quota bars per provider) and **Agents** (live sessions by project, with subagents nested). Every section folds and resizes by its handle. Ctrl+B (Alt+S inside a terminal) hides the sidebar.
- **Pane grid.** Up to **six panes**, which you can drag to reorder, resize by their gutters, and zoom with a double-click on the header. Each header shows the pane's kind, its live folder (click to copy) and a few tools.
- **Status bar.** The **Update** chip rebuilds this checkout and reinstalls it. The **Panes** popover chooses which panes and sidebar sections show. The **Layout** popover holds the workspace size, column count, saved layouts and *Reset sizes*. At the right are a `CDP :port` chip when remote debugging is on, and the version.

### Panes

| Pane | What it is |
| --- | --- |
| **Terminal** | A real ConPTY shell (`node-pty` + xterm.js) in a folder. Type `claude` or `codex` in it and the pane becomes a *Claude Code terminal* / *Codex terminal*. It survives hide/show, and after a restart it comes back in the folder its shell was in, resuming the exact session it ran. Copy on select, Ctrl+C copies a selection, Ctrl+V pastes text or forwards an image to the CLI. |
| **Claude Code chat / Codex chat** | The CLI as a conversation, the way the Claude Code extension draws it. Every step of a reply is a dot on a timeline, commands open as IN / OUT, edits show as diffs, and approvals and questions are answered inline. The composer carries the model and effort, the permission mode, slash commands, a context pie and pasted images. It runs your installed CLI through the Claude Agent SDK or `codex app-server`, and history is the providers' own (*Sessions*). |
| **File** | A project file opened from a badge's tree: text in an editor that saves on Ctrl+S, Markdown rendered, and images inline. |
| **Notes** | A shared notepad over `%USERPROFILE%\Notes`: a file tree with template folders (Daily, Meetings, Plans, Prompts), drag and drop, and autosave. Agents read and write the same files. |
| **Clipboard** | Everything you copy, in any app, encrypted at rest. Search it, star it, sort it into groups, see which app or page it came from, and paste it into a terminal pane. |
| **Web** | A site in a pane, on one persistent signed-in browser session shared by every web pane. |
| **Agents** | The live session list as a pane instead of the sidebar section. |
| **Spend / Insights / History** | Today's tokens, estimated value and API spend. What drives local usage (context size, subagents, skills, MCP). And history: 1D · 3D · 7D · 30D · ALL, with a running total against the period before, projects, models and a calendar. |
| **Keys** | Every keyboard shortcut: the workspace's, the global chords, and the ones Claude Code, Codex and the shell already own. *Check a key* tells you who owns a chord. |

### Keys

| Key | Does |
| --- | --- |
| **Ctrl+Alt+W** / **Alt+Q** | Summon the workspace / the half view (global; rebind in Settings → Keyboard shortcuts) |
| **Ctrl+Alt+V** | The clipboard picker at the cursor (global); Enter pastes the clip back into the window you were in |
| **Alt+Shift+1–3** | Paste favorite 1–3 (global) |
| **Ctrl+K** (inside a terminal too; Alt+K anywhere) | Command palette: every command, live agent and open window. `>` lists commands, `@` agents, `#` windows, `!` clips |
| **Ctrl+Tab**, **Ctrl+1–6** | Next pane, a pane by number |
| **Alt+J** | Jump to the next session that is waiting on you (its pane, else its window) |
| **Alt+Z** | Zoom the focused pane / restore |
| **Ctrl+Shift+`** | New terminal in the launch target |
| **F1** | The Keys pane |
| **Escape** | Close a menu or dialog, un-zoom, else hide (a terminal keeps its own Escape) |

Inside a terminal, the keys Claude Code, Codex and the shell use stay theirs. The workspace's keys there are the Alt layer, Ctrl+Tab and Ctrl+1–6, and a test fails if one collides.

### Attention

A session waiting on you puts a red badge on the tray icon, an overlay on the taskbar button (with one flash, unless muted or focused), a bell on its pane and a waiting chip in the title bar. Click the chip for the next waiting session. Right-click a waiting session that runs in a pane to reply to it from the sidebar. Settings → *Phone push* forwards a long wait to an ntfy or Pushover URL. The connection chip says when each provider last reported, and flags hooks that need repair.

### Clipboard and Chrome

Every copy is captured as it happens, deduplicated, and sealed with Windows' `safeStorage`. Password managers, excluded formats, blocklisted apps and sites, and likely secrets are skipped. **Ctrl+Alt+V** opens the picker at the cursor, with search, chips for favorites, images, groups and sources, a gear for settings, and resizable columns. A clip can carry a note, a text-expansion code (`;sig`) and its own global keybind. The unpacked extension in `extension/` adds Chrome's side: the page a copy came from, *Paste from clipboard ▸* in the right-click menu, *Save to favorites*, and text expansion in page fields. It talks to the app over native messaging, never the network (`node hooks/install.mjs --host`).

## Automation

The daemon that receives hook events also serves agents, on loopback with the per-install bearer token from the endpoint file. `npm run tm -- <command>` wraps it:

```text
tm status [--json]                     sessions, what is waiting, usage  (GET /v1/status)
tm terminals                           embedded terminals and their sessions
tm new [--cwd <folder>] [--launch shell|claude|codex] [--run "<command>"]
tm send <terminal-id> <text…> [--no-enter]
tm read <terminal-id> [--lines <n>]
tm wait <agent-id> [--until waiting|complete|idle|running|ended] [--timeout <s>]
tm clip list|show|copy|add|paste       the clipboard history
tm show | hide | palette | usage | activity | notes | layout <name> | open …
tm skill [--install]                   the agent skill, into ~/.claude/skills
```

Every embedded terminal carries `TM_AGENT_MONITOR_ENDPOINT_FILE` and `TM_TERMINAL_ID`, so a CLI in a pane can find the daemon and its own pane. The skill (`hooks/SKILL.md`) teaches a session the routes and the etiquette: check status before starting a second session in a project, and wait instead of polling.

## Current capabilities

- Provider-neutral live lifecycle model with collision-safe identities (`provider:sessionId[:actorId]`), fed by Claude Code, Codex and Cursor hooks.
- Sessions grouped by canonical project path, with provider badges, nested subagents, git branch and dirty count.
- Embedded terminals and chat panes over the user's own CLIs, resumed by exact session after a restart.
- Claude subscription windows, deduplicated local Claude transcript totals, best-effort isolated Codex rollout totals, and actual Anthropic organization API spend. Provider- and model-specific API-equivalent value; unknown models keep their tokens and mark the value partial; estimates are not bills.
- Hourly usage for the live days, and optional MongoDB schema-v2 history with `byProvider` breakdowns.
- Clipboard history with a picker, paste-back, favorites, groups, keybinds, text expansion and a Chrome extension.
- A file tree per project, File panes, a shared Notes folder and web panes.
- Native Windows focus that resolves the stored agent ID in main and validates HWND/PID ownership before raising a window. A palette over every open window.
- Sandboxed renderer, runtime-validated IPC, authenticated loopback ingestion, and a per-install discovery token.
- Auto-update from GitHub Releases, plus the **Update** chip, which rebuilds from the local checkout, quits, silently reinstalls and relaunches without a release.

Windows can raise the Codex/ChatGPT desktop window, but public Win32 APIs cannot select a specific task tab. Panes host this app's own content and *switch to* your real windows rather than embedding them. Electron has no supported way to host a foreign native window ([electron/electron#10547](https://github.com/electron/electron/issues/10547) is still open), and reparenting a live HWND breaks input, focus and DPI in the captured window.

## Development

```powershell
npm install
npm run dev
npm run typecheck
npm test
npm run build
```

Use `electron . --mock` (or `CLAUDE_WATCH_MOCK=1` in development) for provider-rich sample data. The `--mock` flag has the highest precedence, so packaged captures cannot silently touch real data. There is no linter: typecheck, tests, build and `git diff --check` are the gates.

The chat panes are vendored. `src/chat/` is copied from the `chat-panes` package by `npm run chat:sync`; change the package and re-sync, never `src/chat/` directly.

## Hook setup

The shared bridge reads stdin, normalizes provider events to `AgentEventV1`, and performs one authenticated loopback request. It has no retry loop and caps delivery at 250 ms.

```powershell
npm run hooks:install             # Claude user hooks
npm run hooks:codex               # Codex user hooks
npm run hooks:cursor              # Cursor user hooks
node hooks/install.mjs --all --status
node hooks/install.mjs --all --repair
node hooks/install.mjs --all --remove
node hooks/install.mjs --host     # the Chrome/Edge native-messaging host (--status, --repair, --remove)
```

Installer writes are atomic, preserve unrelated settings, create `*.tm-agent-monitor.bak`, and remove only handlers carrying the exact ownership marker. Claude Code, Codex and Cursor have separate provider registrations. After installing Codex hooks, use **Settings → Codex hooks → Review trust**: the app copies `/hooks`, opens Codex in a terminal, and keeps the trust warning visible until a real hook event verifies the bridge. The Agents pane's empty state offers *Install* or *Repair* per provider too. Local surfaces that emit hooks are supported; cloud-only tasks are out of scope.

The app publishes `%APPDATA%\taylormade-agent-monitor\hook-endpoint.json` containing `{schemaVersion, port, token}`. This keeps custom ports synchronized without depending on a hook process inheriting Electron environment variables.

## Data sources

| Source | Purpose | Stability |
|---|---|---|
| Claude/Codex/Cursor lifecycle hooks | Authoritative live state | Supported provider surface |
| `~/.claude/projects` JSONL | Claude daily and hourly tokens/value | Local transcript data |
| `~/.codex/sessions` rollouts | Codex tokens, context, quota windows | Best effort; parser drift disables only Codex usage |
| Claude OAuth usage endpoint | Personal subscription windows | Best effort local account data |
| Anthropic Admin API | Actual organization token/cost report | Optional admin key |
| MongoDB `token_board.daily_usage` | Optional durable history | Additive schema v2 |

Claude transcript scanning uses per-file/per-message ledgers in a separate utility process, so a heavy transcript day never stalls the window. It scans retained-day data in bounded chunks, replaces duplicate contributions, rebuilds after truncation or rewrite, removes vanished files, serializes refreshes, and publishes aggregates atomically.

## Configuration

Configuration is bootstrapped before provider services are constructed. Precedence is process environment, installed `userData/.env`, legacy `%APPDATA%\claude-watch\.env`, then project `.env` in development only. Open the canonical config folder from Settings → System. Most preferences (the global chords, notifications, window backdrop, phone push, capture settings) are set in Settings and stored by the app; the variables below are the bootstrap.

| Variable | Default | Purpose |
|---|---|---|
| `CLAUDE_WATCH_HOTKEY` | `Control+Alt+W` | Default summon chord (Settings can change it) |
| `CLAUDE_WATCH_NOTIFICATIONS` | `0` | Attention notifications |
| `CLAUDE_WATCH_PORT` | `7459` | Loopback daemon port |
| `CLAUDE_WATCH_MOCK` | `0` | Development mock mode |
| `ANTHROPIC_ADMIN_KEY` | – | Anthropic Admin API report |
| `CLAUDE_WATCH_ORG_NAME` | `Growth Saloon` | Admin-spend label |
| `CLAUDE_WATCH_DAILY_BUDGET_USD` | – | Optional daily actual-spend budget |
| `CLAUDE_WATCH_PROJECTS_DIR` | `~/.claude/projects` | Claude transcript root |
| `CLAUDE_WATCH_NEW_PROJECT_DIR` | `~/Projects` | New-project folder; badges fold subfolders to their project here |
| `TM_NOTES_DIR` | `~/Notes` | The Notes pane's folder |
| `CLAUDE_WATCH_REPO` | `~/Projects/claude-watch` | The checkout the Update chip rebuilds |
| `MONGODB_URI` | – | Optional history sync (`CLAUDE_WATCH_MONGODB_URI` also works) |
| `TM_AGENT_MONITOR_ENDPOINT_FILE` | app-data path above | Bridge discovery override |
| `CLAUDE_WATCH_CLIPBOARD` | – | `poll` forces the clipboard poller instead of the change listener |

## Architecture

```text
Claude/Codex/Cursor hooks -> hooks/bridge.mjs -> authenticated POST /v1/events
                                             |
Claude transcript ledger (usage worker) -----+--> provider-neutral AgentStore
Codex rollout parser (usage worker) ---------+--> UsageAccount[] / DailyUsageDay
OAuth + Anthropic Admin APIs ----------------+--> Electron IPC -> React renderer
                                                          |
                                              optional MongoDB schema v2

Clipboard listener (koffi) -> ClipStore (sealed JSONL) -> picker window, Clipboard pane, /v1/clips
Chat panes: ChatManager (main) -> Claude Agent SDK / codex app-server -> ChatPane
Agents: tm CLI / skill -> /v1/status, /v1/terminals, /v1/agents/:id/wait, /v1/clips, /v1/snippets
```

The compatibility `POST /report` route remains for bounded Claude legacy payloads, but it is authenticated and schema-validated. `/health` and `/status` diagnostics also require the bearer token. All routes are exact-match, and JSON ingestion rejects wrong content types, oversized bodies, future or non-finite timestamps, excessive strings, invalid enums and cardinality overflow.

## Build and package

```powershell
npm run dist:dir
npm run dist
```

`dist`, `dist:dir` and `publish` first run `scripts/check-deps.mjs`, which refuses to package when a runtime dependency in the lockfile is not installed. electron-builder packs whatever `node_modules` holds without a word, and 0.4.58 shipped without its chat dependencies that way. Every distribution command regenerates `build/icon.ico` offline from tracked `resources/icon.png`. Packaged resources include the shared bridge and installer, the native focus module, and the unpacked native modules (`koffi`, `node-pty`, the Agent SDK's `claude.exe`). Builds are unsigned.

`npm run dist` produces two Windows executables in `dist/`: the `*-x64.exe` installer opens the setup wizard, while `*-portable.exe` runs without installation. Pass `--publish never` for a purely local build (`npm run dist -- --publish never`); the config declares a GitHub publisher.

### Installing a local build over the installed app

The **Update** chip in the status bar (also File → *Rebuild & relaunch*, the palette and Settings → System) does all of this from inside the app: `npm install`, `npm run dist`, quit, silent install, relaunch. `scripts\reinstall-local.ps1` is the same flow from a terminal (add `-SkipBuild` to install what `dist\` already holds). By hand, quit the running app (tray → Quit, or File → Quit), then hand the installer the same arguments `electron-updater` uses for `quitAndInstall({ isSilent: true, isForceRunAfter: true })`:

```powershell
Start-Process .\dist\tm-agent-monitor-<version>-x64.exe -ArgumentList '--updated', '/S', '--force-run'
```

`--updated` marks an in-place update (the assisted installer skips its pages and passes `--updated` to the relaunched app), `/S` is NSIS silent mode, and `--force-run` makes the silent install start the app afterwards, as your user, so nothing needs to know the install directory.

Before trusting a local build, verify it the way a release is verified. A green build is not a working app:

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

The tag **and** the release must exist before publishing. electron-builder starts one publisher per artifact and they race to create the release; the loser gets `422`, and that abort skips the `latest.yml` upload. The result is a release with installers but no update feed, which clients see as a 404. If that happens, run `npm run publish` again against the now-existing release: it uploads all four assets and overwrites the binaries so the feed and the exe stay consistent.

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

- **Driving the live app (use this first).** [`.mcp.json`](./.mcp.json) registers [`electron-mcp-server`](https://github.com/halilural/electron-mcp-server) (MIT), which attaches over the Chrome DevTools Protocol to take screenshots, click, type, evaluate JS, and read console and network logs.
  - It is launched through `scripts/mcp-electron-debug.mjs` rather than `npx`. The package's entry has no shebang, so on a machine whose npm `script-shell` is Git Bash the bin shim sources the bundle and dies on line 1. The wrapper runs the package's main under node directly (devDependency first, else the npx cache).
  - It needs an app started with `--remote-debugging-port`. `npm run debug:app` launches the built app that way, with mock data, a throwaway user-data dir (the single-instance lock would otherwise exit it) and daemon port 7460. It also strips `TM_AGENT_MONITOR_ENDPOINT_FILE` / `TM_TERMINAL_ID` from its environment, so the installed app's hooks are untouched. `--real` uses your live hooks; `--packaged` runs `dist\win-unpacked`.
  - Give `take_screenshot` a *relative* `outputPath` (or none, for an inline image), because its validator rejects absolute Windows paths. Read page state with `get_page_structure` / `get_body_text`, since `eval` at the configured security level performs actions but returns only `executed`. The clipboard picker is a second CDP page: check which page a tool attached to.
- **Docs, when the live app can't answer.** The shipped source is authoritative for packaging and updates: `node_modules/electron-updater/out/*.js` and `node_modules/app-builder-lib/templates/nsis/*.nsh`. Context7 mirrors (`/websites/electronjs`, `/electron-userland/electron-builder`) are the fallback for API questions.
- **Repo skills.** `.claude/skills/electron` covers the process model, packaging, auto-update and the failures this project hit; `.claude/skills/workspace-layout` covers window sizing, layering and persisted layout. Copy them to `~/.claude/skills/` to invoke them.

## Roadmap

[docs/UPGRADE-PLAN.md](./docs/UPGRADE-PLAN.md) is the live roadmap, and its *Open now* list gathers what is left. Broader Claude/Codex configuration management (MCP servers, skills, plugins, safe diff editors) is parked in `docs/CLAUDE-CODE-MANAGEMENT-PLAN.md`; the macOS port is scoped in `docs/MACOS-COMPATIBILITY-PLAN.md`.
