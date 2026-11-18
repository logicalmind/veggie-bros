# Veggie Bros. — Graphics Upgrade Plan (branch `feature/graphics-upgrade`)

## 0. Read this first (context discipline)

This file is the **whole contract**. It is self-contained on purpose.

- **NEVER read `WORKFLOW_STATE.md`** (131 KB, describes the *previous* feature) or `docs/REVIEW-2026-11-15.md` for this work. `RESUME.md` / `IMPLEMENTATION.md` are also out of scope.
- Read only: this file, the exact files your slice names, and the specific line ranges you are pointed at.
- `tools/verify.mjs` is 4528 lines — **grep for the id you need, read that range only.**
- Never run the full suite unless your brief says to; run `node tools/verify.mjs <YOUR IDS>`.
- Status/handoff lives in `GRAPHICS_STATE.md` (small). Only the integrator writes it; agents read at most its last 40 lines.
- **One subagent at a time** (integrator + one worker = 2 total). A second live worker is a rule violation, not a speedup: two slices at 1h42m and 1h58m have already died on `503 frontend_overloaded` and had to be rescued from truncated disk state.
- **Slices are cut small on purpose** (§9). A slice may touch **one file**, must be completable in ≤ ~150 new lines, and must need ≤ ~400 lines of reading. If your brief names more, say so and do the first file only.
- **Write incrementally so an abort leaves a loadable tree.** Append in dependency order and re-run `node --input-type=module --check` after every append; a partially finished module must still export whatever other modules import. `src/sprites.js` at 708 lines with zero exports is the cautionary tale — it parsed but broke `render.js`'s import chain and the whole suite.
- Report in ≤ 40 lines: what landed, the gate numbers, any signature drift. No narrative.

## 1. Locked decisions (user-confirmed 2026-11-17)

| # | Decision | Consequence |
| --- | --- | --- |
| G1 | **Zero dependencies, no build step, no asset files, no `package.json`** (existing lock stands) | All art is generated in code at boot and baked into offscreen canvases. Nothing loads over the network. |
| G2 | **Canvas 2D only** — no WebGL | Every "shader" (lighting, bloom, fog) is a small offscreen buffer + composite ops. |
| G3 | **HD-2D art direction** — high-bit pixel art + dynamic lighting, baked ambient occlusion, particles, impact FX, depth fog, bloom, squash-and-stretch | Replaces the "8-bit-inspired" look; `requirements.md` wording is amended in the same branch. |
| G4 | **Device-pixel-native backing store** | `canvas.width = cssW × min(devicePixelRatio, 3)`, capped by total-pixel ceiling; pixel-perfect via a two-pass upscale (see §4). |
| G5 | **Gameplay is frozen**: `TILE`, `ROWS`, `VIEW_W/H`, every physics/hitbox/score constant in `config.js`, the three level maps in `levels.js`, `main.js` state machine, `player.js`, `enemy.js`, `items.js`, `level.js`, `camera.js`, `input.js`, `audio.js` | Graphics layer reads state; it never writes it. Art scale ≠ physics scale. |
| G6 | **The 44-check suite stays green.** Draw-stream checks (`R38`, `R45`) are **rewritten to the new render contract, never deleted or loosened** | A check that can no longer see what it claimed to see is a bug in the check *and* a signal about the renderer. |
| G7 | **New perf + art-quality gates are added to the harness** (§8) | They fail red before the work and green after; that is the proof. |
| G8 | Docs updated in-branch: `architecture.md` (+Deviations), `requirements.md`, `README.md`, `VEGGIE_BROS_PLAN.md` locked decisions | Docs must describe shipped code, not intent. |

Explicitly out of scope: audio changes, new gameplay, new levels, save states, time limits, enemy/player behaviour, HUD *layout* (position/information unchanged — its rendering may be prettier).

## 2. Measured baseline (2026-11-17, headless WebKit, 256×240 canvas @2× CSS)

