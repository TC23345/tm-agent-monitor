---
name: workspace-layout
description: Use when changing how the claude-watch workspace window sizes, layers, summons, or hides, or how layout preferences persist — size modes (full/half), grid column counts, the View menu's layout pickers, hotkey/toggle semantics, or adding any new mutable setting. Also use when a request is phrased as behavior ("don't cover other windows", "let me see behind it", "half screen", "stay open when I click off", "remember my layout") rather than mechanism — translating those asks correctly is most of this skill.
---

# Workspace layout

How the claude-watch workspace window sizes, layers, and summons, and how
layout preferences persist. Grounded in the de-layer + size-mode + column work
shipped on main — read the actual changes when the prose here isn't enough:

```powershell
git show 4d592db   # De-layer the workspace and add a persisted size mode
git show f0218e9   # View menu picks workspace size and grid columns
git show e2f0966   # Add Rebuild & relaunch from source in Settings
git log -1 --stat -- src/shared/layout.mjs   # draggable sidebar + column splitters
```

The `electron` skill owns the general window-shell mechanics (positioning,
show/hide animation, IPC validation shape). This skill owns what sits on top:
the layout model and the traps in changing it.

## Translating the ask (get this wrong and you build the wrong feature)

"It stays on top and I can't see/click other windows" sounds like a request for
**hide-on-blur**. It usually isn't. The shipped answer was **de-layering**:
remove `alwaysOnTop` so other windows can layer in front while the workspace
stays open behind them. Blur-hide dismisses the workspace the moment focus
moves — which kills side-by-side use entirely. Ask which the user wants before
implementing; here the user explicitly rejected blur-hide.

## Gotchas

1. **Without always-on-top, "visible" splits into focused vs buried.** Every
   toggle path must branch: front-and-focused → hide; visible-but-buried →
   `win.focus()` to raise, never hide. Otherwise the summon hotkey *hides* the
   buried window the user was trying to reach. See `toggleWindowMode`
   (`src/main/index.ts:300`).
2. **De-layering deletes a whole class of compensation code.** `stepAside()`
   and the `keepOpen` opt-out existed only because an always-on-top workspace
   covered whatever it launched. When you change layering, hunt down and remove
   the compensations (they were spread across seven IPC routes) — leaving them
   makes launches hide a window that no longer needs to hide. The layering
   assumption is now commented at the focus/launch routes (`src/main/index.ts:1117`).
3. **Two tiers of mode state, deliberately separate.** `sizeModePref`
   (persisted setting: the default view and which side "half" means — left,
   unless the setting says right) vs `viewMode` (transient, flipped by Alt+Q
   and the top-bar half control via the `window:half` IPC, never touching the
   setting). The View-menu radio reflects the *setting*, not the transient
   flip. Collapsing these into one variable makes a quick peek silently
   rewrite the user's configured default. See `applySizeMode`/`halfSide`
   (`src/main/index.ts:236-249`).
4. **Boot hydration order: capture pins beat persisted prefs.**
   `CLAUDE_WATCH_CAPTURE_HALF` boots straight into the half view for
   screenshots; the persisted `sizeMode` must not override it
   (`src/main/index.ts:1314`). Any new persisted view state needs the same
   guard or capture tooling breaks silently.
5. **`!important` media queries silently beat inline styles.** The old
   responsive column caps lived in CSS and would have clobbered any user-chosen
   column count. The fix: breakpoints moved into `colCap()`
   (`src/renderer/src/App.tsx:31`) and the grid computes
   `min(userChoice, paneCount, viewportCap)` so the choice and the narrow-window
   limit compose. The sidebar's `max-width: 1040px` rule went the same way when
   the width became draggable: an inline `flex-basis` from a drag is no match
   for a breakpoint, so the narrow default now lives in `defaultSidebarWidth`
   and the ceiling in `clampSidebarWidth`. Don't reintroduce geometry into
   media queries — the comment left where those blocks were says why.
