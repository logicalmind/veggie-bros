# Session handoff — 2026-11-18, after S-09a + S-09h1 + S-09h2 + S-09b1 (**S-09b2 in flight, uncommitted**)

Read this file, then `GRAPHICS_STATE.md` (slice status + measured results), then `GRAPHICS_PLAN.md` §9 (the queue). Nothing else is required to resume; `WORKFLOW_STATE.md`, `RESUME.md`, `IMPLEMENTATION.md`, `docs/REVIEW-2026-07-15.md` are out of scope.

## Cold start — run all five before editing anything

```sh
cd ~/repos/veggie_bros && git status --short && git log --oneline -3
node tools/verify.mjs 2>&1 | tail -2          # expect: 44/44 pass, 0 fail
bash /tmp/vb-verify-each.sh                   # expect: STANDALONE FAILS: 0 of 44
for f in src/*.js; do node --input-type=module --check < "$f"; done
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8010/   # ./serve-local.sh 8010, NEVER 8000
```

Expected wall: the suite was 7.1 s at `7f6d809` and is **~11-13 s with the DPR pass landed** (two extra full-surface blits/frame plus more modelled ops inside inked scopes). That is acceptable — plan §2's 1.9 s target is documented as broken; keep watching it, and keep the isolation gate green. `/tmp/vb-verify-each.sh` runs every registry id in its own process (13-20 s); it is the gate that catches ink contamination the in-suite run cannot.

## Where the branch stands