| Metric | Baseline | Target after §8 gates |
| --- | --- | --- |
| `fillRect` per frame | **1114** med / 1153 max (240 visible tiles × several `px()` each) | ≤ 60 (HUD + full-frame fills only) |
| `drawImage` per frame | 0 | ≤ 240 with FX at max |
| raw `fillRect` throughput | ~2500/ms → ~0.45 ms/frame of call cost | — |
| frame interval | 17.0 med / 20.0 p95 ms | ≤ 16.7 med / ≤ 20.0 p95 on DPR 3, 375×667 |
| unique colours on screen | **21** (35-entry flat palette, zero gradients/alpha) | ≥ 90 |
| bake cost at boot | n/a | ≤ 60 ms |
| harness | 44/44 PASS, 1.9 s | 44 + new ids PASS |

Conclusion the plan is built on: **draw-call count, not GPU fill, is the thing to fix.** ~1114 procedural `fillRect`s/frame must become a handful of `drawImage`s of pre-baked buffers; the freed budget pays for the HD-2D layers.

## 3. Architecture

```
game state (frozen, G5)
      │  read-only
      ▼
sprites.js      art DATA: pixel-string matrices + palette letters, per-sprite frame tables
   │  boot, once
   ▼
atlas.js        ONE offscreen canvas atlas (all sprites/tiles, ART scale) + metadata table
pixels.js       bake primitives: ramps, outline, directional shade, rim light, dither, AO; deterministic hash
   │  level load, once per level
   ▼
terrain.js      per-level baked layers: parallax (3 depths), terrain chunks, baked AO/lightmap ambient
   │  every frame
   ▼
fx.js           particle pool (fixed capacity, typed arrays), squash/stretch, camera shake — render-only
composite.js    layer stack: parallax → terrain → sprites → FX → lightmap(multiply) → bloom(lighter) → shake
   │            → HUD + overlays (crisp, unshaken)
   ▼
render.js       orchestrates composite.js; keeps `render(ctx, g)` signature
main.js         canvas DPR sizing + resize; FX emit calls at existing event sites only
config.js       PALETTE ramps + ART/FX/lighting constants (new keys only; existing keys untouched)
```

**The one load-bearing idea:** *art is data, not code paths.* Every sprite is a matrix of palette letters; one shared bake pass (outline → directional light → hue-shifted shadow → rim highlight → AO contact) is applied to all of them. That is what makes 20 hand-written sprites read as one art set instead of 20 guesses, and it makes the bake trivially deterministic.

### New modules

| File | Owns | Must NOT |
| --- | --- | --- |
| `src/pixels.js` | ramp generation from base hues, matrix→canvas bake, outline/shade/rim/dither/AO passes, `hash(i)` + seeded `rand(i)` | import anything but `config.js`; touch the DOM beyond `document.createElement('canvas')` |
| `src/atlas.js` | `bakeAll(artScale)`, `getFrame(key, frame)`, `blit(ctx, key, frame, x, y, opts)`, `ready()`, bake timing | know what a hero or a turnip is; per-frame allocation |
| `src/terrain.js` | `bakeLevel(level, theme)` → `{ chunks, parallax, ambient, ao }`; chunked terrain + per-column AO | mutate `level`; bake per frame |
| `src/fx.js` | particle pool + emitters + `updateFx(dt)` + `shakeOffset()`; squash/stretch derived from velocity | write to player/enemy/item state, `G`, or the camera |
| `src/composite.js` | layer buffers, lightmap, bloom chain, final two-pass DPR composite | gameplay logic; `getImageData`/`putImageData` |

`render.js` keeps `export function render(ctx, g)` and `render.js` stays the only module `main.js` calls for drawing.

### 3.1 Frozen API (A1 implements exactly this; later slices code against it and must not change it)

