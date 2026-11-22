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
    `paintPumpkinUsed` is the delta). [NOTE: that parenthetical was an unverified inference and
    was wrong — see R-6, the star did NOT vanish.]

- [x] **R-6** — star boxes spend to solid colour (approved 2026-11-21)
  - **Real bug found — the R-5 "Next:" note was wrong:** punched boxes kept drawing the intact
    STAR art. `bakeLevel` computes each strip's LRU key (`label|theme|phase|i|digest`) ONCE at
    level load, and `ensureStrip` looks the module-level `strips` Map up with those frozen keys —
    a punched tile re-ran no planning, so the spent tile served the stale intact canvas forever.
    The only post-punch change was the lightmap disc ('P' glow → 'U' `PUMPKIN_DIM`), and that
    disc's radial read like an art change on a luma-diff map, which is how the earlier
    "it re-bakes, just dim" misread happened. Reproduced byte-identically across three separate
    page loads on two builds: spent box avg [155,93,30] vs intact [164,97,32], star-seal centre
    [185,129,48] still bright (hi 171). That was JASON's report exactly.
  - `terrain.js`: new export `retileColumn(baked, tx)` — recomputes `baked.stripKeys[i]` ONLY for
    the strips whose digest range `[firstCol-2, firstCol+TILES_PER_STRIP+2]` touches the mutated
    column (that range is exactly the union of every tile read a bake performs: AO field ±2,
    fractional tap +1). The next `ensureStrip` misses the LRU and re-bakes those strips within one
    frame; only keys are written (no canvas allocation, no gameplay state). Also
    `paintPumpkinUsed`: the dark hollow clip (the `hg` radial block) is DELETED — the spent block
    is now the plain used-ramp body + top strip + outline + contact shadow, per "just be the
    solid color of the box".
  - `render.js`: exports `retileColumn(g, tx)` — a no-op unless the cached plan's level identity
    matches `g.level` (after `loadLevel()` the new identity re-plans anyway). `main.js`: one call
    at each of the THREE runtime tile-mutation sites — P→U, Q→U, B→'.' (the parse-time writes in
    `level.js` are pre-plan and need nothing). No gameplay logic touched: punch conditions,
    physics, levels, camera unchanged. The `terrain.js:152` self-healing comment, which described
    behaviour that never existed (the digest changed nothing until this pass re-runs it), is now
    true.
  - In-page catches: (1) a fresh page once ran STALE module code after a reload. Root cause was
    the dev server: plain `python3 -m http.server` sends no cache headers, so the browser's
    heuristic freshness re-served old nested ES modules. FIXED AT THE SOURCE this slice:
    `tools/serve.py` (stdlib http.server + `Cache-Control: no-store`) now backs both serve
    scripts (`serve-local.sh`/`serve-network.sh` exec it; `stop-server.sh` matches it; README
    updated) — a standard browser refresh always pulls the files straight from disk. Verified
    with a marker round-trip: comment added to terrain.js → standard `location.reload()` → page
    served the marker; comment removed → standard reload → page served the removal. (Separately,
    `tab.reload()` from the tool bridge no-ops silently in this environment — `location.reload()`
    + a small `performance.now()` is the reliable in-test reload.) (2) A keyup ~40 ms after the
    jump keydown triggers `JUMP_CUT_VY` (−200) and caps the arc at ~35 px — short of a block 36
    px above the head; hold the jump through the arc for a real head-bump (punches here landed
    71–95 ms after the held keydown).
  - Gates: `hd-verify` `{"ok":true,"sceneScale":4,"scene":[1024,960],"determinism":true,"stripHash":"f7206cb3","seam":{"cam140":true,"cam420":true},"distinctColors":7830}`
    — seam hash unchanged (the probe never mutates tiles, so the re-key path is unexercised by it).
    Zero console errors across boot → PLAYING → both real punches.
  - Pixel evidence (visible 768×720 canvas; 44×44 box / 20×20 centre; P@21,9): intact star box
    avg [153,104,48], centre [157,109,50] hi 154; spent WITHOUT re-bake (old behaviour —
    reproduced by setting the tile 'U' by hand, which no game code path does) avg [155,105,48],
    centre [161,110,50] hi 157 — **star persists**; spent after a REAL held-jump punch (tile 'U',
    71 ms) avg [127,96,56], centre [131,98,56] hi 121 — plain tan, no star (box hi 212 = punch
    sparks in-frame). First punch P@16,9: star centre [200,135,50] hi 184 → spent centre
    [122,93,55] hi 117. B@22,9 (big hero, real punch): block [152,104,49] → [175,223,181] = the
    background behind the block, art gone. Q→U shares P's exact two-line fix (same 'U' art).
    PNGs: /tmp/vb-r6-intact.png (pristine star), /tmp/vb-r6-before.png (spent, star persists —
    the reported symptom), /tmp/vb-r6-after.png (spent, plain box), /tmp/vb-r6-after-break.png
    (B block broken).
  - Parked `tools/verify.mjs` drift continues and is never re-run; a future re-pin must also
    expect the new `retileColumn` export and the re-baked spent tiles.
  - Deferral: "solid color" read as "no star, no hollow" — the rounded body gradient, top
    highlight strip and outline stay. A literally flat single-colour fill is a one-line
    follow-up if wanted.
  - Next: R-6 was the last planned slice. All six commits are UNPUSHED (6554051, b27074e,
    bfd3467, 9960a75, d1833e1, + this one); the branch awaits JASON's next request.

