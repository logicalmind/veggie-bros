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

**The art cutover is already live in the browser:** the 18 draw wrappers blit from the atlas (lazily baking on first draw), so the world is no longer procedural — a steady 1-1 frame is **253 `fillRect` + 62-71 `drawImage`** (procedural baseline 1114/0) and the live canvas carries **140→202 unique colours** across a scroll against the old 21. `src/render.js` is still the one doing the calling (no `composite.js` yet), and no module calls `bakeSprites()`/`bakeAll()` at boot — the bake happens lazily on first draw (14-19 ms).

### Measured reality for `R49` — the figure this file carried did not reproduce

Probes (all pixel readback, no eyeballs — I cannot see images): `/tmp/vb-probe-art.js` (per-key atlas readback + inked-box digest), `/tmp/vb-probe-density.js` (live canvas, v3), `/tmp/vb-probe-sets.js` (exact colour sets). Before/after captures: `/tmp/vb-probe-{art,density}-{before,after}.json`. Shots: `/tmp/vb-shots/s01c-{before,after}-play.png`. **The `before-{title,play}.png` files this file used to name as the visual baseline do not exist** — `/tmp/vb-shots/` holds only `w2-sprites-play.png`, `w2-terrain.png`, and my S-01c pair, so S-17's "screenshots vs before-*" comparison has no baseline yet.

Definitions the probes use, which **S-14 must adopt or deliberately supersede**:

