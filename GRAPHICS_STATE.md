# GRAPHICS_STATE — graphics upgrade (branch `feature/graphics-upgrade`)

Plan of record: **`GRAPHICS_PLAN.md`** (self-contained; read that, not `WORKFLOW_STATE.md`).
This file is a compact handoff log — the only graphics doc safe to read in full.

## Baseline carried in from `main`

- Harness: **44/44 PASS, 1.9 s**. Ids `SMOKE`, `R01`–`R33`, `R36`–`R38`, `R40`–`R46`.
- Browser (headless WebKit, 256×240 @2× CSS): 1114 `fillRect`/frame (min 1090 / max 1153), dt 17.0 med / 20.0 p95 ms.
- **Art density of the old renderer** (sets every `R49` threshold so it fails today): 21 unique on-screen colours; per-tile tone bands med **2** / min 1 / max 5; per-tile colours med **3** / max 10; 83 of 240 tiles non-sky.
- Before-shots for the visual gate: `/tmp/vb-shots/before-title.png`, `/tmp/vb-shots/before-play.png`; metrics `/tmp/vb-baseline-metrics.json`.
- Frozen by design (plan §1 G5): `player/enemy/items/level/camera/input/audio/levels` — graphics layer reads state only.

## Wave board

| Wave | Slice | Files | Status |
| --- | --- | --- | --- |
| W1 | A1 bake-core | `src/pixels.js` (449), `src/atlas.js` (237) | **in flight** — reported uncommitted |
| W1 | A2 harness stub | `tools/verify.mjs` | **done**, committed `9539ab3` |
| W2 | B1 art / B2 terrain / B3 fx | `sprites.js` / `terrain.js` / `fx.js` | pending A1's anchor + emissive conventions |
| W3 | C1 renderer | `render.js`, `composite.js`, `main.js` (DPR) | pending |
| W4 | D1 wiring / D2 checks | `main.js`,`config.js`,`index.html` / `verify.mjs` | pending |
| W5 | E1 docs | docs only | pending |

## Commits on this branch

1. `a049805` docs: graphics-upgrade plan of record
2. `d9d838b` docs: fold W1 harness ground truth into the plan
3. `9539ab3` harness: per-frame draw accounting (`drawStats()`, `VB_DRAWSTATS=1` probe) — 44/44, byte-identical

## Integrator notes for the next wave

- Wave 2 briefs MUST hand each agent the anchor rule + emissive-marker convention **as BakeCore reported them**, not as guessed.
- `getImageData`/`putImageData` are banned in `src/` outright: the harness stub does not rasterise, so read-back bakes are flat under the suite (plan §7).
- Ink model goes blind for atlas-sourced art (`R16`–`R24`, `R45` canary) — bake canvases need `inkRects = true` before bake. Wave 4 lever, plan §8.1.
- `R45`'s `firstDiff` must move from `rec.blits` to `rec.drawImages`.
- `R48` must demote harness scratch buffers (`bakeCalls=1064`, `offscreenCanvases=7` on a clean run) before bounding bake calls per level load.
- Static server: `./serve-local.sh 8010` (never 8000). Browser probe tab name `vb`, `app: "own"`.

## Log

- 2026-11-17: branch off `main` @ `d16b002`; baseline captured; plan written from user decisions (zero-dep bake-at-boot Canvas 2D, HD-2D direction, DPR backing store, physics frozen, suite green, perf gate, docs in-branch). W1/A2 landed green. `R49` thresholds re-derived from measurement after finding the drafted gate already passed on `main`.
