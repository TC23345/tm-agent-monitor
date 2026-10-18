# TaylorMade Agent Monitor — UX/UX Improvement Plans (for approval)

> **Status as of 2026-10-18 (v0.4.59): superseded.** Each item below is marked
> with what happened to it. The open ones (A1–A3, C3, E2's arrow keys, E4, E6's
> chips, F1, F6, G1, G3) moved to `docs/UPGRADE-PLAN.md` → **Open now**, which is
> the one live list. Current architecture is `CLAUDE.md`; release history is
> `CHANGELOG.md`.

> Earlier status (provider-neutral iteration): threshold alerts, per-session tokens,
> loading/offline states, nested indent rails, bulk collapse, settings,
> launch-at-login, auto-update, and provider-aware connection states are implemented.
>
> **Superseded:** window auto-sizing (§B) shipped and was then removed. The app
> became a full-screen workspace in 0.3.0 (sidebar plus a pane grid, sized to the
> display's work area, full or half), so there is no dead gap to size away and no
> content-height IPC. Do not reimplement §B.
>
> Usage was also split: the sidebar's Limits section is limit bars only (Claude and
> Codex separately), and token/spend detail is the Spend pane (with Insights and
> History as their own panes since 0.4.2).

Synthesized from three parallel design reviews (visual design · interaction/IA · feature/utility).
Effort: **S** ≈ ½–1 day · **M** ≈ 2–4 days · **L** ≈ 1 week+.

---

## A. Brand alignment (new — surfaced by the rebrand)
The TaylorMade design system is **near-black + off-white + a single sky-cyan accent**, Geist Mono
for interface text, sharp corners (radius 0), 1px hairlines, "reads like a terminal." The app
still uses an **orange** accent, Segoe UI, rounded corners + shadows (true as of 0.4.59). Decide how far to align:
- **A1 — Accent → brand sky-cyan** (replace `--accent #d97757`). Makes the cyan wordmark cohesive. **S** — *Open:* `--accent` is still `#d97757` (`styles.css`).
- **A2 — Interface font → Geist Mono** (headings/labels), Geist for body. **M** — *Open:* the body font is still `'Segoe UI', system-ui, …`; no Geist is loaded.
- **A3 — Sharper, terminal-flat aesthetic** (reduce radius, lean on 1px hairlines, less shadow). **M** — *Partly:* the clipboard picker went square-cornered in 0.4.42; the workspace keeps `--r-card: 12px` and `--r-row: 22px`.

## B. Window auto-sizing to content (consensus #1) — ~~shipped~~, then **superseded**
Originally: replace the fixed `height: 680` with content-driven sizing (ResizeObserver → IPC →
`setContentSize`). This shipped, then was removed when the window stopped tracking content —
first a fixed full-height sidebar, and since 0.3.0 a full-screen workspace whose scroll regions
absorb overflow. `CLAUDE.md` forbids content-driven window sizing.

## C. Usage safety (high "saves your day" value; data already exists)
- **C1 — Threshold alerts** when the 5h/weekly window crosses warning→critical (edge-triggered notify
  + tray tint). Severity already arrives from the OAuth endpoint. **S** — *Shipped:* edge-triggered
  notifications in `src/main/index.ts` (usage threshold alerts).
- **C2 — Per-session token counts** on rows (`· 42K out`). **S** — *Shipped:* `AgentRow.tsx` shows
  `tokensOut`.
- **C3 — Usage sparkline/history** under each bar (needs a small persisted ring buffer). **M** —
  *Open:* the ring exists (`userData/usage-history.json`, 90 samples) but only feeds
  `projectedLimitAt`, which draws the pace line and the pace streaks (0.4.8). No sparkline.

## D. Make it a real always-on app
- **D1 — In-app settings panel** (hotkey rebind, notifications on/off + per-event, mock toggle, admin-key
  status) backed by `userData/settings.json`. **L** — *Shipped:* `SettingsPanel.tsx`; recordable
  chords in Settings → Keyboard shortcuts (0.4.34); a seven-row main page with sub-pages (0.4.40).
- **D2 — Launch at login** (`setLoginItemSettings`, start hidden). **S** — *Shipped:* Start with
  Windows (Settings and the tray menu, `--hidden`).
- ~~**D3 — Real auto-update**~~ — shipped. `electron-updater` reads `latest.yml` from GitHub
  Releases; see the publishing section in `README.md` for the release race that can silently
  omit that feed. Builds remain unsigned.

## E. Interaction & accessibility
- **E1 — Loading / empty / offline states** (stop showing "No active agents" before first data loads;
  render Usage during load; actionable offline card with an "Install hooks" button). **S** —
  *Shipped:* the Agents empty state offers Install (0.4.4) or Repair (0.4.10) hooks.