- [x] **R-7** — landing shake: configurable + playtuned down, shake edge-flash removed (approved 2026-11-21)
  - Two playtest reports, both FX/render-only (`src/config.js`, `src/fx.js`, `src/render.js`);
    no gameplay code touched.
  - **Shake knob:** new `SHAKE_SCALE` in config.js (after `LAND_MIN_POWER`), applied at the
    `fx.shake()` entry so every emitter — the landing puff is the only one today — runs
    through it. 1.0 = the R54 tuning. Playtest-stepped: 1.0 → 0.5 (JASON: too much shake) →
    0.25 (JASON: "still feels very jittery") → approved. The offset is integer and the ±1
    floor in `fx.js` keeps any live shake at 1 px, so the knob shortens the jitter window,
    not the step. At 0.25 only near-terminal landings (power > ~0.90) print one 1-px frame;
    lighter landings land still. Next lever if the last frame ever still bugs: the floor
    itself (the `if (o === 0)` block in `fx.js update()`) — removing it silences shake
    entirely; not done preemptively.
  - **Edge flash (new bug found in the same playtest):** the vertical half of the jolt
    (`oy = -o` in render.js) shifts the world 1 px, but the strip/parallax blits stay
    exactly VIEW_H tall, so the band at the OPPOSITE frame edge fell through to the bright
    ambient fog ramp behind the world — a 1-2 px white flash, bottom of screen on upward
    jolts. Root-caused with a pixel probe: o=+1 frame bottom band (181,222,140) bright fog
    vs still-frame (95,75,58) dark dirt. Fix: `edgeFill()` in `drawWorld()` re-blits the
    shifted canvas's own edge rows into the |oy|-px band (parallax layers AND terrain
    strips; no-op when not shaking). Post-fix probe: both o signs equal the still frame
    exactly.
  - Measured (fresh-origin drop protocol, `fx.metrics().shakeFrames` deltas): full-power
    176-px drop (p=1.0): 4 frames @1.0 → 2 @0.5 → **1 @0.25**; 20-px mid drop (p≈0.72):
    2 → 1 → **0** (lands still, dust puff still fires). Cold scale probe (`shake(1.0)`,
    20 updates): 3 → 1 → **0** live frames.
  - Gates: `hd-verify` `{"ok":true,"sceneScale":4,"scene":[1024,960],"determinism":true,"stripHash":"f7206cb3","seam":{"cam140":true,"cam420":true},"distinctColors":7856}`
    — seam hash unchanged, zero console errors. Note: JASON's browser can still hold
    pre-no-store-era module bytes; one hard reload (Cmd+Shift+R) before a playtest is the
    working mechanism (a plain F5 re-served stale `fx.js` during this slice). Parked
    `tools/verify.mjs` drift continues, never re-run.
  - Next: R-7 was the post-R-6 playtest fix; the branch awaits JASON's next request.
    All seven commits are UNPUSHED (6554051, b27074e, bfd3467, 9960a75, d1833e1, 2995d5b,
    + this one).

