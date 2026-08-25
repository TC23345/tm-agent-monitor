# Upgrade plan — optimizations and the next twenty features

> Written 2026-08-25 against 0.3.1 (IDE title bar, command palette, draggable
> layout, pane zoom, Usage pane). `docs/UX-IMPROVEMENT-PLANS.md` keeps the
> visual/IA backlog (A1–G3) and `docs/CLAUDE-CODE-MANAGEMENT-PLAN.md` the
> config-management features; nothing here duplicates either. Effort:
> **S** ≈ ½–1 day · **M** ≈ 2–4 days · **L** ≈ 1 week+. A ✅ marks shipped items.

## How to work this plan

- Every feature below names the data or IPC it is grounded in. If that
  grounding is missing when you start, stop and re-plan — the whole point is
  that none of these needs a new provider surface.
- Order of work is the **sprints** at the bottom, not the numbering. Each
  sprint is one commit range, gated by `npm run typecheck && npm test &&
  npm run build && git diff --check`, driven once through the `electron-debug`
  MCP tools (`CLAUDE.md` → Agent tooling), and finished with a CHANGELOG line.
- Renderer-only work needs no new IPC. Anything that adds an IPC route follows
  the four-file shape in the `electron` skill (`examples/ipc-and-preload.md`);
  anything that adds a persisted setting follows the eight-stop checklist in
  the `workspace-layout` skill.
- Pure logic goes in `src/shared/*.mjs` with a `.d.mts` and a test, like
  `layout.mjs` and `palette.mjs`. Components stay thin.

## Optimizations

| # | What | Why it matters | Where |
|---|------|----------------|-------|
| O1 ✅ | **Stop re-rendering the whole workspace every second.** `App` holds `now` in state and ticks it every 1s, so the title bar, sidebar, every pane (xterm hosts included), and `paletteItems()` re-render each tick. Move the tick into a `useNow()` hook used only by the components that show durations/countdowns (`AgentRow`, `UsageDashboard`, `SpendView`), and memoize `groupByProject`/`applyOrder` on `agents`/`order`/`waitingOnly`. | Idle CPU in a tray app that is open all day; the grid should only re-render on layout changes. | `App.tsx` (`now`, `groups`), `AgentRow.tsx`, `UsageDashboard.tsx`, new `useNow.ts` |
| O2 ✅ | **Debounce layout persistence.** Trailing 200ms write, flushed on unmount, instead of a synchronous `localStorage` write per splitter `pointermove`. | Drag smoothness. | `App.tsx` |
| O3 ✅ | **Skip no-op window-list updates.** `useDesktopWindows` keeps the previous reference when hwnd/pid/title/agent tuples are equal. | The poll is `EnumWindows` + a process snapshot; the re-render was avoidable. | `WorkspacePanes.tsx` |
| O4 ✅ | **Register the keyboard listener once**, behind a ref. | Hygiene; removes a per-render allocation from O1's hot path. | `App.tsx` |
| O5 ✅ | **Make pane/sidebar persistence testable.** Move `sanitize`, `readLayout`/`writeLayout`, `readSizes`, and the sidebar migrations into `src/shared/panes.mjs` with `.d.mts` + tests; `panes.ts` becomes a thin browser wrapper. | The v1→v2 sidebar migration and the "unknown ids are dropped" rule (which the Usage pane relies on) have no test. | new `src/shared/panes.mjs` |
| O6 ✅ | **Lazy-load xterm.** `React.lazy` the `TerminalPane` module (~40% of the ~790 KB renderer bundle). | Faster renderer boot; no visible change since the window starts hidden. Lowest payoff. | `App.tsx` (`paneBody`) |
| O7 | **Dependency currency.** Within-major now: `electron 42.5→42.10`, `koffi 3.0.2→3.1.6`, `lucide-react 1.21→1.34`, `mongodb 7.4→7.6`. Majors as separate, packaged-and-verified steps: **Electron 44** (re-verify `node-pty`/`koffi` prebuilds, `verify-asar-deps`, MCP smoke), **React 19** (`forwardRef` → `ref` prop; `@vitejs/plugin-react 6`), **Vite 8 / TypeScript 7** (electron-vite first). `node-pty` stays on the 1.2 beta — the 1.1.0 "latest" tag is older. | Chromium patches; native ABI coupling makes Electron its own PR. | `package.json` |