```js
// src/pixels.js — bake-time primitives. NEVER called per frame.
export function hash(i)                          // existing render.js:46-50 moves here; pure integer -> [0,1)
export function seeded(i, salt)                  // deterministic [0,1) from (i, salt) — the only RNG in the project
export function makeLayer(w, h)                  // -> { c, ctx }; offscreen canvas, imageSmoothingEnabled = false
export function buildRamps(palette)              // -> { [hueName]: { deep, shade, base, lit, hi } } from config PALETTE
export function bakeMatrix(rows, map, opts)      // rows: string[], map: {char: cssColor},
                                                 // opts: { scale, outline:{color,width}, light:{dx,dy}, shade:{strength},
                                                 //        rim:{color,width}|null, dither:boolean, emissive:boolean }
                                                 // -> { c, ctx, w, h }  (w/h already in art px)
export function bakeRadial(color, radius, scale) // -> canvas  (one pre-baked glow sprite per colour×radius bucket)
export function bakeVertical(w, h, stops, scale) // -> canvas  (sky / fog gradients, baked once)

// src/atlas.js — one atlas, baked once, queried by string key.
export function register(entry)                  // called by sprites.js at MODULE LOAD, never per frame:
                                                 //   entry = { key, frames: [rows, rows…], map, opts, emissive?: [rows…] }
                                                 // atlas.js must NOT import sprites.js and must NOT know any sprite by
                                                 // name — it packs whatever it is handed. Layout happens in bakeAll.
export function bakeAll(artScale)                // -> { ms, canvas, frames }; idempotent (2nd call returns the same object)
export function ready()                          // -> boolean
export function frameCount(key)                  // -> number of baked frames for that key
export function blit(ctx, key, frame, x, y, opts) // the ONLY runtime sprite call.
                                                 // opts: { flipX, scaleX, scaleY, alpha } — read, never allocated per call
export function emissive(ctx, key, frame, x, y, opts) // same, but blits that key's emissive mask (bloom/lightmap input)
export function metrics()                        // -> { frames, w, h, ms }
```

Sprite keys are flat strings: `'hero.small'`, `'hero.big'`, `'turnip'`, `'turnip.squash'`, `'boss'`, `'ground.top'`, `'ground.body'`, `'stone'`, `'brick'`, `'pumpkin'`, `'pumpkin.used'`, `'platform'`, `'pipe.cap'`, `'pipe.body'`, `'gate'`, `'fruit'`, `'berry'`, `'shard'`, `'bush'`, `'hill.far'`, `'hill.near'`, `'cloud'`, `'lives'`. `blit` must tolerate an unknown key by drawing nothing and counting it in `metrics().missing` — never throw (a render throw is survivable per `R26`, but a missing sprite must be loud in the harness, which asserts `missing === 0`).

A1 appends its final signatures to `GRAPHICS_STATE.md` if it deviates for a real reason; deviation requires reporting, not silent drift.

## 4. Resolution model (G4)

- Logical world **stays 256×240**: all gameplay, camera, hitboxes, `TILE = 16` — unchanged (G5).
- `ART_SCALE = 2`: art and terrain bake at 2× logical → art buffers 512×480. Detail lives here.
- `FX_SCALE = 0.5`: lightmap/fog/bloom buffers 128×120 (lighting is low-frequency; quarter res is invisible and 16× cheaper than scene res).
- Backing store: `dpr = clamp(window.devicePixelRatio || 1, 1, 3)`; backing = css×dpr, but total backing pixels capped at `MAX_BACKING_PX = 1024×960`; `imageSmoothingEnabled = false` on the pixel path.
- Final composite is **two passes**: (1) scene → `upscale` buffer by the largest integer factor `k = max(1, floor(backing/scene))`, nearest-neighbour → pixels stay crisp; (2) `upscale` → canvas at the exact backing size. Pass 2 is a fraction ≤ 2×, so smoothing on it does not blur pixels into mush. **HUD/overlay text is composited at crisp `k`, after shake, so text never blurs and never shakes.**
- The existing `SCALE_STEP`/`CRISP_MIN_SCALE` CSS-sizing logic in `main.js` (lines ~42–58) stays the authority for `canvas.style.width/height`; only the backing store changes.