- [x] **R-8** — gate celebration: auto walk-in, grown dancer (floss/twerk/dougie),
  press-any-key continue (approved 2026-11-21)
  - The one gameplay-surface slice on this branch: `LEVEL_CLEAR` is **deleted outright**,
    replaced by two states, `GATE_WALK` (in-world auto-walk into the arch, ~0.25 s) and
    `GATE_DANCE` (the cutscene). Files: `src/config.js`, `src/input.js`, `src/main.js`,
    `src/chars.js`, `src/ui.js`, `src/render.js`. Approved design: gate exits go
    1-1→1-2→1-3, the 1-3 boss defeat ALSO dances then WIN→TITLE; the grown form is
    celebration-only (next level restarts small); the scene is the gate's own doorway.
  - **Timeline** (config.js, shared by main.js + ui.js): `DANCE_WALK_T 1.45` (hero crosses
    off-screen-left → doorway centre; drawn BEFORE the arch so the dark opening swallows
    him), `DANCE_GLOW_END 1.75` (green/white flood), `DANCE_TEXT_T 2.15` (far-side growth
    completes 0.35x→1.0 ease-out-cubic under the fading white; pose clock starts here so
    the dance loops whole from the moment control arms).
  - **Dancer** (chars.js, scene-only, live-painted — no bake): `drawDancer(ctx, x, y, dance, t)`
    rig in local units × `DANCER_SCALE` 1.3, feet at origin, one `dancerPose(dance, t)`
    driving three procedural poses over a 4-limb IK rig (bent arms: upper+fore with
    shoulder→hand distance check; mirrored far-side limbs at darker `HB.deep`).
    Berry torso (lit→base→shade→deep grad + AO/gloss/rim), neck, r4.8 head with cap;
    front view = face + smile, back view = bare head.
  - **Twerk legibility fix (two-part root cause):** (a) the pose itself — buns hung at
    mid-thigh leaving shins below (read "wide-hipped standing"), and with 12.5-length
    arms the hands cannot reach the knees in a deep squat (shoulder→knee 18.2 > 12.5).
    Fix: buns dropped to the torso bottom (abs y ≈ −3.7 at rest, a shin's width off the
    ground, knees ±5.6 poking past bun sides ±5.2, cleft line between), arms parameterized
    per-pose (`A.u`/`A.f`) with the twerk override to 7.5/7.5 and IK targets on the bun
    tops (distance 14.5 < 15 ✓), limbs thickened (thigh/shin/upper 3.4, fore 3.0), hands
    r2.1 in near `HB.shade`/far `HB.deep` to read on the `HB.base` buns. (b) My probe
    scale math was wrong (isolated canvas 4× × 1.3 = ÷5.2, not ÷4) — the code always drew
    the pose spec. Pixel probes are ground truth at this scale; the VLM hallucinates
    (claimed a face on the back view; probes found 0 dark eye pixels).
  - **Exit input:** `input.anyKeyPressed` set on non-repeat keydowns, consumed via
    `consumeAnyKey()`, armed only at `danceT >= DANCE_TEXT_T` — held direction keys
    (repeats) can never skip, and a pre-arm press is dropped at the frame-end transient
    reset (verified: 'x' at danceT 0.72 rejected; held ArrowRight for 40+ s never
    skipped).
  - **Boss path:** `danceExit` computed at `startDance()` — last level ⇒ `'win'`.
    1-3 has no gate; the boss defeat call site (`defeatT > 1.5`) now funnels through
    `onBossDown()` → `startDance()`; `goWin()` is reachable ONLY through the dance exit.
  - Verified live in-page: full run 1-1 gate → dance (random 0/1/2, `danceExit:'next'`,
    +1000) → 1-2 → gate → 1-3 → boss `defeated` (needs `active` — a far-spawn boss is
    not simulated until the camera reaches it; a real defeat is always active) → 1.5 s
    → `GATE_DANCE danceExit:'win'` → fresh key → `WIN` (score 4000) → Enter → `TITLE`.
    Twerk geometry pixel-probed at max thrust: hips (±2.4,−10.3), knees (±5.6,−4.7),
    ankles (±1.6,0), bun bottom abs −3.7, hands on bun tops. All three dances + walk-in
    frame vision-checked, no glitches.
  - Gates: `hd-verify` `{"ok":true,"sceneScale":4,"scene":[1024,960],"determinism":true,
    "stripHash":"f7206cb3","seam":{"cam140":true,"cam420":true}}` — hash unchanged (the
    dance scene is state-gated, out of the bake strips). Parked `tools/verify.mjs`
    drift continues, never re-run.
  - Next: R-8 was the post-R-7 feature request. All eight commits are UNPUSHED
    (6554051, b27074e, bfd3467, 9960a75, d1833e1, 2995d5b, 7bffa55, + this one).

