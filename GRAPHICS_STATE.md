# GRAPHICS_STATE — RESUME HERE (branch `feature/graphics-upgrade`)

**Read `GRAPHICS_PLAN.md` first** (the whole contract: decisions, architecture, frozen API, gates, slice rules). Then read this file. Then stop reading — nothing else is required, and `WORKFLOW_STATE.md` (131 KB), `RESUME.md`, `IMPLEMENTATION.md`, `docs/REVIEW-2026-11-15.md` are all **out of scope for this work**.

This file is the only graphics doc safe to read in full, and the integrator owns it.

## Working rules the user set (they override convenience)

- **One subagent at a time.** Integrator + one worker = 2 total. Never spawn a second while one is live.
- **Small slices** (plan §9): one file, ≤ ~150 new lines, ≤ ~400 lines read. Agents report in ≤ 40 lines.
- **Write incrementally** so an abort leaves a loadable tree; `node --input-type=module --check` after every append.
- Green suite at every checkpoint: `node tools/verify.mjs` → `44/44 pass, 0 fail` (ids may be added only when they can pass).
- The user ends the session and starts a fresh one whenever context gets heavy. **Keep this file current so that costs nothing.**

## Cold start — run these five, in order

```sh
cd /Users/jasonjordan/repos/veggie_bros && git branch --show-current        # feature/graphics-upgrade
node tools/verify.mjs | tail -2                                             # expect 44/44 pass, 0 fail
for f in src/*.js; do node --input-type=module --check < "$f" || echo FAIL $f; done
grep -c "^export" src/sprites.js                                            # expect 20 (18 draw fns + TEXT_PITCH + bakeSprites)
./serve-local.sh 8010 &                                                     # NEVER port 8000 (splash inference engine)
```
If `src/sprites.js` shows a low export count or fails `--check`, an agent died mid-write: the last good copy is `git show HEAD:src/sprites.js`, the last good art-data partial was `/tmp/vb-rescue/sprites-partial-685.js`. Do **not** guess the missing half — re-run slice S-01.

## Tree state (head `b82f86a`, 12 commits off `main`@`d16b002`) — **suite green 44/44**

| Commit | What | Verified? |
| --- | --- | --- |
| `a049805` `d9d838b` `2a38bda` `f90bd56` | plan + gates + this log | — |
| `9539ab3` | harness `drawStats()` per-frame accounting, `VB_DRAWSTATS=1` probe | yes: 44/44, byte-identical ×2 |
| `8ba8033` | `src/pixels.js` (467) ramps + bake passes; `src/atlas.js` (237) pack + `blit`; scale constants | yes: real-canvas bake smoke, packer stress 160 rects / 39 ms / 0 bleed |
| `45e3d9e` | `src/fx.js` (434) pool + squash + shake | yes: 100k ticks, heap growth −0.4 KB; determinism digest; DOM-free |
| `9e6169c` | `src/terrain.js` (769) strips + AO + parallax — **draft** | **NO** — its acceptance tests were never run |
| `6ffaa53` | harness ink bridge (`inkAt`, `inkRects` on offscreen canvases) — **partial** | suite yes (44/44, byte-identical to HEAD harness); blit-ink probe + check-impact list **outstanding** |
| `e98a95e` | `src/sprites.js` (1025) art as matrices — **2 known reds** | partial: `missing === 0`, density floor met, 128 live colours; `R21`/`R24` RED |
| `b82f86a` | outline pad → particles only; rim inside the matrix | yes: 44/44 twice, 253 `fillRect`/frame, 121 live colours |

**The art cutover is already live in the browser:** the 18 draw wrappers blit from the atlas (lazily baking on first draw), so the world is no longer procedural — a 1-1 reference frame went **1138 → 253 `fillRect`s** and the live canvas carries 121 unique colours against the old 21. `src/render.js` is still the one doing the calling (no `composite.js` yet), and no module calls `bakeSprites()`/`bakeAll()` at boot.

**Measured reality for `R49` (S-14 will be red on art, not plumbing).** Live now: 121 unique on-screen colours (baseline 21), per-tile tone bands **median 5 / minimum 2** over 86 non-sky tiles. `R49` demands min ≥ 3, so that clause is a genuine art gap: the fix is the queued **S-01c** two-tone rim (deep on the away edge, `shade` on the key-lit edge — the atlas already supports `opts.rim`), never a weakened check.

## Slice queue — run one at a time, in this order

| ID | Slice | File | Gate (must be shown, not asserted) |
| --- | --- | --- | --- |
| S-01 | art as matrices: registrations + 18 wrappers + `bakeSprites` | `src/sprites.js` | **done** (`e98a95e`): 57 frames + 9 emissive masks, density floor met, `missing === 0`, bake 18 ms |
| S-01b | outline-pad policy fix → `R21`/`R24` green | `src/sprites.js` | **done** (`b82f86a`): 44/44, `PADDED()` limited to the four `fx.*` puffs, inked boxes provably unmoved |
| S-01c | two-tone rim to recover character tones (deep on the away edge, `m` = `heroBody.shade` on the key-lit edge) | `src/sprites.js` | **next.** Character colours back toward 20+ / hero, turnip, boss; live per-tile tone min ≥ 3; boxes unmoved; 44/44 |
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

## Environment

- Server: `./serve-local.sh 8010` (localhost only). Browser via eval: `await browser.open({ name: '<unique>', url: 'http://127.0.0.1:8010/', app: 'own', viewport: { width: 900, height: 700 } })`; integrator's long-lived tab is `vb` (it gets idle-closed — reopen with the same `url`/`app`). Close your own tabs.
- Perf/density probe (reusable): patch `ctx.fillRect` to count, sample 240 rAF intervals for dt percentiles, then `getImageData(0,0,256,240)` and count unique colours + per-tile luminance tone bands over a 16×16 grid. Baseline: 1114 `fillRect`/frame, dt 17.0/20.0 ms, 21 colours, tone bands med 2.
- Artifacts: `/tmp/vb-shots/before-{title,play}.png` (visual baseline), `/tmp/vb-baseline-metrics.json`, `/tmp/vb-rescue/` (sprites partial + harness copies).
- `window.G` is NOT a browser global (it is a module export); drive the game with real key events, or import `/src/main.js` in the page and use the returned namespace.