## 5. Art direction rules (what "professional-grade" means here, checkable)

1. **Ramps, not colours.** `config.js` gains `RAMPS`: for each hue a 5-step ramp `{deep, shade, base, lit, hi}`. Derived deterministically from a base hue with a **hue shift toward the light colour on highlights and toward blue-violet on shadows** (never just "base × 0.7"). Old `PALETTE` keys stay (they are the source hues); new keys only.
2. **One light direction**, up-left, ~30° above horizontal, applied by `pixels.js` to every sprite and tile. A sprite whose shading disagrees with the set is a bug.
3. **Silhouette first.** Every sprite gets a 1-px `deep` outline at art scale, plus a 1-px darker "contact shadow" baked into tiles where they meet.
4. **Minimum 3 tone bands per material**, plus exactly one specular pixel cluster on wet/shiny materials (Sunfruit, Mega Berry, Melon Gate, boss crown).
5. **Dither only in gradient fields** (sky, fog, large tile faces) — never on sprite edges, never in a pattern with a period that aliases with `ART_SCALE`.
6. **Animation**: derived in `render.js` from existing state only (`p.t`, `p.onGround`, `p.vx`, `p.facing`, `e.frame`, `e.squashT`, `e.hurtT`) — no new state fields. Hero: idle×2, run×4, jump×1, fall×1, land-squash×1. Turnip: walk×4, squash. Boss: idle×2, hop×1, hurt×1. Add squash-and-stretch as a render-time scale, never a hitbox change.
7. **Depth**: 3 parallax depths (far hills 0.25×, clouds/bushes 0.5×, foreground grass/leaves 1.15×) + depth fog that tints distant layers toward the sky ramp. Foreground layer may overhang the play area; it must never obscure the hero's feet or a landing surface (verify by keeping the foreground band ≤ 12 logical px tall along the bottom, ≤ 8 px at the top).

## 6. FX spec (`fx.js`)

- Fixed-capacity pool, `MAX_PARTICLES = 96`, struct-of-arrays `Float32Array`s, allocated once at boot. No `Math.random`, no `Array.push` in the loop — reuse the existing deterministic `hash(i)` idiom (`render.js:46-50` moves to `pixels.js`).
- Emitters (called from the exact existing event sites in `main.js`, next to the score popups): landing dust, run dust (grounded && `|vx| > WALK_MAX`, alternate frames), stomp impact, brick break (augments the existing `makeShards` visual), berry sparkle, gate flash, boss hop dust, boss hit spark, death poof.
- Particles are pure visual: never affect physics, never change how long anything is on screen, never change `render`'s determinism for a given `(state, frame)`.
- **Camera shake is render-only**: `shakeOffset()` returns an integer px offset applied to the world composite; camera state and `cam.x` are untouched, so `R36/R38/R40/R41/R42/R43/R44/R45` camera assertions stay valid. Shake is zero while a checkpoint floor is being asserted (peak ≤ 3 px, ≤ 0.25 s decay).
- **Hard rule: `shakeOffset() === 0` whenever the game is state-driven from the harness unless the check asks for it** — a shaken frame must not make two logically identical states draw different streams, or R45-style comparisons become meaningless. Concretely: shake is driven by a pool timer, and `fx.reset()` (called by `newGame()`/`loadLevel()` paths the harness uses) zeroes it.
- **As landed (`src/fx.js`, 434 lines, DOM-free — no `document`/`window`/`performance`/`Date.now`, verified).** Contract wave 3/4 must honour:
  - `hit(entity, kindName)` takes the **strings** `'land' | 'stomp' | 'hurt' | 'hop' | 'jump'` (unknown/omitted → `land`); `burst(x, y, n, kind)` takes a `KIND.*` value (unknown → `SPARK`). Easy to mix up — they are different argument types.
  - `shakeOffset()` returns **one signed integer (±3 px)**, no y channel. Wave 3 decision, so nobody re-derives it: the renderer offsets the world composite by `(dx, dy) = (offset, -offset)` — diagonal shake, no extra state, `R52` unaffected since neither axis touches `cam.x` or the HUD.
  - Overflow policy is **newest refused** (96 hard cap, oldest never recycled), `MAX_PARTICLES` is exported, and `reset()` zeroes the nine pool arrays + squash slots + shake while `peak/emitted/dropped/shakeFrames` deliberately survive it.
  - Emitter points are puff **centres** (half the nominal sprite is pre-subtracted); `fx.draw` re-reads `atlas.frameCount` per frame and clamps, so extra baked frames need no fx change. `fx.spark`'s emissive mask is composite's business — fx never calls `atlas.emissive`.
  - Determinism is asserted by **draw-stream digest**, not array dumps: fx ships no debug hook, and `kill()`/`reset()` zero vacated slots specifically so whole-array dumps stay reproducible if `R50` wants them.