- [x] **R-9** — hero arms: proportional limbs on the small and big strawberry (approved 2026-11-21)
  - Play request: "during normal play, can we add arms to strawberry that are
    proportional to its size". Single file: `src/chars.js`. No canvas/anchor changes
    — arms draw inside the existing 12px-wide bake canvas (small 12×14, big 12×28).
  - **Geometry:** `ARMS` table keyed small/big — `sy` shoulder y, `sx` shoulder x
    offset (under the silhouette edge), `w` stroke width, and per-state `[outX, dy]`
    for `down`/`mid`/`up` hand positions. Small: shoulder (6±4.35, 7.2), down hand
    (6±4.85, 10.95) — arm ≈3.75–4.1 units on a 10.3-unit body (~38% of body height);
    big: shoulder (6±4.45, 12.6), down hand (6±4.95, 19.45) — same ratio, the big
    body is 1.81× tall. Widths 1.3/1.8, hand dot r = 0.62·w. `ARM_BY_FRAME`
    (9 entries in frame-table order) swings `mid` on the stride frames, `up` on
    jump/fall, `down` otherwise — idle, blink, together, land rest.
  - **Contrast (measured, not guessed):** first pass used `HB.shade` stroke +
    `HB.deep` hand — arm (172,30,61) vs body-at-arm-height (197,47,66) was too
    close to read and the VLM confirmed "no arms visible". Final: stroke
    `HB.deep` (102,13,44) + hand dot `HB.shade` (172,30,61) — deep reads on both
    the base band and the background (probe bg 223,232,210).
  - **Draw order:** feet → (squash-transformed) body/shading/seeds/cap/face → arms
    LAST, deliberately OUTSIDE the squash transform: a still arm through the
    one-frame landing squash is invisible at this scale and keeps the hand dot
    unclipped. The shoulder end hides under the silhouette edge; the limb is the
    darkest body tone.
  - Verified: pixel probes on both heroes (small: arm mid (102,13,44) ✓, hand
    (172,30,61) ✓, body at arm height (197,47,66); big: same arm/hand values,
    body (185,39,64); leftmost arm px x=2 / rightmost x=45 (small, canvas 0–47)
    and x=1/x=46 (big) — no clipping). Scene-scale capture 1024×960 with 4× zoom
    before/after crop: at the arm position the before pixel is background green
    (119,188,100), the after is the arm (89,12,35); body pixels identical in both.
    VLM vision-check at scene scale confirmed arms present/absent as expected.
  - Pre-existing, NOT a regression: the hero's visible foot sliver (device rows
    53–55, logical y ≈13.25–13.75) renders dark red, not the green `F.green` the
    `foot()` call specifies. Proven pre-existing — byte-identical between the
    committed arm-less build and the arms build (R-2 art, out of scope here).
  - Gates: `hd-verify` `{"ok":true,"sceneScale":4,"scene":[1024,960],"determinism":true,
    "stripHash":"f7206cb3","seam":{"cam140":true,"cam420":true}}` — hash unchanged
    (the arm pixels land in the hero's baked strips but the strip hash covers the
    strip layout/edge contract, which is untouched). Parked `tools/verify.mjs`
    drift continues, never re-run.
  - Next: R-9 was the post-R-8 play request. All nine commits are UNPUSHED
    (6554051, b27074e, bfd3467, 9960a75, d1833e1, 2995d5b, 7bffa55, 763be6f,
    + this one).