Landed today (integrator-committed, each with both gates re-run by the integrator, never on a worker's word):

| SHA | Slice | Headline |
| --- | --- | --- |
| `8fa548a` | S-09a | boot `bakeSprites(ART_SCALE)` + `initFx()`, `updateFx(STEP)` per fixed step (`main.js` +18). Atlas baked before any frame; steady frame `offscreenCanvases=0`, `stripsBaked` frozen |
| `4f378b3` | S-09h1 | `R23` reads world ink off the logical `scene` recorder; `frac` guard scans `[...sr.scaleCalls, ...rec.scaleCalls]` (control: `sc.scale(1,0.5)` around `render.js:270` PASSES on the live-only guard, FAILs on the landed one) |
| `4ba4c27` | S-09h2 | `R45`'s post-band ink reads move to a `sceneRec().pixels` snapshot scan (`probeShot`/`rescan` + canary). Green at `k=2` and `k=3`; control marker → `FAIL … 120,192=#ff00ff` |
| `413400f` | S-09b1 | `hud` layer allocated in `composite.js` (6 layers, k-independent 256×240, `imageSmoothingEnabled=false`, +245,760 B, worst 4,504,320 B < 8 MiB), inert: no consumer, no pixel change |

**`S09b2DprPass` is still running** and its work is in the working tree, uncommitted: `src/main.js` +41, `src/render.js` +48, `tools/verify.mjs` +112. The integrator verified the mid-flight tree is loadable and green (`--check` clean, `44/44 pass, 0 fail`, 12.9 s). It was at `ctx 223K/262K (~68%)` when last checked — workers get killed near 70% and lose accuracy — so it was ordered to checkpoint early: `/tmp/vb-s09b2-result.json` and its `### S-09b2 RESULT` block **first**, then the isolation gate, the `VB_DRAWSTATS` line, and the control pairs; it may skip the browser gate, which is then the integrator's to run. Check `proc://S09b2DprPass` before touching anything; if it died, the tree is still committable after the checklist below.

### Landing checklist for S-09b2 (integrator only)

1. Re-run yourself: `node tools/verify.mjs`, `bash /tmp/vb-verify-each.sh`, the `--check` loop, and `node tools/verify.mjs R11 R18 R19 R23 R24 R45`.
2. Demand those four controls, verbatim, or run them yourself in a scratch copy — every one of them is a guard against a check going green because it went blind:
   - `R19` — suppress the LEVEL_CLEAR white flash → `R19` FAILs with its own text, revert → PASS.
   - `R24` — shift one HUD element a few px → `R24` FAILs, revert → PASS.
   - `R45`'s `shot()` — one `fillRect` on the `scene` ctx inside the post/gate draw path → `R45` FAILs (a scene-ctx marker is invisible to a live-recorder stream, which is exactly why `shot()` had to move).
   - the ink-model widening — `upscale`'s first writer is `main.js`, so `resolveInkOwner` rightly does not demote it; nothing clears it, so `inkVolatile` never flipped and every steady frame re-walked `scene`'s 61,440 stale cells × `k²` = **132.6 ms/frame** (`inkDropped` 6.1 M, suite >280 s). The fix accepts a whole-surface `source-over` alpha-1 blit **from** a proven per-frame layer as the `inkVolatile` proof. Negative controls required: a **partial** blit, an **alpha < 1** blit and a **non-`source-over`** blit must each **not** demote. Demand-propagation control: inside `inkedRender` the live recorder still models the frame, 0 after a plain frame.
3. `VB_DRAWSTATS=1 node tools/verify.mjs 2>&1 | tail -2` — the steady line must still read `fillRect 252 … drawImage 3` (S-08's s1 is the reference); the two new blits belong to `upscale`/`hud`, not the live ctx.
4. Browser (nobody else may claim this): `canvas.width === cssW·dpr` and `height === cssH·dpr` up to the 1024×960 cap, the frame fills the whole backing store (sample the four corners + centre — the failure mode is rendering into the top-left third), `dt` med/p95 over 240 rAF, `terrain.stats().stripsBaked` delta 0 over 12 settled frames, per-frame `offscreenCanvases` 0.
5. Commit through the eval `commit` namespace only (`d = await commit.draft()`, `await d.commit(subject, [bullets])`). Never `git add`/`commit`/`stash`/`checkout --`.

### What the DPR pass changed structurally (for later slices)

`fit()` now calls `composite.configure(cssW, cssH, window.devicePixelRatio)` and sizes `canvas.width/height` from the **returned layout** (never from re-derived arithmetic; the `MAX_BACKING_PX` clamp is inside `configure`); `configure` runs once per `fit()` (boot + resize), never in `frame()`. `render()` no longer draws to the live context at all: world+FX → `layers().scene`, HUD/banner/overlay/`TITLE` → `layers().hud`, whose **first** op is a whole-surface `clearRect` issued by `render.js` (a composite-side priming clear would let `resolveInkOwner` demote `hud` to FX scratch and blind `R19`/`R24`). `main.js` runs `scene → upscale`, `hud → upscale`, `upscale → canvas`, all nearest-neighbour; the live ctx receives exactly one `drawImage` per frame. Five harness reads now target layer recorders: `R18`/`R23`/`R45` (`scene`), `R19`/`R24` (`hud`).

Remaining queue: **S-09b2 landing** → **S-10** (FX emit sites at the existing score-popup events, `src/main.js`; note `fx.hit(entity, 'land'|'stomp'|'hurt'|…)` takes **strings** while `fx.burst(x, y, n, KIND.SPARK)` takes a **KIND value**), **S-11** (`config.js` + `index.html`, ~5 lines each), **S-12** (`R47` — its budget must now count the two `upscale`-buffer blits), **S-13** (`R48` bake-once: gate on per-frame `offscreenCanvases === 0` + frozen `stripsBaked`, **not** `bakeCalls === 0`; plus `R52`), **S-14** (`R49`, must be red on `main`), **S-15** (`R50`/`R51`), **S-16** (`R38`/`R45` onto `rec.drawImages`), **S-17** (browser gate — **integrator only, no subagent**), **S-18–S-20** (docs). Ambient tint (`multiply` moves mean luma −14.79 fields / −27.37 canyon / −23.31 palace) is still a design call for S-11, and particle/explosion **lights** still need a `fx.js` pool iterator = a second file; say so and get authorization rather than letting a worker widen scope.

## Standing warnings — each earned with a measurement

- Harness `k = 3`: `innerWidth 1280 × innerHeight 800` with `devicePixelRatio` pinned to 1 (`tools/verify.mjs:957`) ⇒ `fit()` scale 3 ⇒ backing 768×720. Prove any §4-shaped change at `k=2` **and** `k=3` in a scratch copy (`rsync -a --exclude .git ./ /tmp/vb-XXXX/`), never in the repo.
- A `k`-sim does **not** predict surface moves: `R19` went red only when the HUD actually left the live ctx. After any change that moves draws between surfaces, grep for every live-recorder consumer (`rec.rects|blits|text|clears|drawImages|stateLog|pixels|colsWhere|rowsWhere|inkAt`) and run the isolation gate.
- `fillRect` ink is modelled **pre-CTM** (`tools/verify.mjs:343-349`, "applied to BLIT ink only"): a canvas transform moves no modelled pixel. Hence no transform in `render.js`, and why `R23`'s fractional-scale guard has to scan both recorders.
- `bump()` counts **every** modelled op on any `createElement` canvas into `bakeCalls` (`tools/verify.mjs:100-107`): a steady frame reports `bakeCalls=97` (`scene 67 + bloom 16 + lightmap 8 + bloomHalf 6`). `R48` must gate on `offscreenCanvases === 0` + frozen `stripsBaked`.
- The live recorder holds **device** px now (768×720 = 552,960 > `INK_CAP` 262,144), so its ink is truncated on a fully inked frame. No check may read live ink; a future `INK_CAP` raise must be deliberate with counts re-derived, never widened to make a check pass.
- `edit` with a **relative** path resolves against the session cwd = the repo, and a byte-identical file has an identical snapshot tag. Always pass absolute paths for `/tmp`, then `grep -c <patch-string>` both copies. One probe edit landed in the repo's `tools/verify.mjs` today; reverted byte-for-byte, verified with `git diff`.
- Order **any** slice that may run > ~10 minutes to write its `RESULT` block + `/tmp/vb-<slice>-result.json` **early**, and tell the worker to say `STOPPED AT <step>` under context pressure. Two of today's three workers ran 12-19 min.
- Atlas bake cost is **27 ms** in-browser at `ART_SCALE 2`; the old 14-19 ms figure does not reproduce. Headless bake timing is meaningless (the mock ctx never rasterises).
- After a death/respawn at a static camera `stripsBaked` can tick **+1** (a `MAX_LIVE = 12` eviction re-bake on demand). Settle ≥ 2 s before the 12-frame gate.
- `036ad19`'s commit message claims `44/44` for S-08: true in-suite, false standalone (`R18`). Read it as "green with contamination".

## Unchanged rules

One subagent at a time. Brief with exact paths **and** line ranges, ≤ ~400 lines read, ≤ ~150 changed lines, ≤ 40-line report; the worker writes its own `### <SLICE> RESULT` block (immediately before `## Slice queue — run one at a time, in this order`), its own queue row, and `/tmp/vb-<slice>-result.json`; the integrator spot-checks numbers, re-runs both gates itself, and commits only via the `commit` namespace. Never delete, skip, loosen or re-word a check — a red you cannot fix is a finding, quoted verbatim. `src/player.js enemy.js items.js level.js camera.js input.js audio.js` are read-only to the graphics layer; each slice names its own writable files and everything else is read-only. Banned in `src/`: `getImageData`, `putImageData`, `ctx.filter`, `shadowBlur`, runtime `createLinearGradient`/`createRadialGradient`/`createPattern`, `Math.random`, `ctx.translate` in `render.js`. No deps, no build step, no `package.json`, no asset files, no TODO/stub/feature-flag/dead code; comments say *why*.

## Environment

Server `./serve-local.sh 8010` (localhost only, never 8000). Browser via eval: `await browser.open({ name: '<unique>', url: 'http://127.0.0.1:8010/', app: 'own', viewport: { width: 900, height: 700 } })`; the integrator's long-lived tab is `vb` (idle-closed — reopen with the same `url`/`app`). Quirks: `tab.evaluate(stringOfAsyncIIFE)` returns `undefined` — stash on `window.__*` and read back in a second call; `tab.screenshot({ path })` writes nothing — use canvas `toDataURL`; `tab.evaluate(() => location.reload())` fails — use `tab.reload()`; a released `press('ArrowRight')` leaves `cam.x === 0` — `press('Enter')` then `keyDown('ArrowRight')` **held**, restore any level writes; `window.G` is a module export, not a global — `await import('/src/main.js')` in the page. **S-17:** `tab.emulate({ viewport: { width: 375, height: 667, deviceScaleFactor: 3 } })` works on WebKit (timezone/CPU/network throttling throw there, so `dt` is measured on unthrottled hardware); shoot the branch the same way the baselines were made — native 256×240 `#game` `toDataURL('image/png')`, viewport 900×700, `press('Enter')` + held `ArrowRight` 2500 ms — and diff against `/tmp/vb-shots/before-title.png` / `before-play.png` (from `main` at `d16b002`, confirmed present today). Never compare against the `w2-*.png` upscales. Worktrees: `/tmp/vb-s08` is the pristine `036ad19` copy the census used — `cmp`-clean, keep until S-16; `/tmp/vb-s09x` is a scratch copy carrying the `k=3` blit sim plus a widened `R23` window — rebuild scratch copies from scratch, never trust it. A/B a build without touching the tree with `git worktree add /tmp/vb-main main` + `./serve-local.sh 8011` + `git worktree remove` after.
