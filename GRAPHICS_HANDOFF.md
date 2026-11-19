# Session handoff — 2026-11-18, after **S-13 (R48 bake-once + R52 render-only shake) landed and integrator-verified**

Read this file, then `GRAPHICS_STATE.md` (slice queue + every `RESULT` block), then `GRAPHICS_PLAN.md` §9 (the queue). Nothing else is required to resume. `WORKFLOW_STATE.md`, `RESUME.md`, `IMPLEMENTATION.md`, `docs/REVIEW-*` are out of scope.

## Cold start — run all five before editing anything

```sh
cd ~/repos/veggie_bros && git status --short && git log --oneline -5
node tools/verify.mjs 2>&1 | tail -2          # expect: 47/47 pass, 0 fail  (~9-13 s)
bash /tmp/vb-verify-each.sh 2>&1 | tail -1    # expect: STANDALONE FAILS: 0 of 47  (~16-27 s)
for f in src/*.js tools/verify.mjs; do node --input-type=module --check < "$f"; done
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8010/   # ./serve-local.sh 8010, NEVER 8000
```

If `/tmp/vb-verify-each.sh` is gone (reboot clears `/tmp`): it runs every registered id in its own `node tools/verify.mjs <ID>` process and prints `STANDALONE FAILS: n of <ids>`; that gate is the only one that catches cross-check contamination, so rebuild it before continuing.

## Where the branch stands

`HEAD ef61f63510` on `feature/graphics-upgrade`, tree clean, suite **47/47**, isolation **0 of 47**. All four of this session's slices are integrator-committed, each with every gate re-run personally (never on a worker's word) and at least one falsification control run by the integrator's own hands:

| Commit | Slice | Integrator control that mattered |
| --- | --- | --- |
| `c99f961c7e` | S-10 FX emit sites, `main.js` +75/−1 (14 particle + 6 `fxHit`) | my probe: a live pool adds exactly one `scene` `drawImage` per particle (22 → 32 for 10 sparks); and `render.js:264 → const o = 3` **passed all 44 checks** → logged as the shake-blindness finding |
| `8b1a184736` | S-11 page metas + `LAND_MIN_POWER` → `config.js` | browser: all four metas parse, `color-scheme` resolves dark, DPR pass intact (backing 512×480 == css at dpr 1); worker's positive control `touch-action` → `FAIL R12` |
| `a8a47a0409` | S-12 `R47` draw budget (+7 surface clause, `R12` metas), harness +98/−0 | my own two reds: `TOTAL_FILL 450→252` → `FAIL R47 total fillRect 253 > 252 …`, `WORLD_BLIT 240→21` → `FAIL R47 world pass: scene drawImage 22 > 21` |
| `ef61f63510` | S-13 `R48` bake-once + `R52` render-only shake, harness +140/−0 | my own `render.js:264 → const o = 3` now gives **`46/47 pass, 1 fail`**, red = `R52 clause 2 … the shake never reaches the world draw` — the S-10 gap, closed |

**Harness slices are additive-only**: `git diff --numstat HEAD -- tools/verify.mjs` must read `N 0`. A nonzero deleted-line count means a worker edited an existing check — reject the diff.

## Structural facts the remaining slices must NOT re-derive

