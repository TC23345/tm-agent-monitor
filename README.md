# TaylorMade Agent Monitor (Windows)

A hotkey-summoned, dark desktop panel that monitors your running **Claude Code** agents and
your **Claude usage**. Summoned with a global hotkey (default **Ctrl+Alt+W**), it lives in the
system tray. Originally inspired by the macOS menu-bar app
[ImTaegan/claude-watch](https://github.com/ImTaegan/claude-watch); rebuilt for Windows with the
TaylorMade Solutions brand.

Built with **Electron + TypeScript + React**. Dark theme, single accent, Lucide icons, the
TAYLORMADE SOLUTIONS wordmark in the header and a `tm` monogram as the app/tray/installer icon.

## What it shows

**Usage (collapsible) — two meters, two accounts:**
- **YOU · MAX** — your personal subscription's **real** 5-hour (Session) + weekly windows, from
  the same OAuth usage endpoint Claude Code's `/usage` uses, plus "Today N tokens out" summed
  from local transcripts. This one login drives *all* your Claude Code here (CLI, VS Code, and
  the desktop app's Claude Code tab).
- **{ORG} · API** — the org's API-key token usage + cost from the Admin API (pay-per-use, no
  5-hour window). Optional daily-budget bar.

Percentages are color-graded by the OAuth endpoint's own severity (normal → amber → red). A
transient rate-limit (HTTP 429) keeps the last good values instead of flashing an error.

**Agents — grouped by project:** every project is a collapsible header (with a red dot when a
session there needs you); sessions nest beneath with a left indent rail. Each session row shows a
Lucide state icon — shield = permission wait · message-alert = question (row highlighted) ·
file-pen = editing · terminal = running a command · check = finished · moon = idle — plus the
activity/question, context-fill `%` (graded, with a `↑` when climbing), duration, and an orange
spinner while running. The header shows a red **"N waiting"** chip.

**Footer** — daemon connection dot · gear (toggle sample/mock data) · Quit. **Click a row to
bring that agent's terminal window to the foreground** (native, via Win32 FFI); right-click a row
to open its project folder. Hover anything for an explanatory tooltip.

## Architecture

```
Claude Code hooks (report.mjs) ──POST /report──► Daemon (127.0.0.1:7459) ┐
OAuth usage endpoint           ──fetch─────────► subscription windows    ├─► StatusSnapshot ──IPC──► React UI
Anthropic Admin API            ──fetch─────────► org API usage           │
~/.claude/projects transcripts ──read──────────► "today tokens out"      ┘
```

- **Daemon** (`src/main/daemon.ts`) — local HTTP server; hooks push agent events.
- **Hooks** (`hooks/report.mjs`) — run on every Claude Code event, derive activity + context %
  (+ the terminal HWND for click-to-focus), POST to the daemon. Installed via `hooks/install.mjs`.
- **Subscription windows** (`src/main/subscriptionUsage.ts`) — real 5h/weekly from
  `https://api.anthropic.com/api/oauth/usage` using `~/.claude/.credentials.json`.
- **Org API usage** (`src/main/usage.ts`) — Admin API token + cost report. Optional.
- **Today tokens** (`src/main/localUsage.ts`) — sums `output_tokens` from local transcripts.
- **Native focus** (`src/native/win32.mjs`) — koffi FFI to `user32`/`kernel32`; loads system DLLs
  at runtime (no per-Electron-ABI rebuild).
- **UI** (`src/renderer`) — React, polled once a second.

## Setup

```sh
npm install
npm run dev                          # launches the app; toggle with Ctrl+Alt+W
$env:CLAUDE_WATCH_MOCK=1; npm run dev # see the design with sample data (PowerShell)
```

### Live agents (Claude Code hooks)

```sh
npm run hooks:install                # writes ~/.claude/settings.json (or --project)
```
Restart open Claude Code sessions. Remove with `node hooks/install.mjs --remove`.

### Live usage (optional)

The **YOU · MAX** windows need no config (they read `~/.claude/.credentials.json` automatically).
For the **org API** meter, set `ANTHROPIC_ADMIN_KEY` (an `sk-ant-admin…` key). In dev, put it in
`.env`; for the **installed app**, put it in `%APPDATA%\claude-watch\.env` (the installed app's
working dir has no `.env`).

## Configuration (`.env`)

| Var | Default | Purpose |
|---|---|---|
| `CLAUDE_WATCH_HOTKEY` | `Ctrl+Alt+W` | Global summon/hide hotkey (if it won't fire, try e.g. `Alt+C`) |
| `CLAUDE_WATCH_NOTIFICATIONS` | `0` | `1` = desktop "needs input" notifications (off by default — noisy) |
| `CLAUDE_WATCH_PORT` | `7459` | Daemon port |
| `CLAUDE_WATCH_MOCK` | `0` | Start in mock mode |
| `ANTHROPIC_ADMIN_KEY` | – | Org **API** meter (admin usage + cost) |
| `CLAUDE_WATCH_ORG_NAME` | `Growth Saloon` | Label for the API meter |
| `CLAUDE_WATCH_ORG_DAILY_BUDGET_USD` | – | Optional daily-spend budget bar on the API meter |
| `CLAUDE_WATCH_PROJECTS_DIR` | `~/.claude/projects` | Transcript store for "Today tokens out" |

(Env var names keep the `CLAUDE_WATCH_` prefix for back-compat.)

## Build & package

```sh
npm run typecheck
npm run build          # compiles main + preload + renderer into out/
npm run dist           # build + electron-builder → NSIS installer + portable in dist/
npm run dist:dir       # unpacked build only (faster, for testing)
```

`npm run dist` produces `dist/tm-agent-monitor-<ver>-x64.exe` (installer) and
`dist/tm-agent-monitor-<ver>-portable.exe`. `koffi` is marked `asarUnpack` so native focus
works packaged. App/tray/installer icons come from the `tm` monogram (`scripts/brand-icon.mjs` →
`scripts/gen-ico.mjs`); run `npm run icons` to regenerate.

> Builds are **unsigned** — Windows SmartScreen warns ("More info → Run anyway"). The appId is
> `com.taylormade.agent-monitor`.

### Auto-update

Packaged builds pull updates from GitHub Releases on `TC23345/tm-agent-monitor` (a **public**
repo, so the app can read `latest.yml` without a token). The app checks on launch + every 6h,
downloads in the background, and installs on quit (with a notification nudge).
(To keep the code private instead, point `publish.repo` in `electron-builder.yml` at a separate
public releases repo.)
Each release — bump `version` in `package.json`, then publish (needs a GH token with `repo` scope):
```sh
$env:GH_TOKEN="<token>"; npm run publish
```
This builds + uploads the installer, `latest.yml`, and blockmap to a GitHub Release on the public
repo. Installed apps see the higher version and update themselves. (Unsigned ⇒ SmartScreen may still
prompt on the updated build.)

## Click-to-focus (native)

Clicking a session row brings its terminal to the front. The hook walks the process tree from the
Claude Code session to the first ancestor owning a visible top-level window — covers **Windows
Terminal**, the **VS Code integrated terminal**, and classic consoles. It foregrounds the
*window*; selecting a specific WT **tab** isn't possible via public Win32 APIs.

## Plans & docs (`docs/` + local)
- `docs/UX-IMPROVEMENT-PLANS.md` — prioritized visual / interaction / feature improvement plan.
- `docs/CLAUDE-CODE-MANAGEMENT-PLAN.md` — extending the app into an MCP/hooks/workflows manager.
- `plan-design-system-agent-monitor.md` (gitignored) — brand → app design-system migration spec
  (cyan/mono/sharp values, applied opt-in; the app keeps orange for now).

## Notes & follow-ups
- **Org *subscription* window** (separate from the API meter) isn't tracked yet — the desktop
  Claude Code tab shares the personal Max login here; a true org subscription would live in the
  desktop app's claude.ai web session (cookie-based). Planned.
- Queued from the UX plans: window **auto-sizing to content**, **launch-at-login**, an in-app
  **settings panel** (hotkey/notifications/mock), and real **auto-update**.
