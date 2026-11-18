# GRAPHICS_STATE — graphics upgrade (branch `feature/graphics-upgrade`)

Plan of record: **`GRAPHICS_PLAN.md`** (self-contained; read that, not `WORKFLOW_STATE.md`).
This file is a compact handoff log — it is the only graphics doc safe to read in full.

## Baseline carried in from `main`

- Harness: **44/44 PASS, 1.9 s** (`node tools/verify.mjs`). Ids: `SMOKE`, `R01`–`R33`, `R36`–`R38`, `R40`–`R46`.
- Browser: 1114 `fillRect`/frame, 17.0/20.0 ms med/p95 dt, **21 unique on-screen colours**, 256×240 canvas @2× CSS.
- Unchanged by design: all gameplay (`player/enemy/items/level/camera/input/audio/levels`) — see plan §1 G5.

## Wave board

| Wave | Slice | Files | Status |
| --- | --- | --- | --- |
| W1 | A1 bake-core | `src/pixels.js`, `src/atlas.js` | pending |
| W1 | A2 harness stub | `tools/verify.mjs` | pending |
| W2 | B1 art / B2 terrain / B3 fx | `sprites.js` / `terrain.js` / `fx.js` | pending |
| W3 | C1 renderer | `render.js`, `composite.js`, `main.js` (DPR) | pending |
| W4 | D1 wiring / D2 checks | `main.js`,`config.js`,`index.html` / `verify.mjs` | pending |
| W5 | E1 docs | docs only | pending |

## Log

- 2026-11-17: branch created off `main` @ `d16b002`. Baseline suite green. Plan written (user decisions: zero-dep bake-at-boot Canvas 2D, HD-2D art direction, device-pixel-native backing store; physics frozen; suite must stay green; perf gate required; docs updated in-branch).
