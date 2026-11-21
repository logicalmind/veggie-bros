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

- [x] **R-4** — HD title/HUD (approved 2026-11-21)
  - New `src/ui.js` (~230 lines), the art surface for every UI pixel. Font = the OS stack
    (`-apple-system, "Segoe UI", "Helvetica Neue", Arial, sans-serif`) — zero deps, no embedded
    TTF. Panels = one surface everywhere: `rgba(18,22,30,0.55)` fill, 2-device-px
    `rgba(255,255,255,0.22)` edge, rounded via an `arcTo` helper (`rr()`; no roundRect
    dependency), soft drop shadow in DEVICE space (blur 10 / offsetY 3 — shadow params ignore
    the transform). Exports `hud(ctx,g)`, `title(ctx,now)`, `banner(ctx,g)`, `overlay(ctx,g,now)`,
    `popup(ctx,str,x,y)`; font/align/baseline are set per call, so nothing leaks into world passes.
  - The 256×240 `hud` composite layer is RETIRED: `composite.js` drops it from `LAYER_NAMES` and
    `build()` (byte-budget comment now five layers / 7.58 MiB), `main.js`'s composite is two
    blits, and `render.js` draws the UI on the scene AFTER the lightmap/bloom passes under the HD
    transform (TITLE before them — the title stays unlit and unshaken). The UI is never
    multiplied, bloomed or shaken; the lightmap gather reads frozen state, so post-FX UI is safe.
    Glyphs rasterize at 4× device resolution and the hero (12×12) / fruit (9×9) icons land 1:1 —
    the last transitional bilinear downscales are gone.
  - Title: sky scrim gradient (0→170 logical, 0.45/0.18/0 alpha), 'VEGGIE BROS.' gradient logo
    (#ffe27a→crown→#ff8a30→red) with 5px black stroke and a soft shadow, sin bob, subtitle,
    blinking ENTER pill, two control rows, hero + turnip pair. Logo measures 234.1 logical px
    (fits 256 with margin; downsize threshold 246).
  - HUD: score panel (88×34, label + 11/800 crown value + fruit icon + ×NN), centered WORLD pill,
    right-aligned lives pill with a live `drawHero` idle icon (sharp 1:1, the R-4 target) and a
    MUTED pill beside it when muted. Overlays: PAUSED = scrim + 24/800 title + hint; LEVEL_CLEAR =
    white flash (clearT>0.9, max 0.6) + STAGE CLEAR on a dark pill + +1000; WIN/GAME_OVER = scrim
    (the old build had none) + 24/800 title (GAME_OVER in red) + crown score + blinking ENTER.
    Banner: dark pill, alpha min(1, bannerT). Item popups: 8.5px/800 white with 1.5px black stroke.
  - `src/sprites.js` DELETED (pixel font + the last tile text); `src/config.js` drops `ART_SCALE`
    (no imports left; only the parked verify.mjs mentioned it, in comments).
  - Gates: `hd-verify` `{"ok":true,"sceneScale":4,"scene":[1024,960],"determinism":true,"stripHash":"f7206cb3","seam":{"cam140":true,"cam420":true},"distinctColors":11773}`
    — seam hash unchanged (the probe is terrain-only, UI-independent); distinct up from 7174 =
    UI pixels now living on the scene layer. Zero console errors across title → PLAYING → all four
    fake overlays (score pinned 12340, bannerT forced for the banner check).
  - Pixel evidence (visible 768×720 canvas, same boxes as the R-4 BEFORE pass): logo 1864→4266
    distinct; sky top avg [101,196,230]→[63,120,143] (scrim darkening); score row 32→833; world
    pill 16→380 (luma reaches 255); lives row 169→951 with luma 26–255 (icon now sharp);
    GAME_OVER line 65→565, luma 130–189→89–130 (new scrim); WIN line 103→811; PAUSED line 15→550;
    LEVEL_CLEAR line 70→560; banner pill 1165 distinct.
  - Parked `tools/verify.mjs` drift continues (it now also references the deleted hud layer,
    drawPixelText/tileGrid and ART_SCALE); it stays parked and is never re-run.
  - Next: R-5 lighting/FX — bloom knobs live in `composite.js` (`BLOOM_MAX_ALPHA = 0.18`); the
    emissive-key expansion (gate/pumpkin/spark) is the open decision.

- [x] **R-5** — HD lighting/FX (approved 2026-11-21; the screen-fixed vignette was rejected and
  removed after the first evidence pass — "the bloom that encircles the play area is unnecessary")
  - `composite.js`: `BLOOM_MAX_ALPHA` 0.18→**0.22**, `BLOOM_MASK_ALPHA` 0.25→**0.30** (gain 0.25
    unchanged; both sit at the top of the old R53 envelope the parked verify's clause pinned, so a
    future re-pin stays green). `EMISSIVE_KEYS` frozen to `['fruit','berry','gate','pumpkin']`;
    `buildBloom` now emits the gate mask at `(gate.x - camX, gate.y - 103)` (the blit anchor
    `drawGate` uses) and `scanPumpkinMasks` walks the same tile range as `scanBlocks` for `'P'`/`'Q'`
    and masks each on its tile origin. All new emits run through the shared `MAX_LIGHTS` (12) cap
    in items → enemies → gate → pumpkin order, so a block-crammed view degrades background glow
    (lightmap discs share the same cap order in `drawLightmap`), never pickup halos. Punched
    `'U'` blocks stay unlit — one spent sprite, one spent glow. `fx.spark` deliberately stays
    unmasked: a 5×5 art-px spark is ~1.25 bloom-px, a single bright pixel the mip blur smears into
    noise; sparks already read bright in HD art.
  - `props.js`: `paintGateMask` (32×119, radial centre (16,52) r 3→60, `#a6ff72` 1/0.55/0) and
    `paintPumpkinMask` (16×16, radial (8,8) r 0.5→8.5, `#ff9b2e` 1/0.5/0) — mask colours mirror the
    existing lightmap GLOW table; `B.mask` gains `gate`/`pumpkin` entries.
  - `render.js`: net zero. The first pass wired a screen-fixed multiply vignette into both the
    TITLE branch and the main FX chain; after JASON's rejection it was deleted, leaving the file
    byte-identical to R-4 (confirmed by `git status` showing only composite.js + props.js dirty).
  - In-page catches: (1) first R-5 boot rendered a fully transparent canvas — `vignetteBake`
    stored the layer OBJECT (`{c, ctx}`) in `VIG.c`, so `drawImage` threw a TypeError every frame
    (6,478 logged errors, `frame`'s catch). The fix (`VIG.c = l.c`) was moot once the vignette was
    removed, but the incident is exactly what hd-verify's live-canvas `distinctColors` check exists
    for: it reported `renderSmoke:1, distinctColors:1` on the broken build vs 22k after. (2) First
    gate shot at 250 ms after teleporting the player missed — the camera lerp hadn't arrived
    (camX 2340, gate off-canvas); settle ≥2 s before sampling after any player teleport.
  - Gates: `hd-verify` `{"ok":true,"sceneScale":4,"scene":[1024,960],"stripCanvas":[256,960],"determinism":true,"stripHash":"f7206cb3","seam":{"cam140":true,"cam420":true},"distinctColors":7830}`
    — seam hash unchanged (probe is terrain-only). `distinctColors` is a 1/4-stride snapshot of the
    ANIMATED title frame: 7830 stable across 3 consecutive runs this pass (the vignette pass read
    22176 — the multiply gradient inflated quantized colour counts; R-4 logged 11773 at a different
    animation phase). Title corners/centre are byte-identical to R-4, so no title regression.
    `C.metrics()` in the spawn view: `bloomAlpha: 0.22`, lights/emissives 3 (fruit + berry + one
    pumpkin tile); gate view emissives include the gate mask. Zero console errors across
    boot → title → PLAYING → gate.
  - Pixel evidence (visible 768×720 canvas, avg RGB / luma range; BEFORE = R-4 build):
    title corners TL/BL/BR [58,113,130]/[130,91,77]/[125,93,81] and centre [164,208,212]
    187–198 — identical after (vignette removed); gameplay corners [62,118,112]/[110,88,64]
    identical after, centre [170,230,190] 194–213 → [167,228,189] 194–208 (unchanged);
    fruit halo box [152,213,182] 64–208 → [150,217,186] 61–203 (halo slightly hotter at the
    0.22 ceiling; the 60×60 box spans the fruit's spin frames so averages vary by frame);
    berry box [140,190,121] 31–241 → [141,191,121] 32–243 (unchanged); gate (new, after only,
    player parked at gate.x−60, restored after the shot): gateBox 2896 distinct, avg [162,223,165],
    luma 43–231; halo strip right of the gate 133 distinct, luma 206–226 — the green bloom halo is
    the visible R-5 delta.
  - Parked `tools/verify.mjs` drift continues and is never re-run; if ever re-pinned, its
    `distinctColors` gate must expect the vignette-free animated-title counts.
  - Next: R-6 (JASON request) — spent star boxes: remove the dark hollow so a hit P/Q block is a
    plain solid-coloured body (the star marking already vanishes on hit; the hollow in
    `paintPumpkinUsed` is the delta).
