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
