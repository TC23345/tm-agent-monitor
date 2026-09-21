# Sidebar companion — a painted character at the foot of the sidebar

> Written 2026-09-21 against 0.4.12. Revised the same day: the characters
> stay **high-fidelity painted stills from GPT-image**, animated as short
> image-to-video clips, instead of the first draft's pixel-art route
> (see *Routes not taken*). Goal: a small animated character in the empty
> space under the Agents list, in the spirit of the Codex desktop app's
> **Pets**, with three launch characters from the hooded-robe /
> cracked-mask / glowing-coin concepts.
> Effort: **S** ≈ ½–1 day · **M** ≈ 2–4 days.
> [V] = verified in a source or on this machine this session; [I] = inferred.

## Decisions

1. **One master still per character, and every clip starts and ends on it.**
   Several image-to-video models accept a **first and a last frame**. Passing
   the same rest still as both gives a clip that leaves the pose, acts, and
   lands back on it, so the swap back to the still is invisible.
   - Kling 3.0 Pro: `image` + `end_image` [V]
   - Seedance 2.0: `first_frame_url` / `last_frame_url` [V]
   - Veo 3.1: `lastFrame` [V]
   - MiniMax Hailuo: `last_image_url` [V]
   - Luma Ray 2: `keyframes` + `loop` [V]
   - Wan 2.2 FLF2V, open weights [V]

   Runway Gen-4 and Sora 2 take only a first frame, so they're out [V].
2. **Kling 3.0 Pro is the default generator; Wan 2.2 FLF2V is the fallback.**
   - Kling: strong character consistency, API through fal/Segmind, about
     $0.42 per 5 s [V].
   - Wan 2.2 FLF2V: local ComfyUI, free, unlimited retries [V].
   - Seedance 2.0 is the second opinion if Kling drifts the face.
3. **Transparency comes from matting, not from the model.** No commercial
   image-to-video model outputs alpha today [I: none found]. Wan-Alpha
   outputs RGBA video but has no image-to-video weights yet [V]; revisit
   when it does.
   - Generate on a **flat mid-grey plate (`#7f7f7f`)**. Green screen would
     eat Gulp, and black would eat the robes.
   - Matte with **MatAnyone 2** [V].
   - Recover clean edge and glow colour with foreground estimation
     (`pymatting.estimate_foreground_ml`) [I].
   - We need real alpha because the app card is translucent under the
     default Mica material (`rgba(28,27,32,0.78)`, `styles.css:1768`) [V].
     A clip baked onto a solid colour would show as a box.
4. **Ship VP9 WebM with alpha.** Chromium decodes it [V], and the CSP's
   `default-src 'self'` already admits a bundled media file [V].
   - Encoded on this machine with
     `ffmpeg -framerate 24 -i f_%04d.png -c:v libvpx-vp9 -pix_fmt yuva420p -b:v 0 -crf 30 -auto-alt-ref 0 -an clip.webm`
     [V]: a 2 s, 256 px test clip came to 12 KB, and its first frame
     decoded back as `rgba`.
   - Gotcha [V]: `ffprobe` reports such a file as `pix_fmt=yuv420p`. Alpha
     shows only as the stream tag `alpha_mode=1`, and it survives decode
     only through `-c:v libvpx-vp9`. The build check reads the tag.
5. **Event-driven, never ambient.** This is unchanged from the first
   draft, and it is the 0.4.9 rule (memory `claude-watch-no-ambient-effects`).
   - The sidebar shows the **still**. A clip plays **once** on an event, then
     hides; nothing loops, not even on hover.
   - No clip is decoded while resting.
   - Reduced motion shows the still only.
6. **Original characters.** The concept references are a hooded Yoshi, a
   hooded Eevee and a Shy Guy, which are Nintendo / Pokémon Company IP, and
   this app ships public installers. So the master stills are re-generated
   as the original designs below. They keep the shared costume and the coin
   (three-bar Solana face).
7. **Renderer-only.** No IPC and no main-process setting, like
   `tm.field.v1`. Persistence is `tm.companion.v1` in localStorage.

## How it behaves