## 7. Lighting / bloom / fog spec (no shaders, G2)

- **Ambient layer, baked per level**: vertical sky gradient + per-column **soft AO** under every overhang/ceiling (derived from `level.tiles` at bake time; deterministic, one pass, ~O(cols·rows)). Stored in `terrain.js` output, blitted as one `drawImage`.
- **Dynamic lightmap**, `FX_SCALE` buffer: `fillRect` the baked ambient once, then `globalCompositeOperation = 'lighter'` blits of **pre-baked radial-gradient sprites** (one per colour×radius bucket, baked at boot in `atlas.js`) for: Sunfruit (small warm), Mega Berry, Pumpkin Block, used blocks dim, Melon Gate (large), boss hurt flash, explosions. Never `createRadialGradient` per frame.
- Composite order: lightmap → scene with `'multiply'`; bloom → scene with `'lighter'` at `≤ BLOOM_MAX_ALPHA = 0.35` (mirrors the existing `CLEAR_FLASH_MAX_ALPHA` ceiling convention, `render.js:31-32`).
- **Bloom is an approximation, and the plan says so**: scene → 64×60 (smoothed) → self-composite `'lighter'` twice → two down/up `drawImage` scale blurs → additive at low alpha. No threshold, so bright-but-large areas (sky) must be excluded by drawing the bloom source from the *emissive* lightmap plus a baked emissive mask, not from the whole scene. If the cheap chain looks muddy, stop and report — do not escalate to `ctx.filter`/`shadowBlur`.
- Emissive mask: a second channel baked per sprite in `atlas.js` (key `<name>:emissive`) so bloom can be driven without reading pixels back. **No `getImageData` anywhere in the runtime path.**
- **No readback anywhere, bake included.** The harness stub's `getImageData` returns transparent black (it does not rasterise), so any bake pass that reads pixels back bakes from zeros under the suite and reads as silently flat. Every `pixels.js` shading/outline/AO pass therefore works on the **letter matrix in JS**, never on a raster read-back. Same rule as runtime: `getImageData`/`putImageData` appear nowhere in `src/`.

## 8. Verification gates (additive harness ids; existing 44 stay)

Stub first (`tools/verify.mjs`): the canvas stub is a `Proxy` that records `fillRect`. It must record `drawImage` (source canvas id + source rect + dest rect), `save`/`restore`, `translate`/`scale`, `globalCompositeOperation`, `globalAlpha`, `imageSmoothingEnabled`, and support `document.createElement('canvas')` + `getContext('2d')` for offscreen buffers. Any canvas/window API the renderer touches that the stub does not model is recorded into an **`unknownCalls` set** — `R47` (W4) asserts that set is empty rather than the stub throwing, because making it throw against the *old* renderer would break the green-suite-at-every-checkpoint rule (`main.js` already touches APIs the current stub only no-ops).

**W1/A2 lands instrumentation only** — recording, counters (`fillRect`/`drawImage`/bake-API counts per stepped frame) and a `drawStats()` accessor later checks can read. It registers **no** new ids and the suite must still be **44/44 green against the OLD renderer**: this repo's rule is a green suite at every checkpoint. `R47`–`R52` are registered by D2 in W4, when they can actually pass.

