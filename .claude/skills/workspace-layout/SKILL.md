---
name: workspace-layout
description: Use when changing how the claude-watch workspace window sizes, layers, summons, or hides, or how layout preferences persist — size modes (full/half), grid column counts, the status bar's Layout popover, sidebar sections and their heights, the pane grid, the clipboard picker window, hotkey/toggle semantics and in-app keys, or adding any new mutable setting. Also use when a request is phrased as behavior ("don't cover other windows", "let me see behind it", "half screen", "stay open when I click off", "remember my layout") rather than mechanism — translating those asks correctly is most of this skill.
---

# Workspace layout

How the claude-watch workspace window sizes, layers, and summons, and how
layout preferences persist. Grounded in the de-layer + size-mode + column work
shipped on main — read the actual changes when the prose here isn't enough:

```powershell
git show 4d592db   # De-layer the workspace and add a persisted size mode
git show f0218e9   # Workspace size and grid columns (then a View menu; the status bar's Layout popover since 0.4.2)
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
implementing; here the user explicitly rejected blur-hide. (The clipboard
picker is the opposite case — a popup that should vanish on blur; gotcha 17.)

## Gotchas

1. **Without always-on-top, "visible" splits into focused vs buried — and
   minimized.** Every toggle path must branch: front-and-focused → hide;
   visible-but-buried → `win.focus()` to raise, never hide. Otherwise the
   summon hotkey *hides* the buried window the user was trying to reach. The
   title bar's minimize (`window:minimize`) is a real minimize, which Windows
   still counts as visible, so `toggleWindowMode` and `showWindow` restore a
   minimized window first. See `toggleWindowMode` in `src/main/index.ts`.
2. **De-layering deletes a whole class of compensation code.** `stepAside()`
   and the `keepOpen` opt-out existed only because an always-on-top workspace
   covered whatever it launched; both are gone, and must stay gone. When you
   change layering, hunt down the compensations (they were spread across seven
   IPC routes) — leaving them makes launches hide a window that no longer needs
   to hide. The layering assumption is commented in `createWindow()` and above
   the `agent:focus` / `path:open` routes.
3. **Two tiers of mode state, deliberately separate.** `sizeModePref`
   (persisted setting: the default view and which side "half" means — right,
   unless the setting says left) vs `viewMode` (transient). The transient flip
   is the half-view chord (`halfHotkey`, Alt+Q by default, set in Settings →
   Keyboard shortcuts) and the tray's *Half view*, both calling
   `toggleWindowMode('half')` in main; there is no renderer IPC for it. The
   Layout popover's *Workspace size* radio reflects the *setting*, not the
   transient flip. Collapsing these into one variable makes a quick peek
   silently rewrite the user's configured default. See `applySizeMode` /
   `halfSide` in `src/main/index.ts`.
4. **Boot hydration order: capture pins beat persisted prefs.**
   `CLAUDE_WATCH_CAPTURE_HALF` boots straight into the half view for
   screenshots; the persisted `sizeMode` must not override it (the
   `!process.env.CLAUDE_WATCH_CAPTURE_HALF` guard where the `whenReady` block
   applies `settings.sizeMode`). Any new persisted view state needs the same
   guard or capture tooling breaks silently.
5. **`!important` media queries silently beat inline styles.** The old
   responsive column caps lived in CSS and would have clobbered any user-chosen
   column count. The fix: breakpoints moved into `colCap()`
   (`src/renderer/src/App.tsx`) and the grid computes
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
   every pair of columns *and rows* is separated by a `GRID_GUTTER` (10px)
   track the splitter occupies (`columnTemplate` builds either axis). That is
   why pane slots are placed explicitly (`gridColumn`/`gridRow`, both
   `index * 2 + 1`) rather than auto-flowing: an overlay handle would need
   measurement, and a grid gap plus a gutter would double the spacing. A
   splitter spans the other axis with an explicit end line (`1 / rows * 2`),
   since `-1` only reaches the end of the *explicit* grid. Do not switch to an
   absolutely-positioned overlay.
9. **Per-view sizes key off the viewport, not the setting.** Sizes live under
   `sizes.full` / `sizes.half` (`viewportBucket`). Keying them off the
   persisted `sizeMode` would be wrong the moment the half-view chord flips the
   transient `viewMode`, which never touches that setting (gotcha 3) — the
   renderer would save half-view splits over the full-view ones. Deriving the
   bucket from `innerWidth` vs `screen.availWidth` needs no new IPC and is
   right for both the setting and the flip. Hold every bucket in one state
   object and index into it; loading a bucket into its own state on change
   races the save effect.
10. **Every in-app key is one table: `src/shared/keymap.mjs`.** xterm stops
   propagation of keys it handles, so App registers its keydown listener in
   the capture phase and does `matchAppKey(eventChord(e), inTerminal)` — no
   hand-matched chords. Each key in `APP_KEYS` is marked `terminal: true`
   (fires even in a focused terminal pane: Alt+K/S/J/Z, Ctrl+Tab, Ctrl+1–6,
   Ctrl+Shift+P/`/W/←/→) or `terminal: false` (goes to the CLI there: Ctrl+K,
   Ctrl+P, Ctrl+B, Ctrl+,, F1). `terminalCollisions()` must stay empty — a test
   fails if a key that fires inside a terminal is in `RESERVED` (Claude Code's,
   Codex's, the prompt's readline keys, PSReadLine's). A new key goes into
   `APP_KEYS` and App's switch, nothing else; never bind Ctrl+W or Alt+W/P/O/T/V.
   Keys typed into a web pane never reach the renderer, so main sends the
   workspace ones back as `web:key`. Escape belongs to the CLI inside a
   terminal; elsewhere an open `[data-escape-close]` element (a `ContextMenu`,
   an inline rename, a drag ghost) gets a `tm-escape` event first, then the
   chain is the agent menu (`menu`) → the one title-bar / popover / badge menu
   (`openMenu`) → palette → session rename → layout dialog → new-project
   dialog → un-zoom → hide (never while Settings is open). Every new overlay must carry `data-escape-close` or slot into that
   chain, or Escape hides the workspace underneath it.
11. **Zoom hides, never unmounts.** A zoomed pane is the grid's only track and
   the others get `display: none`. Unmounting them would tear down each xterm
   and force a PTY reattach + scrollback replay on every toggle — correct, but
   visibly churny. The `TerminalPane` resize observer already ignores a
   zero-size host, so hidden panes refit on restore. Hiding the sidebar
   (Ctrl+B, or Alt+S, which also works inside a terminal; Layout popover →
   *Sidebar*) follows the same rule: `display: none`, remembered in
   `tm.sidebar.hidden.v1`.
12. **A resizable dimension needs a way home.** A dragged sidebar, column, row
   or sidebar section can end up unusable on a display the user no longer has.
   Every splitter resets on double-click (and `Home`), plus Layout popover →
   *Reset pane sizes* (which clears both buckets); the sidebar stores `null`
   rather than a number while undragged, so an untouched sidebar keeps
   following `defaultSidebarWidth` instead of freezing today's default.
13. **Persistence split rule.** Does main need the value before the renderer
   exists (window geometry, boot view, the picker's size)? → settings.json via
   the validated patch. Renderer-only presentation? → its own `tm.*`
   localStorage key: `tm.panes.v3` (pane instances), `tm.sidebar.v3` (sections),
   `tm.sidebar.collapsed.v1`, `tm.sidebar.sections.v1` (section heights),
   `tm.sidebar.hidden.v1`, `tm.stream.v1` (activity stream height),
   `tm.layouts.v1` (saved layouts), `tm.launch.v2`. `tm.layout.v1` holds every
   size (columns, sidebar width, per-column-count fractions, per bucket) behind
   one read/merge/write pair in `panes.ts` — add sizes there rather than
   minting a key each time, and never let a writer clobber a sibling's field.
   Parsing of every key lives in `src/shared/panes.mjs` (tested). The capture
   hook seeds the *legacy* `tm.panes.v2` / `tm.sidebar.v2` keys (they migrate on
   a fresh profile) and `tm.layout.v1` via `CLAUDE_WATCH_CAPTURE_LAYOUT`; keep
   those migrations working or update the hook with them.
14. **Settings that move the window should update renderer state
   optimistically.** The window re-bounds in the same beat as the IPC call;
   waiting for the round-trip makes the radio lag the visible change. Set local
   state first, reconcile from the returned settings view (`applySizeMode` in
   `App.tsx`), and follow main's `window:size-mode` push for changes main
   makes itself.
15. **An edge drag is a gesture, never a resize — and it cannot be the OS
   border.** A transparent frameless window has no resize border on Windows:
   `resizable: true` plus a `will-resize` listener never fired under a real
   mouse drag (probed 2026-09-15). The handle is the renderer's `EdgeGrip`
   strips (`.edge-grip`, 8px down each side of the card), which report one
   `window:edge-drag` (edge, delta) per pointer-down once the pointer has gone
   `EDGE_COMMIT_PX`; main's `commitEdgeDrag` then asks `edgeDragTarget`
   (`src/shared/edgeDrag.mjs`) whether that flips the size mode (left half →
   full, full → the half on the far side). The flip goes through
   `applySizeMode`, persists, and is pushed as `window:size-mode` so the
   Layout chip follows — because the geometry the user sees must be the
   setting (gotcha 3 still holds: the half-view chord's transient flip is a
   different path). The effective mode fed to the helper is
   `viewMode === 'half' ? halfSide() : 'full'`, not the pref, or a peek at the
   half view would misread the drag.
16. **Sidebar sections size like the stream, and the last one does not.** The
   Activity head (project badges over the stream) ends in a `splitter--stream`
   handle: `clampStreamHeight` (`src/shared/projectStrip.mjs`, `STREAM_DEFAULT`
   168, snaps to 0 under `STREAM_SNAP`). Every section with another beneath it
   gets the same handle (`splitter-section-<view>`): a drag pins its height
   inline and its body scrolls; `clampSectionHeight` (`layout.mjs`) folds it to
   its header under `SECTION_SNAP` through `sidebarCollapsed` and leaves
   `SECTION_RESERVE`; double-click drops the pin so the stylesheet sizes it
   again. The last section (Agents, when on) has no handle and ignores a stored
   height — sizing it would only leave empty space under it.
17. **The picker is the always-on-top exception — keep the rules apart.**
   `src/main/picker.ts` is a popup: `alwaysOnTop`, `skipTaskbar`, hidden on
   blur, placed at the cursor by `placePicker` (`src/shared/pickerPlace.mjs`,
   flipped near an edge, clamped to the display's `workArea`). Do not copy its
   layering to the workspace, nor the workspace's to it. It resizes by its own
   grips with main owning the geometry (`picker:resize` → `resizePickerBy` →
   `resizePicker`, clamped to `PICKER_MIN`); release stores the card in the
   mutable setting `pickerSize` (`{width, height} | null`, `sanitizePickerSize`;
   null = `PICKER_CARD`), and the picker's Settings → Window → *Reset to
   default* (`picker:reset-size`) sets it back to null.
18. **Panes are instances, and a kind is fixed for life.** `MAX_PANES` is 6.
   Data views (`agents`, `spend`, `insights`, `history`, `notes`, `clipboard`,
   `keys`) are unique; `terminal`, `web`, `file` and `chat` repeat
   (`isUniqueKind` in `panes.ts`), each carrying its config on the instance.
   Swapping a pane's kind would kill its shell or chat, so a different kind is a
   new pane. The agent list lives in one place: opening the Agents pane turns
   off the sidebar's Agents section and vice versa. Saved layouts
   (`src/renderer/src/layouts.ts`, Layout popover → *Saved layouts*) strip
   terminal `sessionId`s and chat `chatId`s and restore fresh pane ids;
   applying one disposes the open shells first.

## Checklist: adding a mutable setting

The full chain for `sizeMode` — every new setting walks the same eight stops,
and missing one fails at runtime, not typecheck (`pickerSize` and the chord
settings are recent examples):

1. `src/shared/types.ts` — add to `AppSettingsPatch` (optional) and
   `AppSettings` (required).
2. `validateMutableSettingsPatch` in `src/main/store.ts` — add the key to the
   `allowed` set **and** a value branch (enum membership / type check / a
   shared sanitizer); unknown keys reject the whole patch.
3. `src/main/index.ts` `interface Settings` — the on-disk shape.
4. A live mirror variable near the other prefs (`sizeModePref`).
5. Boot hydration in the `whenReady` block — validate the stored value, mind
   gotcha 4.
6. `settingsView()` — expose the current value.
7. The `settings:set` handler — apply the mirror, persist, and take the live
   side effect (`applySizeMode` repositions if visible; a chord re-runs
   `registerAllHotkeys`).
8. UI (a `MenuCheckItem` in the status bar's Layout popover, `StatusBar.tsx`,
   or an `.srow` in `SettingsPanel.tsx`) + a `store.test.mjs` case for
   valid/invalid values.

## Verifying layout changes

Typecheck passing says nothing about geometry. After the standard gates
(`npm run typecheck && npm test && npm run build && git diff --check`):

- Drive the built app with the electron-debug MCP tools against
  `npm run debug:app` first (see the `electron` skill): click through the
  Layout popover, read `get_page_structure`, take a screenshot.
- Screenshot each mode with the electron skill's `capture-window.mjs`
  (clear `ELECTRON_RUN_AS_NODE` first); `CLAUDE_WATCH_CAPTURE_HALF=1` boots the
  half view directly.
- A *resized* workspace screenshots without a real drag:
  `CLAUDE_WATCH_CAPTURE_LAYOUT='{"sizes":{"full":{"sidebar":460,"cols":{"3":[1.5,0.8,0.7]},"rows":{"2":[1.35,0.65]}}}}'`
  seeds `tm.layout.v1` before the capture reload. Pair it with
  `CLAUDE_WATCH_CAPTURE_VIEW=limits,terminal,terminal,terminal`; the hook takes
  the sections `limits` and `agents` and the pane kinds that open with no
  config (`terminal`, `spend`, `insights`, `history`, `notes`, `clipboard`,
  `keys`), so for web, file and chat panes drive the app instead.
  `CLAUDE_WATCH_CAPTURE_COLLAPSED=limits` rolls a section back up (captures
  expand them by default).
- Screenshots cannot prove a *drag* works. Drive real input at the built app
  instead: `webContents.sendInputEvent` with `mouseDown`, a run of `mouseMove`
  carrying `modifiers: ['leftbuttondown']`, then `mouseUp`, and read back the
  computed `grid-template-columns`/`-rows` and `tm.layout.v1`. Without the held
  modifier the synthetic moves arrive as hover (`buttons: 0`), Chromium drops
  the pointer capture, and a working splitter looks broken.
- To feel a change in the *installed* app without cutting a release: the
  status bar's Update chip (or File / Settings → *Rebuild & relaunch*,
  `app:reinstall` in `src/main/index.ts`) runs `npm install` and `npm run dist`
  in `CLAUDE_WATCH_REPO`, then a PowerShell waiter — created through WMI, not
  as a child, so it survives the app's exit — waits for exit, silently
  reinstalls, and relaunches. Packaged builds only.
- Manual checks that catch what screenshots can't: hotkey on a buried-but-
  visible workspace raises it (not hides); a minimized workspace comes back on
  the hotkey; a terminal launch leaves the workspace open behind the new
  window; the half-view flip does not change the Layout popover's radio.

## Maintaining this skill

Canonical copy: `.claude/skills/workspace-layout/` in the repo. Invocable
copy: `~/.claude/skills/workspace-layout/`. After editing the repo copy:

```bash
cp -r .claude/skills/workspace-layout/. ~/.claude/skills/workspace-layout/
```

References above are function and file names, not line numbers — find them
with `git grep -n <name>`.
