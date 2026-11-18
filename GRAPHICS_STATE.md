# GRAPHICS_STATE — graphics upgrade (branch `feature/graphics-upgrade`)

Plan of record: **`GRAPHICS_PLAN.md`** (self-contained; read that, not `WORKFLOW_STATE.md`).
This file is a compact handoff log — the only graphics doc safe to read in full.

## Workflow rules the user set

- **At most TWO subagents running at once** (set 2026-11-17 after wave 2 spawned four). Queue the rest; spawn the next only when a slot frees.
- Context discipline stands: agents never read `WORKFLOW_STATE.md` / `RESUME.md` / `IMPLEMENTATION.md` / `docs/REVIEW-2026-11-15.md`; `tools/verify.mjs` is grep-only by id.

## Baseline carried in from `main`

- Harness: **44/44 PASS, ~2 s**. Ids `SMOKE`, `R01`–`R33`, `R36`–`R38`, `R40`–`R46`.
- Browser (headless WebKit, 256×240 @2× CSS): 1114 `fillRect`/frame (min 1090 / max 1153), dt 17.0 med / 20.0 p95 ms.
- **Old-renderer art density** (sets `R49` so it fails today): 21 unique on-screen colours; per-tile tone bands med **2** / min 1 / max 5; per-tile colours med **3** / max 10; 83 of 240 tiles non-sky.
- **Draw-call decomposition** (sets `R47`): 240 visible tiles ≈ 700, `drawPixelText('SCORE 000000')` = **127**, `'WORLD 1-1  POPPY'` = 123, title logo = 102, lives ×3 fruits = **165**, hero 21, turnip 16.
- Before-shots: `/tmp/vb-shots/before-{title,play}.png`, metrics `/tmp/vb-baseline-metrics.json`.
- Frozen by design (§1 G5): `player/enemy/items/level/camera/input/audio/levels`.

## Wave board

| Wave | Slice | Files | Status |
| --- | --- | --- | --- |
| W1 | A1 bake-core | `src/pixels.js`, `src/atlas.js` | **done**, committed `8ba8033` |
| W1 | A2 harness stub | `tools/verify.mjs` | **done**, committed `9539ab3` |
| W2 | B3 fx | `src/fx.js` (434) | **done, uncommitted** — verified by integrator: DOM-free, no banned APIs, 0 gameplay writes |
| W2 | E ink bridge | `tools/verify.mjs` | **running** |
| W2 | B2 terrain | `src/terrain.js` | **running** (as `FitBug`; first attempt died on a 503 with nothing written) |
| W2 | B1 art | `src/sprites.js` | **FAILED at 1h42m on a 503, truncated** — queued for completion, needs a free slot |

## The sprites.js incident (read before touching that file)

`Sprites` authored 685 lines of art data (generators + matrices, good footprint/outline reasoning in the header) and then hit `503 frontend_overloaded` **before writing any exports or atlas registrations** — a module that parses but exports nothing, so `render.js`'s 18-name import would have failed and the suite would have gone red for a non-reason. I moved the partial to **`/tmp/vb-rescue/sprites-partial-685.js`** and restored `src/sprites.js` from `HEAD` (426 lines) so the running ink-bridge agent had a working tree.

Next slice for that file must **finish the partial**, not restart it: the authored art is the expensive part. It needs the registration calls, the `bakeSprites()` export, the 18 unchanged draw wrappers, and §5 density ≥6 colours / ≥5 tone bands per key.

## Model capacity

Two slices have died on `503 frontend request capacity is exhausted` after long runs (Terrain at 2m47s with nothing written, Sprites at 1h42m with a truncated file). Consequence: **slices must be small enough that a failure loses hours, not days** — prefer a finished small file over an ambitious big one, and have agents write incrementally so a partial is still useful.

## Integrator notes for the next wave

- `fx.js` facts wave 3/4 need are in plan §6 ("As landed"): `hit()` takes strings `'land'|'stomp'|'hurt'|'hop'|'jump'`, `burst()` takes `KIND.*`; `shakeOffset()` is one signed int → renderer applies `(dx,dy) = (o,-o)`; pool cap 96, newest refused.
- `getImageData`/`putImageData` banned in `src/` outright (§7): the stub does not rasterise, so read-back bakes are flat under the suite.
- Ink model goes blind for atlas art (`R16`–`R24`, `R45` canary) → bake canvases need `inkRects = true`; `R45` must read `rec.drawImages`; `R48` must demote harness scratch buffers (`bakeCalls=1064` clean run). Plan §8.1.
- Server: `./serve-local.sh 8010` (never 8000). Probe tab name `vb`, `app: "own"`.

## Commits on this branch

`a049805` plan · `d9d838b` plan W1 ground truth · `9539ab3` harness accounting · `8ba8033` atlas+ramps+scale constants · `2a38bda` R49 thresholds + handoff · `f90bd56` R47 budget split.

## Log

- 2026-11-17: branch off `main`@`d16b002`; user decisions recorded (zero-dep bake-at-boot Canvas 2D, HD-2D, DPR backing store, physics frozen, suite green, perf gate, docs in-branch). W1 landed green. W2: fx done, terrain + ink bridge running, art truncated by a model 503 and restored. User set the 2-concurrent-subagent cap.
