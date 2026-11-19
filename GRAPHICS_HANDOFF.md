# Session handoff — 2026-11-19, after **S-14 (`R49` art density) + S-14b (the harness ink-model fix it exposed) landed and integrator-verified**

Read this file, then `GRAPHICS_STATE.md` (slice queue + every `RESULT` block), then `GRAPHICS_PLAN.md` §9 (the queue). Nothing else is required to resume. `WORKFLOW_STATE.md`, `RESUME.md`, `IMPLEMENTATION.md`, `docs/REVIEW-*` are out of scope.

## Cold start — run all five before editing anything

```sh
cd ~/repos/veggie_bros && git status --short && git log --oneline -5
node tools/verify.mjs 2>&1 | tail -2          # expect: 48/48 pass, 0 fail  (~15-16 s since S-14b's ink cost)
bash /tmp/vb-verify-each.sh 2>&1 | tail -1    # expect: STANDALONE FAILS: 0 of 48  (~24 s)
for f in src/*.js tools/verify.mjs; do node --input-type=module --check < "$f"; done
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8010/   # ./serve-local.sh 8010, NEVER 8000
```

If `/tmp/vb-verify-each.sh` is gone (reboot clears `/tmp`): it runs every registered id in its own `node tools/verify.mjs <ID>` process and prints `STANDALONE FAILS: n of <ids>`; that gate is the only one that catches cross-check contamination, so rebuild it before continuing.

**The machine was restarted between sessions, so treat `/tmp` as empty until you prove otherwise.** Everything the queue leans on lives there; rebuild, never guess:

| artifact | what it is | rebuild recipe |
| --- | --- | --- |
| `/tmp/vb-verify-each.sh` | isolation gate (cold-start #2) | one `node tools/verify.mjs <ID>` per registered id, print `STANDALONE FAILS: n of <N>` |
| `/tmp/vb-s08` | pristine `036ad19` tree, required by **S-16**'s two-identical-maps clause and by any "did we change old behaviour?" question | `git worktree add --detach /tmp/vb-s08 036ad19` — a worktree, never `git stash` / `git checkout --` in the shared tree |
| `/tmp/vb-shots/before-title.png`, `before-play.png` | S-17's visual baseline, 256×240 off `main` at `d16b002` | worktree at `d16b002` + `./serve-local.sh 8010`, then `/tmp/vb-s17-readback.js`'s `shot()` (downscales `layers().upscale` by 1/k to true 256×240). If the readback is gone too, re-derive it from the tooling note below before taking any comparison screenshot |
| `/tmp/vb-s15-brief.md`, `/tmp/vb-s17-tooling.md`, `/tmp/vb-s17-bot.js`, `/tmp/vb-s17-readback.js`, `/tmp/vb-s10-snap-head.json` | the pre-written S-15 brief, the validated S-17 harness, S-10's snapshot anchor file | S-15's whole brief is rebuilt inline in its queue row below; `R51`'s anchors are the recorded shas (`4919 B → b8a8c73f…`, `60 → 38d977fe…`, `120 → cca225d3…`, `600 → 069132e3…`), so the check is writable from the numbers, not the file; S-17's tooling must be re-derived (rAF tap + `layers().upscale` downscale) and re-validated against a known page before it is trusted |

## Where the branch stands

`HEAD b7b01da9fc` on `feature/graphics-upgrade`, working tree **clean**, suite **48/48**, isolation **0 of 48**, harness additive-only. Every slice is integrator-committed, each with every gate re-run personally (never on a worker's word) and at least one falsification control run by the integrator's own hands. **S-15 was never started:** its worker was cancelled by the user after two requests and had made **zero** edits, so nothing of it is in the tree — start it from scratch off its queue row. The user's own two paths (`jsconfig.json`, the `src/main.js` `@type` line) are committed as `b7b01da9fc` at their request.

| Commit | Slice | Integrator control that mattered |
| --- | --- | --- |
| `c99f961c7e` | S-10 FX emit sites, `main.js` +75/−1 (14 particle + 6 `fxHit`) | my probe: a live pool adds exactly one `scene` `drawImage` per particle (22 → 32 for 10 sparks); and `render.js:264 → const o = 3` **passed all 44 checks** → logged as the shake-blindness finding |
| `8b1a184736` | S-11 page metas + `LAND_MIN_POWER` → `config.js` | browser: all four metas parse, `color-scheme` resolves dark, DPR pass intact (backing 512×480 == css at dpr 1); worker's positive control `touch-action` → `FAIL R12` |
| `a8a47a0409` | S-12 `R47` draw budget (+7 surface clause, `R12` metas), harness +98/−0 | my own two reds: `TOTAL_FILL 450→252` → `FAIL R47 total fillRect 253 > 252 …`, `WORLD_BLIT 240→21` → `FAIL R47 world pass: scene drawImage 22 > 21` |
| `ef61f63510` | S-13 `R48` bake-once + `R52` render-only shake, harness +140/−0 | my own `render.js:264 → const o = 3` now gives **`46/47 pass, 1 fail`**, red = `R52 clause 2 … the shake never reaches the world draw` — the S-10 gap, closed |
| `be836d9187` | S-14 `R49` art density, harness +196/−0 | registered **RED** on purpose (`FAIL R49 clause 1: a sampled frame held only 75 distinct colours, < 90`), plan §8 thresholds untouched; my own probes (`VB_R49DIAG`, `DIAG2`…`DIAG5` in `/tmp/vb-s14d`) root-caused it to the ink model, not the art |
| `8e1e9fa0dc` | S-14b ink-model fix, harness +124/−25 (a declared model fix, every removed line reviewed) | my own two controls: raising the new downscale guard to `nx >= 3` → `FAIL R49 clause 2 … bands med 9 / min 2`; a per-pixel ink trace of ground px `(64,208)` → now the ramp `#ddf2cb` **then** the strip's `#dfbf9d`, against exactly one `[object Object]` write before |

**Harness slices are additive-only**: `git diff --numstat HEAD -- tools/verify.mjs` must read `N 0`. A nonzero deleted-line count means a worker edited an existing check — reject the diff. Two exceptions, both declared in advance and reviewed line by line by the integrator: S-14b (the ink MODEL, plus `R49`'s comment lines — no `check(...)` body) and **S-16**, which is specced as a rewrite of `R38`/`R45`.

## Structural facts the remaining slices must NOT re-derive

- **Steady settled fx-idle 1-1 frame, per surface** (`newGame → steps(120) → fx.isIdle() → zero the op logs → renderFrames(1)`): live `0 fillRect / 1 drawImage`; `scene 0 / 22 blits + 1 clear`, `depth 0`, 7 save/restore pairs; `hud 252 fillRect / 2 blits + 1 clear`; `upscale 0 / 2 blits`; `lightmap 1 / 1`; `bloom 0 / 4 + 1 clear`; `bloomHalf 0 / 1 + 1 clear`. Total fillRect **253** = `hud` 252 + `lightmap` 1, and it equals the independent `drawStats().totals.fillRect` delta for that frame. `bakeCalls 356`, `offscreenCanvases 0`, per-frame `unknownCalls []` (bake whitelist `arc/beginPath/fill`).
- **Bake-scope op logs SATURATE at `BAKE_LOG_CAP` 4096** (`log()` at `tools/verify.mjs:119-123`) and silently stop appending. Zero the log you read (`r.rects.length = 0`, the `R18`/`R23`/`R47` pattern) or bound it by `r.seq`. Unzeroed reads measured `hud 4096 + lightmap 122 = 4218`, and a live-recorder-only clause passes on 0 while 252 glyph fills run on `hud`.
- **Never read `compositeLayers().x.ctx.globalAlpha`**: it answers `3.26e-16` for `hud` on a healthy renderer while the ink it records carries alpha 1. Read the last `stateLog` set inside the frame window instead (`log()` pushes `[key, value, seq, used]`).
- **The live recorder holds DEVICE px** (`k = 3` in the harness: `devicePixelRatio` pinned 1 at 1280×800 ⇒ `fit()` s=3 ⇒ backing 768×720) and is truncated at `INK_CAP` 262,144 < 552,960. All world/HUD ink reads go to `sceneRec()` / `hudRec()` (`tools/verify.mjs:1011/:1023`), never `rec`. `fillRect` ink is modelled **pre-CTM** — a canvas transform moves no modelled pixel.
- **`main` (`d16b002`) cannot host any new check**: no `drawStats()`/`STAT_KEYS`, no `composite.js`/`fx.js`/`pixels.js`/`atlas.js`/`terrain.js`. "Red before" evidence therefore has to be a *measured substitute*, stated honestly — the pattern S-12/S-13 established (a counter grafted onto main's own recorder gave `VB_DRAWSTATS 1-1 fillRect min=1090 med=1114 max=1153 drawImage=0`), plus an **in-harness falsification** (flat-palette synthetic frame → same code path goes red).
- **`fx` determinism**: `fx.hit(entity, 'land'|'stomp'|'hurt'|'hop'|'jump')` takes **strings**, `fx.burst(x, y, n, KIND.SPARK)` takes a **KIND value**; mixing degrades silently. A settled frame requires `fx.isIdle()` before any stream comparison. `fx.reset()` is called from `loadLevel()` (`main.js:163`), which is what the harness's `newGame()` route reaches.
- **No wall clock in a pass line**: `atlas.metrics().ms` is `performance.now()`-derived (R48 prints only `frames/w/h/missing`). **`src/render.js:200` blinks the TITLE on `Date.now()/500`** — the only wall-clock read on the draw path, and `R50` (S-15) will hit it head-on: TITLE is the one screen that cannot be stream-digest-compared across two runs unless the blink phase is pinned or the comparison excludes TITLE.
- **The ink model is now correct, and `R49` proves it — do not re-derive or "simplify".** `gradientInk` resolves a gradient `fillStyle` per pixel (linear projection on the create-call axis, radial `(dist−r0)/(r1−r0)`, stops in `addColorStop` order, `t` clamped, canonicalised through `inkCss`, cache cap 4096; conic declines to ink — `grep createConicGradient src/` → no hits); `inkBlit` reads the whole n×n source block for an **exact integer downscale** (≥2 both ratios, identity CTM, integral src+dst) because the destination scan's `(u+0.5)*(sw/W)` sample lands on the ODD source column while an `ART_SCALE = 2` bake keys the EVEN corner. `rec.rects` still logs `String(t.fillStyle)` (`R45` diffs that array), and `parseInk` still treats `[object Object]` as unparseable. **Gotcha 18** in `GRAPHICS_STATE.md` is the lesson: any new ink census needs a blank-the-source control.
- **`R49`'s shipped census** (settled 1-1, 9 inked frames at 9 `cam.x`, 309 LEVEL-decided tile samples): unique colours/frame min **330** / med 576 / max 600 (the branch's browser readback is 800-801), tone bands med **16** / min **9** / p10 15 / max 47, colours/tile med **16** / min **9**, frame ink **52,835-54,260** opaque px + **0** unparseable of 54,260, `hud` 18 colours. Thresholds are plan §8's unchanged `90 / 5 / 3 / 6`; clauses 2-3 are carried by the strip art, clause 1's headroom by the gradient fix — the comment at `tools/verify.mjs:5750` keeps the D1-only `min 93` number so neither fix can be "tidied" away.
- **Suite cost moved 10.2 → 15.3 s** (R49 standalone 2.3 → 3.2 s) because ink now covers ~320k px per inked check; the agreed ceiling is 25 s. `R19`'s printed `draw #` index legitimately shifts between runs (gotcha 7) — two runs of the same tree can differ on that one PASS line; its assert is relative.
- **User decision, do not reopen**: plan §7's single `multiply` of the lightmap onto `scene` stays exactly as S-08/S-09 landed it — no ambient lift toward white, no `source-over` fallback, the 3-line `render.js` tweak is cancelled. Measured cost: mean world luma **−14.79 fields / −27.37 canyon / −23.31 palace**, past the user's stated 15-luma comfort level and **knowingly accepted**; S-17's screenshots carry it and nobody may soften the multiply to flatter a screenshot.

## Remaining queue — one worker at a time, in this order

| ID | Slice | File | What the next worker must be told |
| --- | --- | --- | --- |
| **S-15** | `R50` FX determinism + `R51` frozen gameplay | `tools/verify.mjs` | **Brief is pre-written: `/tmp/vb-s15-brief.md`** (if `/tmp` was cleared: `R50` = the draw-stream digest of two identical scripted runs, `fx.reset()` ⇒ shake 0, `rec` op logs zeroed first, and **`R50` must assert `G.state === 'PLAYING'` on every sampled frame** because `src/render.js:200` blinks the TITLE prompt on `Date.now()/500`; `render.js` is not to be touched). `R51` = deep `G`/player/enemy/item snapshot dump serialised `JSON.stringify(dump, null, 1)` and sha256'd (`node:crypto` is available to the harness) at scripted frames 60/120/600: **a 3-snapshot dump is 4919 B, sha256 `b8a8c73f…`** (reference file `/tmp/vb-s10-snap-head.json`), per-frame anchors `60 → 38d977fe…`, `120 → cca225d3…`, `600 → 069132e3…`; `KIND`/`fx.burst`/`fx.hit` are NOT yet imported in `tools/verify.mjs` (add as a new line), `streamDigest` (FNV-1a 32-bit) sits near the old `:5453`, `fx` accessors near old `:5374`. Diff must be `N 0`. |
| S-16 | rewrite `R38` + `R45` onto `rec.drawImages` | `tools/verify.mjs` | Claims preserved, never loosened; `/tmp/vb-s08` is the pristine `036ad19` copy (`cmp`-clean, keep until S-16 done). Note `036ad19`'s message claims `44/44` for S-08: true in-suite, false standalone (`R18`) — read it as "green with contamination". |
| **S-17** | browser gate — **integrator only, never delegated** | — | **Tooling is built and validated: `/tmp/vb-s17-tooling.md`.** Readback = `layers().upscale` downsampled by integer `1/k` → exactly 256×240, comparable to `/tmp/vb-shots/before-{title,play.png}` (verified 256×240, `main` `d16b002`); NEVER `#game.toDataURL()` (device px now). Timing tap wraps the global `requestAnimationFrame` → `med/p95/over20/console-error-count` from the game's own loop. Thresholds `med ≤ 16.7`, `p95 ≤ 20`, 0 errors; **run with zero workers live** (a sample taken beside a running worker read med 17.0 / p95 20.0 / 1238 frames > 20 ms — invalid). `dpr > 1` only via Chromium `tab.emulate({ device: 'iPhone 13' })`; that tab freezes rAF between automation calls. The reactive bot reaches 1-1 `cam 839.96` and dies — decide between a better bot and the documented `G` seam for the 1-3 boss, and label a seam-produced arena run honestly. |
| S-18 | `architecture.md` module map + Deviations | `architecture.md` | Docs must describe shipped code, not intent. |
| S-19 | `requirements.md` "8-bit-inspired" + `VEGGIE_BROS_PLAN.md` locked decisions | two docs | |
| S-20 | `README.md`, full suite, final commit | `README.md` | all ids green |

## Open findings (nobody has funded these; do not silently "fix" them)

1. **`fxHit()` has no consumer**: `grep -n getSquash src/*.js` → only `src/fx.js:320`. The 6 `fxHit` sites S-10 added set squash state nothing renders, and `fx.metrics()` does not count hits. **S-10b** (~10 lines in `render.js` applying `getSquash` to the player/enemy/boss blits) is what makes jump/land/stomp/hurt/boss-hit visible. Needs a fresh slice with its own gate.
2. **Unfunded §6 emitters**: the `bump` sfx (`main.js:489-491`) has no emitter; §6's **boss-hop dust** is unreachable from `main.js` (`updateBoss` is in read-only `src/enemy.js`, would need per-entity state).
3. **Particle/explosion *lights* still need an `fx.js` pool iterator** — a second file. **Ask the user before letting any worker widen into `src/fx.js`.**
4. `render.js:200`'s `Date.now()` title blink is the last wall-clock read in the draw path (see the `R50` note).
5. My own facts file `/tmp/vb-s12-facts.md` said `hud 253` fillRect; S-12's worker proved `252` (217 glyph cells on rows 9-15 + 35 on rows 21-27, +1 `lightmap` = the measured +253). The file is corrected; the gated total was always right.
6. **`jsconfig.json` (the user's, 2026-11-19) is editor-only, not a gate.** `tsc --noEmit -p jsconfig.json` (`checkJs: true`, `include: ["**/*.js"]` → 17 files; `.mjs` is not matched, so `tools/verify.mjs` is outside it) reports **779 errors on this branch vs 774 on pristine `main`** — i.e. our +5 are the same implicit-any family as the pre-existing 774 (`TS7006` 525, `TS7005` 108, `TS2339` 74, `TS7053` 29, `TS7034` 24, `TS7018` 14, `TS7019` 2, `TS2551` 2, `TS2353` 1), concentrated in `sprites.js` 208 / `terrain.js` 101 / `fx.js` 90 / `composite.js` 72. Adding `"noImplicitAny": false` leaves **6** (`3 TS2339`, `2 TS2551`, `1 TS2353`). Do not wire `tsc` into the gates or "clean up" 779 implicit-anys without the user asking; do not let a JSDoc sweep near `src/` without a slice brief.
7. **S-17's boss half has an open decision** (recorded, not decided): the reactive bot in `/tmp/vb-s17-bot.js` reaches `cam 839.96` in 1-1 and never 1-2, so 1-3 needs either a lookahead bot over `level.tiles` or the documented `G` test seam to park the hero in the arena — and a seam-produced run may be presented **only** as labelled timing evidence, never as a played run. Evidence and the validated readback/tap recipe: `/tmp/vb-s17-tooling.md`.

## Unchanged rules (they are the reason the suite is still trustworthy)

One subagent at a time; brief with exact paths **and** line ranges, ≤ ~400 lines read, ≤ ~150 changed lines, ≤ 40-line report; the worker writes its own `### <SLICE> RESULT` block (immediately before `## Slice queue — run one at a time, in this order`), its own queue row, and `/tmp/vb-<slice>-result.json` **early** (both of today's long workers hit context compaction — tell them a control whose verbatim red they cannot quote did not happen). The integrator re-runs every gate itself and **never runs the `commit` namespace while a worker is live** (that is what `f77d12f` is: it swept a live worker's lines). Never delete, skip, loosen or re-word a check — a red you cannot fix is a finding, quoted verbatim; a check that turns green because it went blind is the worst outcome, so **every new or re-pointed read needs a positive control**, and "44/44" (now "47/47") is never accepted as evidence by itself. `src/player.js enemy.js items.js level.js camera.js input.js audio.js` are read-only to the graphics layer; each slice names its own writable files, one file per slice. Banned in `src/`: `getImageData`, `putImageData`, `ctx.filter`, `shadowBlur`, runtime `createLinearGradient`/`createRadialGradient`/`createPattern`, `Math.random`, `ctx.translate` in `render.js`. No deps, no build step, no `package.json`, no asset files, no TODO/stub/feature-flag/dead code; comments say *why*. `edit` with a relative path resolves against the session cwd (the repo); absolute paths for `/tmp`, then `grep -c <patch-string>` both copies. A/B builds: `git worktree add /tmp/vb-main main` + `./serve-local.sh 8011` + `git worktree remove` after — never `git stash`/`git checkout --` in this shared worktree.

## RESUME PROMPT — paste this into a fresh session

```
Continue the veggie_bros graphics upgrade as INTEGRATOR. cwd /Users/jasonjordan/repos/veggie_bros,
branch feature/graphics-upgrade at its tip (the commit that last touched GRAPHICS_HANDOFF.md), clean
tree. The user's own jsconfig.json and the src/main.js @type line are already committed (b7b01da9fc):
do not re-add them, re-lint them, or wire tsc into the gates.

THE PREVIOUS SESSION ENDED WITH A MACHINE RESTART, so assume /tmp is empty: rebuild
/tmp/vb-verify-each.sh (recipe in GRAPHICS_HANDOFF.md's artifact table) and re-run ./serve-local.sh
8010 before trusting any gate or screenshot. Then RUN THE FIVE COLD-START GATES IN GRAPHICS_HANDOFF.md
BEFORE EDITING ANYTHING, in order: node tools/verify.mjs (expect 48/48 pass, 0 fail, ~15-16 s), the
isolation sweep (expect STANDALONE FAILS: 0 of 48, ~24 s), the node --check loop over src/*.js
tools/verify.mjs, curl http://127.0.0.1:8010/ (NEVER port 8000), git status --short. A red you did
not cause is a finding: quote it verbatim, never skip or re-word a check.

READ FIRST, IN THIS ORDER, NOTHING ELSE: GRAPHICS_HANDOFF.md (cold start, the /tmp artifact rebuild
table, the structural facts no slice may re-derive, the standing warnings, the 7 open findings), then
GRAPHICS_STATE.md (slice queue + every measured RESULT block, then the gotcha list — gotcha 18 is the
S-14b lesson), then GRAPHICS_PLAN.md §9.

STATE: S-01..S-14b complete, integrator-committed, every gate re-run personally. Suite 48/48 in
~15-16 s, isolation 0 of 48. R49 (art density) is GREEN at plan §8's unchanged thresholds because
S-14b fixed the harness ink model (exact-integer-downscale blits + per-pixel gradient ink); its
thresholds and executable lines are frozen, so leave R49 alone unless asked. S-15 was never started:
its worker was cancelled after two requests having made zero edits, so nothing of it is in the tree.

YOUR JOB: run the remaining queue, ONE subagent at a time — the user paused the last session with "no
new subagents", so confirm before spawning the first worker. Start at S-15 (R50 draw-stream
determinism + R51 frozen-gameplay snapshot diff in tools/verify.mjs; the whole brief is rebuilt in the
handoff's S-15 queue row: R50 must assert G.state === 'PLAYING' on every sampled frame because
render.js:200 blinks the title on Date.now()/500; R51's anchors are 4919 B / b8a8c73f… with per-frame
38d977fe / cca225d3 / 069132e3; neither id may enable the ink option, since ink costs ~4 s per check
since S-14b). Then S-16 (rewrite R38/R45 onto rec.drawImages — a DECLARED rewrite, so numstat will not
be "N 0": review every removed line yourself and keep all three R45 claims plus a real measured claim
for R38; rebuild /tmp/vb-s08 as a detached git worktree at 036ad19 first). Then S-17 (60 s of 1-1 plus
the 1-3 boss at dpr 3 / 375x667, dt med <= 16.7, p95 <= 20, 0 console errors, screenshots vs
/tmp/vb-shots/before-*.png — INTEGRATOR ONLY, never delegated, and with ZERO workers live or the
numbers are meaningless; rebuild and re-validate the readback/bot tooling first; dpr 3 needs app
'chromium' + tab.emulate iPhone 13, where rAF freezes between automation calls; the boss-entry
decision in open finding 7 belongs to the user). Then S-18..S-20 (docs: architecture.md, then
requirements.md + VEGGIE_BROS_PLAN.md — plan §2's "21 unique colours" and §8's "med 2 / min 1 / max 5"
are stale, measured med 3 / min 2 / max 6 — then README.md and the final full suite).

RULES: one worker live at a time; brief with exact paths AND line ranges, <=400 lines to read, <=150
changed lines, <=40-line report; the worker writes its own RESULT block, queue row and
/tmp/vb-<slice>-result.json EARLY. Re-run every gate yourself and demand a positive control for any
harness read that is new or moved — never accept a worker's "48/48" without the pasted line. Harness
slices diff as "N 0" unless the slice is a declared rewrite (S-16 is). Worker scratch lives in
/tmp/vb-<slice>w/ copies (rsync -a --exclude .git ./ ...); never git stash / git checkout --, and
commit only via the eval commit namespace, never while a worker is live. Ask the user before any slice
widens into src/fx.js for a particle-light pool iterator, and before touching jsconfig/tsc settings.
Keep your own context small: measurements go in the brief file, not the transcript; dead workers are
respawned with tighter scope.
```