6. **A `resize` listener is safe here — but only because bounds never track
   content.** The window resizes solely on size-mode switches and display
   changes, so re-running `colCap()` on `resize` fires rarely. Do not take this
   as license for content-driven sizing (see CLAUDE.md invariant).
7. **Splitters own no geometry.** The drag handle (`Splitter.tsx`) reports
   pixels moved since pointer-down; every decision about what that means lives
   in `src/shared/layout.mjs` as a pure function with a test. Two traps this
   avoids: accumulating deltas across a drag (capture the baseline once in
   `onStart` and stay delta-from-start, which is also what makes arrow keys
   work), and assuming the CSS box — drag start parses the *used*
   `grid-template-columns` (`trackWidths`) instead of hard-coding the grid's
   padding and gap, so styles.css can change without breaking the math.
8. **Grid splitters live in real gutter tracks.** Both grid gaps are 0 and
   every pair of columns *and rows* is separated by a `10px` track the splitter
   occupies (`columnTemplate` builds either axis). That is why pane slots are
   placed explicitly (`gridColumn`/`gridRow`, both `index * 2 + 1`) rather than
   auto-flowing: an overlay handle would need measurement, and a grid gap plus
   a gutter would double the spacing. A splitter spans the other axis with an
   explicit end line (`1 / rows * 2`), since `-1` only reaches the end of the
   *explicit* grid. Do not switch to an absolutely-positioned overlay.
9. **Per-view sizes key off the viewport, not the setting.** Sizes live under
   `sizes.full` / `sizes.half` (`viewportBucket`). Keying them off the
   persisted `sizeMode` would be wrong the moment Alt+Q flips the transient
   `viewMode`, which never touches that setting (gotcha 3) — the renderer would
   save half-view splits over the full-view ones. Deriving the bucket from
   `innerWidth` vs `screen.availWidth` needs no new IPC and is right for both
   the setting and the flip. Hold every bucket in one state object and index
   into it; loading a bucket into its own state on change races the save effect.
10. **Keyboard chords must be filtered by focus, and registered in capture.**
   xterm stops propagation of keys it handles, so a bubbling `window`
   listener never sees a chord typed into a terminal pane; register app
   shortcuts with `addEventListener('keydown', fn, true)`. Then filter by
   focus: inside `.termpane`, Escape and Ctrl+P belong to the shell, so only
   Ctrl+Shift chords (palette, new terminal) are taken; outside, Ctrl+P and
   Ctrl+, are fine. Escape resolves in a fixed order — context menu → menu →
   palette → dialog → un-zoom → hide — and every new overlay must slot into
   that chain or Escape hides the workspace underneath it.
11. **Zoom hides, never unmounts.** A zoomed pane is the grid's only track and
   the others get `display: none`. Unmounting them would tear down each xterm
   and force a PTY reattach + scrollback replay on every toggle — correct, but
   visibly churny. The `TerminalPane` resize observer already ignores a
   zero-size host, so hidden panes refit on restore.
12. **A resizable dimension needs a way home.** A dragged sidebar, column or
   row can end up unusable on a display the user no longer has. Every splitter
   resets on double-click (and `Home`), plus View > "Reset pane sizes" (which
   clears both buckets); the sidebar stores `null` rather than a number while
   undragged, so an untouched sidebar keeps following `defaultSidebarWidth`
   instead of freezing today's default.
13. **Persistence split rule.** Does main need the value before the renderer
   exists (window geometry, boot view)? → settings.json via the validated
   patch. Renderer-only presentation (columns, pane set, sidebar state)? →
   its own `tm.*` localStorage key. `tm.layout.v1` now holds every size
   (columns, sidebar width, per-column-count fractions) behind one
   read/merge/write pair in `panes.ts` — add sizes there rather than minting a
   key each time, and never let a writer clobber a sibling's field. Keys the
   capture hook seeds (`tm.panes.v2`, `tm.sidebar.v2`, `tm.layout.v1` via
   `CLAUDE_WATCH_CAPTURE_LAYOUT`) must keep their shape.