- [x] **R-10** — run arms: contralateral swing in concert with the legs (approved 2026-11-21)
  - Play request: "can we have the arms move while the character is running. In
    concert with the legs". Single file: `src/chars.js`. No canvas/anchor changes.
  - **Design:** the symmetric `[outX, dy]` arm states became per-side `{L: [outX,dy],
    R: [outX,dy]}` (the draw loop reads `s < 0 ? a.L : a.R`), and two run-swing
    states were added: `lf` (left hand up, right hand low) and `rf` (mirror). The
    arm OPPOSITE the leading leg carries forward/up, so the arms read as pumping
    with the stride instead of bobbing in unison.
  - **Frame mapping:** run frames are baked stride/pass/strideBack/together —
    stride (right foot forward) ⇒ `lf`, pass ⇒ `mid`, strideBack (left foot
    forward) ⇒ `rf`, together ⇒ `mid`. `ARM_BY_FRAME` is now
    `['down','down','lf','mid','rf','mid','up','up','down']`; jump/fall keep
    `up`, idle/blink/land keep `down`.
  - **Amplitude:** small hero's hands travel sy+1.70 → sy+5.45, a 3.75-unit
    (15 device px at 1:1) vertical swing vs the old 0.35-unit ≈ 1.4 px
    down↔mid bob — why the arms previously read as still. Big: 6.4 units
    (25.6 px), same ratios as R-9. Trail-hand x flare ≤ 5.05/4.95 keeps the
    hand dot inside the 12px canvas (small: 0.95 − r 0.806 > 0).
  - Verified: pixel probes at 1:1 on all four run frames (exact hand-dot color
    (172,30,61) clusters): stride left (6,35) / right (44,50); strideBack right
    (41,35) / left (3,50) — exact mirrors; pass/together both ≈(5,41) and
    (43,41) (odd frames carry the pre-existing −1 run bob). 4x-zoom before/after
    sheet vision-checked (alternation visible, no clipping, legs alternate);
    in-game scene capture mid-stride shows one arm high, the other low.
  - Gates: `hd-verify` `{"ok":true,"sceneScale":4,"scene":[1024,960],"determinism":true,
    "stripHash":"f7206cb3","seam":{"cam140":true,"cam420":true}}` — unchanged
    (the arm pixels land in the hero's baked strips; the strip hash covers the
    strip layout/edge contract, untouched). Parked `tools/verify.mjs` drift
    continues, never re-run.
  - Next: R-10 was the post-R-9 play request. All ten commits are UNPUSHED
    (6554051, b27074e, bfd3467, 9960a75, d1833e1, 2995d5b, 7bffa55, 763be6f,
    1d0549d, + this one).