The character reads **root sessions** through the same pure helpers as the
chip and Ctrl+Shift+W (`waitingAgents`, `nextWaiting` in
`src/shared/attention.mjs`), so it can never disagree with them.

| Moment (an edge, not a level) | Clip, played once | Afterwards |
|---|---|---|
| 0 → ≥1 running | `work` | still |
| A root turn completes (running → complete) | `celebrate` | still |
| 0 → ≥1 waiting | `alert` | still, plus a red bubble |
| Compaction (`ActivityEvent.kind === 'compacted'`) | `ponder` | still |
| Click, nothing waiting / first hover after 10 min | `wave` | still |
| Click, something waiting | none; focuses it (`routeToWaiting`, `App.tsx:554`) | — |

- **Bubble.** While anything waits, a small static bubble shows the first
  waiting session's `question`, or "needs permission", in two lines. Red is
  `--st-question` only, keeping the colour rule. It is the one piece of
  information the character adds.
- **Priority.** A burst of edges in one snapshot plays one clip, in this
  order: `alert` > `celebrate` > `work` > `ponder`.
- **No re-trigger.** A clip already playing is not restarted by the same
  edge.
- **Tooltip.** "2 working · 1 waiting on you".

## Architecture

```text
snap.agents + recentEvents ─▶ companionCue(prev, next, events)   (pure, tested)
                                   │ 'alert' | 'celebrate' | … | null
                                   ▼
Companion.tsx:  <img rest> + <video clip> stacked, video shown only while playing
                                   ▲
      assets/companions/<id>/{rest.webp, work.webm, celebrate.webm, alert.webm,
                              ponder.webm, wave.webm, companion.json}
```

- **`src/shared/companion.mjs` + `.d.mts` + `companion.test.mjs`** (pure):
  - `CLIPS`;
  - `companionCue(prev, next, events)`, with priority and no re-trigger;
  - `parseCompanionManifest(json)`, which drops malformed entries;
  - `sanitizeCompanionPrefs`: default `{ on: true, id: 'gulp' }`.
- **`src/renderer/src/Companion.tsx`**:
  - **The rest still is always rendered.** The `<video>` sits on top,
    muted, `playsInline`, and hidden by default.
  - **Loading:** clips `preload="auto"` for the current character only,
    lazy-imported, so the other two cost nothing.
  - **Playing a cue:** `currentTime = 0` → `play()` → reveal on the first
    `requestVideoFrameCallback`, never before, so there is no blank frame.
  - **Ending:** on `ended`, hide the video. Its last frame *is* the still,
    so the swap doesn't show.
  - **Parking:** pause and hide on `document.hidden` and on the window's
    `exit` phase.
  - **Size:** a CSS box of about 112–128 px. Painted art scales smoothly,
    so the pixel route's integer-scaling rules no longer apply.
  - **Hooks for automation:** `data-state="rest|playing"` and
    `tid('companion', id)`.
- **Placement** (`App.tsx`, `<aside className="sidebar">`, around line 1099):
  - A `<footer className="sidebar-companion">` goes after
    `activeViews.map(sideSection)`.
  - Agents is `sideview--fill`, so the footer takes the space it leaves.
    `margin-top: auto` pins it when Agents is collapsed.
  - **Never crowd the list:** `.sidebar { container-type: size }` +
    `@container (max-height: 560px) { .sidebar-companion { display: none } }`.
    That is pure CSS, with no `ResizeObserver`.
- **Toggle and picker.**
  - Layout popover: a *Companion* check item plus the three characters.
  - Palette: `cmd:companion` and `cmd:companion:<id>`. Add `companion` to
    the Layout regex in `commandGroup` (`src/shared/palette.mjs:92`, today
    `…|field$`) with a test case, or both commands land under "Other".
- **Assets and budget.**
  - Per clip: 256×256, 24 fps, 2–3 s, **≤ 400 KB**; per rest still:
    ≤ 60 KB WebP.
  - Five clips × three characters is about 3–5 MB in the installer, of which
    one character (~1–1.5 MB) is ever loaded. Vite fingerprints them.

## The three launch characters