## Features F1–F10 — surfacing what the app already collects

| # | Feature | Grounded in | Effort |
|---|---------|-------------|--------|
| F1 ✅ | **Usage history in the Usage pane.** A third section: 30-day bars of tokens/value per provider, with a per-model breakdown for today and the month (share of spend on the expensive model, flagged). Insights callouts show absolute token counts next to their percentages. | `getHistory()` / `history:recent` already returns 30 days (Mongo + live-day overlay) and **nothing calls it**; `DailyUsageDay.byModel`/`byProvider` and `UsageInsightMetric.tokens` are computed and dropped. | M |
| F2 ✅ | **Provider heartbeat and hook health.** Connection chip tooltip and Settings show "last report 3m ago" per provider, the last hook error text, and a warning when the installed bridge is older than the app (offer Repair). Title-bar chip turns amber when a provider that was reporting goes silent for >10 min. | `ProviderHealth.lastReportAt`, `.error`, `.bridgeVersion` and `StatusSnapshot.generatedAt` are populated and never read. | S |
| F3 ✅ | **Attention routing.** A waiting agent's own terminal pane (matched by cwd + launch) gets a pulsing badge in its header; **Ctrl+Shift+W** cycles focus to the next waiting session (embedded pane if it has one, else `focusAgent` raises its window); the palette's `@` list puts waiting sessions first with their question as the detail. | `Agent.state === 'waiting'`, `waitReason`, `question`, `focusAgent`; the `waiting` count is already in the title bar but is passive text. | M |
| F4 ✅ | **Activity feed pane.** A new unique pane kind: a reverse-chronological feed of attention events across all sessions — questions asked, permissions requested, turns completed, sessions started/ended — each row jumps to the agent. A per-agent filter makes it a session timeline. Needs a bounded event ring in `AgentStore` and one `agent:events` IPC route. | `AgentEventV1` already flows through `daemon.ts` → `store.ts`; `recentQuestions` is the only slice kept today. | M |
| F5 ✅ | **Drop a project onto the grid, and agent actions in the palette.** Dragging a project group (already draggable for reordering) onto the pane grid opens a Claude/Codex/shell pane in that cwd; the palette's agent rows gain sub-actions: *terminal here*, *open folder*, *open in Cursor*, *copy path* (mirroring `AgentContextMenu`). | `dragHandle` on `ProjectGroup`, `addPane('terminal', { cwd })`, `openTerminal`, `openPath`, `openCursor`, `copyText`. | S–M |
| F6 | **Terminal tabs within a pane.** A pane holds several shells with a tab strip in its header; split becomes "new tab", and a tab can be torn out into its own pane. Sessions are already independent in `terminals.ts`, so this is renderer-only. | `PaneInstance.term` becomes `terms[]` + `activeTerm`; `TerminalPane` per tab, hidden with `display: none` like zoom. | M |
| F7 | **Launch profiles.** User-defined launch commands beyond the three fixed ones — `claude --continue`, `claude --model …`, `codex --full-auto`, a project's `npm run dev` — as extra buttons in the Launch pane, in the Terminal menu, and as palette commands. Stored as a validated `AppSettingsPatch` field. | `TerminalLaunch` + `terminals.ts` spawn already parameterize the command; settings validation in `store.ts`. | M |
| F8 ✅ | **Slash snippets in the terminal tool strip.** A one-click menu on Claude/Codex panes that types common commands into the PTY — `/compact`, `/context`, `/cost`, `/clear`, `/resume` — plus user snippets. | `termInput(id, data)` already exists; the tool strip is the natural home. | S |
| F9 ✅ | **Named workspace layouts.** Save the current panes + sizes + sidebar views as "Review", "Build", "Monitor"…; switch from the View menu or the palette (`Layout: Build`). Terminal panes restore with their launch + cwd (a fresh shell). | Everything is already in `tm.panes.v2`, `tm.layout.v1`, `tm.sidebar.v2`; this is a named snapshot of those keys. | S–M |
| F10 | **Multi-machine roll-up.** With MongoDB history configured, the Usage pane's history section shows other machines' days too (`token_board.machines` is written on every connect and never read), with a per-machine legend. | `history.ts` docs carry `machineId`; `recentDays()` needs a `machineId?` filter and one IPC route. | M |