| New id | Gate | Red until |
| --- | --- | --- |
| `R47` | **Budget, split because glyph runs are not per-pixel art.** *World layer* (everything but HUD/overlay text): ≤ 60 `fillRect` and ≤ 240 `drawImage` on a reference 1-1 frame. *Total* including text: ≤ 450 `fillRect`. Measured decomposition of the 1114 old baseline that sets these numbers: 240 visible tiles ≈ 700 (`drawGround` = 7 per tile), HUD text ≈ 300 (`drawPixelText('SCORE 000000')` = **127**, `'WORLD 1-1  POPPY'` = 123, title logo = 102), lives cluster = **165 for 3 fruits** (55 each — becomes 3 blits once art is the atlas), hero 21, turnip 16. Plus **zero** `createLinearGradient`/`createRadialGradient`/`createPattern`/`ctx.filter`/`shadowBlur`/`getImageData`, and a frame ending with `save`/`restore` balanced (`depth === 0`) and composite/alpha back at defaults | world art still drawn procedurally; or a leaked `save` |
| `R48` | **Bake-once**: atlas bake happens exactly once; level re-entry after death does not re-bake the atlas; bake calls ≤ N per level load | terrain bakes per frame |
| `R49` | **Art density, thresholds set against the measured old renderer so they fail today**: ≥ 90 distinct colours on a reference frame (old: 21); per-tile luminance tone bands median ≥ 5 over non-sky tiles, minimum ≥ 3 (old: med **2**, min **1**, max 5); per-tile distinct colours median ≥ 6 (old: med **3**, max 10). Measured by the pixel-ink model, not a screenshot. **±3 LSB per channel tolerance** — headless WebKit reads an opaque `fillRect` back ±1 and canvas→canvas `drawImage` drifts ±3 (premultiplied backing store); `putImageData` round-trips are byte-exact | old flat palette — **all three clauses are red on `main`** |
| `R50` | **FX determinism**: same state + same frame index ⇒ byte-identical draw stream twice; `fx.reset()` ⇒ shake 0 | `Math.random` or wall-clock in FX |
| `R51` | **Frozen gameplay guard**: `render`+`fx` emit zero writes to `G`/player/enemy/item fields across 600 scripted frames (snapshot-diff) | renderer mutating state |
| `R52` | **Render-only shake**: camera and player x streams identical with `fx.shake` forced on vs off | shake leaked into `cam.x` |

Also rewritten, never deleted: **`R45`** keeps its two claims (nothing drawn at a checkpoint post; two logically-identical maps draw identical streams) re-expressed over the new primitive (compare `drawImage` + `fillRect` streams; keep the canary-pixel clause). **`R38`** keeps "nothing drawn at a post" under the new renderer.

Real-browser gate (manual, run by the integrator with the probe script pattern from §2): 60 s of level 1-1 and 1-3 boss play at DPR 3 / 375×667 emulation, `dt_med ≤ 16.7 ms`, `dt_p95 ≤ 20 ms`, no console errors, and a screenshot of title/1-1/boss saved for the user's eye.

### 8.1 Harness ground truth after W1 (measured — wave 2 and wave 4 code against this)

`tools/verify.mjs` is now 4838 lines with a frame-accounting core (`drawStats()` at `148-163`, `mkCtx` at `200-341`, `step()` wraps `beginFrame`/`endFrame` at `570-587`, and a `VB_DRAWSTATS=1` probe at `4789-4801` that costs nothing by default). Verified: `44/44`, byte-identical across runs, output identical to the pre-change capture, and a reference 1-1 frame reports `fillRect min 1090 / med 1114 / max 1153, drawImage 0` — plan §2 reproduced by the harness itself.

Five things W1 measured that change later slices. These are the integration owner's checklist for W4:

