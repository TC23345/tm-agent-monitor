# Upgrade plan — optimizations and the next twenty features

> **Status as of 2026-10-21 (v0.4.68, released): live roadmap.** Every row carries its
> real status: ✅ with the version it shipped in, *changed:* when it shipped
> differently, *removed in 0.4.x* when it was taken out again, or **open**.
> **Open now** at the end gathers everything still left across all the
> planning docs (this one, `UX-IMPROVEMENT-PLANS.md`, `4.2-plan.md`,
> `4.3-plan.md`, `CLAUDE-CODE-MANAGEMENT-PLAN.md`) and the chat panes' own gap lists
> (`tc-rea/chat-panes/docs/rea-findings.md`). Current architecture is
> `CLAUDE.md`; release history is `CHANGELOG.md`.

> Written 2026-08-25 against 0.3.1 (IDE title bar, command palette, draggable
> layout, pane zoom, Usage pane). `docs/UX-IMPROVEMENT-PLANS.md` was the
> visual/IA backlog (A1–G3); it is superseded and its open items are in
> **Open now** below. `docs/CLAUDE-CODE-MANAGEMENT-PLAN.md` holds the parked
> config-management features. Effort:
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
| O1 ✅ 0.4.2 | **Stop re-rendering the whole workspace every second.** `App` holds `now` in state and ticks it every 1s, so the title bar, sidebar, every pane (xterm hosts included), and `paletteItems()` re-render each tick. Move the tick into a `useNow()` hook used only by the components that show durations/countdowns (`AgentRow`, `UsageDashboard`, `SpendView`), and memoize `groupByProject`/`applyOrder` on `agents`/`order`/`waitingOnly`. | Idle CPU in a tray app that is open all day; the grid should only re-render on layout changes. | `App.tsx` (`now`, `groups`), `AgentRow.tsx`, `UsageDashboard.tsx`, `useNow.ts` |
| O2 ✅ 0.4.2 | **Debounce layout persistence.** Trailing 200ms write, flushed on unmount, instead of a synchronous `localStorage` write per splitter `pointermove`. | Drag smoothness. | `App.tsx` |
| O3 ✅ 0.4.2 | **Skip no-op window-list updates.** `useDesktopWindows` keeps the previous reference when hwnd/pid/title/agent tuples are equal. *Changed:* the Open windows sidebar section went in 0.4.4 and `WorkspacePanes.tsx` / `useDesktopWindows` with it; the palette now calls `listWindows` once per open, so there is no poll left to skip. | The poll was `EnumWindows` + a process snapshot; the re-render was avoidable. | `App.tsx` (palette windows) |
| O4 ✅ 0.4.2 | **Register the keyboard listener once**, behind a ref. | Hygiene; removes a per-render allocation from O1's hot path. | `App.tsx` |
| O5 ✅ 0.4.2 | **Make pane/sidebar persistence testable.** Move `sanitize`, `readLayout`/`writeLayout`, `readSizes`, and the sidebar migrations into `src/shared/panes.mjs` with `.d.mts` + tests; `panes.ts` becomes a thin browser wrapper. | The v1→v2 sidebar migration and the "unknown ids are dropped" rule (which the Usage pane relied on) had no test. | `src/shared/panes.mjs` |
| O6 ✅ 0.4.2 | **Lazy-load xterm.** `React.lazy` the `TerminalPane` module (~40% of the ~790 KB renderer bundle). | Faster renderer boot; no visible change since the window starts hidden. Lowest payoff. | `App.tsx` (`paneBody`) |
| O7 ✅ within-major (0.4.0); majors **open** | **Dependency currency.** Shipped 2026-08-25: `electron 42.5→42.10`, `koffi 3.0.2→3.1.6`, `lucide-react 1.21→1.34`, `mongodb 7.4→7.6`. Majors as separate, packaged-and-verified steps: **Electron 44** (re-verify `node-pty`/`koffi` prebuilds, the `electron` skill's `verify-asar-deps`, MCP smoke), **React 19** (`forwardRef` → `ref` prop; `@vitejs/plugin-react 6`), **Vite 8 / TypeScript 7** (electron-vite first). `node-pty` stays on the 1.2 beta — the 1.1.0 "latest" tag is older. As of 0.4.59 none of the majors has moved: `electron ^42.10`, `react ^18.3.1`, `vite ^7`, `typescript ^5.6`. Electron 44 prep: `src/main/clipboardIo.ts` is the only file that touches `clipboard`/`safeStorage`, so the W3C clipboard migration is one file; `scripts/check-deps.mjs` (0.4.59) now gates every `dist`. | Chromium patches; native ABI coupling makes Electron its own PR. | `package.json` |

## Features F1–F10 — surfacing what the app already collects

| # | Feature | Grounded in | Effort |
|---|---------|-------------|--------|
| F1 ✅ 0.4.2 | **Usage history** (planned as a third section of the Usage pane). 30-day bars of tokens/value per provider, with a per-model breakdown for today and the month (share of spend on the expensive model, flagged). Insights callouts show absolute token counts next to their percentages. *Changed:* it is its own History pane since the 0.4.2 split, with one 1D · 3D · 7D · 30D · ALL range filter, hourly detail, a running total, projects, a typical week and a calendar (0.4.51–0.4.53). **Open:** the Insights callouts and breakdown rows still show percentages only, no absolute tokens (`UsageInsightsView.tsx`, `Callout` and `Breakdown`). | `getHistory()` / `history:recent` returned 30 days (Mongo + live-day overlay) and at the time nothing called it; `DailyUsageDay.byModel`/`byProvider` and `UsageInsightMetric.tokens` were computed and dropped. | M |
| F2 ✅ 0.4.2 | **Provider heartbeat and hook health.** Connection chip tooltip and Settings show "last report 3m ago" per provider, the last hook error text, and a warning when the installed bridge is older than the app (offer Repair). Title-bar chip turns amber when a provider that was reporting goes silent for >10 min. | `ProviderHealth.lastReportAt`, `.error`, `.bridgeVersion` and `StatusSnapshot.generatedAt` were populated and never read; `src/shared/health.mjs` reads them now. | S |
| F3 ✅ 0.4.2 | **Attention routing.** A waiting agent's own terminal pane gets a pulsing badge in its header; **Ctrl+Shift+W** cycles focus to the next waiting session (embedded pane if it has one, else `focusAgent` raises its window); the palette's `@` list puts waiting sessions first with their question as the detail. Since 0.4.3 the pane is matched by the hooks' terminal id first, then cwd + launch; **Alt+J** joined Ctrl+Shift+W in 0.4.43, and the title bar's waiting chip goes there on click (0.4.3). | `Agent.state === 'waiting'`, `waitReason`, `question`, `focusAgent`. | M |
| F4 ✅ 0.4.2 | **Activity feed pane.** A reverse-chronological feed of attention events across all sessions — questions asked, permissions requested, turns completed, sessions started/ended — each row jumps to the agent. A per-agent filter makes it a session timeline. A bounded event ring in `AgentStore` and one `agent:events` IPC route. *Changed in 0.4.46:* the pane was removed; the feed is the sidebar's Activity stream under the project badges (`ActivityStream.tsx`), and file edits joined it as folded `edited` rows. | `AgentEventV1` flows through `daemon.ts` → `store.ts`; the store keeps a 300-entry ring. | M |
| F5 ✅ 0.4.2 | **Drop a project onto the grid, and agent actions in the palette.** Dragging a project group (already draggable for reordering) onto the pane grid opens a shell pane in that cwd (Shift: Claude Code); the palette's agent rows gain sub-actions: *terminal here*, *open folder*, *open in Cursor*, *copy path* (mirroring `AgentContextMenu`). | `dragHandle` on `ProjectGroup`, the grid's `onDrop` → `dropProject`, `addPane('terminal', { cwd })`, `openPath`, `openCursor`, `copyText`. | S–M |
| F6 **open** | **Terminal tabs within a pane.** A pane holds several shells with a tab strip in its header; "new tab" sits beside Terminal → New terminal, and a tab can be torn out into its own pane. Sessions are already independent in `terminals.ts`, so this is renderer-only. | `PaneInstance.term` becomes `terms[]` + `activeTerm`; `TerminalPane` per tab, hidden with `display: none` like zoom. | M |
| F7 **open** | **Launch profiles.** User-defined launch commands beyond the fixed ones — `claude --continue`, `claude --model …`, `codex --full-auto`, a project's `npm run dev` — in the Terminal menu, a project badge's menu, and as palette commands (the Launch pane they were planned for was removed in 0.4.2). Stored as a validated `AppSettingsPatch` field. Partly covered today: a folder's `.tm.json` commands and npm scripts are Terminal → Run (F15), and chat panes pick model, effort and permission mode per chat (0.4.58–0.4.59), with a default model and mode a new chat starts on (0.4.66). | `TerminalLaunch` + `terminals.ts` spawn already parameterize the command; settings validation in `store.ts`. | M |
| F8 ✅ 0.4.2 | **Slash snippets.** Common commands typed into the PTY — `/compact`, `/context`, `/cost`, `/clear`, `/resume` — plus user snippets. *Changed in 0.4.3:* the tool-strip menu was removed in the header diet; snippets are the palette's **Snippets** group, acting on the focused terminal pane (`snippets.ts`, `commandGroup` → `Snippets`). | `termInput(id, data)`. | S |
| F9 ✅ 0.4.2 | **Named workspace layouts.** Save the current panes + sizes + sidebar views as "Review", "Build", "Monitor"…; switch from the status bar's **Layout** popover or the palette (`Layout: Build`). It first shipped under View → Layouts; the View menu was removed in 0.4.2. Terminal panes restore with their launch + cwd (a fresh shell). | `tm.layouts.v1` (`layouts.ts`): a named snapshot of `tm.panes.v3`, `tm.layout.v1`, `tm.sidebar.v3`. | S–M |
| F10 **open** | **Multi-machine roll-up.** With MongoDB history configured, the History pane shows other machines' days too (`token_board.machines` is written on every connect and never read), with a per-machine legend. | `history.ts` docs carry `machineId`; the read path filters on this machine's id, so `recentDays()` needs a `machineId?` filter and one IPC route. | M |

## Features F11–F20 — what the agent driving this app would use

Added after building 0.3.1 with the `electron-debug` MCP loop. F11–F13 make
the app a better target for agents; F14–F20 are what an operator running
hours-long sessions reaches for.

| # | Feature | Grounded in | Effort |
|---|---------|-------------|--------|
| F11 ✅ 0.4.2 | **Status API for agents.** The live `StatusSnapshot` over the daemon as a read-only `GET /v1/status` for token holders, and `tm status [--json]`, so a Claude Code session can ask *what else is running, what's waiting* — and avoid launching a second session in a project that already has one. `hooks/SKILL.md` (`tm skill --install`) teaches it. Since 0.4.68 agents can also start and drive chat panes (`/v1/chats`, `tm chats`; approvals stay the user's). **Open remainder:** the stdio MCP-server wrapper was never built. | `status:get`; the daemon on loopback with a bearer token. | M |
| F12 ✅ 0.4.2 | **Scriptable workspace.** `tm open --cwd … --launch claude`, `tm layout build`, `tm palette|usage|activity|notes|show|hide`: a second instance forwards its argv to the running one, main forwards a validated command to the renderer, which runs the same handler the palette does (`workspaceCommand.mjs`). **Open remainder:** the `tm-agent://` deep link — no protocol handler is registered. | `second-instance` event, the palette's command table, `addPane`. | M |
| F13 ✅ 0.4.2 | **Automation-stable targets.** `data-testid` on every interactive element (menus, palette rows, pane tools, splitters, agent rows; `testid.ts`) and a `CDP :port` chip when main sees `--remote-debugging-port` — in the status bar at the right (`StatusBar.tsx`), not the title bar. | The MCP loop had targeted aria-labels and class names, which drift. | S |
| F14 ✅ 0.4.2 | **Answer a waiting session from the monitor.** For a session running in an embedded pane (matched by terminal id since 0.4.3, as in F3), the agent row's context menu gets a reply box that writes to its PTY; external sessions fall back to focus. | `question` is on the row; `termInput(sessionId, data)`. | M |
| F15 ✅ 0.4.2 | **Per-project commands.** A `.tm.json` (or `package.json` scripts), run in an embedded terminal in the launch target's folder. *Changed:* planned as Launch-pane buttons; the Launch pane went in 0.4.2, so they are Terminal → **Run** and the palette's `Run: …` items (`projectCommands.mjs`). | The launch target's cwd, `createTerminal` with a launch command, `project:commands`. | S–M |
| F16 ✅ 0.4.2 | **Git state on project groups.** Branch, ahead/behind and dirty-file count per project header (`git status --porcelain`, on demand, cached ~30s), with a ⑂ marker for a linked worktree. *Changed:* worktrees are not grouped under their parent repo in the agent list (grouping keys on cwd); the sidebar's project badges fold worktrees into their project since 0.4.54. | Project cwd per group; `git:status` spawning `git` (`gitStatus.mjs`). | M |
| F17 ✅ 0.4.2 | **Context-pressure alert with one-click compact.** Title-bar chip and desktop notification when a session crosses ~85% context and is rising; for embedded panes a header tool that sends `/compact`. | `contextPct`, `contextRising`, the notification path in main, `termInput`. | S |
| F18 ✅ 0.4.2, **removed in 0.4.3** | **"While you were away" digest.** On summon, a dismissable strip: sessions finished, questions asked, permissions pending, spend since last hide. Removed because the waiting chip, which goes to the session on click, covers a cold return. | `StatusSnapshot` diff; `onWindowPhase`. | S–M |
| F19 ✅ 0.4.2 | **Phone push for long waits.** When a session has waited longer than N minutes, POST the question to ntfy/Pushover (`pushUrl`, `pushAfterMin`). | The waiting-notification path in main; settings checklist. | S–M |
| F20 ✅ 0.4.2 | **Keyboard pane focus.** Ctrl+1…6 focuses pane N, Ctrl+Shift+←/→ moves between panes (Ctrl+Tab / Ctrl+Shift+Tab too since 0.4.43). The focused pane tints its own border rather than drawing an accent ring. | `termRefs` expose `focus()`; the keymap (`keymap.mjs`) and App's capture-phase handler. | S |

