# Session handoff — 2026-11-18, after S-08 + S13a

Read this file, then `GRAPHICS_STATE.md` (slice status + measured results), then `GRAPHICS_PLAN.md` §9 (the queue). Nothing else is required to resume. `WORKFLOW_STATE.md`, `RESUME.md`, `IMPLEMENTATION.md`, `docs/REVIEW-2026-11-15.md` are out of scope.

## Cold start — run all five before editing anything

```sh
cd ~/repos/veggie_bros && git status --short && git log --oneline -3
node tools/verify.mjs 2>&1 | tail -2          # expect: 44/44 pass, 0 fail   (~7 s)
bash /tmp/vb-verify-each.sh                   # expect: STANDALONE FAILS: 0 of 44  (~19 s)
for f in src/*.js; do node --input-type=module --check < "$f"; done
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8010/   # server: ./serve-local.sh 8010, NEVER 8000
```

If `/tmp` was cleared, `/tmp/vb-verify-each.sh` is 26 lines and worth rewriting immediately — it is the gate that caught the contamination bug (see "Verification rules"). It derives ids from `grep -o "check('[^']*'" tools/verify.mjs` plus `SMOKE`. Other `/tmp/vb-*` probes are described in the matching `### S-0x RESULT` blocks in `GRAPHICS_STATE.md`; recreate only the one you need.

## State

- Branch `feature/graphics-upgrade`. Gameplay is frozen (G5): `player.js`, `enemy.js`, `items.js`, `level.js`, `camera.js`, `input.js`, `audio.js` are read-only to the graphics layer. `TILE = 16`.
- Landed: S-01a/b/c (sprite atlas + emissive masks), S-02 (terrain, validated — with two escapes fixed later), S-04 (`src/composite.js` buffers + `k`), S-05 (lightmap), S-06 (bloom), S-07a (world layer from baked terrain strips + parallax), S-08 (scene-buffer compositing order), S13a (harness ink model + isolation gate).
- Remaining: **S-09** (boot/DPR/`main.js`), **S-10** (FX emit sites), **S-11** (`config.js` + `index.html`), **S-12** (`R47`), **S-13** rest (`R48` bake-once, `R52`), **S-14** (`R49`), **S-15** (`R50`/`R51`), **S-16** (rewrite `R38`/`R45` onto `rec.drawImages`), **S-17** (browser gate, integrator only), **S-18–S-20** (docs).
- `GRAPHICS_STATE.md` line "NEXT UP" carries the facts S-09 needs. Do not trust older "NEXT UP" text anywhere else.

## Verification rules (each of these was earned with a bug)

1. **Run the isolation gate after anything that moves draws between surfaces.** A check can be green inside the suite and red standalone: at `036ad19`, `R18` and `R23` were green only on ink left behind by an earlier check. `bash /tmp/vb-verify-each.sh` is 19 s and finds this; the in-suite run does not.
2. Never delete, skip, loosen, or re-word a check. A red you cannot fix is a finding, reported verbatim with the harness's own text.
3. The integrator does not accept a worker's `44/44` without running the suite itself. That is how the `036ad19` contamination passed my review: I re-ran `R45` for timing but took the verdict on faith, and the commit message repeats the bad claim.
4. Commit only through the eval `commit` namespace (`d = await commit.draft()`, `await d.commit(subject, { body: [...] })`). Never `git add`/`commit`/`stash`/`checkout --`. `d.show(path)` then `d.take(path)` for lines a worker wrote through bash.
5. Banned in `src/`: `getImageData`, `putImageData`, `ctx.filter`, `shadowBlur`, runtime `createLinearGradient`/`createRadialGradient`/`createPattern`, `Math.random`, `ctx.translate` in `render.js`.
6. No deps, no build step, no `package.json`, no asset files, no TODO/stub/feature-flag/dead code. Comments say *why*, densely.

## Harness ink model, as of S13a (`tools/verify.mjs`, +166/−8)

Four levers took the suite from ≥288 s (measured standalone Σ 2100 s at `036ad19`; `R03` alone 1029 s) to 7 s:

1. **First-writer surface roles.** A `createElement('canvas')` whose first draw op's innermost `src/*.js` frame is `composite.js` stops modelling ink — `lightmap` 128×120, `bloom` 64×60, `bloomHalf` 32×30 are FX scratch. `scene` (first writer `render.js`) and the atlas/terrain/pixels bakes keep every pixel.
2. **`inkBlit` walks the source** (`src.pixels`) for identity CTM + exact integer `k`, instead of one string-keyed `get()` per destination px; 20k randomised cases agree with the destination scan.
3. **Demand gate.** A whole-surface `clearRect` marks a layer per-frame scratch, so it models ink only while a check-readable destination is open inside `inkedRender()`.
4. **`parseInk` memoised** by colour string (cap `1<<14`, rebuilds a fresh object per hit).