- **E2 — Keyboard nav + Esc-to-close** (rows become focusable; ↑/↓ between rows, Enter = focus,
  Esc = hide; focus first waiting agent on summon). **M** — *Partly:* Escape hides the workspace
  (after menus, palette, dialogs and zoom), and Alt+J / Ctrl+Shift+W / the waiting chip go to the
  next waiting session. *Open:* ↑/↓ between agent rows; nothing focuses a waiting agent on summon.
- **E3 — Discoverable row actions** (hover-revealed copy-path / open-folder / open-in-editor). **S–M** —
  *Changed:* nothing is hover-revealed; the actions are the right-click menu (`AgentContextMenu`,
  redesigned in 0.4.16) and the palette's per-agent items (*terminal here*, *open folder*, *open in
  Cursor*, *copy path*). `copyText` is used now (those items, the pane path).
- **E4 — Custom dark tooltips** replacing native `title` (themed, instant, edge-aware). **M** —
  *Open:* tooltips are still native `title` attributes.
- **E5 — Collapse/expand bulk controls** + smarter defaults (auto-collapse complete/idle groups). **S–M** —
  *Shipped:* collapse-all in the Agents section header. Auto-collapse of idle groups was not built (inferred).
- **E6 — Filter/sort** (All / Waiting / Running chips; order rows within a group by state). **M** —
  *Partly:* rows are state-sorted and there is a waiting-only filter (Agents header tool, Shift-click
  on the waiting chip). *Open:* All / Waiting / Running chips.

## F. Visual polish (cohesion, legibility, semantics)
- **F1 — Integer type scale** (kill the fuzzy 13.5/12.5px sizes; real hierarchy steps). **M** —
  *Open:* `styles.css` still has dozens of fractional `font-size` values (12.5px, 10.5px, 11.5px …).
- **F2 — Fix `--faint` contrast** (#6e665f ≈ 3:1 fails AA on reset/duration/label text). **S** —
  *Done* in commit `2919480` (2026-06-28, the v0.1.x rebrand): `--faint` went from `#6e665f` to
  `#897f76`. Inferred from the WCAG formula, not measured in the app: about 4.4:1 on
  `--card #1c1b20`, still just under AA's 4.5:1 for small text.
- **F3 — Color semantics** — pull the accent away from the amber warning; use **one** color for
  "needs input" (header chip + group dot + alert row currently disagree); give context-% its own
  ramp instead of reusing red/amber state colors. **S–M** — *Shipped* in 0.4.2 (`b53fad8`): red
  `--st-question` only for "needs you", amber `--st-permission` for warnings, the `--pressure` ramp
  for context and quota fill. The orange accent and the amber warning are still neighbouring hues
  (inferred; A1 would settle it).
- **F4 — Icon consistency** (single stroke weight `2`, 3-step size ramp; replace `Sparkles` default
  running icon). **S** — *Partly:* running and done are dots since 0.4.46, so `Sparkles` is no longer
  the running icon. Stroke weights are still mixed (1.5, 2, 2.5).
- **F5 — 4px spacing grid + nested indent rail** (a 1px guide tying session rows to their project). **M** —
  *Shipped:* the indent rail (`.group-rows` border, `.row--nested`). A 4px grid was not adopted as a
  system (inferred).
- **F6 — List enter/exit motion** (150ms fade so live agents don't pop in/out jarringly). **M** —
  *Open:* only the status dot pops in; rows have no enter/exit motion.

## G. Strategic (larger)
- **G1 — `entrypoint` per session** (cli/vscode/desktop glyph) — needs a quick spike to confirm
  `CLAUDE_CODE_ENTRYPOINT` is readable in the hook. **S–M** — *Open:* nothing reads it.
- **G2 — Recent sessions/projects menu** (capture on SessionEnd before deletion; persisted). **M** —
  *Changed:* recent projects are the sidebar's project badges (four-hour window, persisted in
  `tm.projects.v1`, 0.4.46); a session's *Recent questions ▸* flyout; and chat panes list the
  providers' own past sessions (0.4.58). No menu captured on SessionEnd.
- **G3 — Multi-account** (org subscription window alongside personal; `fetchWindow` already accepts a
  token — blocker is acquiring the org/desktop token). **L** — *Open.*

---

### Consensus "do these first"
Recorded at review time. All four groups are now resolved except A1:

1. ~~**B** window auto-sizing~~ · ~~**C1** threshold alerts~~ · ~~**C2** per-session tokens~~
2. ~~**E1** loading/empty/offline states~~
3. ~~**F2 + F3** contrast + color semantics~~ (F2 in `2919480`, F3 in 0.4.2)
4. **A1** brand cyan accent (cohesion with the new logo) — still open; see `UPGRADE-PLAN.md` → Open now