- **Steady settled fx-idle 1-1 frame, per surface** (`newGame → steps(120) → fx.isIdle() → zero the op logs → renderFrames(1)`): live `0 fillRect / 1 drawImage`; `scene 0 / 22 blits + 1 clear`, `depth 0`, 7 save/restore pairs; `hud 252 fillRect / 2 blits + 1 clear`; `upscale 0 / 2 blits`; `lightmap 1 / 1`; `bloom 0 / 4 + 1 clear`; `bloomHalf 0 / 1 + 1 clear`. Total fillRect **253** = `hud` 252 + `lightmap` 1, and it equals the independent `drawStats().totals.fillRect` delta for that frame. `bakeCalls 356`, `offscreenCanvases 0`, per-frame `unknownCalls []` (bake whitelist `arc/beginPath/fill`).
- **Bake-scope op logs SATURATE at `BAKE_LOG_CAP` 4096** (`log()` at `tools/verify.mjs:119-123`) and silently stop appending. Zero the log you read (`r.rects.length = 0`, the `R18`/`R23`/`R47` pattern) or bound it by `r.seq`. Unzeroed reads measured `hud 4096 + lightmap 122 = 4218`, and a live-recorder-only clause passes on 0 while 252 glyph fills run on `hud`.
- **Never read `compositeLayers().x.ctx.globalAlpha`**: it answers `3.26e-16` for `hud` on a healthy renderer while the ink it records carries alpha 1. Read the last `stateLog` set inside the frame window instead (`log()` pushes `[key, value, seq, used]`).
- **The live recorder holds DEVICE px** (`k = 3` in the harness: `devicePixelRatio` pinned 1 at 1280×800 ⇒ `fit()` s=3 ⇒ backing 768×720) and is truncated at `INK_CAP` 262,144 < 552,960. All world/HUD ink reads go to `sceneRec()` / `hudRec()` (`tools/verify.mjs:1011/:1023`), never `rec`. `fillRect` ink is modelled **pre-CTM** — a canvas transform moves no modelled pixel.
- **`main` (`d16b002`) cannot host any new check**: no `drawStats()`/`STAT_KEYS`, no `composite.js`/`fx.js`/`pixels.js`/`atlas.js`/`terrain.js`. "Red before" evidence therefore has to be a *measured substitute*, stated honestly — the pattern S-12/S-13 established (a counter grafted onto main's own recorder gave `VB_DRAWSTATS 1-1 fillRect min=1090 med=1114 max=1153 drawImage=0`), plus an **in-harness falsification** (flat-palette synthetic frame → same code path goes red).
- **`fx` determinism**: `fx.hit(entity, 'land'|'stomp'|'hurt'|'hop'|'jump')` takes **strings**, `fx.burst(x, y, n, KIND.SPARK)` takes a **KIND value**; mixing degrades silently. A settled frame requires `fx.isIdle()` before any stream comparison. `fx.reset()` is called from `loadLevel()` (`main.js:163`), which is what the harness's `newGame()` route reaches.
- **No wall clock in a pass line**: `atlas.metrics().ms` is `performance.now()`-derived (R48 prints only `frames/w/h/missing`). **`src/render.js:200` blinks the TITLE on `Date.now()/500`** — the only wall-clock read on the draw path, and `R50` (S-15) will hit it head-on: TITLE is the one screen that cannot be stream-digest-compared across two runs unless the blink phase is pinned or the comparison excludes TITLE.
- **User decision, do not reopen**: plan §7's single `multiply` of the lightmap onto `scene` stays exactly as S-08/S-09 landed it — no ambient lift toward white, no `source-over` fallback, the 3-line `render.js` tweak is cancelled. Measured cost: mean world luma **−14.79 fields / −27.37 canyon / −23.31 palace**, past the user's stated 15-luma comfort level and **knowingly accepted**; S-17's screenshots carry it and nobody may soften the multiply to flatter a screenshot.

## Remaining queue — one worker at a time, in this order

| ID | Slice | File | What the next worker must be told |
| --- | --- | --- | --- |
| **S-14** | `R49` art density | `tools/verify.mjs` | **Brief is pre-written: `/tmp/vb-s14-facts.md`** (thresholds unchanged, the ±3 LSB canonicalisation, the LEVEL-decided non-sky tile definition, `cam.x` fractional trap, `sceneRec().pixels` as the source, the honest red-on-`main` substitute, ≥200 tile samples over a camera scroll). Measured figures: `main` tone bands min 2 / med 3 / max 6 and colours min 2 / med 3 / max 7 and 35–56 unique colours on a frame; this branch (S-07a) bands exact 18/38/30/46, q8 11/17/15/20, colours 20/44/35/53, unique 800–801, per-char q8 minima X 14 / P 15 / B 14 / `\|` 11. Print `main`'s figures in the check's comment or the next reader "fixes" them. |
| S-15 | `R50` FX determinism + `R51` frozen gameplay | `tools/verify.mjs` | `R50` = draw-stream digest twice, `fx.reset()` ⇒ shake 0; mind the TITLE blink fact above. `R51` can reuse S-10's method: deep `G`/player/enemy/item snapshot dump at scripted frames 60/120/600, sha256'd (recipe and the shipped-code hashes in `/tmp/vb-s10-result.json`, `/tmp/vb-s10-probe-{patched,head}.txt`; the dump was 4919 B, `b8a8c73f…`, identical with 9110 particles emitted). |
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

## Unchanged rules (they are the reason the suite is still trustworthy)

One subagent at a time; brief with exact paths **and** line ranges, ≤ ~400 lines read, ≤ ~150 changed lines, ≤ 40-line report; the worker writes its own `### <SLICE> RESULT` block (immediately before `## Slice queue — run one at a time, in this order`), its own queue row, and `/tmp/vb-<slice>-result.json` **early** (both of today's long workers hit context compaction — tell them a control whose verbatim red they cannot quote did not happen). The integrator re-runs every gate itself and **never runs the `commit` namespace while a worker is live** (that is what `f77d12f` is: it swept a live worker's lines). Never delete, skip, loosen or re-word a check — a red you cannot fix is a finding, quoted verbatim; a check that turns green because it went blind is the worst outcome, so **every new or re-pointed read needs a positive control**, and "44/44" (now "47/47") is never accepted as evidence by itself. `src/player.js enemy.js items.js level.js camera.js input.js audio.js` are read-only to the graphics layer; each slice names its own writable files, one file per slice. Banned in `src/`: `getImageData`, `putImageData`, `ctx.filter`, `shadowBlur`, runtime `createLinearGradient`/`createRadialGradient`/`createPattern`, `Math.random`, `ctx.translate` in `render.js`. No deps, no build step, no `package.json`, no asset files, no TODO/stub/feature-flag/dead code; comments say *why*. `edit` with a relative path resolves against the session cwd (the repo); absolute paths for `/tmp`, then `grep -c <patch-string>` both copies. A/B builds: `git worktree add /tmp/vb-main main` + `./serve-local.sh 8011` + `git worktree remove` after — never `git stash`/`git checkout --` in this shared worktree.

## RESUME PROMPT — paste this into a fresh session

```
Continue the veggie_bros graphics upgrade. cwd /Users/jasonjordan/repos/veggie_bros, branch
feature/graphics-upgrade, HEAD ef61f63510, tree clean.

READ FIRST, IN THIS ORDER, NOTHING ELSE: GRAPHICS_HANDOFF.md (cold start, the structural
facts no slice may re-derive, the standing warnings, the open findings), then GRAPHICS_STATE.md
(slice queue + measured RESULT blocks), then GRAPHICS_PLAN.md §9.

STATE: S-01..S-13 complete. Suite 47/47 in ~9-13 s, isolation gate 0 of 47, harness diffs
additive-only. All DPR/device, per-surface frame, bake and shake facts are measured — the
handoff's "Structural facts" section is the whole list; do not re-derive any of it.

YOUR JOB: run the queue with one subagent at a time, starting at S-14 (R49 art density in
tools/verify.mjs — the brief is already written to /tmp/vb-s14-facts.md: thresholds unchanged,
±3 LSB colour canonicalisation, LEVEL-decided non-sky tiles, sceneRec().pixels as the source,
honest red-on-main substitute; if /tmp was cleared the same numbers are in GRAPHICS_STATE.md's
R49 section). Then S-15 (R50 draw-stream determinism — mind the Date.now() title blink in
render.js:200 — plus R51 frozen-gameplay snapshot diff), S-16 (R38/R45 onto rec.drawImages;
/tmp/vb-s08 pristine 036ad19 copy must survive until then), then S-17 (60 s of 1-1 + 1-3 boss at
dpr 3 / 375×667, dt med <=16.7 p95 <=20, 0 console errors, screenshots vs
/tmp/vb-shots/before-*.png — INTEGRATOR ONLY, never delegated; tooling and the readback recipe
are in /tmp/vb-s17-tooling.md: downscale layers().upscale by 1/k for a true 256x240, and run the
timing with zero workers live or the numbers are meaningless), then S-18..S-20 (docs).

Only one worker live at a time; brief with exact paths AND line ranges, <=400 lines to read,
<=150 changed lines, <=40-line report; the worker writes its own RESULT block, queue row and
/tmp/vb-<slice>-result.json early. Re-run every gate yourself (node tools/verify.mjs,
bash /tmp/vb-verify-each.sh, the --check loop, a targeted subset) and demand a positive control
for any harness read that is new or moved — never accept a worker's "47/47". Harness slices must
diff as "N 0" (pure addition). Never run the commit namespace while a worker is live. Ask the
user before any slice widens into src/fx.js for a particle-light pool iterator. Prefer delegating
work to subagents and keeping your own context small: put measurements in the brief, not in your
transcript.
```