14. **Settings that move the window should update renderer state
   optimistically.** The window re-bounds in the same beat as the IPC call;
   waiting for the round-trip makes the radio lag the visible change. Set local
   state first, reconcile from the returned settings view
   (`src/renderer/src/App.tsx:99`).

## Checklist: adding a mutable setting

The full chain for `sizeMode` — every new setting walks the same eight stops,
and missing one fails at runtime, not typecheck:

1. `src/shared/types.ts` — add to `AppSettingsPatch` (optional) and
   `AppSettings` (required).
2. `src/main/store.ts:19` — add the key to the `allowed` set **and** a value
   branch (enum membership / type check); unknown keys reject the whole patch.
3. `src/main/index.ts` `interface Settings` — the on-disk shape.
4. A live mirror variable near the other prefs (`sizeModePref`).
5. Boot hydration in the `whenReady` block — validate the stored value, mind
   gotcha 4.
6. `settingsView()` — expose the current value.
7. The `settings:set` handler — apply the mirror, persist, and take the live
   side effect (`applySizeMode` repositions if visible).
8. UI (`MenuCheckItem` radio in the View menu, `TopBar.tsx:158-166`, or an
   `.srow` in SettingsPanel) + a `store.test.mjs` case for valid/invalid values.

## Verifying layout changes

Typecheck passing says nothing about geometry. After the standard gates
(`npm run typecheck && npm test && npm run build && git diff --check`):

- Screenshot each mode with the electron skill's `capture-window.mjs`
  (clear `ELECTRON_RUN_AS_NODE` first); `CLAUDE_WATCH_CAPTURE_HALF=1` boots the
  half view directly.
- A *resized* workspace screenshots without a real drag:
  `CLAUDE_WATCH_CAPTURE_LAYOUT='{"sizes":{"full":{"sidebar":460,"cols":{"3":[1.5,0.8,0.7]},"rows":{"2":[1.35,0.65]}}}}'`
  seeds `tm.layout.v1` before the capture reload. Pair it with
  `CLAUDE_WATCH_CAPTURE_VIEW=windows,limits,launcher,terminal,terminal,terminal`
  and `CLAUDE_WATCH_CAPTURE_COLLAPSED=windows` (which rolls sections back up —
  captures expand them by default).
- Screenshots cannot prove a *drag* works. Drive real input at the built app
  instead: `webContents.sendInputEvent` with `mouseDown`, a run of `mouseMove`
  carrying `modifiers: ['leftbuttondown']`, then `mouseUp`, and read back the
  computed `grid-template-columns`/`-rows` and `tm.layout.v1`. Without the held
  modifier the synthetic moves arrive as hover (`buttons: 0`), Chromium drops
  the pointer capture, and a working splitter looks broken.
- To feel a change in the *installed* app without cutting a release:
  Settings → "Rebuild & relaunch" (`app:reinstall`, `src/main/index.ts:1149`)
  builds `npm run dist` from `CLAUDE_WATCH_REPO`, then a detached PowerShell
  waits for exit, silently reinstalls, and relaunches. Packaged builds only.
- Manual checks that catch what screenshots can't: hotkey on a buried-but-
  visible workspace raises it (not hides); a terminal launch leaves the
  workspace open behind the new window; Alt+Q flip does not change the
  View-menu radio.

## Maintaining this skill

Canonical copy: `.claude/skills/workspace-layout/` in the repo. Invocable
copy: `~/.claude/skills/workspace-layout/`. After editing the repo copy:

```bash
cp -r .claude/skills/workspace-layout/. ~/.claude/skills/workspace-layout/
```

Line anchors above are against main at `3620ab0` (pre-splitters) — re-verify with
`git grep -n` after significant merges before trusting them.
