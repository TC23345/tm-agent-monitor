# Sidebar companion — a pixel character at the foot of the sidebar

> Written 2026-09-21 against 0.4.12. Goal: a small animated pixel-art character
> in the empty space under the Agents list (the blue box in the request's
> screenshot), in the spirit of the Codex desktop app's **Pets**, with three
> launch characters drawn from the hooded-robe / cracked-mask / glowing-coin
> references. Effort: **S** ≈ ½–1 day · **M** ≈ 2–4 days.
> [V] = verified in a source or in this repo this session; [I] = inferred.

## What the reference actually is

- [V] The `>_` blue blob is a **Codex Pet**: an animated companion in the
  Codex/ChatGPT desktop app (`/pet`, Settings → Appearance → Pets; custom pets
  via `/hatch`, the `hatch-pet` skill). Windows 26.908 (2026-09-11) added the
  floating Pets controls. <https://learn.chatgpt.com/docs/changelog>
- [V] A pet is **one sprite atlas plus a manifest**, not Lottie/Rive/SVG:
  `spritesheet.webp` (or PNG) at **1536×1872**, an **8×9 grid of 192×208
  cells**, unused cells fully transparent, next to `pet.json`
  (`id`, `displayName`, `description`, `spritesheetPath`) in
  `~/.codex/pets/<name>/`. Source of truth:
  <https://github.com/openai/skills/blob/main/skills/.curated/hatch-pet/SKILL.md>
- [V] Rows are states with **per-frame timings** (`references/animation-rows.md`
  in that skill), so playback is JS-driven, not a uniform CSS `steps()`:

  | Row | State | Frames | Timing (ms) |
  |---|---|---|---|
  | 0 | idle | 6 | 280, 110, 110, 140, 140, 320 |
  | 1 | running-right | 8 | 120 ×7, 220 |
  | 2 | running-left | 8 | 120 ×7, 220 |
  | 3 | waving | 4 | 140 ×3, 280 |
  | 4 | jumping | 5 | 140 ×4, 280 |
  | 5 | failed | 8 | 140 ×7, 240 |
  | 6 | waiting | 6 | 150 ×5, 260 |
  | 7 | running (task work) | 6 | 120 ×5, 220 |
  | 8 | review | 6 | 150 ×5, 280 |