Shared costume, so the set reads as one:
- black hooded robe;
- purple `#7c4dff` / `#a98bff` and teal `#22c7b0` / `#7ff0de` trim glow;
- cracked cream mask charm (`#efe6cf`);
- a glowing purple-to-teal coin with a white glint.

Each character keeps one body silhouette borrowed loosely from its concept.

| | **Gulp** (dino concept) | **Vesper** (fox-kit concept) | **Hush** (masked-wanderer concept) |
|---|---|---|---|
| Body | round green lizard, big rounded snout, stubby teal-tipped tail, one small horn through the hood | brown fox-kit, tall dark-tipped ears through hood slits, cream-tipped brush tail | peaked purple hood over a cream mask, short cape, leather gloves; no visible body |
| Mask charm | on the belt | on the shoulder strap | the mask *is* the face: two tall oval eyes, small "o" mouth, a crack over one eye |
| `celebrate` | tongue snaps out, snags the coin, reels it back | pounces on the coin, tail flick, sits back | tosses the coin, catches it, glow flares |
| `alert` | looks straight at you, tongue half out, blinks | ears up, head tilt toward you | mask tilts, coin raised to show you |
| `work` | hunched over the coin, taps it with a claw | paw on the coin, tail curls and uncurls | coin floats above the palm, teal wisps |
| `ponder` | eyes roll up, tail thumps once | scratches behind an ear | hood droops, hand to chin |
| `wave` | small wave, grin | paw wave, ear flick | slow gloved wave |

## Making the art: the pipeline

1. **Master still (GPT-image, per character).**
   - Setup: full body, centred, three-quarter view facing left, the whole
     silhouette inside the frame with ~15% margin, feet on an implied floor,
     a **flat uniform mid-grey (#7f7f7f) background, no shadow, no
     vignette, no smoke**. Smoke and background glow are what matting
     can't separate. The coin's own glow stays.
   - Render at 1024×1024 and keep the seed/prompt in the manifest.
   - Prompt skeleton:
     > Original chibi mascot character, painted 3D-render look, soft rim
     > light. Black hooded robe with glowing purple and teal trim, a cracked
     > cream mask charm on the belt, holding a glowing purple-to-teal coin.
     > Full body, centred, three-quarter view facing left, flat plain
     > mid-grey #7f7f7f background, no shadow, no smoke. Character: [row
     > from the table]. Not Yoshi, not Eevee, not Shy Guy.
2. **Clips (Kling 3.0 Pro, image + end_image = the master still).**
   - 5 s generations at 720p, trimmed to 2–3 s. Prompt the action from the
     table plus a fixed suffix: *"static locked camera, no zoom, no camera
     move, plain grey background stays flat, character returns to the
     exact starting pose."*
   - Budget 3–4 tries per clip: about 15 clips × 3.5 × $0.42 ≈ **$20–25 for
     all three characters** [I from the $0.42 per 5 s price].
3. **Matte.**
   - MatAnyone 2 on each clip, with a SAM 2 first-frame mask as the prompt.
   - Then foreground estimation to de-grey the soft edges and the coin glow.
   - Run the **master still through the same pass**, so its edges match the
     clips' first and last frames exactly.
   - If the coin glow comes out dull, split it into its own additive layer
     (a second `<video>` with `mix-blend-mode: plus-lighter`). Don't do this
     by default.
4. **Seal the return.** Models drift a little in the last frames [I].
   Crossfade the final 6 frames into the matted master still, so the last
   frame *is* the still, pixel for pixel.
5. **Encode:** scale to 256×256, then run the VP9-alpha command from
   decision 4. The still becomes `rest.webp`, with alpha.
6. **Build:** `scripts/build-companions.mjs` (`npm run companions`) turns
   `art/companions/<id>/` into the assets.
   - **Inputs:** `master.png`, the raw clip MP4s, and `prompts.json`
     (prompts, seeds, model, cost).
   - **Steps 3–5** run through a uv Python script, `scripts/companions/matte.py`.
     It needs a GPU and is optional: the committed outputs are the product.
   - **Validation:**
     - `alpha_mode=1`;
     - 256×256;
     - duration ≤ 3.5 s;
     - size budget;
     - first and last frames within a small mean-difference tolerance of
       `rest.webp`.
   - **Writes:** `companion.json`.
   - **Git:** raw MP4s are git-ignored (regenerable from `prompts.json`);
     the master still and the outputs are tracked.

