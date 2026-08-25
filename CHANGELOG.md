# Changelog

Releases are GitHub Releases on `TC23345/tm-agent-monitor`; installed apps update from `latest.yml` there. Local builds land in `dist/` as `tm-agent-monitor-<version>-x64.exe`.

## 0.3.1 — 2026-08-25

Layout customization, on top of the 0.3.0 workspace.

- **Draggable sidebar.** A splitter between the agent sidebar and the pane grid. Width is clamped to 260–720px and to whatever leaves a pane its 200px minimum, so a half-screen workspace cannot be dragged into uselessness. An untouched sidebar keeps following the responsive default instead of freezing today's number.
- **Column and row splitters** in the pane grid. A drag re-splits only the pair it grabbed; the other tracks never move. Rows stop at a smaller minimum (120px) than columns (200px).
- **Per-view sizes.** Sidebar width and column/row fractions are stored separately for the full and half workspace, keyed off the live viewport — so an Alt+Q peek at the half view never overwrites the full-screen layout.
- **Pane zoom.** The header button (or a double-click on the header) fills the grid with one pane; `Escape` restores it. Other panes stay mounted, so a running shell is never disturbed.
- **Reset.** Double-click (or `Home`) resets one splitter; View → *Reset pane sizes* resets everything in both views. Splitters are keyboard-reachable (`Tab`, arrows).
- **Open windows** leads the sidebar, pinned above the agent list and collapsed by default — one header row, one click from the switcher.
- **Command palette.** Ctrl+Shift+P (or the command center in the title bar, or Ctrl+P outside a terminal) opens a fuzzy-searched list of every command, every live agent, and every open window; `>` `@` `#` narrow the sections, `Tab` cycles them.
- **IDE-style title bar.** One row: the brand mark and menus at the left, the command center in the middle, status at the right — replacing the wordmark row.
- **Pane tool strips.** The pane header's content dropdown is gone; the kind is fixed and the header carries that kind's tools — terminals get split, clear, restart, external terminal, and open folder; the launcher gets new project and Projects folder. Ctrl+Shift+` opens a new terminal, Ctrl+, opens Settings.
- Dependencies: Electron 42.10 (Chromium patches), koffi 3.1.6, lucide-react 1.34, mongodb 7.6 — within-major; the packaged build was re-verified (asar deps, native modules, boot).
- **Status for agents.** `GET /v1/status` on the loopback daemon returns the full snapshot to a token holder, and `npm run tm -- status [--json]` prints it — so a Claude Code session can ask what else is running or waiting without opening the window.
- Renderer: xterm loads lazily (a workspace with no terminal pane never parses it), and the persisted-layout parsing moved into tested `src/shared/panes.mjs`.
- **Activity feed.** A new pane (User → Activity feed, or the palette) lists what sessions asked, finished, started, ended, and compacted — newest first, across every session, with a project filter; rows jump to the session. The store keeps the last 300 such moments, so the feed shows what happened before the pane was opened.
- **Scriptable workspace.** `npm run tm -- open --cwd C:\proj --launch claude`, `tm layout Build`, `tm palette|usage|activity|show|hide` drive the running app from a terminal or keybind through Electron's second-instance path; both sides validate the command.
- **Phone push.** Settings → *Phone push*: an ntfy / Pushover URL and a wait threshold; a session that has waited longer than that gets its question POSTed there, once.
- **Reply from the monitor.** Right-click a waiting session that runs in an embedded pane and type the answer there — it goes straight into that pane's shell.
- **While you were away.** Summon the workspace after more than a minute and a one-line strip says what changed: sessions now waiting (with a jump link), finished, started, ended, and estimated spend since you left. Dismisses itself.
- **Project commands.** The Launch pane lists a folder's `.tm.json` commands and `package.json` scripts as buttons; each runs in a new terminal pane in that folder (also in the palette as `Run: …`).
- **Git state.** Project headers show branch, ahead/behind, dirty count (amber), and a ⑂ for linked worktrees — one cached `git status` per folder per half-minute.
- **Usage history.** The Usage pane gains a History section: thirty days of tokens and value per provider as stacked bars, the API spend beside them, and the model mix for today and the month — flagging when one model carries most of the value. This is the history the app has written since 0.2 and never drawn.
- **Named layouts.** View → Layouts saves the open panes, dragged sizes, sidebar views, and column choice under a name and applies it back later (terminals come back as fresh shells in their folders); the palette has `Layout: …` and `Delete layout: …`.
- **Drop to launch.** Drag a project group from the sidebar onto the pane grid to open a shell in that folder — hold Shift to start Claude Code there. The palette also offers *terminal here*, *open folder*, *open in Cursor*, and *copy path* per session.
- **Context pressure.** A session past ~85% context and still climbing shows an amber chip in the title bar (click to focus), gets a desktop notification when the workspace is hidden, and its Claude pane grows a *Compact now* tool that types `/compact`.
- **Attention routing.** A terminal pane whose session is waiting on you shows a pulsing bell in its header (matched by folder and launch); **Ctrl+Shift+W** jumps to the longest-waiting session — its pane if it has one, else its window — and the palette lists waiting sessions first with their question.
- **Keyboard pane focus.** Ctrl+1…6 focuses pane N, Ctrl+Shift+←/→ steps between panes, and the focused pane shows a ring; clicking a pane focuses it too.
- **Snippets.** A `/` tool on every terminal pane types common commands into it — `/compact`, `/context`, `/cost`, `/clear`, `/resume` for Claude Code; `/status` for Codex; `cls`, `git status`, `claude`, `codex` for a shell.
- **Provider heartbeat.** The connection chip and Settings now say *when* each provider last reported, flag one that has gone silent for 10+ minutes, show the last hook error, and warn when the installed hooks carry an older bridge protocol than this app speaks.
- **Automation targets.** Every interactive element carries a stable `data-testid`, and a `CDP :port` chip appears in the title bar when the app runs with `--remote-debugging-port` (as `npm run debug:app` does).
- **Idle cost.** The per-second clock moved out of the app root into the rows and bars that print a time (`useNow`), so the grid and every terminal stop re-rendering every second; grouping is memoized.
- **Usage pane.** Spend and Insights leave the sidebar and combine into one Usage pane in the grid — today's spend, then local usage insights, one scrolling column — opened from User → *Usage: spend & insights* (or View → Add pane, or the palette). The sidebar keeps Open windows and Limits; a stored Spend/Insights sidebar toggle is dropped silently.
- Idle-cost trims: layout sizes persist on a trailing 200ms write instead of per mouse event; the window-list poll no longer re-renders when nothing changed; the keyboard listener is registered once.
- **Rebuild & relaunch** now hands the installer the same arguments `electron-updater` uses (`--updated /S --force-run`), so the silent install relaunches the app itself.
- Agent tooling: `.mcp.json` registers `electron-mcp-server` and `npm run debug:app` launches a CDP-driveable copy of the app; docs libraries for Context7 are listed in `CLAUDE.md`.

## 0.3.0 — 2026-08-21

The full-screen workspace.

- Embedded terminals: real ConPTY shells (`node-pty`) rendered with xterm.js in panes; sessions survive hide/show and pane remounts.
- Menu-bar chrome (File / Terminal / View / User) replaces the button strips; the top right holds passive status only.
- Sidebar data views (Limits, Spend, Open windows, Insights) toggled from the sidebar menu, each collapsible to its header.
- De-layered window: no always-on-top, so launched windows appear in front while the workspace waits behind; the hotkey raises a buried workspace.
- Persisted workspace size (full / left half / right half), Alt+Q half view, View-menu column counts.
- Settings → Rebuild & relaunch from the local checkout.

## 0.2.x — July–August 2026

Provider-neutral monitoring rebuild: Claude Code, Codex, and Cursor hooks; provider-qualified identities; usage per provider; optional MongoDB history; native Win32 focus and the open-windows switcher; branded provider badges and notifications.
