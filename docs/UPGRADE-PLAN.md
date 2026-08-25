# Upgrade plan — optimizations and the next ten features

> Written 2026-08-25 against 0.3.1 (IDE title bar, command palette, draggable
> layout, pane zoom, Usage pane). `docs/UX-IMPROVEMENT-PLANS.md` keeps the
> visual/IA backlog (A1–G3) and `docs/CLAUDE-CODE-MANAGEMENT-PLAN.md` the
> config-management features; nothing here duplicates either. Effort:
> **S** ≈ ½–1 day · **M** ≈ 2–4 days · **L** ≈ 1 week+.

## Optimizations

Found by auditing the code against the `electron` and `workspace-layout`
skills and by reading the render path. Ordered by payoff ÷ effort. None
changes behaviour. O2–O4 shipped with the Usage pane; the rest are open.

| # | What | Why it matters | Where |
|---|------|----------------|-------|
| O1 | **Stop re-rendering the whole workspace every second.** `App` holds `now` in state and ticks it every 1s, so the title bar, sidebar, every pane (xterm hosts included), and `paletteItems()` re-render each tick. Move the tick into a `useNow()` hook used only by the components that show durations/countdowns (`AgentRow`, `UsageDashboard`, `SpendView`), and memoize `groupByProject`/`applyOrder` on `agents`/`order`/`waitingOnly`. | Idle CPU in a tray app that is open all day; the grid should only re-render on layout changes. | `App.tsx` (`now`, `groups`), `AgentRow.tsx`, `UsageDashboard.tsx`, new `useNow.ts` |
| O2 ✅ | **Debounce layout persistence.** Every splitter `pointermove` ran `setAllSizes` → effect → `localStorage.setItem` — a synchronous JSON write per mouse event. Now a trailing 200ms write, flushed on unmount. | Drag smoothness; localStorage writes are sync on the main thread. | `App.tsx` |
| O3 ✅ | **Skip no-op window-list updates.** `useDesktopWindows` set a new array every poll even when nothing changed. It now keeps the previous reference when hwnd/pid/title/agent tuples are equal. | The poll is `EnumWindows` + a process snapshot; the re-render was avoidable. | `WorkspacePanes.tsx` |
| O4 ✅ | **Register the keyboard listener once.** The capture-phase `keydown` effect re-subscribed every render; the handler now lives in a ref behind one stable listener. | Hygiene; removes a per-render allocation from O1's hot path. | `App.tsx` |
| O5 | **Make pane/sidebar persistence testable.** `sanitize`, `readLayout`/`writeLayout`, `readSizes`, and the sidebar migrations live in `panes.ts` (TS, untested). Move the pure parsing into `src/shared/panes.mjs` with `.d.mts` + tests, like `layout.mjs` and `palette.mjs`. | The v1→v2 sidebar migration and the "unknown ids are dropped" rule (which the Usage pane relies on) have no test. | new `src/shared/panes.mjs`; `panes.ts` becomes a thin browser wrapper |
| O6 | **Lazy-load xterm.** `@xterm/xterm` + `addon-fit` are ~40% of the ~790 KB renderer bundle and are parsed even when no terminal pane exists. `React.lazy` the `TerminalPane` module. | Faster renderer boot; no visible change since the window starts hidden. Lowest payoff here. | `App.tsx` (`paneBody`), `TerminalPane.tsx` |
| O7 | **Dependency currency.** `npm outdated` (2026-08-25): within-major and safe now — `electron 42.5→42.10`, `koffi 3.0.2→3.1.6`, `lucide-react 1.21→1.34`, `mongodb 7.4→7.6`, `@types/node` patch. Majors as separate, packaged-and-verified steps: **Electron 44** (Chromium security; re-verify `node-pty`/`koffi` prebuilds, `verify-asar-deps`, MCP smoke), **React 19** (`forwardRef` in `TerminalPane` becomes a plain `ref` prop; check `@vitejs/plugin-react 6`), **Vite 8 / TypeScript 7** (electron-vite compatibility first). `node-pty` stays on the 1.2 beta — the 1.1.0 "latest" tag is older. | Chromium patches; native ABI coupling makes Electron its own PR. | `package.json` |

## Ten new features

Each is grounded in data or IPC the app already collects, so none needs a new
provider surface. Ordered by value; the first four are the recommended next
sprint.

