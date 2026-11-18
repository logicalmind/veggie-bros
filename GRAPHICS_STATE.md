# GRAPHICS_STATE — RESUME HERE (branch `feature/graphics-upgrade`)

**Read `GRAPHICS_PLAN.md` first** (the whole contract: decisions, architecture, frozen API, gates, slice rules). Then read this file. Then stop reading — nothing else is required, and `WORKFLOW_STATE.md` (131 KB), `RESUME.md`, `IMPLEMENTATION.md`, `docs/REVIEW-2026-11-15.md` are all **out of scope for this work**.

This file is the only graphics doc safe to read in full, and the integrator owns it.

## Working rules the user set (they override convenience)

- **One subagent at a time.** Integrator + one worker = 2 total. Never spawn a second while one is live.
- **Subagent context windows stay under 100 K tokens, smaller is better** (user directive 2026-11-17). Brief a worker with exact file paths *and line ranges*, never whole files; hand it the gate command to run rather than the harness source; tell it which ids to run. A slice that would need > ~400 lines read is cut in half before dispatch.
- **Small slices** (plan §9): one file, ≤ ~150 new lines, ≤ ~400 lines read. Agents report in ≤ 40 lines.
- **Write incrementally** so an abort leaves a loadable tree; `node --input-type=module --check` after every append.
- Green suite at every checkpoint: `node tools/verify.mjs` → `44/44 pass, 0 fail` (ids may be added only when they can pass).
- The user ends the session and starts a fresh one whenever context gets heavy. **Keep this file current so that costs nothing.**
- **The integrator does not author handoff prose** (user directive 2026-11-18, after it was noticed that doc-writing was the biggest single sink of integrator context). The worker that measures writes its own facts to `/tmp/vb-<slice>-result.json` **and** appends its own bounded section here — ≤ 14 lines plus its one slice-table row, nothing else in the file. The integrator's part is only: spot-check two or three numbers against that JSON, run the gate, commit. This **overrides** plan §0's "only the integrator writes `GRAPHICS_STATE.md`"; while a worker owns a doc edit the integrator does not touch the file, so nobody collides.

## Cold start — run these five, in order

```sh
cd /Users/jasonjordan/repos/veggie_bros && git branch --show-current        # feature/graphics-upgrade
node tools/verify.mjs | tail -2                                             # expect 44/44 pass, 0 fail
for f in src/*.js; do node --input-type=module --check < "$f" || echo FAIL $f; done
grep -c "^export" src/sprites.js                                            # expect 20 (17 draw fns + bakeSprites + TEXT_PITCH + TEXT_CELL_H)
./serve-local.sh 8010 &                                                     # NEVER port 8000 (splash inference engine)
```
If `src/sprites.js` shows a low export count or fails `--check`, an agent died mid-write: the last good copy is `git show HEAD:src/sprites.js`, the last good art-data partial was `/tmp/vb-rescue/sprites-partial-685.js`. Do **not** guess the missing half — re-run slice S-01.

## Tree state — **suite green 44/44**

Head and commit count are deliberately **not** pinned here — they move every time this file itself is committed, which is how the previous revision ended up one behind. Read them live: `git log --oneline -1` and `git rev-list --count main..HEAD`, and expect a clean `git status --short`. **The last change to any `src/` file is `c28be8b` (S-01c)**; everything on top of it is documentation.