## Features F11–F20 — what the agent driving this app would use

Added after building 0.3.1 with the `electron-debug` MCP loop. F11–F13 make
the app a better target for agents; F14–F20 are what an operator running
hours-long sessions reaches for.

| # | Feature | Grounded in | Effort |
|---|---------|-------------|--------|
| F11 ✅ | **Status API for agents.** Expose the live `StatusSnapshot` as a tiny MCP server (stdio, `tm-agent-monitor status`) or `tm status --json`, so a Claude Code session can ask *what else is running, what's waiting, which daemon/CDP ports are taken* — and avoid launching a second session in a project that already has one. | `status:get` already returns everything; the daemon already listens on loopback with a bearer token — a read-only `GET /v1/status` for holders of the token is the smallest form. | M |
| F12 ✅ | **Scriptable workspace.** `tm open --pane terminal --cwd … --launch claude`, `tm layout build`, or a `tm-agent://` deep link: a second instance forwards its argv to the running one (`requestSingleInstanceLock` already hands `second-instance` the argv), main forwards a validated command to the renderer, which runs the same handler the palette does. | `second-instance` event, the palette's command table, `addPane`. | M |
| F13 ✅ | **Automation-stable targets.** `data-testid` on every interactive element (menus, palette rows, pane tools, splitters, agent rows) and a title-bar chip "CDP :9222" when main sees `--remote-debugging-port`. | The MCP loop currently targets aria-labels and class names, which drift. | S |
| F14 ✅ | **Answer a waiting session from the monitor.** For a session running in an embedded pane (matched by cwd + provider, as in F3), the agent row's context menu gets a reply box that writes to its PTY; external sessions fall back to focus. | `question` is already on the row; `termInput(sessionId, data)` exists. | M |
| F15 ✅ | **Per-project commands.** A `.tm.json` (or `package.json` scripts) rendered as buttons in the Launch pane when that project is active, run in an embedded terminal. One IPC route reads the file. | `LaunchContext.cwd`, `createTerminal` with a launch command. | S–M |
| F16 ✅ | **Git state on project groups.** Branch name and dirty-file count per project (`git status --porcelain`, on demand, cached ~30s), worktrees grouped under their parent repo. | Project cwd per group; one IPC route spawning `git`. | M |
| F17 ✅ | **Context-pressure alert with one-click compact.** Title-bar chip and desktop notification when a session crosses ~85% context and is rising; for embedded panes a button that sends `/compact`. | `contextPct`, `contextRising` (already per row), the notification path in main, `termInput`. | S |
| F18 ✅ | **"While you were away" digest.** On summon, a dismissable strip: sessions finished, questions asked, permissions pending, spend since last hide. The renderer diffs snapshots across `window:phase` exit→enter. | `StatusSnapshot` diff; `onWindowPhase`. | S–M |
| F19 ✅ | **Phone push for long waits.** When a session has waited longer than N minutes, POST the question to ntfy/Pushover (URL + token as validated settings). | The existing waiting-notification path in main; settings checklist. | S–M |
| F20 ✅ | **Keyboard pane focus.** Ctrl+1…6 focuses pane N, Ctrl+Shift+←/→ moves between panes, with a visible focus ring on the active pane. | `termRefs` already expose `focus()`; the capture-phase key handler. | S |

## Design notes for the first sprints

**O1 `useNow`.** One `setInterval` in a module-level store; `useNow()` subscribes via `useSyncExternalStore`. `App` no longer holds `now`; `UsagePane`/`SpendView`/`AgentRow`/`UsageDashboard` call the hook. `groups` is `useMemo`'d on `agents`, `order`, `waitingOnly`.

**F2 heartbeat.** Pure helper `providerStatus(health, now, appVersion)` in `src/shared/health.mjs` → `{ tone: 'on'|'warn'|'off', reason }`: `reporting && silent > 10 min` → warn "silent 12m"; `bridgeVersion && bridgeVersion !== appVersion` → warn "bridge v0.2.3 — repair"; `error` → warn with the text. Connection chip tooltip lists per provider; Settings rows show the same.