| # | Feature | Grounded in | Effort |
|---|---------|-------------|--------|
| F1 | **Usage history in the Usage pane.** A third section: 30-day bars of tokens/value per provider, with a per-model breakdown for today and the month (share of spend on the expensive model, flagged). Insights callouts show absolute token counts next to their percentages. | `getHistory()` / `history:recent` already returns 30 days (Mongo + live-day overlay) and **nothing calls it**; `DailyUsageDay.byModel`/`byProvider` and `UsageInsightMetric.tokens` are computed and dropped. | M |
| F2 | **Provider heartbeat and hook health.** Connection chip tooltip and Settings show "last report 3m ago" per provider, the last hook error text, and a warning when the installed bridge is older than the app (offer Repair). Title-bar chip turns amber when a provider that was reporting goes silent for >10 min. | `ProviderHealth.lastReportAt`, `.error`, `.bridgeVersion` and `StatusSnapshot.generatedAt` are populated and never read. | S |
| F3 | **Attention routing.** A waiting agent's own terminal pane (matched by cwd + launch) gets a pulsing badge in its header; **Ctrl+Shift+W** cycles focus to the next waiting session (embedded pane if it has one, else `focusAgent` raises its window); the palette's `@` list puts waiting sessions first with their question as the detail. | `Agent.state === 'waiting'`, `waitReason`, `question`, `focusAgent`; the `waiting` count is already in the title bar but is passive text. | M |
| F4 | **Activity feed pane.** A new unique pane kind: a reverse-chronological feed of attention events across all sessions — questions asked, permissions requested, turns completed, sessions started/ended — each row jumps to the agent. A per-agent filter (from a row's context menu) makes it a session timeline. Needs a bounded event ring in `AgentStore` and one `agent:events` IPC route. | `AgentEventV1` already flows through `daemon.ts` → `store.ts`; `recentQuestions` is the only slice kept today. | M |
| F5 | **Drop a project onto the grid, and agent actions in the palette.** Dragging a project group (already draggable for reordering) onto the pane grid opens a Claude/Codex/shell pane in that cwd; the palette's agent rows gain sub-actions: *terminal here*, *open folder*, *open in Cursor*, *copy path* (mirroring `AgentContextMenu`). | `dragHandle` on `ProjectGroup`, `addPane('terminal', { cwd })`, `openTerminal`, `openPath`, `openCursor`, `copyText`. | S–M |
| F6 | **Terminal tabs within a pane.** A pane holds several shells with a tab strip in its header (VS Code's terminal tabs); split becomes "new tab", and a tab can be torn out into its own pane. Sessions are already independent in `terminals.ts`, so this is renderer-only. | `PaneInstance.term` becomes `terms[]` + `activeTerm`; `TerminalPane` per tab, hidden with `display: none` like zoom. | M |
| F7 | **Launch profiles.** User-defined launch commands beyond the three fixed ones — e.g. `claude --continue`, `claude --model …`, `codex --full-auto`, a project's `npm run dev` — shown as extra buttons in the Launch pane, in the Terminal menu, and as palette commands. Stored as a validated `AppSettingsPatch` field (mutable-setting checklist in the `workspace-layout` skill). | `TerminalLaunch` + `terminals.ts` spawn already parameterize the command; settings validation in `store.ts`. | M |
| F8 | **Slash snippets in the terminal tool strip.** A one-click menu on Claude/Codex panes that types common commands into the PTY — `/compact`, `/context`, `/cost`, `/clear`, `/resume` — plus user snippets. | `termInput(id, data)` already exists; the tool strip is the natural home. | S |
| F9 | **Named workspace layouts.** Save the current panes + sizes + sidebar views as "Review", "Build", "Monitor"…; switch from the View menu or the palette (`Layout: Build`). Terminal panes restore with their launch + cwd (a fresh shell, like after a restart). | Everything is already in `tm.panes.v2`, `tm.layout.v1`, `tm.sidebar.v2`; this is a named snapshot of those keys. | S–M |
| F10 | **Multi-machine roll-up.** When MongoDB history is configured, the Usage pane's history section can show other machines' days too (`token_board.machines` is written on every connect and never read), with a per-machine legend — one place to see all your agent spend. | `history.ts` docs carry `machineId`; `recentDays()` needs a `machineId?` filter and one IPC route. | M |

Not included, deliberately: the management-plan features (MCP/hooks/skills
managers) remain their own document; G2 "recent sessions" and E3 hover actions
stay in the UX backlog; §B content-sized window stays dead.

## Data the app collects but never shows (feeds F1, F2, F10)

- `Agent.usageProvenance`, `Agent.valueComplete` (agent-level), `rawSessionId`, `actorId`.
- `UsageAccount.provenance`, `UsageAccount.sourceDate` (the UTC bucket API totals represent).
- `StatusSnapshot.generatedAt`; `ProviderHealth.lastReportAt`, `.error`, `.bridgeVersion`.
- `UsageInsights.available`/`generatedAt`; `UsageInsightMetric.tokens`, `UsageInsightRow.tokens`.
- `DailyUsageDay` (all of it — `getHistory()` has no caller); the 90-sample `UsageSample` ring in `userData/usage-history.json` (feeds only `projectedLimitAt`).
- MongoDB `token_board.daily_usage` (`byModel`, `byProvider`, `apiCostUsd`…) and `token_board.machines` (no read path at all).