- [V] Codex draws it as a CSS background (`background-size: 800% 900%`,
  `image-rendering: pixelated`) at ~113×122 CSS px — a **non-integer**
  downscale of the 192×208 cell, which is exactly what makes custom pets
  jagged (openai/codex#20808). We must not copy that.
- [V] Claude Code's `/buddy` (April 2026) is the ASCII cousin: 5×12-character
  sprites, 3 frames, species hashed from the account id. Not a format to adopt.

## Decisions

1. **Adopt the Codex Pet atlas as our on-disk format.** Same grid, same rows,
   same `pet.json`. We get a documented spec with timings for free, our three
   characters can also be installed into Codex (`~/.codex/pets/`), and a pet
   the user already hatched in Codex can be shown here later (phase 4).
2. **Draw true pixel art at 48×52 and store it ×4.** Each 192×208 cell is a
   48×52 logical sprite upscaled 4× nearest-neighbour. That keeps Codex
   compatibility and gives us a real pixel grid to scale by integers.
3. **Render on a `<canvas>` at an integer device-pixel scale.** Pick
   `k = max(1, round(targetCss × devicePixelRatio / 48))`, draw the cell into a
   `48k × 52k` device-pixel canvas with `imageSmoothingEnabled = false`, and set
   CSS size `48k / dpr`. At 150% Windows scaling a 96-CSS-px target gives
   k = 3, so each art pixel is exactly 3 device pixels. Re-fit on `resize`,
   which also fires on DPR change. This is the #20808 bug avoided on purpose.
4. **Event-driven, never ambient.** The 0.4.9 rule stands (no always-on
   motion; memory `claude-watch-no-ambient-effects`). The character **rests on
   a still frame**. It plays a row **once** when something happens, then goes
   back to its still frame. Zero timers while resting. The idle row plays only
   on hover. Reduced motion shows the still frames only.
5. **Original characters, not the franchise ones.** The references are a
   hooded Yoshi, a hooded Eevee and a Shy Guy, which are Nintendo / Pokémon
   Company IP. This app ships public installers through GitHub releases, so
   we keep the *look* (black robe, purple + teal trim, a cracked white mask
   charm, the glowing coin) and design original bodies (below). The coin keeps
   the three-bar Solana face from the references. It is a single layer, so
   swapping it for the app mark is one edit if we ever want that.
6. **Renderer-only.** No IPC and no main-process setting: main never needs
   the value, same as `tm.field.v1`. Persistence is `tm.companion.v1` in
   localStorage.

## How it behaves

The character is a readout of **root sessions**, fed from the same pure
helpers as the chip and Ctrl+Shift+W (`waitingAgents`, `nextWaiting` in
`src/shared/attention.mjs`), so it can never disagree with them.

| Moment (edge, not level) | One-shot row | Rests on |
|---|---|---|
| Nothing live / all idle | none | idle frame 0 |
| 0 → ≥1 running | 7 running (task work) | row 7, frame 0 (work pose) |
| A root turn completes (running → complete) | 4 jumping | idle 0, or the work pose if others still run |
| 0 → ≥1 waiting | 3 waving | row 6, frame 0, plus a red `!` bubble |
| Compaction (`ActivityEvent.kind === 'compacted'`) | 8 review | previous rest |
| Hover | 0 idle, loops only while hovered | previous rest |
| Click, something waiting | none; focuses the next waiting session (`routeToWaiting`) | none |
| Click, nothing waiting | 3 waving | previous rest |

- **Bubble.** While anything waits, a small static bubble over the
  character shows the first waiting session's `question`, or "needs
  permission", truncated to two lines. Red is `--st-question` only, keeping
  the colour rule. This is the one piece of information the character adds,
  and it earns the space.
- **Tooltip.** Summarises the state, e.g. "2 working · 1 waiting on you".
- Rows 1, 2 and 5 (running left/right, failed) are drawn for Codex
  compatibility. We use none of them in v1: there is no failure state in
  `AgentState`, and walking across the sidebar would be ambient.
- Edges come from diffing the previous and next agent lists, the same shape as
  `attentionTransition` / `trackFlares`. A burst of edges in one snapshot
  plays only the highest-priority cue: waiting > complete > started >
  compacted.

## Architecture

```text
snap.agents + recentEvents ─▶ companionCue(prev, next)  (pure, tested)
                                  │  {row, then: restRow/restFrame}
                                  ▼
                        Companion.tsx  ── canvas, one setTimeout chain per one-shot
                                  ▲
         assets/companions/<id>/{spritesheet.webp, pet.json}  (Vite imports)
```

- **`src/shared/companion.mjs` + `.d.mts` + `companion.test.mjs`** (pure):
  - `PET_ROWS`: the table above, as data;
  - `companionRest(agents)`: which still frame to show;
  - `companionCue(prev, next, events)`: the one-shot row or null, with priority;
  - `deviceScale(targetCss, dpr, logicalW)`: the integer `k`;
  - `cellRect(row, frame)`: source rectangle in the atlas;
  - `parsePetManifest(json)`: validates `pet.json`, drops anything malformed.
- **`src/renderer/src/Companion.tsx`**:
  - loads the atlas once as an `ImageBitmap`;
  - a one-shot is a `setTimeout` chain over the row's timings and ends on the
    rest frame;
  - redraws only on cue, hover, DPR/resize or character change;
  - parks when `document.hidden` or when the workspace phase is `exit`;
  - `data-state="rest|playing|hover"` on the root, testid `tid('companion', id)`.
- **Placement** (`App.tsx`, `<aside className="sidebar">`): a `<footer
  className="sidebar-companion">` after `activeViews.map(sideSection)`. The
  Agents section is already `sideview--fill`, so the footer takes the space it
  leaves. When Agents is collapsed, `margin-top: auto` keeps the footer
  pinned to the bottom.
- **Never crowd the list.** `.sidebar { container-type: size }` plus
  `@container (max-height: 560px) { .sidebar-companion { display: none } }`.
  This is pure CSS: no `ResizeObserver`, no content-driven sizing. The aside's
  height comes from the frame, so a size container is safe. Check that the
  `.sideview--fill` `min-height: 120px` still holds with the footer present.
- **Toggle and picker.**
  - Layout popover: *Companion* check item plus the three characters.
  - Palette: `cmd:companion` (on/off) and `cmd:companion:<id>`. Add `companion` to
    the Layout regex in `commandGroup` (`src/shared/palette.mjs:92`, today
    `…|field$`) plus a test case, or both commands land under "Other".
  - `tm.companion.v1 = { on: true, id: 'gulp' }`, parsed by a sanitizer in
    `companion.mjs`, defaulting to on.
- **Assets:** `src/renderer/src/assets/companions/<id>/spritesheet.webp` +
  `pet.json`. Vite fingerprints them, and each is about 20–60 KB of lossless
  WebP, since flat blocks compress well. Sources live in
  `art/companions/<id>/<id>.aseprite` (tracked) and `<id>.png` + `<id>.json`
  (Aseprite export, tracked).
- **`scripts/build-companions.mjs`** (offline and deterministic, like
  `build-icon.mjs`). It reads each Aseprite export (48×52 cells, tags named
  after the rows) and validates it:
  - frame counts per tag match `PET_ROWS`;
  - palette ≤ 16 colours;
  - no semi-transparent pixels;
  - unused cells empty.

  It then writes the ×4 atlas and `pet.json`. `--codex` also copies the
  result into `~/.codex/pets/<id>/`. Wire it as `npm run companions`.

## The three launch characters

A shared costume makes the three characters read as one set. Each keeps
exactly one body silhouette, borrowed loosely from its reference.

**Shared palette (lock this in Aseprite; ≤16 colours per character):**

- outline `#0b0a10`;
- robe `#15131c` / `#252131` / `#35304a`;
- purple trim `#7c4dff` / `#a98bff`;
- teal trim `#22c7b0` / `#7ff0de`;
- mask `#efe6cf` / `#bfb293`, crack `#5b5140`;
- coin `#a98bff` → `#7ff0de` with a white glint `#ffffff`.

| | **Gulp** (from the dino reference) | **Vesper** (from the fox-kit reference) | **Hush** (from the masked-wanderer reference) |
|---|---|---|---|
| Body | round green lizard, big rounded snout, stubby tail with a teal tip, one small horn poking through the hood | brown fox-kit, tall ears through hood slits with dark tips, cream-tipped brush tail | no visible body: a peaked purple hood over a cream mask, short cape, glove hands |
| Own colours | `#3fae4a` `#2a7d33` belly `#f4f1e6`, tongue `#e46a86` | `#b0703a` `#7a4a24` cream `#f1dcb4` | hood `#6b3fa0` `#8f63c9`, glove `#5a3a2a` |
| Mask charm | cracked mask on the belt | cracked mask on the shoulder strap | the mask *is* the face: two tall oval eyes and a small "o" mouth, a crack over one eye |
| Signature one-shot | **jumping** = tongue snaps out and snags the coin (turn complete) | **jumping** = pounce onto the coin, tail flick | **jumping** = coin tossed up and caught, glow flares |
| Waiting (`!`) | stares at the viewer, tongue half out | ears up, head tilt | mask tilts, coin held up to "show" you |
| Work pose (row 7) | hunched over the coin, tapping it | paw on the coin, tail curled | coin floating above the palm, faint teal wisps (2 px) |

## Making the art: the pipeline

General image models (GPT-image, Midjourney, Gemini) give "pixel-*style*"
pictures: an off-grid layout, 200+ colours, and frames that don't match. They
are fine for concept work and never shippable as-is [V: freegamesprites.com
2026 survey]. So:

1. **Concept, one still per character (hi-res).** Use GPT-image or
   Nano Banana with the three reference images as *style* reference. Prompt
   skeleton:

   > Original chibi mascot, full body, facing three-quarter left, black
   > hooded robe with purple and teal glowing trim, cracked white mask charm
   > on the belt, holding a glowing purple-to-teal coin, dark background,
   > clean outline. Character: [Gulp / Vesper / Hush description from the
   > table]. Not Yoshi, not Eevee, not Shy Guy.

   Pick one still per character. It is the reference for everything after.
2. **Base sprite at 48×52.**
   - **PixelLab** is the primary tool. It produces true grid-aligned output,
     takes a reference image for consistency, and has skeleton- or
     text-prompted animation. It also has an API and MCP if we want to script
     it later. <https://www.pixellab.ai/>
   - **Retro Diffusion** is the fallback for the base pose (palette-limited,
     trained on licensed pixel art). <https://retrodiffusion.ai/>
3. **Snap and quantise.**
   - Run every generated frame through **Pixel Snapper** with the locked
     palette: `--palette` with the hex list above.
     <https://github.com/Hugo-Dz/spritefusion-pixel-snapper>
   - Use `proper-pixel-art` if a model output lost its true resolution.
4. **Finish by hand in Aseprite** (LibreSprite works too).
   - One layer for the coin, so its face can change.
   - Tags `idle`, `running-right`, `running-left`, `waving`, `jumping`,
     `failed`, `waiting`, `running`, `review`, with the frame counts and
     durations from the table.
   - Derive most frames from the rest pose: 1–2 px shifts, a blink, trim
     glints. This is how Codex's own pets move, and it keeps the three
     characters consistent.
5. **Export and build:**
   `aseprite -b <id>.aseprite --sheet-type rows --list-tags --format json-array --sheet <id>.png --data <id>.json`,
   then `npm run companions`. The build validates and emits the atlas.
6. **Shortcut for unblocking code early (throwaway).** Run `/hatch` in the
   Codex app with one reference image. It writes a Codex-format atlas to
   `~/.codex/pets/`, which is enough to build and test `Companion.tsx`
   against while the real art is made. Don't ship it: it is image-model
   output at 192×208, not a 48×52 grid.

## Work order

| Step | What | Effort | Gate |
|---|---|---|---|
| 1 | `companion.mjs` + tests (rows, rest, cue priority, `deviceScale`, manifest, prefs sanitizer) | S | `npm test` |
| 2 | `Companion.tsx` + footer + container query, running on a `/hatch` placeholder | S | electron-debug screenshots at 100% and 150% scaling: crisp edges, hidden under 560 px |
| 3 | Toggle and picker (Layout popover, palette, `tm.companion.v1`) | S | palette `>` browse shows the commands under Layout |
| 4 | Art: Gulp first (to prove the pipeline), then Vesper and Hush | M per character, the long pole | `npm run companions` validates, contact sheet reviewed |
| 5 | `scripts/build-companions.mjs` + `--codex` install | S | installs and animates in the Codex Pets overlay |
| 6 | (later) import any pet from `~/.codex/pets/` through a validated `pets:list` IPC, drawn with smoothing on when its cell isn't a clean ×4 grid | S | follows the four-file IPC shape in the `electron` skill |

Each code step: `npm run typecheck && npm test && npm run build && git diff
--check`. Bump `package.json` so the version chip moves, add a CHANGELOG line,
and add a CLAUDE.md architecture bullet (the companion is on-demand only,
rests on a still frame, uses integer device-pixel scaling, and the atlas is
the Codex Pet format).

**Done means:**

- no timer runs while the character is resting (a performance trace with
  nothing happening shows no companion frames);
- art pixels are exact at 100%, 125% and 150% Windows scaling;
- the character is hidden rather than crowding the list on short screens;
- clicking it while a session waits lands on that session's pane.