Consequences for the remaining harness slices (S-12…S-16):

- **A marker that changes only the light is now invisible to `R45`'s band diff.** The census proved 0 art-ink position differences across 1,744 surface pairs, and every difference classified as lighting; residue itemised: 4,258 px on the `scene` layer, `R45` only, which is `pixels.js:459-464`'s stringified gradient (`"[object Object]"`) and cannot be inverted.
- **Checks that read world-space art must read `sceneRec()`** (`layers().scene.c._rec`), not the live recorder — that is the `R18` lesson, and the reason `R18` now clears `sr.rects` first (a `bake` recorder's op log is never reset and stops at `BAKE_LOG_CAP` 4096; without the clear the full suite fails `R18`).
- `R45`'s own ink reads replace `rec.ink` (`verify.mjs:5046`), so they are invisible to any census of `pixels`; they rest on its direct band comparison.
- No check in either tree reads `inkAt`/`coloursIn`/`lumsIn`/`inkStats`/`colsOf`/`textInk`.

## Standing corrections and open decisions

- `036ad19`'s commit message claims `44/44` for S-08: true in-suite, false standalone (`R18`). Read it as "green with contamination".
- `GRAPHICS_PLAN.md` §2's 1.9 s harness target is currently met (7 s), but S-12/S-14/S-15 add render-heavy comparisons — re-check the wall after each, and keep the isolation gate green.
- **Ambient tint is a design decision, not implemented tuning.** S-08 sets `setAmbient(colorToCss(baked._theme.fog))` per level, and `multiply` now moves mean luma −14.79 (fields `#dff2c9`), −27.37 (canyon `#ffd9a0`), −23.31 (palace `#ffe0a0`). Whether that is the look is S-11's `config.js` call. S-05's earlier near-white base made `multiply` a no-op (245.01 → 245.29), so "make it lighter" must be measured, not guessed.
- Particle/explosion **lights** are still unimplemented: `fx.js` exposes only `metrics()`/`isIdle()`, no pool iterator, so S-10 needs a second file. Say so and get authorization rather than letting a worker widen scope silently.
- Delegation is a user directive: one worker at a time, brief with exact paths **and line ranges**, ≤ ~400 lines read, ≤ ~150 changed lines, ≤ 40-line report, worker writes its own `### <SLICE> RESULT` block (immediately before `## Slice queue — run one at a time, in this order`), its own queue row, and `/tmp/vb-<slice>-result.json`. A slice needing >400 lines of reading gets cut in half first — that is how S-07 became S-07a/S-07b, and it is why S-07b (entity blits through the composite, squash) is still open inside S-07's row.
- Workers get killed near 70 % context and lose accuracy: one restarted worker wrote that "the ink cost grew between S-08 and `036ad19` (S-09..S-12)" — `036ad19` *is* S-08 and those slices do not exist. Check any history claim in a long-running worker's output against `git log`.

## Traps that have already cost hours

- Colour objects handed to `pixels.js:71 colorToCss` must carry `a`; a missing alpha formats `rgba(r,g,b,NaN)`, the canvas silently ignores the assignment (the fill uses the previous `fillStyle`) and the harness throws in `inkOver` on any `globalAlpha < 1` blit of such a pixel, which `main.js:596` swallows. Gotcha 17.
- Tile chars `H T F C G K` never survive `parseLevel` (cleared to `.`; positions live in `level.checkpoints/.fruits/.gate/.boss`), so any `tileAt === 'G'` scan is dead code.
- Terrain strips are world-aligned at `i*64 − phase`, **art-scale** 128×480 for a 64×240 logical strip; blit the full 64 px dest (a 63-px dest fakes seam gaps). `live` cap 12.
- Browser probes: `tab.evaluate(stringOfAsyncIIFE)` returns `undefined` on this harness — stash results on `window.__*` and read them back in a second call. `tab.screenshot({ path })` writes nothing — use canvas `toDataURL`. `tab.evaluate(() => location.reload())` fails — use `tab.reload()`. A released `press('ArrowRight')` leaves `cam.x === 0`; use `press('Enter')` then `keyDown('ArrowRight')` **held**, and restore any level writes. `ctx.filter` has no wrappable accessor in this WebKit build, so the no-filter clause of `R47` must be a static grep.
- Repeated `getImageData` of a layer canvas drifts ±1 LSB, so hex-exact census counts have a noise floor.
- Screenshots for S-17 must use the baseline method: native 256×240 canvas `toDataURL`, diffed against `/tmp/vb-shots/before-title.png` and `before-play.png` (from `main` at `d16b002`). Never compare against the `w2-*.png` 1024×960 upscales.
- To A/B a build without touching the tree: `git worktree add /tmp/vb-main main` (or any sha), serve from there, `git worktree remove` after. `/tmp/vb-s08` is the pristine `036ad19` worktree used by the census — `cmp`-verified clean, keep it until S-16 lands.