| Commit | What | Verified? |
| --- | --- | --- |
| `a049805` `d9d838b` `2a38bda` `f90bd56` | plan + gates + this log | — |
| `9539ab3` | harness `drawStats()` per-frame accounting, `VB_DRAWSTATS=1` probe | yes: 44/44, byte-identical ×2 |
| `8ba8033` | `src/pixels.js` (467) ramps + bake passes; `src/atlas.js` (237) pack + `blit`; scale constants | yes: real-canvas bake smoke, packer stress 160 rects / 39 ms / 0 bleed |
| `45e3d9e` | `src/fx.js` (434) pool + squash + shake | yes: 100k ticks, heap growth −0.4 KB; determinism digest; DOM-free |
| `9e6169c` | `src/terrain.js` (769) strips + AO + parallax — **draft** | **NO** — its acceptance tests were never run |
| `6ffaa53` | harness ink bridge (`inkAt`, `inkRects` on offscreen canvases) — **partial** | suite yes (44/44, byte-identical to HEAD harness); blit-ink probe + check-impact list **outstanding** |
| `e98a95e` | `src/sprites.js` (1025) art as matrices — **2 known reds** | partial: `missing === 0`, density floor met, 128 live colours; `R21`/`R24` RED |
| `b82f86a` | outline pad → particles only; rim inside the matrix | yes: 44/44 twice, 253 `fillRect`/frame |
| `3b7070e` | docs only | — |
| `298d110` | `fx.js` one line: `KIND.SPARK` puff box 3×3 → 5×5 to match the baked art box | audited diff, 44/44, syntax clean (integrator's earlier note, re-checked) |
| `c28be8b` | S-01c two-tone rim in `rim()` — hero/hero.big/lives/boss/shard two-tone, turnip single-tone | yes: 44/44, all 27 atlas inked boxes byte-identical, hero.small 29→34 / boss 16→24 colours, live tone bands unchanged |

**The art cutover is already live in the browser:** the 18 draw wrappers blit from the atlas (lazily baking on first draw), so the world is no longer procedural — a steady 1-1 frame is **253 `fillRect` + 62-71 `drawImage`** (procedural baseline 1114/0) and the live canvas carries **140→202 unique colours** across a scroll, against **35–56 measured on `main`** (plan §2's "21" does not reproduce; see the `R49` table). `src/render.js` is still the one doing the calling (no `composite.js` yet), and no module calls `bakeSprites()`/`bakeAll()` at boot — the bake happens lazily on first draw (14-19 ms).

**Landed API vs plan §3.1 (measured by `grep -n '^export'`, verified 2026-11-18 — later slices code against these names, do not "correct" them):** `atlas.js` ships all eight §3.1 names exactly. `pixels.js` ships all six plus five colour helpers §3.1 never listed (`rgbToHex`, `parseColor`, `colorToCss`, `rgbToHsl`, `hslToRgb`) that `terrain.js` imports. `fx.js` exports **`update(dt)`**, not §6's `updateFx(dt)`, plus `init()`, `dust`, `landing`, `sparkle`, `poof`, `shake`, `getSquash`, `draw(ctx, camX)`, `isIdle`; `KIND` values are the atlas keys `'fx.dust' | 'fx.spark' | 'fx.poof' | 'fx.chip'`. `config.js` has `ART_SCALE = 2` and `FX_SCALE = 0.5` but **no `MAX_BACKING_PX` and no `BLOOM_MAX_ALPHA` yet** — S-04/S-06 must own those constants in `composite.js` (config edits belong to S-11, and one file per slice).

### Measured reality for `R49` — the figure this file carried did not reproduce

Probes (all pixel readback, no eyeballs — I cannot see images): `/tmp/vb-probe-art.js` (per-key atlas readback + inked-box digest), `/tmp/vb-probe-density.js` (live canvas, v3), `/tmp/vb-probe-sets.js` (exact colour sets). Before/after captures: `/tmp/vb-probe-{art,density}-{before,after}.json`. Shots: `/tmp/vb-shots/s01c-{before,after}-play.png`. **The `before-{title,play}.png` files this file used to name as the visual baseline do not exist** — `/tmp/vb-shots/` holds only `w2-sprites-play.png`, `w2-terrain.png`, and my S-01c pair, so S-17's "screenshots vs before-*" comparison has no baseline yet.

Definitions the probes use, which **S-14 must adopt or deliberately supersede**:

- **non-sky tile = decided by the LEVEL, not by pixel coverage**: `isSolid(tileAt(G.level, wtx, ty))`, measured over the tile's exact screen rect with ≥14 of its 16 px on screen. Deciding it by "has ≥1 non-sky pixel" makes `minimum` unfalsifiable — a lone sprite-edge pixel can never hold 3 tone bands, so the clause can only ever fail.
- **tone band** = distinct `round(0.2126R + 0.7152G + 0.0722B)` (the harness's own `lumsIn`, `tools/verify.mjs:642`), plus a **q8** bucketed variant, because opaque dither pixels inflate exact-luminance counts (same reason `coloursIn` takes a `quantum`).

At head, 12 frames sampled over a 1-1 run (cam 0→365, 423 geometry-tile samples): **exact min 14 / med 24 / max 37**; **q8 min 9 / med 12 / max 16**. Per-tile-char min: `X` 10, `P` 10, `B` 12, `|` 9.

**Consequence: `R49`'s tone-band clauses (`med ≥ 5`, `min ≥ 3`) are already green on this tree by 3-9×.** The "min 2 / med 5 over 86 non-sky tiles / 121 colours" figure earlier revisions carried is not reproducible under either tile definition — `med 5` exact is impossible for dithered tiles (measured 24). S-14 must therefore NOT register a tone-band clause that already passes; before registering, **run `/tmp/vb-probe-density.js` against `main` in a worktree and show the red**, or pick thresholds the old renderer demonstrably misses. Per §10, the fix is never a weakened check.

### Gate defect 1 RESOLVED — `R49` is red on `main`, with the numbers to prove it

A/B by checkout, never by `git stash` (gotcha 15): `git worktree add /tmp/vb-main main` (`main` at `d16b002`), `cd /tmp/vb-main && ./serve-local.sh 8011`, same probe, same port-swap. Both builds driven identically: `tab.press('Enter')` then `tab.keyDown('ArrowRight')` **held** for the whole run (the probes send no input of their own — see gotcha 16), 12 frames sampled every 20, live 256×240 canvas at `dpr 1`, cam 0→366.3 both sides.

_(Both the worktree and the 8011 server were torn down right after the capture — `git worktree remove /tmp/vb-main`; the four JSON files above are the evidence, and nothing in the tree depends on them. Recreate with gotcha 15's recipe if S-14 wants a live red.)_

`/tmp/vb-probe-tiles.js` (new; per-tile **clause** probe, same geometry rule as density v3) → `/tmp/vb-probe-tiles-{main,branch}.json`. Density v3 re-run on `main` → `/tmp/vb-probe-density-main.json`.

| clause (plan §8 `R49`) | `main` d16b002 | this branch | planned threshold |
| --- | --- | --- | --- |
| tone bands/tile, exact `lumsIn` (426 vs 428 tiles) | min **2** / med **3** / p10 3 / max 6 | min 14 / med 24 / p10 23 / max 37 | med ≥5, min ≥3 → **RED on main** |
| tone bands/tile, q8 | 2 / 3 / 3 / 4 | 9 / 12 / 12 / 16 | — |
| colours/tile, exact | min **2** / med **3** / max 7 | min 14 / med 27 / max 44 | med ≥6 → **RED on main** |
| colours/tile, q8 (`coloursIn(8)`) | 2 / 3 / 5 | 10 / 17 / 29 | — |
| unique colours, whole frame | 35–56 (12 frames) | 192–202 | ≥90 → **RED on main** |
| `fillRect`/`drawImage` per live frame | 1149–1356 / 0 | 253 / 62–71 | `R47` |

Per-char minima on `main` (`q8`): `X` 3, `P` 3, `B` 2, `|` 3 — the flat-palette floor. So all four `R49` clauses are falsifiable as written; S-14 can register them unchanged. Two plan §8/§2 **parentheticals are wrong** and must be corrected in-doc (never the thresholds): old tone bands are med **3** / min **2** / max **6** (not 2/1/5), old colours/tile max **7** (not 10), and "21 unique colours on screen" does not reproduce — a live frame carries **35–56** on `main`. The margin is thin (main's med 3 vs threshold 5), so S-14 must print the measured `main` figures in the check's comment or the next reader will "fix" it again.

### S-04 RESULT (2026-11-18)

| row | css | backing | capped | k | upscale | pass-2 frac (w/h) | `upscale ≤ backing` | MB |
|---|---|---|---|---|---|---|---|---|
| s=1@dpr1 | 256×240 | 256×240 | no | 1 | 256×240 | 1.000 / 1.000 | yes | 0.546 |
| s=1@dpr2 | 256×240 | 512×480 | no | 2 | 512×480 | 1.000 / 1.000 | yes | 1.249 |
| **s=1@dpr3 = phone** | 256×240 | 768×720 | no | 3 | 768×720 | 1.000 / 1.000 | yes | 2.421 |
| s=1.5@dpr1 | 384×360 | 384×360 | no | 1 | 256×240 | **1.500 / 1.500** | yes | 0.546 |
| s=1.5@dpr2 | 384×360 | 768×720 | no | 3 | 768×720 | 1.000 / 1.000 | yes | 2.421 |
| s=1.5@dpr3 | 384×360 | 1024×960 | **yes** | 4 | 1024×960 | 1.000 / 1.000 | yes | 4.061 |
| s=2@dpr1 | 512×480 | 512×480 | no | 2 | 512×480 | 1.000 / 1.000 | yes | 1.249 |
| s=2@dpr2 | 512×480 | 1024×960 | no (area == cap) | 4 | 1024×960 | 1.000 / 1.000 | yes | 4.061 |
| s=2@dpr3 | 512×480 | 1024×960 | **yes** | 4 | 1024×960 | 1.000 / 1.000 | yes | 4.061 |
| s=3@dpr1 | 768×720 | 768×720 | no | 3 | 768×720 | 1.000 / 1.000 | yes | 2.421 |
| s=3@dpr2 | 768×720 | 1024×960 | **yes** | 4 | 1024×960 | 1.000 / 1.000 | yes | 4.061 |
| s=3@dpr3 | 768×720 | 1024×960 | **yes** | 4 | 1024×960 | 1.000 / 1.000 | yes | 4.061 |
| s=4@dpr1 | 1024×960 | 1024×960 | no (area == cap) | 4 | 1024×960 | 1.000 / 1.000 | yes | 4.061 |
| s=4@dpr2 | 1024×960 | 1024×960 | **yes** | 4 | 1024×960 | 1.000 / 1.000 | yes | 4.061 |
| **s=4@dpr3** = cap case | 1024×960 | 1024×960 | **yes** (`sqrt(983040/983040)=1`) | 4 | 1024×960 | 1.000 / 1.000 | yes | 4.061 |

`css = 256s × 240s`; `scene` 256×240, `lightmap` 128×120, `bloom` 64×60, `bloomHalf` 32×30 in **every** row; MB = five-layer total of the 8 MiB ceiling. `configure()`/`layout()`/`kFor()` are DOM-free (a5 `allocations 0 → 0`); only `layers()` allocates (first call +5 canvases, repeats +0). Numbers: `/tmp/vb-s04-result.json`, probe `/tmp/vb-probe-composite.js`. Sizing **math** with explicit dpr — real device emulation is S-17.
- **`k = max(1, min(floor(backing.w/sceneW), floor(backing.h/sceneH)))` — per-axis floor ⇒ `upscale ≤ backing` on BOTH axes by construction, so pass 2 can only ever upscale, never downscale.** The area-`sqrt` k it replaces violated that inside the shipped domain: css 384×360@1 (`s = 1.5`) has 138 240 backing px and `round(sqrt(138240/61440)) = 2` ⇒ a 512×480 upscale against a 384×360 backing = 0.75× downscale, i.e. 3-device and 4-device px side by side on nearest-neighbour art (the mush §4 forbids). Measured pass-2 fractions over all 16 rows: min 1.0, **max 1.5** (`s=1.5@dpr1`), w == h on every row because the box is aspect-exact ⇒ §4's "≤ 2×" ceiling holds with 25 % margin (probe a9/a10).
- **Reachable `(s, dpr)` domain only — S-09 must feed `configure()` `fit()`'s numbers** (`main.js:47-59` sets `canvas.style` to `256s × 240s`, `s ∈ {1, 1.5, 2, 2.5, 3, 3.5, 4}` clamped to [1,4], `SCALE_STEP` 0.5), so the css box is always 4:3 and **a raw-viewport `configure(375, 667, dpr)` is NOT a shipped case** (the earlier table rows of that shape were synthetic and are withdrawn). If S-09 ever feeds something that is not `256s × 240s`, the per-axis floor silently shrinks `k`: measured `configure(375, 667, 2)` → backing 743×1322 (capped), `k = min(2, 5) = 2`, upscale 512×480, fractions 1.4512 / **2.7542** — the y axis alone busts §4's 2× ceiling, and `configure(375, 352, 3)` → 1023×960, `k = 3`, 1.3320 / 1.3333 stays inside it. Nothing in `composite.js` rejects a non-box input; the invariant is S-09's to keep.
- **`phone` reference row for S-17** — `fit()`'s own arithmetic for a 375×667 coarse-pointer device: `bar = min(80, max(0, 667 − 240·1.5)) = 80`; `r = min(375/256, 587/240) = 1.4648`; `whole = 1 < CRISP_MIN_SCALE 1.4` ⇒ half-step `floor(1.4648/0.5)·0.5 = 1`; `s = clamp(1,1,4) = 1` ⇒ **css 256×240**. At dpr 3 that is the table's `s=1@dpr3` row: backing 768×720, `capped:false`, `k = 3`, upscale == backing, fraction 1.0, **2.421 MB** (not ~1 MB — the 768×720 `upscale` buffer alone is 2.21 MB). dpr 3 assumed; S-17 measures the real device.
- Gate: `44/44 pass, 0 fail`, no `--check` FAIL, **128 lines**. a1 scene 256×240 everywhere · a2 `upscale == scene·k` (k per row above) · a3 worst layer 1024×960 · a4 max 4 258 560 B = 4.061 MB · a5 replay all 16 configs `0 → 0` allocations · a6 identities stable, first `layers()` +5, repeat +0 · a7 smoothing on bloom/bloomHalf only · a8 `1× → 1024×960@3 → 1×` round trip byte-identical, 0 reallocs · a9/a10 above. Exports (all of them): `MAX_BACKING_PX` (now exported — §4 names it, S-09's boot sizing reads it), `BLOOM_MAX_ALPHA = 0.35` (§7 ceiling; nothing consumes it until S-06's bloom composite), `SCENE_SCALE`, `configure`, `layout`, `layers`, `metrics`, `kFor(sceneW, sceneH, {w,h})` (also accepts a `layout()` object; pure). `setBytesTarget`/`getBytesTarget` were unrequested, uncalled surface — deleted; `MAX_BACKING_PX` is the only budget knob.

## Slice queue — run one at a time, in this order

**NEXT UP: S-04** (`src/composite.js`, new file). Two constraints it inherits from the S-02 result below: strip canvases are **art-scale** (128×480 for a 64×240 logical strip), so a terrain blit's dest must be `64 × 240` logical px only when the destination surface is logical-res — into an art-scale scene buffer it is `128 × 480`, and blitting an art-scale strip into a 64-px dest with `imageSmoothingEnabled = false` discards every odd art column (measured: 242 → 239 exact colours on strip `1-1|fields|0|20|1cqa68a`, q8 118 unchanged). And `MAX_BACKING_PX` / `BLOOM_MAX_ALPHA` do not exist yet — they belong in `composite.js`, not `config.js` (config edits are S-11's).

### S-02 RESULT (2026-11-18) — the `src/terrain.js` draft passes: **no source change**

Headless half — `node /tmp/vb-w2-logic.mjs` re-run at `3185cee`: **ALL ASSERTIONS PASSED**, exit 0. Per level: `stripCount = ceil(cols·16/64)` (1-1: 45 strips / 180 cols / 2880 px), selection = **exactly the minimal cover** (no gap, no double coverage), purity (45/50/40 identical strip keys across a scroll), used-block invalidation (`P@64,5 → U` dirties 2 strips), `live ≤ 12` over a full 1-1 scroll with `stripsBaked == stripCount` (maxLive 12, 7.93 MB resident), 3 parallax layers at integer dx (−97/−66/−27, alpha .92/.96/1), ambient 512×480 art px, banned-API scan clean.

Seam half — browser readback, `/tmp/vb-probe-seam.js` → `/tmp/vb-probe-seam.json` (worker-authored; I re-ran it myself and re-derived the control). Bake 1-1 twice, `stripPhase: 0` (45 strips) vs `stripPhase: 32` (46 strips, **0 shared keys**), blit `visibleStrips()` into a fresh 256×240 canvas at camX 0/63/65/1312/2624, diff every pixel. Two different strip grids over the same world region ⇒ any strip-relative shading shows up — which is why `bakeStrip`/`aoColumns` (`src/terrain.js:313-449`) read `artTile`/level columns on absolute coordinates.

| camX | 0 | 63 | 65 | 1312 | 2624 |
| --- | --- | --- | --- | --- | --- |
| opaque px (of 61 440) | 8960 | 11 472 | 11 584 | 15 104 | 14 592 |
| distinct lums | 127 | 137 | 140 | 160 | 137 |
| cross-phase `maxD` / `maxRGBA` | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 |
| px with dL > 0 / >3 / >8 | 0/0/0 | 0/0/0 | 0/0/0 | 0/0/0 | 0/0/0 |

Minimal cover, all 10 (phase × camX): uncovered 0, overlapped 0, `maxCover 1`, nothing past the level's right edge. The grids really differ — at camX 1312 phase 0 gives `[-32,32,96,160,224]` (5 strips) and phase 32 `[0,64,128,192]` (4). Purity under eviction: re-render phase 0 at 1312 after the phase-32 pass, `live` pinned at 12 → `maxRGBA 0`, **0 / 245 760** differing bytes, 3 ms.

**The zero is not a blind probe.** `/tmp/vb-probe-seam-control.js` → `-control.json` (integrator-authored positive controls, same bake, camX 1312): 2nd strip's source rect shifted 1 logical px → `maxD 199`; dest shifted 1 px → `maxD 227`; compared against a blank canvas → `maxD 241`, 15 104 differing px. The control's *first* run caught a measurement bug of my own: blitting a strip into a 63-px destination leaves a 1-px uncovered column at each seam and fakes `maxD 233` between the two phases. **Any seam probe must blit the full `STRIP_W`.**

Intra-render column-pair profile — descriptive, **do not gate on it**: at 1312 the 3 strip-boundary column pairs have mean |Δlum| median 71.4 vs interior 22.3, which looks damning and is not. Every maximum in that statistic sits at `worldX % 16 == 15` — the 1-px tile-edge step `shadeTile` draws deliberately — and a boundary pair is always *also* a tile-edge pair, while only 12 of 250 interior pairs are (16 tile-edge pairs per 256 columns, 4 of them the boundary pairs). So the two medians are not comparable; the honest statement is `boundary max 71.4 < interior max 72.8` — a step at a strip boundary is no bigger than the identical step elsewhere. The cross-phase delta is the load-bearing number: a bake that depended on its own crop moves with the phase, a tile-edge step does not.

Cost, cold after `invalidate()`: 1-1 phase-0 first render **11 ms** (4 strip bakes), the whole 5-camera pass 21 ms, a fresh 46-strip phase-32 grid 10 ms (`stripsBaked 30`, `cacheBytes 2 949 120`). S-09 must fit level baking under plan §2's 60 ms boot budget — this is ~⅓ of it, before ambient/parallax.

**Gate defect 2 — reported, not re-pinned: the plan's `≤ 4 strips` clause is unsatisfiable.** A 256 px window over world-aligned 64 px strips touches 4 only when the view start is 64-aligned, otherwise 5 (`floor(x/64) … floor((x+255)/64)`), and `cam.x` is fractional and never 64-aligned. Measured: 4 at camX 0/2624, **5 at camX 63/65/1312** — which the draft itself prints as `strips=5 (minimal cover = 5)`. The draft is right, the clause is wrong; the honest bound is `ceil(VIEW_W / STRIP_W) + 1 = 5`. Realigning strips to the view to satisfy it would reintroduce gotcha 6. **Awaiting the user's call** on the plan text; `R47` (S-12) must count 5 strip blits, not 4.

| ID | Slice | File | Gate (must be shown, not asserted) |
| --- | --- | --- | --- |
| S-01 | art as matrices: registrations + 18 wrappers + `bakeSprites` | `src/sprites.js` | **done** (`e98a95e`): 57 frames + 9 emissive masks, density floor met, `missing === 0`, bake 18 ms |
| S-01b | outline-pad policy fix → `R21`/`R24` green | `src/sprites.js` | **done** (`b82f86a`): 44/44, `PADDED()` limited to the four `fx.*` puffs, inked boxes provably unmoved |
| S-01c | two-tone rim to recover character tones (deep on the away edge, key-lit edge one ramp step up) | `src/sprites.js` | **done (`c28be8b`)**, per key by atlas readback: hero.small 29→34 colours / 25→30 bands, hero.big 25→28, lives 19→21, boss 16→24 / 15→19, shard 11→14; `turnip` **left single-tone on purpose** (a distinct lit tone costs it 22→19 colours — see gotcha 14). All 27 inked boxes byte-identical, 44/44. **The live tone-min clause was already met (9-14) before the change and did not move** — see the `R49` section above. |
| S-02 | validate the terrain draft, fix if it fails | `src/terrain.js` | **done 2026-11-18, no source change** — see "S-02 RESULT" above. Coverage/minimal-cover/purity/invalidation/`live ≤ 12` via `/tmp/vb-w2-logic.mjs`; 64 px seam delta via `/tmp/vb-probe-seam.js` + `-control.js` = **0** with positive controls at 199/227/241. The `≤ 4 strips` clause is the one item that fails, and the clause is the defect (gate defect 2). |
| S-03 | finish ink bridge (probe: alpha 0.5 / `lighter` / mirrored blit; list of checks that will see different ink) | `tools/verify.mjs` | **PARKED by the user — run later.** 44/44 byte-identical must survive |
| S-04 | composite layer buffers + DPR `k`-factor sizing (no drawing yet) | `src/composite.js` (new) | **done 2026-11-18** — six-row table above: 256×240@1 backing 256×240 k1 scene 256×240 upscale 256×240 lightmap 128×120 bloom 64×60 bloomHalf 32×30 = 0.546 MB; 375×667@3 backing 743×1322 capped k4 upscale 1024×960 = 4.061 MB. a1 PASS (scene 256×240 ×6) a2 PASS (k 1/2/3/2/4/4, upscale = sceneW·k) a3 PASS (worst 1024×960) a4 PASS (max 4,258,560 B) a5 PASS (0 → 0) a6 PASS (identities, +5 then +0) a7 PASS (bloom/bloomHalf ON, scene/upscale/lightmap OFF) a8 PASS (identical, 5 → 5) |
| S-05 | lightmap: pre-baked glow-sprite blits + ambient `multiply` | `src/composite.js` | zero `createRadialGradient` in a frame; ≤ N blits |
| S-06 | bloom: emissive-mask-driven source, down/up chain, `BLOOM_MAX_ALPHA` ceiling | `src/composite.js` | alpha ceiling honoured; no `ctx.filter`/`shadowBlur` |
| S-07 | world layer: terrain strips + atlas sprite blits + shake `(o,-o)` | `src/render.js` | world ≤ 60 `fillRect`, ≤ 240 `drawImage` (plan `R47`) |
| S-08 | HUD/overlays composited crisp and unshaken, after FX | `src/render.js` | total `fillRect` ≤ 450; text never blurred |
| S-09 | boot: DPR backing store, resize, `bakeSprites()` + `bakeLevel()`/`invalidate()` at level load, `fx.update` | `src/main.js` | bake once per boot and per level; no bake inside a steady frame |
| S-10 | FX emit call sites at existing score-popup events (`hit()` strings vs `burst()` KIND values!) | `src/main.js` | `fx.metrics()` shows emits per event; gameplay snapshot unchanged (R51 spirit) |
| S-11 | FX tuning constants + `index.html` | `src/config.js`, `index.html` | two files only because both are ~5 lines |
| S-12 | `R47` draw budget + `save`/`restore` balance clause | `tools/verify.mjs` | red before S-07, green after |
| S-13 | `R48` bake-once (+ demote harness scratch buffers) and `R52` shake-stays-render-only | `tools/verify.mjs` | |
| S-14 | `R49` art density (≥90 colours, tone bands ≥5 med / ≥3 min, ≥6 colours/tile, ±3 LSB) | `tools/verify.mjs` | must be red on `main` |
| S-15 | `R50` FX determinism (draw-stream digest) + `R51` frozen-gameplay snapshot diff | `tools/verify.mjs` | |
| S-16 | rewrite `R38` + `R45` onto `rec.drawImages`; re-derive anything in §8.1's list | `tools/verify.mjs` | claims preserved, never loosened |
| S-17 | browser gate: 60 s of 1-1 + 1-3 boss at DPR 3 / 375×667 | integrator, no subagent | `dt_med ≤ 16.7`, `dt_p95 ≤ 20`, 0 console errors, screenshots vs `/tmp/vb-shots/before-*.png` |
| S-18 | `architecture.md` module map + Deviations | `architecture.md` | |
| S-19 | `requirements.md` "8-bit-inspired" + `VEGGIE_BROS_PLAN.md` locked decisions | two docs | |
| S-20 | `README.md`, full suite, final commit | `README.md` | 44+ ids green |

## Gotchas that have already cost time

1. `sprites.js` truncated with zero exports parsed fine but killed the import chain — land exports early.
2. The harness stub's `getImageData` returns transparent black: `getImageData`/`putImageData` are banned in `src/`, bake included.
3. Atlas art inks nothing unless bake canvases carry ink — S-03's bridge must be green before `R49`-style checks are trusted.
4. `fx.hit(entity, 'land'|'stomp'|'hurt'|'hop'|'jump')` takes **strings**; `fx.burst(x, y, n, KIND.SPARK)` takes a **KIND value**. Mixing them silently degrades to a default.
5. `shakeOffset()` is one signed int; the renderer applies `(dx, dy) = (o, -o)`. Never touch `cam.x`.
6. Terrain strips must shade from **level columns**, never from their own pixels, or every 64px boundary shows a seam.
7. `R19`/`R24` print absolute draw indices; they will legitimately shift. Assertions are relative — do not "fix" the printed numbers.
8. `R48` must demote harness scratch buffers first (`bakeCalls=1064` on a clean run) or it fails for a reason unrelated to the renderer.
9. Never `./serve-local.sh 8000`; both scripts refuse it by design.
10. Two agents have died on `503 frontend_overloaded`. Small slices, incremental writes, one at a time.
11. **`Enter` starts the game; Space only jumps** (`src/input.js:71-75`). A probe that presses Space measures the TITLE screen (1776 `fillRect`/frame, 85 colours, `G.state === 'TITLE'`) and reads like a play measurement.
12. **`cam.x` is fractional.** Mapping screen 16 px cells to world columns (`floor((cam + tx*16)/16)`) fabricates "mostly empty" tiles, because a screen cell straddles two world columns. Measure each world tile at its exact screen rect. This is what produced a false "terrain draws a hole at column 31" report.
13. **`rim(rows, deep, lit, keep)` is positional.** A call site that omits `lit` writes the literal text `undefined` into the matrix; an unmapped letter is transparent, so the sprite draws **zero** ink — `R24` caught it ("'fruit icon' has no ink inside its layout rect [8,16) x [18,36)"). `lit` now defaults to `deep`, which `FRUIT_STAR` needs regardless (its ring must be true `K` for `R24`'s black-ink count).
14. **`bakeMatrix` pass 2 (`src/pixels.js:302-326`) at `shade.strength 1` REPLACES** a silhouette cell's colour with its ramp step instead of blending. So edge tone counts are set by that pass, not by the matrix letter: `turnip` loses 3 colours / 2 tone bands with ANY lit tone other than `deep`, and `2` vs `3` measured byte-identical. Check the pass before blaming the letter.
15. Browser driving: `tab.evaluate(() => location.reload())` fails with "the page navigated away before the function returned" — use the tool's `tab.reload()`. For an A/B build of one file, do **not** use `git stash` / `git checkout -- <path>` (forbidden in this shared worktree by the `commit` namespace rules; the integrator used it once before reading that, and it round-tripped clean only by luck): compare in a separate checkout instead — `git worktree add /tmp/vb-main main`, `./serve-local.sh 8011` from there, same probe against the other port.
16. **The density/tiles probes send no input of their own.** They only sample frames, so a cold tab measures 12 static frames of the TITLE screen. The recipe that produced every number in this file: `await tab.press('Enter')` → `await tab.keyDown('ArrowRight')` (HELD, not `press` — `input.js` clears held flags on keyup, so a released press leaves `cam.x === 0`) → `evaluate(probe)` → `keyUp`. Both sides of an A/B must use the same recipe; `main` and this branch then reproduce cam 0→366.3 and 426 vs 428 geometry-tile samples, which is what makes the comparison fair.


## Environment

- Server: `./serve-local.sh 8010` (localhost only). Browser via eval: `await browser.open({ name: '<unique>', url: 'http://127.0.0.1:8010/', app: 'own', viewport: { width: 900, height: 700 } })`; integrator's long-lived tab is `vb` (it gets idle-closed — reopen with the same `url`/`app`). Close your own tabs.
- **Live probes (all pixel readback — the integrator cannot see images):** `/tmp/vb-probe-density.js` (v3: per-frame `fillRect`/`drawImage`, unique colours, per-geometry-tile tone bands + `byChar` + worst-tile masks), `/tmp/vb-probe-art.js` (per-key atlas colours/bands + inked-box digest), `/tmp/vb-probe-sets.js` (exact colour sets). Run them through the browser tab: `await tab.evaluate(await Bun.file('/tmp/vb-probe-density.js').text())` while holding `ArrowRight`. Definitions and the numbers they produce at head are in the `R49` section above. Keep dt sampling separate (240 rAF intervals) — the density probe's `getImageData` calls distort timings.
- `/tmp/vb-probe-tiles.js` — per-tile **clause** probe for `R49` (colours/tile exact + q8, tone bands exact + q8, `p10`, `byChar` minima, worst tiles). Written 2026-11-18 to settle gate defect 1; its output files `/tmp/vb-probe-tiles-{main,branch}.json` and `/tmp/vb-probe-density-main.json` are the `main`-side evidence quoted in the table above, so S-14 does not have to re-measure it (re-measure only if `/tmp` was cleared — recipe in the `R49` section).
- Baseline references: `/tmp/vb-baseline-metrics.json` (main: 21 unique colours, title and play), procedural `main` renderer = 1114 `fillRect`/frame, 0 `drawImage`, dt 17.0/20.0 ms. **`/tmp/vb-shots/before-{title,play}.png` do NOT exist** (only `w2-sprites-play.png`, `w2-terrain.png`, `s01c-{before,after}-play.png`); re-create the visual baseline before S-17. `/tmp/vb-rescue/` holds the sprites partial + harness copies.
- `window.G` is NOT a browser global (it is a module export); drive the game with real key events, or import `/src/main.js` in the page and use the returned namespace.