1. **The ink model goes blind the moment art comes from the atlas.** `R16`,`R17`,`R18`,`R19`,`R21`,`R22`,`R23`,`R24` (and `R45`'s canary pixel) read `rec.pixels`, which is fed by `fillRect` ink (`inkRects`) and by `drawImage` ink that needs the **source** canvas's own `_rec.pixels`. Bake canvases are created with `inkRects = false`, so atlas-sourced art inks nothing and those checks go red while the render is correct. **Lever:** enable ink tracking on bake canvases before they are baked (`offscreenCanvases[i]._rec.inkRects = true`), so the atlas carries real pixels and `drawImage` ink works transitively. This is a wider set than §8/G6 originally named — expect to touch these checks' *setup*, never their assertions.
2. **`R45`'s `firstDiff` parses `rec.blits` raw args**, which are `undefined` for the 3/5-arg `drawImage` forms: it would still compare equal but could no longer say *which* atlas cell was drawn. Its rewrite must read **`rec.drawImages`** (source canvas id, normalised source/dest rects, `op`, `alpha`, `smoothing` are already recorded).
3. **Bake totals are contaminated by the harness's own scratch buffers**: a clean run reports `bakeCalls=1064, offscreenCanvases=7` because `R16`/`R20` call `document.createElement`. `R48`'s per-level-load bound must demote harness scratch buffers (`_rec.scope = 'scratch'`) or subtract them; per-frame buckets are unaffected.
4. **`save`/`restore` are counted, not stacked**, so a forgotten `restore` leaks `globalAlpha`/composite inside the harness while a browser would rewind it — an invisible desync between the two. `rec.depth` (per frame) and `rec.stateLog` expose it: **`R47` gains a clause** that a frame ends with `depth === 0` and composite/alpha back at defaults.
5. **`R19`/`R24` print absolute draw indices** (`rects[6]`); `clearRect`/`create*Gradient`/`createPattern`/`*ImageData` now also consume `rec.seq`, so printed `#1153`-style numbers shift under the new renderer. Their assertions are relative, so they still pass — do not "fix" the printed numbers.

Whitelist for `R47`: per-frame `unknownCalls` is **empty** today and must stay empty. The only names that ever appear are bake-scope `arc`/`beginPath`/`fill` (from `pixels.js` glow/gradient bakes), which land in `bakeUnknownCalls` and are allowed.

## 9. Phases, file ownership, sequencing

**One owner per file. One subagent at a time.** The old five-wave plan is replaced by 20 small slices (user directive 2026-11-17: smaller chunks so a worker's context window stays small and a `503` abort costs minutes, not hours). Each slice: **one file**, ≤ ~150 new lines, ≤ ~400 lines read, one gate that can be shown rather than claimed. Statuses live in `GRAPHICS_STATE.md`; this table is the authority for **what and in what order**.

| ID | Slice | File | Gate |
| --- | --- | --- | --- |
| S-01 | finish art: registrations + 18 wrappers + `bakeSprites` | `src/sprites.js` | footprint oracle vs `git show main:src/sprites.js`; ≥6 colours / ≥5 tone bands per key; `metrics().missing === 0` |
| S-02 | validate the terrain draft, fix what fails | `src/terrain.js` | ≤4 strips covering the 256px view, purity across `invalidate()`, `live ≤ 12` over a full scroll, 64px-seam luminance delta |
| S-03 | finish ink bridge: blit-ink probe (alpha 0.5 / `lighter` / mirrored) + list of checks whose ink will change | `tools/verify.mjs` | 44/44 and byte-identical survive |
| S-04 | composite layer buffers + DPR `k`-factor sizing (no drawing) | `src/composite.js` | printed buffer table at DPR 1/2/3 and 375×667 |
| S-05 | lightmap: pre-baked glow blits + ambient `multiply` | `src/composite.js` | zero `createRadialGradient` per frame |
| S-06 | bloom: emissive-mask source, down/up chain, alpha ceiling | `src/composite.js` | `BLOOM_MAX_ALPHA` honoured; no `filter`/`shadowBlur` |
| S-07 | world layer: strips + sprite blits + shake `(o,-o)` | `src/render.js` | world ≤ 60 `fillRect`, ≤ 240 `drawImage` |
| S-08 | HUD/overlays composited crisp and unshaken, after FX | `src/render.js` | total `fillRect` ≤ 450; text never blurred |
| S-09 | boot: DPR backing store, resize, `bakeSprites`/`bakeLevel`/`invalidate`, `fx.update` | `src/main.js` | bake once per boot, once per level, never mid-frame |
| S-10 | FX emit sites at the existing score-popup events | `src/main.js` | `fx.metrics()` per event; gameplay state untouched |
| S-11 | FX tuning constants + page meta | `src/config.js`, `index.html` | only two files because each is ~5 lines |
| S-12 | `R47` draw budget + `save`/`restore` balance | `tools/verify.mjs` | red before S-07, green after |
| S-13 | `R48` bake-once (demote harness scratch buffers first) + `R52` render-only shake | `tools/verify.mjs` | |
| S-14 | `R49` art density (±3 LSB/channel) | `tools/verify.mjs` | must be red on `main` |
| S-15 | `R50` FX determinism (draw-stream digest) + `R51` frozen-gameplay diff | `tools/verify.mjs` | |
| S-16 | rewrite `R38`/`R45` onto `rec.drawImages` | `tools/verify.mjs` | original claims preserved |
| S-17 | browser gate at DPR 3 / 375×667 | integrator | `dt_med ≤ 16.7`, `dt_p95 ≤ 20`, 0 errors, screenshots |
| S-18 | `architecture.md` module map + Deviations | `architecture.md` | |
| S-19 | `requirements.md` + `VEGGIE_BROS_PLAN.md` decision amendments | two docs | |
| S-20 | `README.md`, full suite, final commit | `README.md` | all ids green |

Rules: S-04→S-06 and S-07→S-08 are strictly ordered (same file, later slice builds on the earlier one); S-12→S-16 are ordered only to keep one agent in `tools/verify.mjs` at a time. A slice that cannot finish must leave the file loadable (§0) and say so in its report; the integrator re-queues the remainder rather than letting a worker continue past its brief.

`src/pixels.js` + `src/atlas.js` are the API everyone else calls: **their exported signatures are frozen by §3.1 and must not change without updating this file.**


## 10. Landing rules (every agent)

- After each `src/*.js` write: `for f in src/*.js; do node --input-type=module --check < "$f" || echo "FAIL $f"; done` → no FAIL lines.
- `node tools/verify.mjs <your ids>` before you report; the full suite only when your brief says so.
- No new files outside your list. No `package.json`, no deps, no asset files. No TODOs, no stubs, no placeholders.
- Never weaken an existing check to make it pass; if a check fights your change, report it with the check's reasoning, don't edit its assertions.
- Comments: match the repo's style — dense "why" comments, no narration of what the line does.

## 11. Known risks

| Risk | Mitigation |
| --- | --- |
| LLM-drawn pixel art looks inconsistent | §5 rules + one shared bake pass over palette-letter matrices; `R49` tone-band assertion |
| HD-2D FX are slow in Canvas 2D | quarter-res FX buffers, pre-baked gradient sprites, `R47`/`R48` gates, browser p95 gate |
| Bloom needs a threshold Canvas 2D lacks | emissive mask instead of pixel readback (§7); "report, don't escalate" rule |
| FX break the harness's determinism/ink comparisons | §6 `fx.reset()` contract, `R50`/`R52` |
| DPR 3 + large windows blow the fill budget | `MAX_BACKING_PX` cap + `k`-step upscale; browser gate at 375×667 DPR 3 |
| Renderer mutates gameplay by accident | `R51` snapshot-diff guard |
| `hash()` move out of `render.js` breaks its users | A1 moves it, C1 updates the one call site; grep `hash(` before landing |
