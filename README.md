# Claude Watch (Windows)

A hotkey-summoned desktop panel that monitors your running **Claude Code** agents
and your **Claude API usage** — a Windows re-imagining of
[ImTaegan/claude-watch](https://github.com/ImTaegan/claude-watch) (which is a macOS
menu-bar app). Because Windows has no menu bar, the panel is summoned with a global
hotkey (default **Alt+C**) and lives in the system tray.

It reproduces the reference design: a translucent card over a magenta→orange gradient
showing Session/Week usage bars, today's token output, and a live list of agents with
state icons, context-fill %, and durations.

## What it shows

**Usage dashboard — two meters, two different accounts:**
- **YOU · MAX** — your personal subscription's **real** 5-hour (Session) + weekly windows,
  from the same OAuth usage endpoint Claude Code's `/usage` uses, plus "Today N tokens out"
  summed from local transcripts. This one account drives *all* your Claude Code here — CLI,
  VS Code, and the desktop app's Claude Code tab (which runs the bundled `claude.exe` under
  the same login).
- **{ORG} · API** — the org's API-key token usage + cost from the Admin API (pay-per-use, no
  5-hour window). Optional daily-budget bar.

Percentages are color-graded by the endpoint's own severity (normal → amber → red).

> A separate org *subscription* (if you use one via the desktop app's claude.ai web session)
> isn't tracked yet — it's cookie-based web auth, a different extraction. Planned follow-up.

**Agent rows** — one per Claude Code session:
- State icon: amber `!` bubble = permission wait · red `!` bubble = question (row highlighted)
  · blue pencil = editing · blue terminal = running a command · green check = finished · moon = idle
- Project name + current activity / blocking question
- Context-fill `%` — color-graded (amber ≥85, red ≥90) with a `↑` arrow when climbing
- Duration in the current state
- Shimmer animation while running, pulse while waiting

**Footer** — daemon connection dot + a Quit button. **Click a row to bring that
agent's terminal window to the foreground** (native, via Win32 FFI); right-click a
row to open its project folder.

## Architecture

```
Claude Code hooks (report.mjs)  ──POST /report──►  Daemon (127.0.0.1:7459)
                                                       │  in Electron main
Anthropic Admin API (usage)     ──fetch──────────►  Usage poller
                                                       │
                                                   StatusSnapshot ──IPC──► React UI
```

- **Daemon** (`src/main/daemon.ts`) — local HTTP server; hooks push agent events.
- **Hooks** (`hooks/report.mjs`) — run on every Claude Code event, derive activity +
  context %, POST to the daemon.
- **Usage** (`src/main/usage.ts`) — pulls real token usage from the Anthropic Admin
  API (Usage report). Optional; the app runs without it.
- **Native focus** (`src/native/win32.mjs`) — koffi FFI to `user32`/`kernel32`. The
  hook discovers the HWND of the terminal window hosting each session (walking the
  process tree); clicking a row force-foregrounds that window. koffi loads system
  DLLs at runtime, so there's no per-Electron-ABI native rebuild.
- **UI** (`src/renderer`) — React, polled once a second.

## Setup

```sh
npm install
npm run dev        # launches the app (shows on first run; toggle with Alt+C)
```

See the design without any data source:

```sh
# Windows PowerShell
$env:CLAUDE_WATCH_MOCK=1; npm run dev
```

### Live agents (Claude Code hooks)

```sh
npm run hooks:install            # writes ~/.claude/settings.json
# or, per-project:
node hooks/install.mjs --project
```

Restart open Claude Code sessions. Agents appear as they run. Remove with
`node hooks/install.mjs --remove`.

### Live usage (optional)

Copy `.env.example` to `.env` and set `ANTHROPIC_ADMIN_KEY` (an `sk-ant-admin...`
key from the Console). Tune `CLAUDE_WATCH_SESSION_CAP` / `CLAUDE_WATCH_WEEK_CAP`
(output-token caps used for the Session/Week bars) to your plan. Without a key, the
agent list still works; the usage bars stay hidden.

## Configuration (`.env`)

| Var | Default | Purpose |
|---|---|---|
| `CLAUDE_WATCH_HOTKEY` | `Alt+C` | Global summon/hide hotkey (avoid `Ctrl+Alt+*` AltGr & `Ctrl+Shift+W`) |
| `CLAUDE_WATCH_NOTIFICATIONS` | `0` | `1` = desktop "needs input" notifications (off by default — noisy) |
| `CLAUDE_WATCH_PORT` | `7459` | Daemon port |
| `CLAUDE_WATCH_MOCK` | `0` | Start in mock mode |
| `ANTHROPIC_ADMIN_KEY` | – | Org **API** meter (admin usage + cost) |
| `CLAUDE_WATCH_ORG_NAME` | `Growth Saloon` | Label for the API meter |
| `CLAUDE_WATCH_ORG_DAILY_BUDGET_USD` | – | Optional daily-spend budget bar on the API meter |
| `CLAUDE_WATCH_PROJECTS_DIR` | `~/.claude/projects` | Transcript store for "Today tokens out" |

> **YOU · MAX needs no config** — the personal 5h/weekly windows read your existing
> `~/.claude/.credentials.json` token automatically.

## Build

```sh
npm run build      # compiles main + preload + renderer into out/
npm run typecheck
```

## Click-to-focus (native)

Clicking an agent row brings its terminal window to the front. The hook walks the
process tree from the Claude Code session up to the first ancestor that owns a visible
top-level window — this covers **Windows Terminal**, the **VS Code integrated
terminal**, and classic consoles. It foregrounds the *window*; selecting a specific
Windows Terminal **tab** isn't possible through public Win32 APIs, so a multi-tab WT
window comes forward but stays on its current tab.

## Notes & follow-ups
- The Session/Week windows are **real** (the OAuth usage endpoint `/api/oauth/usage`),
  not proxies — they match what Claude Code's `/usage` shows.
- **Org subscription window** (separate from the API meter) isn't tracked yet — on this setup
  the desktop Claude Code tab shares the personal Max login, and a true org subscription would
  live in the desktop app's claude.ai web session (cookie-based). Planned follow-up.
- Tray icon and app icon are generated by `npm run icons`.
- **Packaging (later):** `koffi` is a native module — mark it `asarUnpack` in the
  electron-builder config. The hook (`report.mjs`) currently imports
  `../src/native/win32.mjs`; when packaging, ship `report.mjs` + `win32.mjs` + `koffi`
  to a stable location and have `hooks/install.mjs` point at it.