## Design notes for the first sprints

As written for sprints 1–2; where the shipped code went another way it is
noted in brackets.

**O1 `useNow`.** One `setInterval` in a module-level store; `useNow()` subscribes via `useSyncExternalStore`. `App` no longer holds `now`; `UsagePane`/`SpendView`/`AgentRow`/`UsageDashboard` call the hook. `groups` is `useMemo`'d on `agents`, `order`, `waitingOnly`.

**F2 heartbeat.** Pure helper `providerStatus(health, now, appVersion)` in `src/shared/health.mjs` → `{ tone: 'on'|'warn'|'off', reason }`: `reporting && silent > 10 min` → warn "silent 12m"; `bridgeVersion && bridgeVersion !== appVersion` → warn "bridge v0.2.3 — repair"; `error` → warn with the text. Connection chip tooltip lists per provider; Settings rows show the same.

**F3 attention routing.** Pure helper `paneForAgent(panes, agent)` matches an embedded terminal pane by canonical cwd and launch (`claude` ↔ provider claude, `codex` ↔ codex). [Since 0.4.3 it matches the hooks' terminal id first.] Pane header shows a `.gpane-attn` badge (pulse) when its agent is waiting. `Ctrl+Shift+W` picks the oldest-waiting root agent, zooms/focuses its pane if any, else `focusAgent`. Palette `@` ranks waiting first (stable sort before `rankItems` receives them).

**F8 snippets.** `SNIPPETS` per launch kind (`claude`: `/compact`, `/context`, `/cost`, `/clear`, `/help`; `codex`: `/status`, `/clear`). A `MenuPop` from a tool button; each item calls `termInput(sessionId, text + '\r')`. [The tool button went in 0.4.3; the same catalogue is the palette's Snippets group.]

**F20 pane focus.** `focusedPane` state; Ctrl+digit sets it and calls the terminal handle's `focus()`; `.pane-slot.is-focused .gpane` gets an accent ring; clicking anywhere in a pane sets it. [The ring became a tint of the focused pane's own border.]

**F1 history.** `window.watch.getHistory()` on mount and every 5 min; pure helper `historySeries(days)` → 30 columns (tokens, value, by provider) and `modelMix(days)`; render as CSS bars (no chart library). Section heading "History · 30 days". [Now the History pane: `historyView(days, { range, … })` in `src/shared/history.mjs` behind the 1D · 3D · 7D · 30D · ALL filter.]

**F5 drop-to-launch.** The grid accepts a drop with the project key in `dataTransfer`; on drop, open a `shell` terminal in that cwd (Shift held → Claude). Palette agent sub-actions become four extra items per agent, ranked below the focus item.

**F9 layouts.** `tm.layouts.v1` = `{ name: { panes, sizes, sidebar } }`; terminal entries strip `sessionId`. View → Layouts submenu (Save current…, then names, then Delete…). Palette `Layout: name`. [Since 0.4.2 the status bar's Layout popover holds save, apply and delete.]

## Sprints

1. ✅ **Idle cost + routing** — O1, F20, F13, F8, F2, F3 (commit `2d4adfc`).
2. ✅ **Reports and launch** — F1, F5, F9, F17 (`0fd70c5`).
3. ✅ **Talk back** — F14, F18, F15, F16 (`231aeb9`).
4. ✅ **Feed and outside world** — F4, F19, F12 (`e23505b`).
5. ✅ (part) **Agents and hygiene** — O5, O6, F11, O7 within-major bumps (`04ad15e`, `f16269f`). **Open** — F6 terminal tabs, F7 launch profiles, F10 multi-machine, O7 majors (Electron 44, React 19, Vite 8 / TS 7), and two remainders: F11's MCP wrapper and F12's `tm-agent://` deep link.

### What sprint 5 needs that the others did not

- **F6** changes the pane model (`PaneInstance.term` → `terms[]`); do it as its own commit with `sanitizePanes` (`tm.panes.v3`, `src/shared/panes.mjs`) updated and a migration for stored single-term panes.
- **F7** is the first *user-authored* command surface — profiles must go through `validateMutableSettingsPatch` (bounded list, no newlines) and never be interpolated into a shell string; spawn the CLI with an argv array in `terminals.ts`.
- **F11** shipped as described: a read-only `GET /v1/status` in `daemon.ts` plus `tm status [--json]` in `scripts/tm.mjs`. An MCP wrapper can still sit on top.
- **O7** Electron 44 needs the packaged build verified (the `electron` skill's `verify-asar-deps`, `debug:app --packaged`, MCP smoke) before it merges; `node-pty` and `koffi` prebuilds must match the new ABI.

## Data the app collects but still never shows (feeds F10)

Shown since this list was written: `ProviderHealth.lastReportAt`, `.error`,
`.bridgeVersion` (F2); `DailyUsageDay` with `byModel`, `byProvider`,
`apiCostUsd` and per-project totals (the History pane); `rawSessionId` (the
resume command and exact-session resume); the `UsageSample` ring through
`projectedLimitAt` (the pace line and pace streaks). Still unshown:

- `Agent.usageProvenance`, agent-level `Agent.valueComplete` (only History's day and model rows mark incomplete value), `actorId`.
- `UsageAccount.provenance`, `UsageAccount.sourceDate` (the UTC bucket API totals represent).
- `UsageInsights.generatedAt`; `UsageInsightMetric.tokens`, `UsageInsightRow.tokens` (the F1 remainder).
- The 90-sample `UsageSample` ring in `userData/usage-history.json` as a series (C3's sparkline).
- MongoDB `token_board.machines` (no read path at all; F10).

## Open now

Everything still left across the planning docs, as of 2026-10-21 (v0.4.68). The update feed is current again: v0.4.68 is the first GitHub release since v0.2.3, so installs older than the dev loop now get updates.

This plan:
- **F6** terminal tabs within a pane.
- **F7** launch profiles.
- **F10** multi-machine roll-up in History.
- **F1 remainder** — absolute token counts in the Insights callouts and breakdown rows.
- **F11 remainder** — an MCP-server wrapper over `GET /v1/status`.
- **F12 remainder** — a `tm-agent://` deep link.
- **O7 majors** — Electron 44, React 19, Vite 8 / TypeScript 7, each its own packaged-and-verified step.

From `UX-IMPROVEMENT-PLANS.md` (superseded):
- **A1** accent to the brand sky-cyan (`--accent` is still `#d97757`).
- **A2** Geist Mono / Geist (the interface is still Segoe UI).
- **A3** sharper, terminal-flat aesthetic for the workspace (only the picker went square, 0.4.42).
- **C3** usage sparkline under each quota bar.
- **E2** ↑/↓ between agent rows (Escape-to-hide and Alt+J exist).
- **E4** custom themed tooltips instead of native `title`.
- **E6** All / Waiting / Running filter chips (waiting-only exists).
- **F1** integer type scale (`styles.css` still has many fractional `font-size`s).
- **F6** list enter/exit motion for agent rows.
- **G1** entrypoint glyph per session (cli / vscode / desktop).
- **G3** multi-account limits.

From `4.2-plan.md` / `4.3-plan.md`:
- **4.3 item 9** Settings as a status-bar popover (Settings was consolidated into a seven-row page with sub-pages in 0.4.40 instead).
- **Tray tooltip click** going to the next waiting session (4.3 item 1's tray half).
- Parked, not planned: machine memory / GPU in the status bar; Agents-pane project headers as click-to-copy paths.

From `CLAUDE-CODE-MANAGEMENT-PLAN.md` (parked, not started):
- F1 MCP server manager, F2 hooks CRUD, F3 skills / subagents / plugins browser, F4 What's New, F5 config diff viewer, F6 config health check.

From `MACOS-COMPATIBILITY-PLAN.md`: the whole port is unstarted; that doc is the reference for it.

Chat panes (the package's `docs/rea-findings.md` has the evidence for each):
- **In progress (another agent, 2026-10-21):** Fast mode as one line with no description; output-style rows with an arrow chip, a hover preview that edits the style as Markdown, and a click that opens it in a pane.
- **Framework pass recommendations** (rea-findings *Pass 3*, each a design call): a session id before the first message (needs a resume fallback first); deleting, archiving, tagging and searching sessions for both providers; rewinding a conversation in place (Claude `resumeSessionAt`, Codex `thread/revert`); a resumed session's subagent steps; a live MCP panel with MCP forms and sign-in; a Claude `/status` card and Codex account and hook-trust status; agents and Codex skills in the composer menus; Codex's Auto-mode review state.
- **Markdown:** the explanatory output style's insight frame (`★ Insight`) still draws as plain code and a rule.
- **Claude dialogs:** the refusal card's first-time safeguard copy is not reproduced.
