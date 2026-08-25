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
