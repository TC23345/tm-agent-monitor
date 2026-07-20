# TaylorMade Agent Monitor — UX/UX Improvement Plans (for approval)

> Status (provider-neutral iteration): threshold alerts, per-session tokens,
> loading/offline states, nested indent rails, bulk collapse, settings,
> launch-at-login, auto-update, and provider-aware connection states are implemented.
> Remaining items below are backlog, not descriptions of current gaps.
>
> **Superseded:** window auto-sizing (§B) shipped and was then removed. The panel is
> now a fixed full-height left sidebar, so there is no dead gap to size away and no
> content-height IPC. Do not reimplement §B.
>
> Usage was also split: the top block is limit bars only (Claude and Codex separately)
> and token/spend detail moved to its own footer view.

Synthesized from three parallel design reviews (visual design · interaction/IA · feature/utility).
Effort: **S** ≈ ½–1 day · **M** ≈ 2–4 days · **L** ≈ 1 week+.

---

## A. Brand alignment (new — surfaced by the rebrand)
The TaylorMade design system is **near-black + off-white + a single sky-cyan accent**, Geist Mono
for interface text, sharp corners (radius 0), 1px hairlines, "reads like a terminal." The app
currently uses an **orange** accent, Segoe UI, rounded corners + shadows. Decide how far to align:
- **A1 — Accent → brand sky-cyan** (replace `--accent #d97757`). Makes the cyan wordmark cohesive. **S**
- **A2 — Interface font → Geist Mono** (headings/labels), Geist for body. **M**
- **A3 — Sharper, terminal-flat aesthetic** (reduce radius, lean on 1px hairlines, less shadow). **M**

## B. Window auto-sizing to content (consensus #1) — ~~shipped~~, then **superseded**
Originally: replace the fixed `height: 680` with content-driven sizing (ResizeObserver → IPC →
`setContentSize`). This shipped, then was removed when the panel became a fixed full-height left
sidebar — the sidebar has no dead gap to collapse, and the agents list absorbs overflow instead.

## C. Usage safety (high "saves your day" value; data already exists)
- **C1 — Threshold alerts** when the 5h/weekly window crosses warning→critical (edge-triggered notify
  + tray tint). Severity already arrives from the OAuth endpoint. **S**
- **C2 — Per-session token counts** on rows (`· 42K out`). `Agent.tokensOut` is plumbed end-to-end;
  only the hook producer is missing. **S**
- **C3 — Usage sparkline/history** under each bar (needs a small persisted ring buffer). **M**

## D. Make it a real always-on app
- **D1 — In-app settings panel** (hotkey rebind, notifications on/off + per-event, mock toggle, admin-key
  status) backed by `userData/settings.json`. Replaces env-only config + the misleading gear. **L**
- **D2 — Launch at login** (`setLoginItemSettings`, start hidden). **S**
- ~~**D3 — Real auto-update**~~ — shipped. `electron-updater` reads `latest.yml` from GitHub
  Releases; see the publishing section in `README.md` for the release race that can silently
  omit that feed. Builds remain unsigned.

## E. Interaction & accessibility
- **E1 — Loading / empty / offline states** (stop showing "No active agents" before first data loads;
  render Usage during load; actionable offline card with an "Install hooks" button). **S**
- **E2 — Keyboard nav + Esc-to-close** (rows become focusable; ↑/↓ between rows, Enter = focus,
  Esc = hide; focus first waiting agent on summon). **M**
- **E3 — Discoverable row actions** (hover-revealed copy-path / open-folder / open-in-editor; `copyText`
  IPC already exists and is unused). Surfaces the hidden right-click. **S–M**
- **E4 — Custom dark tooltips** replacing native `title` (themed, instant, edge-aware). **M**
- **E5 — Collapse/expand bulk controls** + smarter defaults (auto-collapse complete/idle groups). **S–M**
- **E6 — Filter/sort** (All / Waiting / Running chips; order rows within a group by state). **M**

## F. Visual polish (cohesion, legibility, semantics)
- **F1 — Integer type scale** (kill the fuzzy 13.5/12.5px sizes; real hierarchy steps). **M**
- **F2 — Fix `--faint` contrast** (#6e665f ≈ 3:1 fails AA on reset/duration/label text). **S**
- **F3 — Color semantics** — pull the accent away from the amber warning; use **one** color for
  "needs input" (header chip + group dot + alert row currently disagree); give context-% its own
  ramp instead of reusing red/amber state colors. **S–M**
- **F4 — Icon consistency** (single stroke weight `2`, 3-step size ramp; replace `Sparkles` default
  running icon). **S**
- **F5 — 4px spacing grid + nested indent rail** (a 1px guide tying session rows to their project). **M**
- **F6 — List enter/exit motion** (150ms fade so live agents don't pop in/out jarringly). **M**

## G. Strategic (larger)
- **G1 — `entrypoint` per session** (cli/vscode/desktop glyph) — needs a quick spike to confirm
  `CLAUDE_CODE_ENTRYPOINT` is readable in the hook. **S–M**
- **G2 — Recent sessions/projects menu** (capture on SessionEnd before deletion; persisted). **M**
- **G3 — Multi-account** (org subscription window alongside personal; `fetchWindow` already accepts a
  token — blocker is acquiring the org/desktop token). **L**

---

### Consensus "do these first"
Recorded at review time. **B**, **C1**, **C2**, and **E1** have since been resolved (B by
superseding it with the fixed sidebar), leaving the visual-cohesion items as the live backlog:

1. ~~**B** window auto-sizing~~ · ~~**C1** threshold alerts~~ · ~~**C2** per-session tokens~~
2. ~~**E1** loading/empty/offline states~~
3. **F2 + F3** contrast + color semantics
4. **A1** brand cyan accent (cohesion with the new logo)