- **non-sky tile = decided by the LEVEL, not by pixel coverage**: `isSolid(tileAt(G.level, wtx, ty))`, measured over the tile's exact screen rect with ≥14 of its 16 px on screen. Deciding it by "has ≥1 non-sky pixel" makes `minimum` unfalsifiable — a lone sprite-edge pixel can never hold 3 tone bands, so the clause can only ever fail.
- **tone band** = distinct `round(0.2126R + 0.7152G + 0.0722B)` (the harness's own `lumsIn`, `tools/verify.mjs:642`), plus a **q8** bucketed variant, because opaque dither pixels inflate exact-luminance counts (same reason `coloursIn` takes a `quantum`).

At head, 12 frames sampled over a 1-1 run (cam 0→365, 423 geometry-tile samples): **exact min 14 / med 24 / max 37**; **q8 min 9 / med 12 / max 16**. Per-tile-char min: `X` 10, `P` 10, `B` 12, `|` 9.

**Consequence: `R49`'s tone-band clauses (`med ≥ 5`, `min ≥ 3`) are already green on this tree by 3-9×.** The "min 2 / med 5 over 86 non-sky tiles / 121 colours" figure earlier revisions carried is not reproducible under either tile definition — `med 5` exact is impossible for dithered tiles (measured 24). S-14 must therefore NOT register a tone-band clause that already passes; before registering, **run `/tmp/vb-probe-density.js` against `main` in a worktree and show the red**, or pick thresholds the old renderer demonstrably misses. Per §10, the fix is never a weakened check.

## Slice queue — run one at a time, in this order

**NEXT UP: S-02** (`src/terrain.js`, 769-line draft at `9e6169c`). Nothing HD-2D renders yet, so it is a validation slice — and most of it is already validated. `/tmp/vb-w2-logic.mjs` is a DOM-free sweep of the real bake path (no-op 2D stub); I ran it at `c28be8b`: **ALL ASSERTIONS PASSED, exit 0**, covering, per level: `stripCount = ceil(cols·16/64)` (1-1: 45 of 180 cols, 2880 px), strip selection = **exactly the minimal cover** with no gap and no double coverage, purity (45/50/40 identical strip keys across the scroll), used-block invalidation (`P@64,5 → U` dirties 2 strips), `live ≤ 12` over a full 1-1 scroll with `stripsBaked == stripCount` (maxLive 12, 7.9 MB resident), 3 parallax layers at integer dx (−97/−66/−27, alpha .92/.96/1), ambient 512×480 art px, and a banned-API scan (none).

Two things S-02 still has to do, and one gate that is **wrong as written**:

1. **The plan's "≤4 strips" bound is unsatisfiable.** A 256 px window over 64 px strips touches 4 strips only when the view start is 64-aligned; at any other offset it touches 5 (`floor(x/64) .. floor((x+255)/64)`). `cam.x` is fractional and never 64-aligned, so the honest bound is 5. Measured: 4 at camX 0/2624, **5 at camX 1312** — which the draft reports as `strips=5 (minimal cover = 5)`, i.e. the draft is right and the clause is wrong. Per §10 this gets reported, not silently loosened; "fixing" it by drawing view-aligned strips would break gotcha 6 (seams).
2. **The 64 px seam luminance delta is still unmeasured.** The stub does not rasterise, so this needs the browser: bake level 1-1 via `terrain.bakeLevel`, blit the strips into one canvas at an unaligned camera, and diff the two 1-px columns either side of every 64 px boundary against the same columns interior to a strip. Reuse `/tmp/vb-probe-density.js`'s readback plumbing.
| ID | Slice | File | Gate (must be shown, not asserted) |
| --- | --- | --- | --- |
| S-01 | art as matrices: registrations + 18 wrappers + `bakeSprites` | `src/sprites.js` | **done** (`e98a95e`): 57 frames + 9 emissive masks, density floor met, `missing === 0`, bake 18 ms |
| S-01b | outline-pad policy fix → `R21`/`R24` green | `src/sprites.js` | **done** (`b82f86a`): 44/44, `PADDED()` limited to the four `fx.*` puffs, inked boxes provably unmoved |
| S-01c | two-tone rim to recover character tones (deep on the away edge, key-lit edge one ramp step up) | `src/sprites.js` | **done (`c28be8b`)**, per key by atlas readback: hero.small 29→34 colours / 25→30 bands, hero.big 25→28, lives 19→21, boss 16→24 / 15→19, shard 11→14; `turnip` **left single-tone on purpose** (a distinct lit tone costs it 22→19 colours — see gotcha 14). All 27 inked boxes byte-identical, 44/44. **The live tone-min clause was already met (9-14) before the change and did not move** — see the `R49` section above. |
| S-02 | validate the terrain draft, fix if it fails | `src/terrain.js` | strip coverage of the 256px view, ≤4 strips, purity across `invalidate()`, `live ≤ 12` over a full 1-1 scroll, max 64px-seam luminance delta |
| S-03 | finish ink bridge (probe: alpha 0.5 / `lighter` / mirrored blit; list of checks that will see different ink) | `tools/verify.mjs` | **PARKED by the user — run later.** 44/44 byte-identical must survive |
| S-04 | composite layer buffers + DPR `k`-factor sizing (no drawing yet) | `src/composite.js` (new) | buffer table printed: scene/upscale/lightmap/bloom px at DPR 1/2/3 + 375×667 |
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

## Environment

- Server: `./serve-local.sh 8010` (localhost only). Browser via eval: `await browser.open({ name: '<unique>', url: 'http://127.0.0.1:8010/', app: 'own', viewport: { width: 900, height: 700 } })`; integrator's long-lived tab is `vb` (it gets idle-closed — reopen with the same `url`/`app`). Close your own tabs.
- **Live probes (all pixel readback — the integrator cannot see images):** `/tmp/vb-probe-density.js` (v3: per-frame `fillRect`/`drawImage`, unique colours, per-geometry-tile tone bands + `byChar` + worst-tile masks), `/tmp/vb-probe-art.js` (per-key atlas colours/bands + inked-box digest), `/tmp/vb-probe-sets.js` (exact colour sets). Run them through the browser tab: `await tab.evaluate(await Bun.file('/tmp/vb-probe-density.js').text())` while holding `ArrowRight`. Definitions and the numbers they produce at head are in the `R49` section above. Keep dt sampling separate (240 rAF intervals) — the density probe's `getImageData` calls distort timings.
- Baseline references: `/tmp/vb-baseline-metrics.json` (main: 21 unique colours, title and play), procedural `main` renderer = 1114 `fillRect`/frame, 0 `drawImage`, dt 17.0/20.0 ms. **`/tmp/vb-shots/before-{title,play}.png` do NOT exist** (only `w2-sprites-play.png`, `w2-terrain.png`, `s01c-{before,after}-play.png`); re-create the visual baseline before S-17. `/tmp/vb-rescue/` holds the sprites partial + harness copies.
- `window.G` is NOT a browser global (it is a module export); drive the game with real key events, or import `/src/main.js` in the page and use the returned namespace.