**F3 attention routing.** Pure helper `paneForAgent(panes, agent)` matches an embedded terminal pane by canonical cwd and launch (`claude` ↔ provider claude, `codex` ↔ codex). Pane header shows a `.gpane-attn` badge (pulse) when its agent is waiting. `Ctrl+Shift+W` picks the oldest-waiting root agent, zooms/focuses its pane if any, else `focusAgent`. Palette `@` ranks waiting first (stable sort before `rankItems` receives them).

**F8 snippets.** `SNIPPETS` per launch kind (`claude`: `/compact`, `/context`, `/cost`, `/clear`, `/help`; `codex`: `/status`, `/clear`). A `MenuPop` from a tool button; each item calls `termInput(sessionId, text + '\r')`.

**F20 pane focus.** `focusedPane` state; Ctrl+digit sets it and calls the terminal handle's `focus()`; `.pane-slot.is-focused .gpane` gets an accent ring; clicking anywhere in a pane sets it.

**F1 history.** `window.watch.getHistory()` on mount and every 5 min; pure helper `historySeries(days)` → 30 columns (tokens, value, by provider) and `modelMix(days)`; render as CSS bars (no chart library). Section heading "History · 30 days".

**F5 drop-to-launch.** The grid accepts a drop with the project key in `dataTransfer`; on drop, open a `shell` terminal in that cwd (Shift held → Claude). Palette agent sub-actions become four extra items per agent, ranked below the focus item.

**F9 layouts.** `tm.layouts.v1` = `{ name: { panes, sizes, sidebar } }`; terminal entries strip `sessionId`. View → Layouts submenu (Save current…, then names, then Delete…). Palette `Layout: name`.

## Sprints

1. ✅ **Idle cost + routing** — O1, F20, F13, F8, F2, F3 (commit `2d4adfc`).
2. ✅ **Reports and launch** — F1, F5, F9, F17 (`0fd70c5`).
3. ✅ **Talk back** — F14, F18, F15, F16 (`231aeb9`).
4. ✅ **Feed and outside world** — F4, F19, F12.
5. ✅ (part) **Agents and hygiene** — O5, O6, F11. **Open** — F6 terminal tabs, F7 launch profiles, F10 multi-machine, O7 (dependency majors).

### What sprint 5 needs that the others did not

- **F6** changes the pane model (`PaneInstance.term` → `terms[]`); do it as its own commit with the `tm.panes.v2` sanitize updated and a migration for stored single-term panes.
- **F7** is the first *user-authored* command surface — profiles must go through `validateMutableSettingsPatch` (bounded list, no newlines) and never be interpolated into a shell string; spawn the CLI with an argv array in `terminals.ts`.
- **F11** should reuse the daemon: a read-only `GET /v1/status` for bearer-token holders is one route in `daemon.ts` plus a `tm status --json` verb in `scripts/tm.mjs`; an MCP wrapper can sit on top later.
- **O7** Electron 44 needs the packaged build verified (`verify-asar-deps`, `debug:app --packaged`, MCP smoke) before it merges; `node-pty` and `koffi` prebuilds must match the new ABI.

## Data the app collects but never shows (feeds F1, F2, F10)

- `Agent.usageProvenance`, `Agent.valueComplete` (agent-level), `rawSessionId`, `actorId`.
- `UsageAccount.provenance`, `UsageAccount.sourceDate` (the UTC bucket API totals represent).
- `StatusSnapshot.generatedAt`; `ProviderHealth.lastReportAt`, `.error`, `.bridgeVersion`.
- `UsageInsights.available`/`generatedAt`; `UsageInsightMetric.tokens`, `UsageInsightRow.tokens`.
- `DailyUsageDay` (all of it — `getHistory()` has no caller); the 90-sample `UsageSample` ring in `userData/usage-history.json` (feeds only `projectedLimitAt`).
- MongoDB `token_board.daily_usage` (`byModel`, `byProvider`, `apiCostUsd`…) and `token_board.machines` (no read path at all).
