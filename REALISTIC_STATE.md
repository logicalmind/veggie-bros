# REALISTIC_STATE — branch `feature/realistic-graphics`

Fork of `feature/graphics-upgrade` @ `d1cb6c2` (S-28), 2026-11-20. **Direction decided by JASON:**
"as realistic and detailed as possible, everything realistic and modern" → **HD 2D**: procedural
high-resolution 2D art (gradients, noise, soft lighting, parallax, bloom, particles) on the existing
zero-dependency vanilla-ES-module canvas stack. No new deps, no build step, no hand-drawn assets.

## Ground rules for this branch

- **The 54-check suite is PARKED** (JASON's decision): `tools/verify.mjs` stays on disk but
  54/54 is NOT required here — its digests pin the old 8-bit art byte-for-byte. Add a small new
  sanity check set (no-crash, determinism, basic render output) as the pipeline settles.
- **Gameplay is frozen**: physics, levels, tile chars/keys, camera math, input — untouched.
  Rendering only. Logical space stays 256×240 / 16-px tiles; HD is a render-resolution concern.
- Every slice ends with a visible before/after in an `ask` form (same workflow as S-21→S-28).
  Iterate until approved, then commit via the commit namespace. No push (standing order).
- Slice plan (order = my call, approved 2026-11-20): **R-1** render foundation + HD terrain +
  parallax background → **R-2** characters → **R-3** items → **R-4** title/HUD → **R-5** lighting/FX.

## Slice log

- [x] **R-1** — HD render foundation (approved 2026-11-21)
  - `composite.js`: `SCENE_SCALE = 4` export, `MAX_BACKING_PX` 1024×960, BYTE_BUDGET 16 MiB; the
    scene layer IS the final image (k ≡ 1). `main.js`: boot + `fit()` set `imageSmoothingEnabled`
    on (pass-2 downscale to the display is the intended soft fit). `index.html`: `pixelated` CSS
    removed. `render.js`: HD scene transform; parallax dest `/ HD`; title world drawn on scene;
    lightmap/bloom blits with bilinear smoothing (FX buffers stay fractional — their upscale is
    the soft halo; retune in R-5).
  - `terrain.js` FULLY REWRITTEN: procedural HD painters for every tile
    (dirt+grass cap with 9 seeded blades, beveled stone with cracks/speckles, seeded bricks with
    per-brick tint, pumpkin/used-pumpkin blocks, one-way platforms, pipe barrels with run
    gradients + rimmed caps + ground contact shadow), fractional 4-subcolumn air-AO
    (`aoKernelF`), baked ambient sky+sun+horizon, 3 HD parallax depths (ridges / clouds+spires+
    temples / foreground ridges with vines+tufts), all seeded from world-absolute tile coords so
    bakes are pure. `MAX_LIVE` 12→8 (HD strips ≈ 983 KB). Pre-rewrite backup kept at
    `/tmp/terrain.js.bak` (not committed).
  - Two seam bugs found and fixed while proving the seam contract: (1) `aoKernelF` first version
    indexed the AO array in absolute world columns — the array is relative to `firstCol - 2`, so
    the first two tiles of every strip read `undefined` → 0; now taps `ao[k+j]/ao[k+j+1]` in the
    same space as `aoKernel` (f=0 reproduces it exactly; context fetch + digest widened by one
    column). (2) Grass tips lean ~1 px across tile edges and the strip canvas clipped them only
    at strip boundaries → per-tile clip rect (`rect(lx, 0, TILE, hPx)`) in `bakeStrip` makes the
    cut identical in every strip.
  - Gates: `tools/hd-verify.mjs` (new, browser-side, prints one JSON) — SCENE_SCALE 4 + scene
    1024×960, strips 256×960, bake determinism across `invalidate()`, seam probe byte-identical
    through strip phases 0/8 at cam 140 & 420, live-frame color check. All pass:
    `{"ok":true,...,"seam":{"cam140":true,"cam420":true},"distinctColors":7050}`.
  - Pixel evidence (from the scene master): 18-step gradient across the pipe barrel; air shadow
    under the gold blocks = 27.5% darkening with a smooth 4-row decay; ground-near AO fades
    smoothly. 8-bit characters/items deliberately untouched (R-2/R-3).

- [x] **R-2** — HD characters (approved 2026-11-21)
  - New `src/chars.js`: the whole character set as procedural vector bakes at `SCENE_SCALE` 4.
    Hero (strawberry, 9 frames × small/big), turnip (4 frames), crowned-pineapple boss (6 frames
    incl. 2 hurt-flash). Per character: multi-stop body gradient lit from the top-left (matches
    both the old `LIGHT` and the R-1 terrain keylight), clipped gloss + rim + bottom AO, baked
    detail (seed dimples, leaf creases, pineapple lattice with bevel, crown spikes + band + gems),
    and a live radial **contact shadow** that is gated on `onGround` — it pops with groundedness
    rather than floating in air. Bakes are lazy plain `OffscreenCanvas`es at 4× logical size,
    blitted at LOGICAL destination size: 1:1 under the scene transform (zero resampling),
    bilinear downscale on the logical HUD canvas (transitional, R-4).
  - Frozen contract kept byte-for-byte: same draw names/args/anchors ({0,−2} / {−1,−1} / {−2,−3}),
    same 9-frame hero order, same `HERO_BASE` idle/run/jump/fall/land math, same run bob (−1 on
    odd run frames), same boss `(hurt, frame&2, frame&1)` pose table. Only API change: optional
    trailing `shadow` arg (default 0) on the three draw wrappers; `render.js` passes
    `onGround ? ~0.2 : 0` at the 4 world call sites.
  - `src/sprites.js` cutover (−371 lines): all character matrices, materials, rim arrays, atlas
    registrations, and the old draw wrappers deleted; a pointer comment marks the section. The
    squashed-turnip corpse stays `render.js`'s live `fillRect` (smooths under the 4× transform).
  - One first-build bug caught by the in-page error log before approval: `BOSS_FRAMES` entries
    passed the options object where `bake` passes `ctx` → `paintBossFrame` threw on `o.tuck`
    every frame and the scene never presented (transparent canvas, loop kept running because
    `frame()` catches per frame). Fixed the table to `(ctx) => paintBossFrame(ctx, o)`.
  - Gates: `hd-verify` all green post-cutover:
    `{"ok":true,"sceneScale":4,"scene":[1024,960],"stripCanvas":[256,960],"determinism":true,"stripHash":"f7206cb3","seam":{"cam140":true,"cam420":true},"distinctColors":6328}`
    (strip hash unchanged — terrain untouched; the distinct-colour drop is the character pixels
    moving to the new art).
  - Pixel evidence (scene master): hero body profile 41 distinct colours across 48 device px
    (old art: ~5 tone steps); bake-vs-scene blit check pixel-exact at 4 sample points with only
    the uniform lightmap delta (R ±5, G −6…−14, B −24…−44); contact shadow ≈14% radial
    darkening under the feet when grounded, fully off airborne (measured across a real jump
    arc); all 28 sheet frames inked, left-facing flips verified, HUD lives icon live.
  - Items/FX/tiles remain 8-bit until R-3; title-screen hero + HUD lives icon are the
    transitional bilinear downscales (R-4 redesigns the HUD).

- [x] **R-3** — HD items (approved 2026-11-21)
  - New `src/props.js` (~560 lines): fruit (4 spin frames, centre-anchored squash keys
    1/0.62/0.24/0.62 — reads as rotation vs the old left-sweep), berry (14×7 capsule, radial
    hi-core; one frame — the old glint-row pulse is the bloom mask's job now), shard (4×4, four
    facets under the top-left key, verbatim old offset math `ox=(k%2)*8; oy=k<2?0:8;
    dx=k%2?1:-1; dy=k<2?-1:1; o=round(t*8)`), melon gate (32×119 blitted at (x, y−103); the old
    right plinth was a 7-wide matrix clipped to 2 px — both plinths now symmetric 7-wide), and the
    four FX kinds (dust / spark / poof / chip) with `fxBlit` replicating the retired atlas
    `drawRec` contract exactly (top-left anchor, round dest size, multiplicative alpha,
    destination-space mirror). Emission: fruit (9×9 pumpkinLit r4.8) + berry
    (14×7 berryBody.hi r6.5) only; gate/pumpkin/spark emission deferred to R-5.
  - `src/sprites.js` rewritten as a pixel-text-only module (~130 lines, zero imports): the entire
    old atlas pipeline (matrices, materials, rim arrays, registrations) deleted and
    `src/atlas.js` removed. Items bake ONCE to plain `OffscreenCanvas`es at 4× logical size and
    blit 1:1 under the scene transform — no per-frame rasterisation. `src/pixels.js` loses the
    rasteriser/rampCache/rgbCache; `src/config.js` drops `ART_MAX_PX`. `SCENE_SCALE` moved to
    `config.js` (chars/composite/props/render/terrain + `hd-verify` all import it from there) to
    break the props↔composite import cycle; `composite.js` no longer exports it.
  - `src/render.js` re-pointed to props (world + HUD icon call sites); `src/fx.js` aliases
    `frames as frameCount, fxBlit as blit`; `src/composite.js` takes `emissive` from props with
    `EMISSIVE_KEYS = ['fruit','berry']`; `src/main.js` drops `bakeSprites`/`ART_SCALE`;
    `src/chars.js` comment-only.
  - Two in-page catches: (1) `bake()` treated `makeLayer()`'s `{c, ctx}` return as a canvas →
    `c.getContext is not a function` on the first `drawFruit`, aborting `drawItems` and blanking
    everything drawn after items; now destructured like chars/terrain. (2) A boot
    `SyntaxError: Importing binding name 'SCENE_SCALE'` proved to be a poisoned WebKit module
    registry (stale pre-rewire `terrain.js` parse re-linked against the new `composite.js`), not a
    source fault — served==disk byte-hash for all 16 src files; a fresh tab boots clean.
  - Harness defect recorded (affects BEFORE evidence, not the game): the prior session's berry
    injection lacked `vx` → `moveBerryX` computed `b.x += b.vx·dt` → NaN → the berry was silently
    undrawn (no exception). The old 8-bit berry was blue (berryBody #4a6cf0→#2f4ab0) and the
    BEFORE bench PNG has zero blue pixels in the berry region → the BEFORE shot has no berry; the
    berry comparison is 8-bit design vs new render.
  - Gates: `hd-verify` all green post-cutover:
    `{"ok":true,"sceneScale":4,"scene":[1024,960],"determinism":true,"stripHash":"f7206cb3","seam":{"cam140":true,"cam420":true},"distinctColors":7174}`
    (strip hash unchanged — items outside the seam probe; distinct up from 6328 = item pixels
    moving to the new art). Zero console errors since seam reinstall.
  - Pixel evidence (live scene layer, same D-mapping as R-2): fruit spin f0–f3 467/373/212/373
    distinct, centre [236,186,81] gold (BEFORE f0: 430, [233,178,68]); berry 827 distinct, avg
    [100,92,111] bluish, stable ≥5.6 s; shards 20×20 908 (BEFORE 419); gate 128×476 4170 distinct,
    opaque, avg [118,133,78] (BEFORE 3743, [116,130,76]); bloom mask fruit 185 px / 141 tones,
    berry 212 / 165, empty-terrain control 3 px. Screenshot crops (1.5×): fruit 9×9 957→864
    distinct, [233,180,68]→[238,190,91]; berry region 1327 blue px / 609 tones; shards 20×16
    1926→2110.
  - Title/HUD fruit + lives icons still transitional old downscales (R-4); bloom params
    (gain 0.25 / mask alpha 0.25) untouched — R-5 tuning.