## Work order

| Step | What | Effort | Gate |
|---|---|---|---|
| 1 | Gulp's master still + one `celebrate` clip through the whole pipeline. This proves matting quality over the Mica card before any code depends on it. | S | clip composited over a screenshot of the real sidebar looks clean, with no grey halo and a readable coin glow |
| 2 | `companion.mjs` + tests (cues, priority, no re-trigger, manifest, prefs) | S | `npm test` |
| 3 | `Companion.tsx` + footer + container query | S | electron-debug: `data-state` flips to `playing` on a mock waiting edge and back to `rest`; hidden under 560 px |
| 4 | Toggle and picker (Layout popover, palette, `tm.companion.v1`) | S | palette `>` browse shows the commands under Layout |
| 5 | Remaining clips for Gulp, then Vesper and Hush | M per character, the long pole | `npm run companions` validates all 15 |
| 6 | `build-companions.mjs` + `matte.py` hardened for re-runs | S | re-running on committed inputs is byte-stable for the outputs |

Each code step: `npm run typecheck && npm test && npm run build && git diff
--check`. Bump `package.json` so the version chip moves, add a CHANGELOG line,
and add a CLAUDE.md architecture bullet (still-first and event-only, clips
start and end on the master still, alpha is VP9 WebM checked by the
`alpha_mode` tag).

**Done means:**
- a performance trace with nothing happening shows no video decode;
- every clip's last frame is indistinguishable from the still;
- the character hides rather than crowding the list on short screens;
- clicking it while a session waits lands on that session's pane.

## Routes not taken

- **Pixel-art sprite atlas** (the first draft of this plan: PixelLab +
  Aseprite, 48×52 cells in the Codex Pet atlas format). Superseded: the
  concepts are painted, and the pixel route discards that look.
  - What it had going for it: Codex compatibility (a Codex Pet is a
    1536×1872 atlas of 8×9 cells, 192×208 each, plus `pet.json` [V]) and a
    few-KB footprint.
  - A Codex export can still be made later by sampling frames from the
    clips into that atlas.
- **Real-time 2D rig (Rive, Live2D, Spine).**
  - Rive meshes and bones work on raster art and its state machine fits
    events [V].
  - But a flat painting must first be cut into occlusion-safe layers, and
    a mesh warp never turns a head or moves cloth, so it never reads as CGI
    [I].
  - Live2D is heavy manual rigging.
  - Revisit only if we want interaction the clips can't give, like eyes
    following the cursor.
- **Image-to-3D (Tripo, Meshy) + auto-rig.** Auto-rigging chibi quadrupeds
  works [V], but textures flatten and the face and glow drift from the
  painting, and robes and hoods weight badly. High effort, and further from
  the concept than video [I].

## Sources

Codex Pets spec:
<https://github.com/openai/skills/blob/main/skills/.curated/hatch-pet/SKILL.md>

Image-to-video models:
- <https://www.segmind.com/models/kling-3-pro-image2video>
- <https://kling.ai/quickstart/ai-video-start-end-frames>
- <https://renderful.ai/blog/kling-api-pricing>
- <https://openrouter.ai/bytedance/seedance-2.0>
- <https://openrouter.ai/google/veo-3.1>
- <https://platform.minimax.io/docs/guides/video-generation>
- <https://docs.lumalabs.ai/docs/video-generation>
- <https://blog.comfy.org/p/wan22-flf2v-comfyui-native-support>
- <https://github.com/WeChatCV/Wan-Alpha>

Matting:
- <https://github.com/pq-yang/MatAnyone2>
- <https://huggingface.co/briaai/RMBG-2.0> (non-commercial weights; not used)

Transparent video on the web:
<https://jakearchibald.com/2024/video-with-transparency/>

Rigging and 3D:
- <https://help.rive.app/editor/manipulating-shapes/meshes>
- <https://www.live2d.com/en/sdk/license/>
- <https://www.tripo3d.ai/features/ai-auto-rigging>
