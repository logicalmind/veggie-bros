# WORKFLOW_STATE — checkpoint-bounded two-sided camera

Goal: fix the camera so it follows the hero LEFT, and add checkpoints — once a flag is
reached the hero can never travel left past it and the camera can never scroll left past
it. Death respawns at the last flag. This explicitly reverses two written decisions
(`architecture.md` "camera is a one-way ratchet (R20) … do not restore it" and
`VEGGIE_BROS_PLAN.md` "no per-level checkpoints … do not add these"), so the docs are
updated in the same change to match the shipped code, and harness check `R20` is rewritten
(not deleted) to assert the new invariant.

Active worktree: none (main workspace) — `/Users/jasonjordan/repos/veggie_bros`

Suite: baseline before any edit **34/34 pass, 0 fail**; after the checkpoint feature **37/37**; after
**FIX PASS 1** 40/40; after **FIX PASS 2** 41/41; **FIX PASS 3** stays 41/41; **FIX PASS 4** 42/42
pass, 0 fail, exit 0 (new id `R44`; the pass-4 baseline it was handed was **40/41, exit 1** — see
that section's Blockers); **after FIX PASS 5 43/43 pass, 0 fail, exit 0** (new id `R45`; the baseline
pass 5 was handed was **42/42, exit 0**, and the camera work it inherited is commit `44ac4bf`) —
byte-identical across consecutive runs and stable in every subset combination tried.
Registered ids: `SMOKE` + `R01`–`R33` + `R36`/`R37`/`R38` + `R40`/`R41`/`R42`/`R43`/`R44`/`R45` = **43,
no duplicates** (`grep -c "^check(" tools/verify.mjs` → 43). **`R34`, `R35` and `R39` are NOT registered**
— `R34` is the docs-only queue entry, `R35` stays RESERVED for the deferred boss-freeze item, `R39`
stays RESERVED for the `Q` double-award candidate that `docs/REVIEW-2026-11-15.md` had first floated as
`R36`. Ids used by this work: `R36`/`R37`/`R38` (checkpoint feature), `R40`/`R41`/`R42` (fix pass 1),
`R43` (fix pass 2), `R44` (fix pass 4 — the per-frame camera-step bound on a live checkpoint crossing),
`R45` (fix pass 5 — the invisible/silent checkpoint guard).
**FIX PASS 3 added no ids** — it hardened `R36` and `R43` in place.

## Checklist

> **[FIRST PASS — READ WITH THE LATER PASSES' MARKERS IN MIND.]** This checklist is the first pass's
> plan, kept as written; it is NOT the authority on current behaviour. Items **5** and **6** were
> amended by **F2/F3/F4/F5.2/F5.3** (forward-crossing arming, the trigger loop moved above the
> dead-return, respawn grace, banner suppression, index guard), item **8**'s flag columns by **F1**, and
> item **9**'s `R38` by **C1** (clearance band restored) and **C3**. Each of those items carries an
> inline pointer. The authoritative current record is **FIX PASS 4** at the end of this file (then FIX
> PASS 3, 2 and 1) plus the live `src/` and `tools/verify.mjs`. These facts are restated in as many as
> four places (here, FIX PASS 1, FIX PASS 2, and — for anything about `R43`'s numbers, which pass 3
> superseded — `docs/REVIEW-2026-11-15.md` §11) — if you change one copy, check them all. Note that
> **pass 4 inverts the camera invariant passes 1–3 assert** (see its "invariant inversion" section):
> anything below this line that says the camera "is clamped to" the floor is describing the deleted
> wall, not the shipped code.

- [x] 1. `src/camera.js` — two-sided lerp + two-sided clamp; `minX` is a **parameter**
      (default 0), never a field on `cam`; `CAMERA_FOLLOW_X = 96` named and exported;
      `makeCamera()` still returns exactly `{ x: 0 }`; the ratchet comment AND the stale
      "second rate (14)" comment are gone. Camera stays a float; consumers still floor it.
      **[THE "TWO-SIDED CLAMP" HALF IS SUPERSEDED BY FIX PASS 4: the bounds are applied to the
      TARGET before the lerp, never to `cam.x` after it — see that section's invariant inversion.]**
- [x] 2. `src/level.js` — `K` added to `MARKER` (`'HTFCKG'`) and `NEEDS_GROUND` (`'HTFK'`),
      `level.checkpoints` of `{ x, y, row, taken }` in the gate's style, tile cleared to `.`,
      list sorted by ascending x.
- [x] 3. `src/main.js` — `G.checkpointX: 0` / `G.checkpointIndex: -1` next to `gateScored`,
      both reset in `loadLevel`, and one derived authority `checkpointBounds()` returning
      `{ playerX, camX }` (the single place `CAMERA_FOLLOW_X` is subtracted).
- [x] 4. `src/player.js` — `updatePlayer(p, dt, input, level, minX = 0)`, clamp immediately
      after the X pass / before `// Y pass`, mirroring the wall-resolve idiom. Both `main.js`
      call sites pass `bounds.playerX`. The three `tools/verify.mjs` callers were left at four
      arguments ON PURPOSE (`R33`'s physics sweeps must stay unbounded; default 0 keeps them).
- [x] 5. `src/config.js` + `src/main.js` — `CHECKPOINT_TRIGGER_W/TOP/BOTTOM`; the forward-only
      trigger sits before the pit check and uses `rectOverlap`,
      only ever raises `checkpointX`, and gives `audio.sfx('power')` + a `CHECKPOINT` popup +
      `G.bannerT = 1`. The overlap with a *walking* hero was verified, not assumed
      (box 196…208 vs band 128…208; `R36` clause 1 asserts it).
      **[SUPERSEDED IN PART — see FIX PASS 1 F2/F3 and FIX PASS 2 C5, which are the authority on the
      trigger as shipped: arming also requires a left-to-right crossing of the post, the loop runs
      ABOVE `if (p.dead) return;`, and the sfx/popup/banner are skipped when the crossing frame is
      also the death frame.]**
- [x] 6. `src/main.js` — `respawnAtCheckpoint()`: capture → `loadLevel(G.levelIndex)` →
      re-apply (re-mark `x <= checkpointX` as taken, restore the pair, seat the hero at
      `(checkpointX, (row + 1)·16 − h)`, zero velocities, `G.cam.x` = the floor). No flag
      banked = the old full restart, untouched.
      **[AMENDED — see FIX PASS 1 F4 (`INVULN_TIME`), F5.2 (`G.bannerT = 0` on this path only) and
      F5.3 (out-of-range index → plain restart, no throw), plus FIX PASS 2 C3 (`p.prevX` pinned to
      `cp.x`); those are the authority on the respawn as shipped.]**
- [x] 7. `src/sprites.js` + `src/render.js` — `drawCheckpoint(ctx, x, y, taken)` next to **[SUPERSEDED by FIX PASS 5 (2026-11-16): that sprite and its draw call are DELETED — a checkpoint is invisible now; `R45` is the guard.]**
      `drawGate`, `px()`/fillRect only, PALETTE-only, inked rows exactly the trigger band;
      banked uses the `used`/`usedDark` pair (the used-pumpkin language). Drawn next to the
      gate with manual `- camX`; no `ctx.translate` introduced; HUD/overlays untouched.
- [x] 8. `src/levels.js` — 1-1 cols 55/91, 1-2 cols 77/**112** (77/117 SUPERSEDED by fix-pass F1
      below, whose edit landed inside F1's own run at 16:58:12 — the later "that edit never landed"
      claim is RETRACTED, see FIX PASS 2), 1-3 cols 42/76 (row 12, x
      880/1456 · 1232/1872 · 672/1216). 2.1–2.5 screens apart, all well before `G`/`F`, each
      with 5 columns of continuous solid ground beneath and clear air through the band. Only
      the three row-12 strings changed; every row length is unchanged (one distinct length per
      map, asserted) and `SMOKE`/`R30`/`R33` are green — `R33`'s numbers are byte-identical.
      **[POST-F1 STATE: `R38`'s clearance band was narrowed by FIX PASS 1 and has since been RESTORED
      to the full 4 rows × post ±2 by FIX PASS 2 C1, with 1-2 (114,9) `'P'` as the only named
      exception, so "clear air through the band" is now asserted strictly, not loosely.]**
- [x] 9. `tools/verify.mjs` — `LEGEND` += `K` (`SMOKE`'s per-character assert would otherwise
      reject every shipped map); `installLevel` resets `checkpointX`/`checkpointIndex` and the
      `taken` flags (`toTitle` gets the pair too); `R20` rewritten to the opposite invariant
      with the cull sub-asserts kept **plus** a new clause proving the per-frame cull now
      unfreezes when the camera walks back; `R36`/`R37`/`R38` added, each with its
      discrimination proof in the header. `R04` (`camX: 236`), `R18` and `R23` (both derive
      screen x from `cam.x`) re-verified green alone and together.
      **[SUPERSEDED IN PART — `R38` was narrowed by FIX PASS 1 and RESTORED by FIX PASS 2 C1 (full
      4-row band × post ±2 + the named `CLEARANCE_EXCEPTIONS` whitelist), and `R37` gained C3's
      `p.prevX` clause. FIX PASS 2's C-section and its proof table are the authority on
      `R36`/`R37`/`R38`/`R43`.]**
- [x] 10. Docs — `architecture.md` (citation-drift note, file map, state machine, collision
      model + the new left-bound paragraph, legend + `K` paragraph, `parseLevel` shape,
      rendering pipeline + camera sentence, Deviations: new camera / checkpoint-bound /
      death-respawn entries and a rewritten behind-camera-cull entry, `makeCamera` entry);
      `VEGGIE_BROS_PLAN.md` ("no per-level checkpoints" marked REVERSED, with the time-limit
      and save-persistence prohibitions kept); `docs/REVIEW-2026-11-15.md` (SUPERSEDED banner on
      the R20 entry + a §11 post-queue landing note with ids, consequences and proofs);
      `README.md` (one player-facing sentence about flagposts). `IMPLEMENTATION.md` has no
      Deviations list, so it was left alone.
      **[SUPERSEDED IN PART — `VEGGIE_BROS_PLAN.md:99` ("respawn at level start") was later REWRITTEN by
      FIX PASS 2 D1, `README.md`'s sentence was tightened by FIX PASS 1 ("from the left"), and two more
      §11 lines were appended after this one. FIX PASS 2's D-table is the authority on the current doc
      state.]**

## Hard-case traces (measured on the real modules, not reasoned in the abstract)

(a) **Nothing banked, `minX = 0`** — flat 120-column map, hero at x 600, camera in steady
state at 504, holding left: `f150 x=147 cam=67 screen=81 → f300 x=0 cam=0 screen=0` and it
stays there. The camera tracks `p.x − 96` down to the 0 floor, so the hero's screen column
goes 96 → 81 → 0 and it is pinned at the world's own left edge (`tileAt` reports solid for
`tx < 0`) — never off-screen (`screen = p.x − floor(cam.x) ≥ 0` always, because
`cam.x ≤ p.x − 96` whenever that is positive and is clamped to ≥ 0 otherwise). On the old
ratchet the camera stayed at 504 and the hero walked out of the picture at screen x < 0.

(b) **Flag banked at 880, floor `880 − 96 = 784`** — hero at 920 holding left:
`f0 x=920 cam=824 screen=97 → f100 x=880 cam=784 vx=0 screen=96`, then permanently
`x=880, cam=784, screen=96` (min screen column during the approach: 87.1).
Why the offset does it: the camera's floor is the hero's floor **minus the lead the camera
normally keeps**, so when the clamp pins the hero at `checkpointX` the camera's floor puts
that same position at screen x = `CAMERA_FOLLOW_X` = 96 — the exact column the hero occupies
in steady-state running. The two clamps can therefore never fight: if the floor were
`checkpointX` itself, the hero would be shoved to screen x 0 (the "jammed at the edge"
failure mode), and if it were lower the hero would drift left of centre.
`main.js:checkpointBounds()` is the only place that subtracts the offset, so the player and
the camera cannot disagree.

## Discrimination proofs (first pass; six variants, each run then reverted from a file backup, no
## tree-mutating git). Two of the numbers below were re-measured by the fix passes below, which
## quote the current values — the harness clauses moved, so the failing x moved with them.
## **[NOT THE AUTHORITARY TABLE — this is the earliest copy of these rows; three of the six are
## restated in FIX PASS 1's table below, which re-measured two of them (clamp → `x=229.17`, camera
## floor → `536.90`), while FIX PASS 2's table below that is the authority on `R38`/`R43` as they ship
## today. Three copies of these proofs exist: if you edit one, edit all three.]**

| variant | result |
|---|---|
| whole `src/` at HEAD (new harness) | `R20` FAIL "cam.x only moved back 0.00px from 1664.00 … the camera must follow the hero left"; `R36` FAIL "level flag: unknown character 'K' at 12,40"; `R37`/`R38` FAIL "Cannot read properties of undefined (reading 'length')" |
| `updatePlayer` clamp deleted | `R36` FAIL "the hero walked to x=218.17, past the checkpoint at 640" (`R37` unaffected, correctly) |
| camera floor deleted (`lo = 0`) | `R20` FAIL "cam.x fell to 637.17, below the checkpoint floor at 640"; `R36` FAIL "the camera scrolled to 526.44, left of the checkpoint floor at 544" |
| respawn reverted to plain `loadLevel` | `R37` FAIL "the hero respawned at x=34.0 — that is the level start, not the checkpoint at 880" |
| trigger loop disabled | `R36` + `R37` FAIL "…never armed it (checkpointIndex=-1…)" |
| `drawCheckpoint` ignores `taken` | `R38` FAIL "a banked flag is not drawn differently from a live one" | **[SUPERSEDED by FIX PASS 5: `drawCheckpoint` and `R38`'s art clause are both deleted, so this row can no longer fire. The claim that survives is "a banked post is not distinguishable from a live one on screen", now asserted the other way round by `R45` (identical draw streams with the posts banked). See FIX PASS 5's coverage-lost table.]**

Every new/rewritten check also PASSES with the shipped fix, and `R37`'s second scenario pins
the no-flag path to the old `H`-spawn restart (so a future "improvement" that always respawns
at a flag goes red).

## Architectural notes discovered while coding

- `tools/verify.mjs` installs `G.cam = { x: opts.camX || 0 }`, a bare object: the left floor
  MUST be an `updateCamera` parameter — a `cam.minX` field reads `undefined` there and would
  NaN the camera. `makeCamera()`'s shape is load-bearing for the test seam.
- `tools/verify.mjs` keeps its own `LEGEND` for `SMOKE`'s per-character assert; a new map char
  must be added in both places or `SMOKE` goes red for a spurious reason.
- Resolving a death calls `loadLevel(G.levelIndex)`, which re-parses `LEVELS[]` and replaces
  any harness-installed synthetic level under the check. So the respawn check runs on the
  shipped 1-1 (`R37`) while the clamp/floor check can stay synthetic (`R36`).
- `updateTurnip`/`updateBoss` (`enemy.js:63,92` — re-resolved in FIX PASS 3; this line said `62,90`
  until then) early-return per frame, so a leftward camera
  genuinely UNfreezes entities: `CULL_BEHIND` now means "32 px behind the current view". `R20`
  asserts the wake-up (the frozen turnip walks 41 px). Knock-on for the deferred `R35`: the
  boss-freeze premise is no longer ratchet-dependent and must be re-derived before that fix.
- `R33`'s fairness/reachability numbers are unchanged (its sweeps call `updatePlayer` with the
  default `minX = 0`) and its PASS line is byte-identical (worst margins 19.8 / 11.0 / 19.8 px,
  171/180 · 180/200 · 144/160 columns reachable).
- Placement was sanity-checked against the one hard pit a flag sits near: 1-2's second flag
  (col 117 — **SUPERSEDED, now col 112; see fix-pass F1 above for the re-measured numbers**) is
  3 columns before the deliberate 6-column pit (cols 120–125), so a respawn there
  must still be able to clear it. Swept every jump timing from that respawn cell with run held:
  **35 of 122 land across** — still a real skill check, never a soft-lock. (1-1's and 1-3's
  flags are 3+ columns clear of their nearest hazards.)
- Two feedback mechanisms were used instead of one: `G.bannerT = 1` (the mandated banner) plus
  a `CHECKPOINT` score-popup, because the banner can only ever draw the level's own name —
  without the popup the only visible feedback would be a repeated "WORLD 1-1 — …".
- Deliberately NOT done: no save persistence; no per-checkpoint score award; no change to
  `CULL_BEHIND`/`enemy.js` logic (the deferred `R35` territory — the fix pass touched only the two
  stale comments there); no new camera field; no refactor of `onDeathResolved`'s callers; the
  4-arg `updatePlayer` calls inside `R33` left unbounded.

---

# FIX PASS 1 — 2026-11-16 (F1–F5, from two APPROVED reviews)

> **READ THIS SECTION WITH PASS 2'S CORRECTIONS IN MIND.** Everything below is what pass 1 reported,
> kept as written so the audit trail is continuous. **Two** things it states are no longer true, and
> `FIX PASS 2` at the end of this file is the authority on each: (1) F1's STOP-CONDITION wording
> (**"fatal from every cell in 110-114"**) overstated the measurement, corrected under D5 below;
> (2) the `R38` clearance rule this section narrowed has since been restored to full height with a
> named whitelist, so "Harness rule narrowed" below is superseded.
> **Do not look for a third correction: the claim pass 2 first recorded here — "F1's `src/levels.js`
> edit never landed" — was itself FALSE and has been RETRACTED.** F1's col 117 → col 112 move **did**
> land, inside this section's own run (16:24:58 → 16:58:12), and 1-2's second flagpost has been at
> col 112 in the working tree ever since. See the RETRACTED "PASS 2 AUDIT FACT" section below, and
> `docs/REVIEW-2026-11-15.md` §11's SECOND FIX PASS line.

Suite: 37/37 → **40/40 pass, 0 fail, exit 0**, byte-identical across consecutive runs; the new and
changed checks also pass in isolation and in reverse order (`R42 R41 R40 R36 R37 R38 R20` = 7/7),
and the camera-sensitive ones (`SMOKE R04 R18 R23 R24 R33`) are still green.
**Ids used by this pass: `R40`, `R41`, `R42` — and only those** (`R35` boss-freeze and `R39`
`Q`-double-award stay reserved; 40 registered ids, no duplicates).
Files touched: `src/levels.js` `src/main.js` `src/player.js` `src/enemy.js` `tools/verify.mjs`
`architecture.md` `docs/REVIEW-2026-11-15.md` `README.md` (+ this file).

- [x] **F1 (MAJOR, fairness)** — 1-2's second flagpost **col 117 → col 112**; only that row-12
      string changed, the row is still exactly 200 characters, and **no terrain was touched**.
      **[PASS 2 AUDIT — RETRACTED, THE ORIGINAL VERSION OF THIS NOTE WAS FALSE.** Pass 2 first wrote
      here that this edit "was never applied to the tree", that `git diff src/levels.js` showed a `K`
      only at cols 77 and 117, and that `R38` printed `77/117`. It **was** applied — here, at
      16:58:12: `moveflag.mjs` and its before/after copies are still in the session temp
      (`fp/bak-prefix/src/levels.js` at 16:24:58 holds 117 → `cur` at 16:58:12 holds 112), pass 2's own
      17:17:16 snapshot already held col 112 and is byte-identical to the live file
      (SHA-256 prefix `49051e0a`), and its 18:15:57 write reproduced that snapshot exactly — a
      byte-for-byte no-op, so nothing was ever re-applied and no tile was ever at risk. The `77/117`
      was genuine output read from the wrong directory: `R38` derives its column string from the live
      parsed map (`cp.x / TILE`), and `vb/mut/U0_unpatched` (a 117-bearing scratch copy) reproduces that
      string exactly. `git diff HEAD -- src/levels.js` must not be cited either way — `HEAD` contains no
      `K` markers at all. Full write-up under FIX PASS 2's RETRACTED "PASS 2 AUDIT FACT".
      Everything measured below still holds, because the numbers were measured from the cell, not from
      the file.]
      Measured from a standing respawn holding right, one jump per take-off frame, 180 timings:

      | respawn cell | RUN clear | RUN window | WALK clear | WALK window | mash |
      |---|---|---|---|---|---|
      | col 117 (before) | **15/180** | f0-14 (truncated at the respawn) | 20/180 | f0-19 | clears |
      | col 112 (after)  | **21/180** | f19-39 | 21/180 | f43-63 | clears |

      The ceiling is spatial, not positional: the clearing take-off strip is fixed at **x≈1831-1895
      (cols 115-118)** — bonus block at (114,9) bounds it left, the `=` ledge bounds it right — and
      every clearing jump lands ON that ledge and runs off its right end (matches `R33`'s recorded
      "79 px real crossing, 103/320 take-offs clear"). Cols 110/111/113/115 measured 20-21/180, so
      the move recovers the whole strip rather than widening it: at 117 the RUN window started at
      frame 0, i.e. the jump had to be pressed before the pit was on screen.
      **STOP CONDITION TRIGGERED — REPORTED, NOT FIXED.** The natural "run to the lip and jump"
      route is **not safe from any cell in 110-114** (head-bump on tile (120,9)
      at x≈1922/y=160, then the pit; measured differences ≤0.3 px across all six cells) because the
      ledge's underside begins at the pit's own left column. Authored geometry; no in-range flag
      position can change it. Terrain left exactly as found, as instructed. `R33`'s numbers are
      byte-identical (worst margin still 11.0 px at that pit).
       **[D5 CORRECTION, PASS 2]** the paragraph above said **"fatal from every cell in 110-114,
       identically to 117"**, which overstates the measurement: a reviewing agent counted head-bumps
       on 20-22 of 61 timings for each cell in 110-114, but its canonical jump-at-the-lip timing
       CLEARS from cols 110-119. What the data supports is *"no cell in 110-114 is safe ACROSS jump
       timings, and the natural lip-jump head-bumps (120,9) at y≈160 in most timings"* — NOT that the
       route cannot be done. That distinction is the stated justification for leaving the terrain
       alone, so it is worth being exact about, and `R43` now prints the margin instead of leaving it
       to prose: 21/180 clearing run+jump timings from col 112, 15/180 from 117, 0/180 from 105.
- [x] **F2 (MINOR)** — a flag now arms only on a **left-to-right crossing of its post**: new
      `p.prevX` beside `prevBottom` (`player.js:29,71,180`) and
      `if (!(p.prevX <= cp.x && p.x > cp.x)) continue;` in the trigger loop. Retreat into an
      unbanked flag arms nothing and stays free to pass; a hop over it above the band arms nothing
      and stays passable; walking right still arms on a plain walk (`R40`). Residual, accepted: a
      hero that turns around while still straddling the post banks nothing until it steps back left
      of the post and re-crosses — the cost is that the bound stays where it was, never a wall.
- [x] **F3 (MINOR)** — the trigger loop moved **above** `if (p.dead) return;`. `R41` constructs the
      fatal contact and the post crossing as the *same frame* (frozen turnip parked `cp.x + 12`,
      hero one step left of the post at `RUN_MAX`), so only that ordering can bank; it composes with
      F2 because the crossing is still required.
- [x] **F4 (MINOR)** — `respawnAtCheckpoint()` grants `p.invulnT = INVULN_TIME` (the constant
      `hurtPlayer` already uses; nothing invented). Checkpoint path only: the no-flag restart keeps
      zero grace, and `R42` asserts both halves plus that the grace *expires* (a frozen turnip
      parked on the respawn point is harmless at 45 frames and lethal within 200).
- [x] **F5.1** — both stale "Well behind the ratcheted camera" comments (`enemy.js` turnip + boss)
      reworded to the camera, noting the cull is a per-frame test. Comments only.
- [x] **F5.2** — `G.bannerT = 0` on the checkpoint-respawn path only; fresh level entry and the
      no-flag restart still show `WORLD 1-1 — STRAWBERRY FIELDS` (`R42` asserts all three).
- [x] **F5.3** — `if (index < 0 || index >= G.level.checkpoints.length) return;`; an unresolvable
      index falls back to the plain restart (`loadLevel` has already cleared the pair) instead of
      throwing on `cp.row` inside the death handler.
- [x] **F5.4** — `R36`/`R37` proof tables rewritten to quote the assert that **actually fires**, and
      each mechanism re-proven by its own mutation (table below, numbers re-measured).
- [x] **F5.5** — `R37` now loops **every** checkpoint index on shipped 1-1 (flag 0 → 880/cam 784,
      flag 1 → 1456/cam 1360, with every flag's `taken` re-asserted against the bound after the
      rebuild); `R36` gained a **shipped-map clause 4** that walks into all 6 shipped flags on the
      real maps (which also proves each is reachable on foot), then takes the best available run-up
      and holds left, asserting the hero bound, the **per-map** camera floor and that the hero stays
      visible (worst measured screen x 80, asserted > 60). New helpers `heroFits`/`walkableFar` so a
      real-map scenario finds its own footing rather than assuming one. Self-check catch: clause 4's
      floor assert first read the *synthetic* clause-2 `FLOOR` (544), which every shipped floor
      happens to exceed — a vacuous assert. It now compares against that map's own
      `post.x − CAMERA_FOLLOW_X`, so 1-1 flag 1 is held to 1360 and 1-2 flag 2 to 1696.
- [x] **F5.6** — `docs/REVIEW-2026-11-15.md:1125`'s "new entry (`R36`)" now carries an inline
      pointer to the `R39` renumber so the line cannot be read as an id collision.
      **[FIX PASS 3: that anchor drifted as the file grew — the inline pointer is at `:1126` now and
      the IDS line stating the renumber is at `:1158`; `:1125` no longer points at either.]**
- [x] Docs — `architecture.md`: the `K` legend paragraph distinguishes band overlap (necessary) from
      the crossing (sufficient); Deviations entries rewritten for the forward crossing +
      death-frame banking and for the respawn grace/banner/guard, plus a new entry recording the
      col-112 choice with its numbers; the `main.js` citation-drift note re-measured (**+93** lines
      now **[PASS 2: re-measured at +104, and rewritten as a named anchor table — see D2/D3 below]**.
      `docs/REVIEW-2026-11-15.md`: a §11 FIX PASS line, and the
      POST-QUEUE `LANDED` line's flag columns corrected to 77/112 with a pointer. `README.md`:
      "walking past one (from the left) banks it".

## Harness rule narrowed — needs orchestrator adjudication
## **[SUPERSEDED BY PASS 2 (C1): the rule is restored to its full 4-row × post ±2 form, with the
## single unavoidable obstruction expressed as a named, audit-asserted whitelist instead of a
## narrowed band. Read the two paragraphs below as history.]**

`R38` used to demand an empty 5-wide × 4-tall box around every flagpost. **No cell in the 110-114
window the user specified passes that** (pipe at 108-109, the authored bonus block at (114,9), the
ledge from 120), so the old rule and the requested cell were mutually exclusive. It now demands the
full 4-row band over the post ±1 column and walking height at ±2 — still not a rubber stamp:
1-2 flag at 111 → `the flag at col 111 has | in the walk-up column 109,11`; 1-1 flag 2 at 94 →
`the flag at col 94 is walled in by | at 95,10`; 1-2 flag buried in the pipe at 108 →
`the flag at col 108 is walled in by | at 108,9`. Col 112 is the only in-window cell that passes.
**Pass 2 note: those three asserts are real and still fire** (re-proven in pass 2 with the restored
band, at the post ±2 columns — `109,11` became `109,9` because the restored rule checks the whole
band rather than only the foot row), but the narrowing itself was the wrong remedy: it silently
forgave the two upper rows for *every* flag on *every* map. The restored rule forgives exactly one
named cell.

## Discrimination proofs (each mutation applied to a throwaway copy under the session temp; the
## working tree was never mutated, so there is nothing to restore — `git status` shows intended
## files only)
## **[PARTLY SUPERSEDED — FIX PASS 2 re-proved the `R38` clearance class after restoring the full band
## (its `109,11` became `109,9`) and added the `R43`/`C3`/`C4`/`C5` rows; pass 2's table is the
## authority on those. Do not "sync" the two tables by hand without re-running the mutations.]**

| mutation | observed FAIL line |
|---|---|
| F2 crossing guard deleted (band overlap arms again) | `R40 the hero walked LEFT through an unbanked flag and armed it (checkpointIndex=0, hero at x=640.0) — only a left-to-right crossing may bank a checkpoint: expected -1, got 0` — the hero pinned exactly at the post is the invisible wall |
| crossing test kept, band gate dropped | `R40 jumping over an unbanked flag banked it — the trigger is a crossing of the post, not a volume to be inside: expected -1, got 0` |
| trigger loop moved back below `if (p.dead) return;` | `R41 a fatal hit inside the band of an unbanked flag skipped the checkpoint (crossed to x=882.17, checkpointIndex=-1) — the trigger loop must run before the dead-return short-circuit` |
| `p.invulnT = INVULN_TIME` deleted | `R42 a checkpoint respawn granted no invulnerability (invulnT=0.00) — the flagpost cells are not safe ground` |
| `G.bannerT = 0` deleted | `R42 a checkpoint respawn re-raised the 1-1 stage-intro banner (bannerT=1.50) — that reads as "level restarted": expected 0, got 1.5` |
| index guard widened back to `index < 0` | `R42 the respawn threw: TypeError: Cannot read properties of undefined (reading 'row'): expected 0, got 1` |
| `respawnAtCheckpoint` → plain `loadLevel` | `R37 the hero respawned at x=34.0 — that is the level start, not the checkpoint at 880` |
| `const index = 0` (first-flag-only respawn) | `R37 the banked flag survives the level rebuild: expected 1, got 0` — invisible to the pre-fix single-index R37 |
| `minX` clamp deleted (`player.js`) | `R36 the hero walked to x=229.17, past the checkpoint at 640` |
| `lo = 0` (`camera.js`) | `R20 cam.x fell to 637.17, below the checkpoint floor at 640` + `R36 the camera scrolled to 536.90, left of the checkpoint floor at 544` |
| 1-2 flag onto the pipe (col 108) | `R36 1-2: the hero has nowhere to walk right after banking the flag at x=1728` (clauses 1-3, synthetic, still PASS) |
| 1-2 flag one column early (111) | `R36 1-2: no standable ground within 2 tiles left of the flag at x=1776 — the hero cannot walk into it` |
| 1-1 flag 2 into its pipe (col 94) | `R36 1-1: the hero has nowhere to walk right after banking the flag at x=1504` |
| `src/main.js` alone at the pre-checkpoint commit | `R36 walking right through the flag at x=640 never armed it (checkpointIndex=-1, hero only reached 792.9)`; `R37 walking through 1-1's flag 0 at x=880 never armed it (…hero at 948.0…)`. This is why the R36/R37 tables no longer claim the clamp/respawn asserts fire there |
| physics-neutrality of the map move | the pre-move and post-move trees produce byte-identical jump sweeps (markers are cleared to `.` before collision) |

## Deliberately NOT done (fix pass)

- Re-marking a SKIPPED earlier flag as un-taken after a respawn — excluded by the brief (cosmetic).
- Any change to the pre-existing 1-2 pit / `=` ledge / pipe / bonus-block geometry — excluded by the
  brief; the fatal natural route is reported above, not engineered around.
- `VEGGIE_BROS_PLAN.md:99`'s old acceptance line ("respawn at level start in small form") left as
  historical text: the plan already carries the REVERSED banner at `:109` and the file was outside
  this pass's doc list. Say the word and it gets a pointer.
  **[DONE IN PASS 2 — D1 rewrote that line to the flagpost respawn, so it no longer contradicts
  shipped behaviour.]**
- The `CHECKPOINT` score-popup from the first pass kept unchanged (it is now the only legible "you
  resume here" marker on the respawn path, since the banner leg is suppressed there).
  **[PASS 2 (C5) kept the popup but silenced it, the fanfare and the banner on the death frame —
  see that section.]**
- No new id below `R40`, no reuse of `R39`, no change to `makeCamera()`'s shape, no camera field, no
  `CULL_BEHIND` logic change, no `R35`, no timer/loop changes, `G` still exported.

---

# FIX PASS 2 — 2026-11-16 (C1–C5 code/harness + D1–D7 docs, from the review punch-list)

Suite: 40/40 → **41/41 pass, 0 fail, exit 0** (new id `R43`), byte-identical across consecutive runs.
**Registered ids: 41, no duplicates, `R43` the only addition** (`grep -c "^check(" tools/verify.mjs` →
41; `R34`/`R35`/`R39` → 0 matches, they stay docs-entry / boss-freeze-reserved / `Q`-candidate).
Files touched this pass: `src/levels.js` (written, but **byte-identical to what was already there** —
see the RETRACTED note below) `src/main.js` `tools/verify.mjs` + `architecture.md`
`docs/REVIEW-2026-11-15.md` `VEGGIE_BROS_PLAN.md` (+ this file). **Nothing committed, no branch, no
worktree.** Every mutation below ran in a throwaway copy under the session temp; `src/` in the tree
was never mutated and no tree-mutating git was run.
**[2026-11-16 RETRACTION: the "PASS 2 AUDIT FACT" section that opens this pass was FALSE — it is kept
under a RETRACTED banner, with the correction beside it. Nothing in C1–C5 or D1–D7 depended on it.]**

## ~~PASS 2 AUDIT FACT — the docs claimed a map edit that had never landed~~ **[RETRACTED 2026-11-16: NOT A FINDING]**

> **This heading and the claim under it were WRONG.** They are kept verbatim below, marked as false,
> so a future reader can see that the claim was made and why it was wrong — the claim must never be
> read as a finding, and no shipped tile was ever authored twice. Full retraction, with the forensic
> basis, is in `docs/REVIEW-2026-11-15.md` §11's **SECOND FIX PASS** line.

**THE CLAIM AS ORIGINALLY MADE — FALSE, QUOTED ONLY FOR THE AUDIT TRAIL:**

> Before any of this pass's work, `src/levels.js` still had 1-2's second flagpost at **col 117**, while
> `architecture.md`, `docs/REVIEW-2026-11-15.md` and this file all described **col 112** (and F1's own
> entry claimed to have moved it). `git diff src/levels.js` showed `K` at cols 77 and 117 and `R38`
> printed `77/117`. So C1's required proofs ("a flag at 112 must pass, a flag at 111 must fail") were
> unrunnable as written, and three docs were describing a tile that did not exist. Reported to the
> orchestrator, and **the user chose "Restore col 112"** — the single-character row-12 edit
> (`||.......K` → `||..K.....`) was re-applied, no other terrain touched, all three docs re-aligned to
> the tree. Consequence for the record: F1's "measured" numbers were always right (they were taken from
> the cell), but they had been *attributed* to a shipped state that only existed in prose.

**CORRECTION — the tree held 1-2's second flagpost at col 112 throughout, and none of the events
described above ever took place.**

- **The relocation landed in the EARLIER pass (F1 / FIX PASS 1), between 16:24:58 and 16:58:12.** The
  script that did it still exists on disk (`moveflag.mjs`, session temp) and its before/after states
  are preserved there: `fp/bak-prefix/src/levels.js` at **16:24:58** holds 117 → `cur` at **16:58:12**
  holds 112. So F1's own log line and the three docs were describing the shipped tree correctly all along.
- **This pass's own start-of-run snapshot, taken 17:17:16, already contained col 112** and is
  byte-identical to the live `src/levels.js` (SHA-256 prefix `49051e0a`).
- **This pass's later write to `src/levels.js` at 18:15:57 produced content identical to that
  snapshot.** The "re-applied single-character edit" was a **byte-for-byte no-op**: no terrain was ever
  at risk, nothing needed repairing, no row length was ever in question, and there was no window in
  which the docs and the tree disagreed.
- **Why `R38` could print `77/117` at all:** its column string is generated from the live parsed map
  (`cp.x / TILE`), never a hard-coded literal, so `77/117` is only printable by running the harness
  **inside a scratch directory that holds a 117 map**. An independent auditor reproduced exactly that
  output from `vb/mut/U0_unpatched` (a deliberately unpatched negative-control copy). Other
  117-bearing artifacts, by mtime: `bak-src/levels.js` 14:59:13, `fp/bak-prefix/src/levels.js` 16:24:58.
- **Evidence that must not be cited either way:** `git diff HEAD -- src/levels.js` cannot adjudicate
  this question, because `HEAD` contains no `K` markers at all — the diff looks identical no matter
  which pass authored the tile. Neither the original claim nor this correction may rest on that diff.
- **Attribution, corrected — this replaces the quoted paragraph's claim that "the user chose 'Restore
  col 112'" and that the edit "was re-applied":** the user's decision was **real**, but it ratified a
  state that had already been in the tree for roughly 50 minutes. **The authorship of 1-2 col 112
  belongs to FIX PASS 1 (F1), not to this pass**, and this pass's write did not put it there.
- **Process note — both halves, stated together so it cannot be misread:** what this pass actually got
  wrong is that it read a `levels.js` from one of its own scratch mutant/backup copies, mistook it for
  the repository, and then asserted a repo state (and a needed user decision) it had not observed.
  That is a real process failure and worth recording. It is **not** a code defect: the write that
  followed was the byte-for-byte no-op above, so no shipped code, tile, or behaviour was affected, and
  the suite went 40/40 → 41/41 for the harness reasons in C1–C5 below, not because of any map repair.
  The raw observation was probably genuine; the attribution was not.
- **End state, re-verified:** exactly 2 flagposts per level — 1-1 cols 55/91, 1-2 cols **77/112**,
  1-3 cols 42/76 — no marker at 117, no duplicates, row lengths 180 / 200 / 160, zero terrain tiles
  changed. `R38` prints `77/112`, which is what it prints from the live tree at every run since
  16:58:12 (before that, 117 was genuinely the shipped cell, so `77/117` from the repo was correct
  until that timestamp and wrong after it).

**Everything else in this section (C1–C5, D1–D7, the proof tables below) is unaffected by the
retraction and stands as written.**

## Checklist — code/harness

- [x] **C1 — `R38`'s clearance band restored to full height (4 rows × post ±2), the one unavoidable
      obstruction whitelisted by name.** Pass 1 had narrowed the band instead; that narrowing is what
      let a solid at (110,9) or (110,10) pass both `R36` and `R38` while clipping a respawn's first
      jump at y≈160. The band is now the full `cp.row-3 … cp.row` over post ±2 columns, and the single
      shipped tile it must tolerate is `CLEARANCE_EXCEPTIONS` (`tools/verify.mjs:2544`) — one entry,
      `1-2 (114,9) 'P'`, naming level + col + row + the exact character, plus an audit assert
      (`:2606`) that **each entry is consulted exactly once**, so the list cannot quietly rot when a
      post moves. Green on all shipped maps (`R38` prints `77/112`).
- [x] **C2 — new `R43`: every shipped respawn has a live route forward (the dynamic-fairness gap).**
      `R36` proves a post can be walked INTO, `R38` proves nothing solid stands in its band — neither
      proves the route OFF it, which was carried by prose only. `R43` (as shipped in pass 2:
      `tools/verify.mjs:2976`, helpers `nextHazardAhead` `:2935` / `respawnClears` `:2953` — **[PASS 3
      re-resolution: after the pins landed the check is at `:3172`, with `nextHazardAhead` `:3130` /
      `respawnClears` `:3149` / `pitRuns` `:3089` / `RESPAWN_HAZARDS` `:3107` / `PIT_INVENTORY`
      `:3119`. Those numbers were already 11 lines stale the moment they were written — locate by
      name, not by number]**) stands the hero on each of the 6 shipped
      posts and, using `R33`'s own pitCross protocol (real `updatePlayer`, right + run held, one
      full-hold jump at take-off frame f, 180 values of f), asks whether ≥1 timing gets across the
      hazard that post actually faces. Rule = first wall/pit in the grounded path, **plus** — when a
      pit's lip is within `VIEW_W`, i.e. visible from the respawn — that pit must be crossable with one
      committed run+jump. Assert is `>0`, not a fixed count: it forbids the impossible, not the tight.
      ~~Live numbers: `1-1@55 pit 58-59 26/180 (f0-25) · 1-1@91 wall 95-96 180/180 · 1-2@77 wall 80-88
      8/180 (f9-16) · 1-2@112 pit 120-125 21/180 (f19-39) · 1-3@42 pit 64-66 26/180 (f96-121) ·
      1-3@76 wall 80-81 180/180`.~~ **[SUPERSEDED BY FIX PASS 3 — the format is superseded and the
      `1-2@77 8/180` entry was MISLEADING AS PUBLISHED. It is an accurate count of a protocol, not a
      fairness margin: the hazard there is a CLIMBABLE STONE STAIRCASE (cols 80-88) with NO death
      route — 0 of 180 timings die, all 172 non-clears end grounded on the steps, and normal play
      (mash jump) walks from col 77 to col 146. That post's real kill hazard, the pit at cols 100-102,
      sits ~368 px away and is outside the `<= VIEW_W` cutoff, i.e. OUT OF SCOPE for `R43` by design.
      Quote `1-2@112 pit 120-125 21/180 deaths=159` as a margin; never quote `1-2@77`. See FIX PASS 3
      for the live numbers in the current format.]**
- [x] **C3 — `R37` now pins `p.prevX` on the respawn path** (`eq(q.prevX, cp.x, …)`, `:2463`). The
      crossing test reads `prevX` as "the last accepted x", so a respawn that leaves it at the level
      start makes the next frame's crossing arithmetic lie; nothing asserted it.
      **[PASS 3 CORRECTION]** "…makes the next frame's crossing arithmetic lie" is a counterfactual
      that cannot occur, and the harness comment said so at greater length until it was rewritten: the
      trigger scan starts at `G.checkpointIndex + 1` (`src/main.js:464`), `respawnAtCheckpoint`
      re-imposes the index (`src/main.js:161`), and `updatePlayer` rewrites `p.prevX` on the very next
      call (`src/player.js:180`). The assert is **state hygiene / defence-in-depth** — the same class
      as C4's `G.dyingT = 0` — valuable precisely because nothing shipped can observe the difference
      today, so it has to be asserted to stay true. The FAIL it produces is unchanged and real.
- [x] **C4 — `loadLevel()` zeroes `G.dyingT`** (`src/main.js:109`, with the why-comment at `:105-108`).
      Every kill site already zeroes it, so today it is always 0 on entry; the reset is there so a
      future kill path that forgets cannot be handed a stale clock that resolves on the new level's
      first frame. `R42` gained the matching clause (`:2895`).
- [x] **C5 — the trigger's feedback no longer fires on a death frame**: `if (!p.dead)` around
      `audio.sfx('power')` / the `CHECKPOINT` popup / `G.bannerT = 1` (`src/main.js:484-488`), while
      the bank itself still happens above the dead-return (F3 unchanged). Two new `R41` asserts
      (`:2771`, `:2773`). **[PASS 3: those line numbers have drifted and, worse, the second of those
      two asserts — the popup ABSENCE — was recorded as proven by a mutation that does not fail
      anything. Re-measured: deleting the popup producer alone leaves the suite 41/41, exit 0. The
      positive direction now lives in `R36` clause 1 (exactly ONE `CHECKPOINT` popup at the post on a
      live crossing); see FIX PASS 3, H1.]**

## Checklist — docs

| item | what landed | verified |
|---|---|---|
| D1 | `VEGGIE_BROS_PLAN.md:99` rewritten from "respawn at level start in small form" to the flagpost respawn (grace, no banner, no-flag fallback, checks `R37`/`R41`/`R42`); `:109`'s REVERSED banner extended to cite `R43` and keep the time-limit + save-persistence prohibitions | both lines read live |
| D2 | `architecture.md:3` drift note rewritten as a named anchor table, re-measured at **+104** for `main.js` (71 checkpoint + 22 pass 1 + 11 pass 2), with `player.js` +14 and the `config.js` **+10-at-`:41`** split stated separately | HIT |
| D3 | citation fixes at `architecture.md` **32, 52, 89, 91, 110, 141, 145, 150, 151, 152, 153, 154, 169, 174** | every `file:line` re-resolved against live code |
| D4 | `docs/REVIEW-2026-11-15.md:116`'s `R20` row now says "(camera half SUPERSEDED 2026-11-16 → two-sided + checkpoint floor; cull half stands)" | HIT |
| D5 | the "fatal from every cell in 110-114" overstatement corrected **in both places it was written** — `docs/REVIEW-2026-11-15.md:1136` and here (F1 entry, inline) | see D5 CORRECTION above |
| D6 | `R38`'s pre-narrowing rule written into `tools/verify.mjs:2523-2535` verbatim from WORKFLOW_STATE, **explicitly labelled a reconstruction** ("WORDING IS APPROXIMATE, THE SHAPE IS NOT") because the superseded clause is unrecoverable from git | HIT |
| D7 | `docs/REVIEW-2026-11-15.md:1126` **THIRD OPEN ITEM**: the 1-2 natural lip-jump head-bump on (120,9), terrain user-declined this change, with `R43`'s margins as the measurement | HIT |

Citation re-resolution used a script (session temp) that extracts every `` `x.js:N` `` from the
rewritten `architecture.md` lines and prints the real source line. All HITs, including the ones that
moved: pit check `main.js:508`, enemy mirror `main.js:320`, death freeze `main.js:281-290`,
`onDeathResolved`/`respawnAtCheckpoint` `main.js:137-183`, `updateCamera` call `:299`,
`checkpointBounds` `:127-135`, `G.cam.x` write `:182`, trigger loop `:464-490` (comment from
`:452`), `SOLID` `config.js:51`, `camera.js:13-29`, `player.js:55`/`106-128`/`130-138`,
`sprites.js:297-312`, `input.js:218`, `items.js:96`, `main.js:78,100`.

## Discrimination proofs (each in its own throwaway copy under the session temp)

| mutation | observed FAIL line |
|---|---|
| `X` planted at (110,9) — the head-height hole pass 1's narrowing left open | `R38 1-2: the flag at col 112 has X in the walk-up column 110,9` |
| `X` planted at (110,10) | `R38 1-2: the flag at col 112 has X in the walk-up column 110,10` (both PASSED this check pre-restoration) |
| 1-2 post one column early (111) | `R38 1-2: the flag at col 111 has \| in the walk-up column 109,9` |
| 1-1 flag 2 into its pipe (94) | `R38 1-1: the flag at col 94 is walled in by \| at 95,10` |
| 1-2 post buried in the pipe (108) | `R38 1-2: the flag at col 108 is walled in by \| at 108,9` |
| ground deleted under the post | `level 1-2: 'K' at 12,112 has no solid tile below` (the loader's `NEEDS_GROUND` gets there first — recorded so nobody reads it as an R38 clause) |
| 1-2's two posts pushed 70 columns apart | `R38 1-2: the two flags are 70 columns apart, expected roughly two screens (24..48)` |
| 1-2 post to col 105 (inside the screen window, 15 cols from the lip) | `R43 1-2: the flag at col 105 respawns the hero with NO route across the pit 120-125 ahead of it (0 of 180 run+jump timings get across; 180 fell in, 0 stopped short)` — **and** `R38 the R38 clearance exception for 1-2 (114,9) 'P' was consulted 0 time(s), expected exactly 1`, i.e. the whitelist audit catches the same map edit from the other side. `R36` clause 4 still PASSes it: the post is walkable, which is exactly the gap `R43` exists to fill |
| `p.prevX = p.x;` deleted from the respawn | `R37 flag 0: the respawn left p.prevX at 34 — the crossing test reads it as the last accepted x, so it has to be the checkpoint: expected 880, got 34` (`R40`/`R41` stay green — they never cross a respawn) |
| `if (!p.dead)` removed from the trigger feedback | `R41 banking a flag on the frame the hero dies still played the fanfare (1 × audio.sfx('power')) under the death cry: expected 0, got 1` | **[SUPERSEDED by FIX PASS 5: the whole feedback block and its guard are deleted from `main.js`; `R41` has no audio or popup asserts left and was re-measured on state (FIX PASS 5).]**
| same, popup only | `R41 banking a flag on the frame the hero dies still pushed 1 CHECKPOINT popup(s) that loadLevel() discards moments later: expected 0, got 1` | **[SUPERSEDED by FIX PASS 5: that popup and both of `R41`'s absence asserts are deleted — with no producer on any frame they were unfailable, which is why they were removed rather than left as vacuous green. `R45` asserts the absence where it can still fail.]**
| `G.dyingT = 0` deleted from `loadLevel` | `R42 a level load inherited the death clock — the next kill would resolve on that same frame and skip the death arc: expected 0, got 9` |

## Deviations from the reviewer's suggested wording (all measured, none applied blind)

- The Y pass is **`player.js:140-175`**, not the suggested `:140-181` — the wider range swallows the
  `prevBottom`/`prevX` capture tail that belongs to the X-pass bookkeeping.
- The `startGame` drift is **+16 (`:96` → `:112`)**, not the "+11" in the punch-list.
- The `main.js` drift note is re-measured at **+104**, not pass 1's +93.
- `docs/REVIEW-2026-11-15.md:1127`'s NIT cites `main.js:436` for the `architecture.md:41` comment; the
  live line is **`src/main.js:540`** (further drift since that log entry). Left unfixed on purpose:
  that NIT is reserved for an entry that may touch `src/`, and this pass's `src/` edits were scoped to
  the five C-items. Correct target would be `architecture.md:52`.

## Extras done beyond the list (each is a one-line honesty fix on a line this pass already touched)

`architecture.md:150` → `camera.js:22-29`; `:154`/`:89` → `enemy.js:17,63,92` / `:64,93` / `:75-83`;
`:174` → the `NEEDS_GROUND` cite; `:153` gained an `R43` pointer; `:152` records C4/C5; `:110` →
`sprites.js:297-312`; and `R42` gained the C4 clause rather than leaving that reset unasserted.

## Known-unfixed (reported, not touched)

- `architecture.md:141`'s **font** citation `sprites.js:325-335,401-422` is pre-existing drift
  unrelated to this change (the font lives at `sprites.js:345-352` + `417-439`, and "unknown glyphs
  keep their cell" is `:421`, not `:403-404`). Same class as `:117`/`:149`'s
  `player.js:65-67,165` → now `:70-71` (capture) + `:179-180` (write-back). Not in the punch-list, so left alone rather than
  half-shifted; say the word and all four are a one-line edit.
- `src/main.js:540` → `architecture.md:41` (see Deviations above).

## Blockers

None. **Not committed** — the tree is left dirty for the orchestrator to review and commit:
`git status --porcelain` is **14 modified files + 1 untracked** (15 lines): `README.md`,
`VEGGIE_BROS_PLAN.md`, `architecture.md`, `docs/REVIEW-2026-11-15.md`, `src/camera.js`,
`src/config.js`, `src/enemy.js`, `src/level.js`, `src/levels.js`, `src/main.js`, `src/player.js`,
`src/render.js`, `src/sprites.js`, `tools/verify.mjs` — plus this untracked `WORKFLOW_STATE.md`.
`git stash list` is empty, branch is `main` at `4101466`, there is no worktree, and no scratch file
is left inside the repo (every proof copy lived under the session temp and has been deleted). No
tree-mutating git was run in either pass, so there is nothing to restore; the suite is green
(41/41) and byte-stable.

The one decision still open for the orchestrator is the D5/`R43` fact rather than a blocker: 1-2's
post at col 112 is **playable but tight** (21/180 committed run+jump timings clear the pit) and the
natural "run to the lip and jump" route head-bumps the authored (120,9) ledge — terrain the user
declined to change, now tracked as the THIRD OPEN ITEM at `docs/REVIEW-2026-11-15.md:1126`.

---

# FIX PASS 3 — 2026-11-16 (H1–H4: what the newest check measures and what it reports)

Scope: **harness + docs only.** `src/` was NOT touched — `src/levels.js` is byte-identical to how this
pass found it (SHA-256 `49051e0a0ba5e21d8225182f87d8131c22a764db12fb3d5d99c915037910ca46` before and
after; `git status --porcelain` lists the same 14 modified + 1 untracked files as pass 2, no new ones).
Files changed here: `tools/verify.mjs`, `docs/REVIEW-2026-11-15.md`, `architecture.md`, this file.

Suite: **41/41 pass, 0 fail, exit 0** before and after (no id was added). Registered ids unchanged:
`SMOKE` + `R01`–`R33` + `R36`–`R38` + `R40`–`R43` = 41, no duplicates, `R34`/`R35`/`R39` still absent.
Byte-identical across consecutive runs; green in isolation and in every order tried (`R43` alone,
`R38 R43 R36 R37 R40 R41 R42 R20`, `R42 R41 R40 R36 R37 R38 R20 R43 R33`). Every mutation below ran in
a throwaway copy under the session temp; the repo tree was never mutated and no tree-mutating git ran.

- [x] **H1 — a recorded proof that did not reproduce, and a shipped feature with no positive
      assertion.** `R41`'s header claimed *"delete only the popup line instead and the next assert
      FAILs `…still pushed 1 CHECKPOINT popup(s)…`"*. **FALSE, re-measured**: deleting
      `G.items.push(makePopup(cp.x, cp.y - TILE, 'CHECKPOINT'));` from `src/main.js:486` gives
      **41/41 pass, exit 0** — `eq(ghosts.length, 0)` is an ABSENCE assert and a producer that no
      longer exists satisfies it. The mutation that fails is removing the popup's **guard**
      (`if (!p.dead)`), and it is caught by the FANFARE assert above it, so the popup clause was never
      the first to fire under any single mutation. (a) The header now records the measured truth,
      including the smallest mutation that does make it fire — compound: guard removed **and**
      `audio.sfx('power')` deleted → `FAIL R41 banking a flag on the frame the hero dies still pushed
      1 CHECKPOINT popup(s) that loadLevel() discards moments later: expected 0, got 1` (with `R36`
      and `R40` red for the missing sound). (b) **Positive coverage added to `R36` clause 1**
      (`tools/verify.mjs:2316-2319`): a live left-to-right crossing pushes **exactly ONE**
      `CHECKPOINT` popup, at `cp.x` / `cp.y - TILE`. Proof that deleting the producer now FAILs:
      see the table. The same false proof also existed in `docs/REVIEW-2026-11-15.md`'s SECOND FIX
      PASS line; annotated there, not deleted.
- [x] **H2 — `R43` published a meaningless number as a fairness margin.** Every row now prints
      `deaths` and `short` beside `clears` and is TAGGED `SURVIVAL` or `NO-DEATH-ROUTE`.
      **Remedy chosen: assert a weaker, correctly-labelled property — nothing was skipped.** All 6
      posts are still measured and still asserted: a `lethal` row asserts `deaths > 0` **and**
      `clears > 0` (survival), a non-lethal row asserts `deaths === 0` **and** `clears > 0` read as
      *"the respawn is not a dead end"* — never as a margin. Measured basis (probe on the real
      modules, `src/` read-only): from 1-2's col-77 post the hazard `R43` selects is the CLIMBABLE
      STONE STAIRCASE `wall 80-88`; **0 of 180 timings die**, all 172 non-clears end their 400-frame
      horizon GROUNDED on the steps at x≈1300-1316 (cols 81-82), a no-jump walk stops at col 79, and
      mash-jump reaches col 146 — i.e. normal play clears it instantly. Its real kill hazard, the pit
      at cols 100-102, is ~368 px away and outside the `<= VIEW_W` cutoff; the cutoff is **unchanged**,
      because one jump from a standing respawn cannot cross a staircase and then a pit, so widening it
      would assert a FALSE failure. That pit is now recorded as OUT OF SCOPE for `R43` rather than
      silently excluded.
- [x] **H3 — nothing pinned WHICH hazard `R43` measures.** Two tables pin it (`tools/verify.mjs`):
      `RESPAWN_HAZARDS` (`:3107`) per post — `1-1@55 pit 58-59` L, `1-1@91 wall 95-96`, `1-2@77
      wall 80-88`, `1-2@112 pit 120-125` L, `1-3@42 pit 64-66` L, `1-3@76 wall 80-81` — and
      `PIT_INVENTORY` (`:3119`), the full authored pit list per map (`4 / 7 / 4` pits, widest
      `3 / 6 / 4`), using the same `noGroundAt` predicate the measurements use. A pinned post that gets
      re-aimed fails immediately (its count would be a false statement); an UNPINNED post is still
      measured and still held to the survival rule first, with the missing pin reported after the loop
      — that ordering is deliberate, otherwise a relocation would pre-empt the substantive FAIL that
      `docs/REVIEW-2026-11-15.md` quotes. R33's numbers stay derived-and-printed (unchanged,
      byte-identical PASS line); the pin cannot live there because a check that prints what it finds
      cannot fail on what it finds. **Limitation, measured not assumed: the pins pin identity, not the
      count.** Running the reviewer's option (a) literally (1-2's `=` platform row 9 → row 8, cols
      120-125) left every pin GREEN while `R43`'s 1-2@112 margin moved **21/180 → 13/180 (f24-36)**;
      that run's red was `SMOKE` + `R33` (`rise at cols 119-120 (5 tiles): margin 3.8px < 8px`), a
      different clause for a different reason. Freezing counts was rejected on purpose (the rule
      forbids the impossible, not the tight, and a physics change would then need number re-baselines),
      so **margins must be re-measured and republished by hand whenever terrain changes**.
- [x] **H4 — comment/justification accuracy.** (1) `R37`'s `prevX` note no longer claims the hero's
      first step "re-reads as a crossing of its own post" — that is unreachable (scan starts at
      `G.checkpointIndex + 1`, `main.js:464`; `respawnAtCheckpoint` re-imposes the index, `main.js:161`;
      `updatePlayer` rewrites `prevX` next call, `player.js:180). It now says what it is: state hygiene /
      defence-in-depth, same class as `G.dyingT = 0`. (2) `R38`'s `hits === 1` audit records that only
      the **dead-weight (`hits === 0`) direction is reachable**; `hits === 2` is not reachable through
      any map edit, because two posts within ±2 of the whitelisted column would violate the 24..48
      gap clause that fires first. (3) Citations: `tools/verify.mjs`'s `R20` header cited
      `enemy.js:62`; the culls are `enemy.js:63` (turnip) and `:92` (boss) — corrected there, annotated
      in `docs/REVIEW-2026-11-15.md` and fixed in this file (`:156`). **The `main.js:168` prevX cite in
      the punch-list does not exist anywhere in `tools/verify.mjs`** (searched: the file carries no
      `main.js:<n>` prevX cite at all), so there was nothing to correct; the seeding is `main.js:173`.

## Live numbers (current format — this is the line to quote)

`R43 6 respawns can leave their flag: 1-1@55 pit 58-59 SURVIVAL clears=26/180 deaths=154 short=0
(f0-25), 1-1@91 wall 95-96 NO-DEATH-ROUTE clears=180/180 deaths=0 short=0 (f0-179), 1-2@77 wall 80-88
NO-DEATH-ROUTE clears=8/180 deaths=0 short=172 (f9-16), 1-2@112 pit 120-125 SURVIVAL clears=21/180
deaths=159 short=0 (f19-39), 1-3@42 pit 64-66 SURVIVAL clears=26/180 deaths=154 short=0 (f96-121),
1-3@76 wall 80-81 NO-DEATH-ROUTE clears=180/180 deaths=0 short=0 (f0-179); pits pinned at 4+7+4
(widest 3/6/4), hazard identity pinned per post; NO-DEATH-ROUTE rows have 0 deaths — their clears is
progress inside the 400-frame horizon, NOT a fairness margin`

**Quotable margins: `1-1@55 26/180`, `1-2@112 21/180`, `1-3@42 26/180`** (the three SURVIVAL rows).
The three NO-DEATH-ROUTE rows are progress figures inside a fixed 400-frame horizon and must not be
compared with each other or with a survival margin. **`1-2@77` is NOT a harsh-respawn point.**

## Discrimination proofs (this pass, each in its own throwaway copy)

| mutation | observed result |
|---|---|
| `CHECKPOINT` popup producer deleted (`main.js:486`) | **pre-pin harness: `41/41 pass, exit 0`** (the defect); **now: `FAIL R36 a live left-to-right crossing of an unbanked flag pushed 0 CHECKPOINT popup(s), expected exactly 1 …: expected 1, got 0`** — 40/41 | **[SUPERSEDED by FIX PASS 5: the producer is deleted ON PURPOSE and its `R36` popup clause with it — that FAIL text is history, not a defect signal. `R36` clause 1 now reads state; `R45` clause 2 fails if a popup comes back.]**
| `if (!p.dead)` guard removed, feedback kept | `FAIL R41 banking a flag on the frame the hero dies still played the fanfare (1 × audio.sfx('power')) under the death cry: expected 0, got 1` — 40/41 (the popup assert does NOT fire) |
| guard removed **and** `audio.sfx('power')` deleted | `FAIL R41 …still pushed 1 CHECKPOINT popup(s) that loadLevel() discards moments later: expected 0, got 1` + R36 + R40 — 38/41 (the only way R41's popup clause fires) | **[SUPERSEDED by FIX PASS 5: both asserts involved are deleted with the feedback (see FIX PASS 5); `R41`'s ordering proof was re-measured and still fires alone.]**
| 1-2 pit cols 120-125 filled with `X` | **pre-pin harness: `41/41`, and `R43` prints `1-2@112 pit 132-135 21/180 (f91-111)`** while `R33` re-baselines to `6 pits (widest 4) … 19.8px @cols 23-24` (the defect, re-verified); **now: `FAIL R43 1-2: the pit inventory R43 measures on has changed — pinned [12-14 … 120-125 …] (7 pits, widest 6), found [12-14 … 132-135 160-161] (6 pits, widest 4) …`** — 40/41 |
| lone `X` at 1-3 (60,12) — re-aim touching no pit | `FAIL R43 1-3: the flag at col 42 is now measured on wall 60-60, but this check publishes its margin as pit 64-66 …` — 40/41, R43 alone |
| 1-2 post → col 90 | R36 + R38 + `FAIL R43 1-2@90: this shipped flagpost has no pinned hazard in RESPAWN_HAZARDS … it measures pit 100-102 (27/180, 153 deaths)` — 38/41 |
| 1-2 post → col 105 (documented case) | R38 `…consulted 0 time(s)…` + the ORIGINAL survival FAIL text, unchanged: `FAIL R43 1-2: the flag at col 105 respawns the hero with NO route across the pit 120-125 ahead of it (0 of 180 …; 180 fell in, 0 stopped short) …` — 39/41 |
| 1-2 post → col 117 (the old "still PASSES" case) | `FAIL R43 1-2@117 … no pinned hazard … it measures pit 120-125 (15/180, 165 deaths)` + R38 — 39/41. The **measurement** (15/180) is unchanged; only the green is gone, by design. Pass 2's "col 117 still PASSES, as it should" is annotated as superseded in `docs/REVIEW-2026-11-15.md` |
| 1-2 posts at 112 AND 113 (is `hits === 2` reachable?) | `FAIL R38 1-2: the two flags are 1 columns apart, expected roughly two screens (24..48)` — the hits loop is never reached; `R43` fails separately on unpinned `1-2@113` |
| reviewer option (a) done literally: 1-2's `=` platform row 9 → row 8, cols 120-125 | **negative control on the pins**: 39/41, red in `SMOKE` (`5-tile rise at col 120 (row 13 -> 8) exceeds the 4-tile threshold`) and `R33` (`rise at cols 119-120 (5 tiles): margin 3.8px < 8px`), while **every `R43` pin stayed green and its 1-2@112 margin moved 21/180 → 13/180 (f24-36)** — the documented blind spot: pins pin identity, not counts |

## No-regression sweep (the six known-bad mutations, re-run against the current harness)

| mutation | still FAILs |
|---|---|
| old camera ratchet body restored | `R20 cam.x only moved back 0.00px from 1664.00 over 120 steps walking left — the camera must follow the hero left, not ratchet` + `R36 the camera scrolled to 536.90, left of the checkpoint floor at 544` + `R40 the camera floor moved under a flag that was never banked (cam.x=589.85)` — 38/41 |
| player `minX` clamp deleted | `R36 the hero walked to x=229.17, past the checkpoint at 640 …` — 40/41 |
| camera floor `lo = 0` | `R20 cam.x fell to 637.17, below the checkpoint floor at 640` + `R36 the camera scrolled to 536.90, left of the checkpoint floor at 544` — 39/41 |
| respawn → plain `loadLevel` (whole body replaced) | `R37 the hero respawned at x=34.0 — that is the level start, not the checkpoint at 880` + R41 + R42 — 38/41 |
| forward-crossing guard deleted | `R40 the hero walked LEFT through an unbanked flag and armed it (checkpointIndex=0, hero at x=640.0) …: expected -1, got 0` — 40/41 |
| solid `X` at 1-2 (110,9) | `R38 1-2: the flag at col 112 has X in the walk-up column 110,9` — 40/41 |

Unmutated control copy with the current harness: `41/41 pass, 0 fail`, exit 0. `node --check` clean on
all 13 files (12 `src/*.js` + `tools/verify.mjs`), negative-controlled against a deliberately broken
file so the check is known to be real.

## Docs touched this pass (all annotations, no history rewritten)

`docs/REVIEW-2026-11-15.md`: the THIRD OPEN ITEM got an annotation confirming its hazard and numbers
still stand (pit 120-125, 21/180 from col 112, 15/180 from 117, 0/180 from 105) and adding the
`1-2@77`-is-not-a-margin correction; `:1141`'s **+93** drift note annotated with the current **+104**
(re-measured `git diff --numstat HEAD -- src/main.js` = +109/−5); `:1137`'s `enemy.js:17,62,90`
annotated to `:17,63,92`; the SECOND FIX PASS line's old `R43` output format, its "popup-only" proof
and its "col 117 still PASSES" claim each annotated as superseded with the re-measurement beside them.
`architecture.md:153` now describes what `R43` prints and pins. `README.md` and
`VEGGIE_BROS_PLAN.md` needed no change (neither quotes an `R43` number).

## Deliberately NOT done (pass 3)

- No change to the `<= VIEW_W` near-pit cutoff (would assert a false failure — see H2), and no change
  to any tile, flagpost column, pit, platform, pipe or block: terrain stays out of scope, so the
  inventory pin is the *only* thing that makes terrain edits visible to this suite.
- No id added or reused; `R34`/`R35`/`R39` stay unregistered; no change to `makeCamera()`'s shape, the
  `minX`-as-parameter design, `CULL_BEHIND` logic, the timer/loop, or the `G` export.
- `R33`'s PASS line left byte-identical (its numbers are derived, not asserted; the pin lives in
  `R43` by choice, not oversight).
- The three NO-DEATH-ROUTE margins were NOT re-derived with a longer horizon or a multi-jump protocol:
  that would make them comparable to each other and invite exactly the quoting error this pass exists
  to stop. They are progress indicators; the honest fix was labelling, not tuning.
- `src/` untouched, so the two pre-existing doc-drift items in "Known-unfixed" above (`architecture.md:141`'s
  font citation, `src/main.js:540` → `architecture.md:41`) are still open and still unaddressed.

---

# FIX PASS 4 — 2026-11-16 (B-1/B-2/B-3, F-2…F-6: the camera fix had no test with teeth)

Suite handed to this pass: **40/41 pass, 1 fail, exit 1** —
`FAIL R36 shoved camera (forced to 0): the camera came to rest at 543.999966, left of its own
checkpoint floor at 544`. Suite handed back: **42/42 pass, 0 fail, exit 0**, byte-identical across
three consecutive full runs (`md5` equal) and order-independent in every subset tried (`R44`;
`R36 R44`; `R20 R36 R44`; `R44 R37 R43`; `R44 R40 R41 R42`; `R33 R36 R44 R20`; `R44 R44`).
`grep -c "^check(" tools/verify.mjs` → **42**, no duplicates; `R34`/`R35`/`R39` still unregistered.
`node --check` clean on `tools/verify.mjs` and `src/camera.js`.

## Goal

Repair the harness and docs around the camera smoothness fix, which an independent audit confirmed to
be **correct and not the problem**: `src/camera.js` was not touched behaviourally by this pass (two
comment corrections only). The test work around it was broken (two blockers made the suite red and one
of them masked the other), incomplete (`R44` cited four times, never registered), and in one place
built on a false premise.

## The invariant inversion, restated for the record

**Passes 1–3 pinned the checkpoint floor as a WALL and asserted it as such**: `assert(minCam >= FLOOR)`
across a window, plus a clause requiring the floor to be recovered "within the frame".
**This pass (and the code it tests) pins it as a TARGET BOUND the camera is carried up to**: the bounds
are applied to `target = clamp(p.x − CAMERA_FOLLOW_X, floor, levelW − VIEW_W)` **before** the follow
lerp and never to `cam.x` after it.

The guarantee is **not weakened**, and it is important that the record says why rather than leaving the
change looking like a loosened threshold:

- The deleted assert was never observable by the player. The hero is clamped to the same floor by
  `player.js`, so the only way `cam.x` can be under the floor is the follow lag it is already carrying,
  and the only thing the wall bought was a one-frame 9–16 px teleport of the whole viewport — the jerk
  the user reported. Everything the wall guaranteed about the hero (`minX >= cp.x`, `p.x === cp.x`,
  screen x ≥ 60, fully inside the view) is still asserted, unchanged, in `R36` clauses 1/2/4.
- What replaced the minimum is **four** claims where the wall had one, three of them about the SHAPE of
  the recovery (`R36`: bounded excursion ≤ the lag, monotone approach, never back below the floor after
  arriving, rest EXACTLY on it — `eq(cam.x, FLOOR)`, not a tolerance), plus a **per-frame delta** bound
  (`R44`) that the wall cannot satisfy. A hard clamp satisfies every minimum trivially and the delta
  bound not at all, which is exactly why the delta bound is the one that had to be added.
- Both floor safety clamps that are NOT about lag are untouched: a camera shoved outside `[0, max]` or
  poisoned with NaN is still assigned back inside the range outright, and `R36` clause 3 still proves
  the convey-to-floor on that state.

## What was actually broken (all three measured, not inferred)

| id | defect | fix |
|---|---|---|
| **B-1** | `assertFloorConvergence` compared `i >= CAM_SETTLE_FRAMES` (module constant, 90) instead of its own `settleFrames` parameter, so `R36` clause 3's caller-side window was ignored and the 544 px forced-0 trace was judged at frame 90 against a 1e-6 tolerance — it is 3.4e-5 px short there and needs ~111 frames. That is the suite-red line. | `if (i >= settleFrames)`. The call site's `150` literal also became `CAM_SETTLE_FRAMES` (see F-4: the constant itself moved to 150, so the two can no longer disagree). |
| **B-2** | `R36`'s return string referenced `minCam`, a variable the smooth-floor rewrite deleted → `ReferenceError: minCam is not defined` on every green run of that check. Invisible only because B-1 threw first. | Removed; the return now publishes measured values instead (`conv.maxUnder`, `conv.reached`, `deepestSeed`, `worstLerp`). |
| **B-3** | Clause 4's `maxUnder <= LAG_RUN` budget was applied to traces seeded by the harness's own run-up **teleport** (`p.x = up`, 32–200 px, camera unmoved) AND premised on the post arming at `p.x === post.x`. Measured deepest dips: 14.445 (1-1 f0) / **20.366** (1-1 f1) / **19.007** (1-2 f0) / **87.506** (1-2 f1) / **37.024** (1-3 f0) / 13.835 (1-3 f1) against a 15.833 budget → four false failures, every one of them the seed frame, with the following frames only ever shallower (87.506 → 52.959 → 24.243 → 0.425 on 1-2 f1). | Budget each trace by its own measured seed: `Math.max(LAG_RUN, floorX - trace[0])`. Chose over deleting the teleport — see the reasoning and the refuted counter-argument in the comment at the call site. Frame 0 was deliberately NOT carved out of the max. |

## The new `R44` — registered exactly once, no ids reused

A hero running into a **live, unbanked** flagpost at `WALK_MAX` and at `RUN_MAX` in the real fixed-step
loop, tracing `{cam, hero x, floor handed to updateCamera}` per frame, then run back into the bound.
Clauses: the bank window's per-frame step against the largest step elsewhere in the run (spike
detection, `SPIKE = 2`); every frame of all four traces against the follow's own step
(`assertFollowStep`, `STEP_FACTOR = 2`, `FOLLOW_RATE` and `STEP_TOL = 1e-4`); the excursion bounded by
`lag + boxDeficit` (both measured); hero on screen on every frame; monotone approach and
`eq(cam.x, FLOOR)` at rest. `R34`/`R35`/`R39` remain unregistered.

**The finding that made `R44` necessary and nearly made it useless**: the pop does **not** land on the
frame the flag banks. `main.js` reads `checkpointBounds()` at the TOP of `updateState`, before
`updatePlayer` can arm anything, so the arming frame still runs on the previous frame's floor — measured
identical traces for clean and wall-mutated `camera.js` on every frame up to and including the bank
(3.167 px steps), and the wall's assignment appearing on the frame **after** it (cam 528.556 → 544.000).
A check that stops at the crossing frame — the first version of `R44` did — passes on the bug. The trace
now runs 30 frames past the bank (`AFTER`) and the window is asserted, not the frame.

**Where the teeth went** (this is the structural point of the pass): `assertFollowStep` is shared by
`R44` (live crossings, both speeds, plus the run-back), by `R36` clause 2b (a REAL play-seeded
under-floor camera, new: the hero leaves the flag and turns back so the camera parks one run lag under
the floor, which is how play reaches that state), by `R36` clause 4 (every shipped-map frame), and by
`R36` clause 3's shove. `R36`'s new clause 2b is placed BEFORE the synthetic shove, so a hard clamp now
goes red on real gameplay first instead of only on the state its own comment calls "not gameplay".

## Live numbers (current format — this is the line to quote)

```
PASS R36 flag armed by walking (x=640); hero pinned at 640 with screen x >= 93, camera floored at 544
and carried onto it from 8.99px of lag (crosses back over its own floor on frame 6, exact by the settle
window) (deepest shipped seed 87.51px); same on all 6 shipped flags (1-1@880 1-1@1456 1-2@1232
1-2@1792 1-3@672 1-3@1216), every frame within 2x the follow's own step (largest shipped step
39.47px), worst screen x 80
PASS R44 WALK_MAX: bank frame 336 steps 1.833px and the 30-frame window after it peaks at 1.833px
(frame 336) against 1.833px everywhere else, lag 9.17, deepest 8.28px under; 367+241 frames all within
2x the follow's own step (largest 1.83px / 1.83px back); rests exactly on 544 | RUN_MAX: bank frame 199
steps 3.167px and the 30-frame window after it peaks at 3.167px (frame 200) against 3.167px everywhere
else, lag 15.83, deepest 15.44px under; 230+241 frames all within 2x the follow's own step (largest
3.17px / 3.17px back); rests exactly on 544
```

Constants published and re-measured this pass: `FOLLOW_RATE` = 0.16666666666666666 (exactly 1/6; read
off `updateCamera`, not from `CAMERA_LERP`, so it cannot go stale) · follow lag **9.167** walking /
**15.833** running = `v·dt·(1−r)/r` = **v/12**, not v/10 · frames from depth d to `CAM_REST_EPS` =
`log(1e-6/d)/log(5/6)`, verified against the shipped `updateCamera`: 88 (9.167 px) / 91 (15.833) / 93
(20.366) / 101 (87.506) / 111 (544) → **`CAM_SETTLE_FRAMES` 90 → 150** (91 is the worst gameplay figure;
90 had *negative* margin against it, and the 56 that the old comment published was never a measurement)
· `STEP_FACTOR = 2`, `SPIKE = 2`, `STEP_TOL = 1e-4`, `AFTER = 30`.

## Discrimination proofs (six throwaway copies under the session temp; the repo tree was never mutated)

| mutation | observed result |
|---|---|
| **unmodified tree** | `42/42 pass, 0 fail`, exit **0**. Bank window peaks at the hero's own per-frame advance (ratio **1.00**), `assertFollowStep` overshoot **0.000 px** over all 1079 traced frames. |
| `if (cam.x < lo) cam.x = lo;` re-added after the lerp (the pre-fix behaviour) | **40/42, exit 1.** `FAIL R44 WALK_MAX: in the 31-frame window that starts on the frame the flag at x=640 banked (frame 336), the camera stepped 8.278px in one frame (frame 337, from cam 535.722 to 544.000 with its floor at 544) while the largest step anywhere else in the run was 1.833px — a checkpoint banking under a running hero teleported the camera its whole 9.17px follow lag in 1 frame(s) after the crossing, which is the jerk the smooth floor replaced (the hero's screen x on that frame: 98.7 of 256)` + `FAIL R36 flagLevel turn-around at RUN_MAX (camera seeded one run lag under the floor, by play): at frame 1 the camera moved 15.833px in one frame when its target at 544.00 (hero x 640.00, floor 544) could produce at most 5.278px — 6.0 frames of follow compressed into one, which is a camera cut, not a follow` |
| same, **RUN_MAX leg only** (WALK leg removed) | 40/42, exit 1. `FAIL R44 RUN_MAX: … the camera stepped 15.444px in one frame (frame 200, from cam 528.556 to 544.000 …) while the largest step anywhere else in the run was 3.167px …` — so both speeds discriminate, not just the first one the loop reaches. |
| same, **spike-ratio assert switched off** (only the follow-step bound left in `R44`) | **still 40/42, exit 1.** `FAIL R44 WALK_MAX live bank at x=640: at frame 337 the camera moved 8.278px in one frame when its target at 546.72 (hero x 642.72, floor 544) could produce at most 3.667px — 4.5 frames of follow compressed into one, which is a camera cut, not a follow` — the result does not rest on one tuned ratio. |
| same, **all of `R36`'s other camera-cut legs off** (2b + clause 3 + clause 3's step bound) | 40/42, exit 1: `FAIL R36 1-2 flag 0 camera follow step: at frame 1 the camera moved 19.007px in one frame when its target at 1167.78 (hero x 1263.78, floor 1136) could produce at most 16.928px` — clause 4's shipped-map leg has teeth of its own (1.12x over on that flag; 1-1's two posts are shallower seeds and pass, so it is the last line of defence, not the first). |
| `CAM_EPS = 40` (a 40 px snap radius; strictly worse than the bug fixed — it deletes the follow lag outright) | **40/42, exit 1.** `FAIL R44 WALK_MAX live bank at x=640: at frame 39 the camera moved 0.389px in one frame when its target at 0.39 (hero x 96.39, floor 0) could produce at most 0.130px — 6.0 frames of follow compressed into one, which is a camera cut, not a follow` + `FAIL R36 1-1 flag 0 camera follow step: at frame 1 the camera moved 38.389px … could produce at most 12.796px`. Stated honestly: inside `R44`'s own trace the violation `R44` sees first is small in absolute px (0.389) and is caught by the RELATIVE bound; the large 38.4 px pop is the one `R36`'s shipped-map leg reports. |

## No-regression sweep (the camera-relevant known-bad mutations, re-run against the current harness)

| mutation | still FAILs |
|---|---|
| old camera ratchet body restored (`528e916`) | `R20 cam.x only moved back 0.00px from 1664.00 …` + `R36 the camera settles on its checkpoint floor: expected 544 +-0.000001, got 548.561967117037` + `R40 the camera floor moved under a flag that was never banked (cam.x=589.85)` + **new** `R44 WALK_MAX: the camera does not come to rest EXACTLY on its floor — the follow must collapse the last sub-representable sliver (CAM_EPS) …` — 38/42 |
| player `minX` clamp deleted | `R36 the hero walked to x=229.17, past the checkpoint at 640 …` + **new** `R44 WALK_MAX: the run back put the hero at x=478.67, through the checkpoint at 640` — 40/42 |
| camera floor `lo = 0` | `R20 cam.x fell to 637.17, below the checkpoint floor at 640` — **41/42, `R20` alone** (see "coverage that moved" below) |
| `respawnAtCheckpoint` → plain `loadLevel` | `R37 the hero respawned at x=34.0 — that is the level start, not the checkpoint at 880` + R41 + R42 — 39/42 |

Unmutated control copy: `42/42 pass, 0 fail`, exit 0.

## Coverage that moved, and coverage that was LOST (flagged, not silently accepted)

- **`lo = 0` (the camera floor deleted outright) is now caught by `R20` alone.** Under passes 1–3 it
  also tripped `R36` (`the camera scrolled to 536.90, left of the checkpoint floor at 544`) — that was
  the `minCam >= FLOOR` assert, which the inversion deleted. It is not recoverable as a floor assert:
  with `player.js` clamping the hero to `checkpointX`, `target = p.x − 96 ≥ floor` on every frame but
  the arming one, so a floor-less camera differs from a floored one by at most the lag, and at rest it
  is **byte-identical** (a pinned hero at `cp.x` gives `target === FLOOR` exactly). Both `R36`'s and
  `R44`'s rest-state asserts (`cam.x === 544`) therefore pass under `lo = 0`. `R20` covers it at unit
  level (it calls `updateCamera` with the hero deliberately BELOW the floor, the only place the
  parameter can bind), and the operative left authority in play — `player.js`'s clamp — is asserted
  directly by `R36` clauses 2 and 4. Left as-is: an assert that could catch it would have to assert the
  lag-free camera, which is the opposite of the contract.
- The 4 shipped-map false failures (B-3) are gone without touching the number `LAG_RUN`; `R36` clause 4
  now asserts 241 frames × 6 flags of per-frame step as well, which it did not before.
- `R36` clause 3 keeps its shove case and its step bound, now with a derived ceiling
  (`FLOOR · FOLLOW_RATE · STEP_FACTOR` = 181.3 px, measured max step 75.6) instead of `FLOOR / 2` = 272 px.

## Docs touched this pass (no history rewritten)

`architecture.md:141` and the **Camera follows both ways** bullet: both said the camera "is clamped to
`[floor, levelW − VIEW_W]`", which is a description of the deleted wall — restated as the
target-clamped, smoothly-converged floor contract, with the lag figures. `architecture.md:3`'s drift
paragraph: `camera.js` (21 → 29 lines) → (21 → 29 → **68**), and the stale `camera.js:22-29` cite
re-derived to `:31-41,53-68` (`:13-29` in `:141` likewise); every camera citation in that file was
re-derived against the live file (`makeCamera` `:5-7` and `main.js:299` re-checked, still correct).
`src/camera.js`: the lag comment's "11 px walking, 19 px running" corrected to the measured 9.17/15.83
(v/12, matching `verify.mjs`), and the safety-clamp comment's NaN overclaim corrected — the recovery is
only for a NaN that arrives in `cam.x`; a NaN `minX` makes `lo` NaN, silently drops the floor and
re-poisons the camera permanently. **Behaviour unchanged**, because it is unreachable from `main.js`
(`checkpointBounds()` is NaN only if `G.checkpointX` is) and the guard would have to invent a floor;
the guarantee the function actually makes is now stated as about a finite `[minX, levelW]` pair.
`tools/verify.mjs`: the contract block's pointer now names `camera.js:31-41` and the `architecture.md`
bullet by name; the duplicated separator and the stray 16-space indent removed; `R36`/`R44`'s proof
blocks rewritten with the quotes above.

## Where this pass disagrees with the punch list (all measured)

1. **"the audit measured 87 (walk seed) / 90 (run seed) frames to reach `CAM_REST_EPS`"** — re-measured
   against the shipped `updateCamera`: **88 / 91**, and the closed form agrees exactly. This matters: it
   makes the old `CAM_SETTLE_FRAMES = 90` *negative*-margin, not merely tight, and it is why the constant
   went to 150 rather than 91+ε.
2. **"re-introducing the old post-lerp hard clamp currently fails ONLY that synthetic clause"** — true
   of the tree this pass inherited (reproduced: 41/42, one red line, clause 3) and the reason `R44` was
   worth registering, but the reason is subtler than "no per-frame assert existed": the pop also does not
   occur on the crossing frame (above). Any future "tighten the crossing frame" work will find nothing.
3. **"measured dips, ALL at frame 0"** — the *deepest* dip is the seed frame on all six shipped flags;
   frames 1–3 still dip (1-2 f1: 87.506 → 52.959 → 24.243 → 0.425). Consequence: a "skip frame 0"
   carve-out would not have been equivalent to measuring the seed, and `maxUnder == under[0]` is forced
   by the monotone-approach claim anyway, so the seed budget's real content is `LAG_RUN` as its floor.
4. **"stop teleporting the hero mid-trace" (the alternative the punch list offered)** — I kept the
   teleport and measured the reason usually given for dropping it, and it is false: with 1-2's post moved
   onto the pipe at col 108 the `nowhere to walk right after banking` assert fires in BOTH variants
   (`walkableFar` reads the pipe, not the hero, so `up === null` either way). The teleport is kept for a
   different reason (every flag gets an identical full-speed retreat; the shipped run-ups are 32–200 px,
   too short to run at `RUN_MAX` from a standing start), and it is recorded in the comment as such.
5. **`CAM_EPS = 40`'s "visible one-frame pop" inside `R44`'s own trace** — the first violation `R44`
   reports is 0.389 px, caught by the relative bound, not by an absolute visibility threshold. The
   mutation is genuinely caught (and the 38.4 px pop is caught by `R36` clause 4), but I did not want the
   proof table to imply `R44` had measured a 40 px jump.

## Deliberately NOT done (pass 4)

- **No behavioural change to `src/camera.js`.** The smoothing approach, the lerp, the eps collapse, the
  guard order and the `minX`-as-parameter design are untouched; two comment blocks corrected only. The
  NaN-`minX` hardening the corrected comment describes was NOT added (unreachable; inventing a floor is
  a worse failure), and no new export was introduced (`CAMERA_LERP` stays private — `FOLLOW_RATE` is
  measured off `updateCamera` instead, so it cannot drift from the constant).
- No threshold was tuned to make a proof pass. `STEP_FACTOR`/`SPIKE`/`STEP_TOL` were set BEFORE the
  mutations were run, from the closed form (`1/FOLLOW_RATE = 6` frames is a full snap; 2 keeps a 3x
  margin), and both mutation directions (spike assert off, R36 legs off) are reported.
- `main.js:100`/`:182`, `makeCamera()`'s `{ x: 0 }`, `CAMERA_FOLLOW_X`'s export, `render.js:289`'s
  `Math.floor(cam.x)`, and all checkpoint FLAG ART / feedback code (`sprites.js drawCheckpoint`, **[SUPERSEDED by FIX PASS 5: that is exactly the code pass 5 deleted, on a new explicit user decision. Pass 4 was right that it was out of scope FOR PASS 4.]**
  `render.js:295-298`, `main.js:484-488`) untouched — that queue item's ground did not move.
- No terrain, tile, flagpost column, pit or pipe edited. No id reused; `R34`/`R35`/`R39` stay
  unregistered.
- Not touched: the two pre-existing doc-drift items still open from pass 3 (`architecture.md:141`'s font
  citation, `src/main.js:540` → `architecture.md:41`), the `Q` double-award candidate (`R39`), and the
  `R20`-only coverage of `lo = 0` argued above — reported rather than fixed, because the assert it would
  need contradicts the contract this pass documents.

---

# FIX PASS 5 — 2026-11-16 (invisible checkpoints: the flag art AND the arrival feedback come out, every line of checkpoint logic stays)

Suite handed to this pass: **42/42 pass, 0 fail, exit 0** (the reviewer-approved camera work, committed
first as **`44ac4bf`** — see STEP 0 below — on top of `c58ea65`). Suite handed back: **43/43 pass, 0
fail, exit 0** (new id **`R45`**, exactly one; `grep -c "^check(" tools/verify.mjs` → **43**, no
duplicates; `R34`/`R35`/`R39` still unregistered). `node --check` clean on all 12 `src/*.js` plus
`tools/verify.mjs`.

**STEP 0, done first:** the tree arrived with 4 modified files (`src/camera.js`, `tools/verify.mjs`,
`architecture.md`, `WORKFLOW_STATE.md`) that were a reviewer-APPROVED camera change sitting uncommitted.
Committed as its own commit — `44ac4bf camera: smooth the checkpoint floor instead of hard-clamping
cam.x` — before a single line of this pass was written, then verified green (`42/42`, exit 0) from a
clean `git archive` of that commit. This pass's code+harness commit is **`dfaf107`**; this docs commit
follows it. No amend, no rebase, no push.

## Goal

The user wants checkpoints that leave **nothing on screen**: no flag/banner sprite, and no arrival
announcement either — no `CHECKPOINT` popup, no banner re-raise, no `power` fanfare. The feature itself
must keep working exactly as it did: a checkpoint still arms on a left-to-right crossing, still clamps
the hero leftward, still floors the camera, and is still the respawn point. **Removing the art had to
not remove the feature** — and the `K` tiles are how checkpoints are authored, so they stay in all three
maps.

## The boundary: feedback out, logic in

**Removed (art and feedback only):**

- `src/sprites.js` — `drawCheckpoint(ctx, x, y, taken)` and its comment block deleted (17 lines). A
  3-line pointer comment records why nothing is there and names `R45` as the guard.
- `src/render.js` — the import entry, and the per-frame `for (const cp of level.checkpoints)
  drawCheckpoint(...)` loop with its comment; a comment states that `level.checkpoints` stays live
  gameplay state with no draw call. This was the **only** render path for a post: `parseLevel` converts
  the `K` tile to `'.'` (`level.js:105-110`), so no tile pass can paint one either.
- `src/main.js` — the trigger's whole feedback block (`audio.sfx('power')`, the `'CHECKPOINT'` popup,
  `G.bannerT = 1`) **and the `if (!p.dead)` guard that gated it**.

**Untouched, deliberately:** the `CHECKPOINT_TRIGGER_*` constants and the band they build, the crossing
test (`p.prevX <= cp.x && p.x > cp.x`), `cp.taken`/`G.checkpointIndex`/`G.checkpointX`/the re-mark loop,
the loop's position **above** the `if (p.dead) return;` short-circuit, `checkpointBounds()`,
`respawnAtCheckpoint()`, `player.js`'s `minX` clamp, every `K` in `src/levels.js`, `src/camera.js`.

**The guard deletion was read before it was made.** Every arming write sits *outside* `if (!p.dead)`, so
the guard could only ever gate noise, never the arming; removing it cannot move a bank off the death
frame. Re-measured after the deletion (mutation **M6**, arming skipped on the death frame): `R41` fails
**alone**, 42/43. So the death-frame bank is still pinned, by state.

**The two `respawnAtCheckpoint()` lines the brief asked to evaluate — both KEPT:**

- `p.invulnT = INVULN_TIME` — kept (default). The flagpost cell was never authored as safe ground, and
  `R42` measures the grace rather than assuming it (a turnip parked on the respawn cannot kill inside
  it, and does kill after it expires).
- `G.bannerT = 0` — **kept, and it is NOT dead weight**. The brief predicted the checkpoint-respawn half
  of `R42` "becomes trivially true once nothing sets `bannerT = 1`". It does not, for a reason unrelated
  to the trigger: `respawnAtCheckpoint()` calls `loadLevel()` **first**, and `loadLevel()` raises the
  WORLD banner to 1.5 (`main.js:101`), so this line is the only thing between a resume and a
  stage-intro card. Measured (mutation **M5**): `R42` fails alone, 42/43, with `bannerT=1.50`. Kept as a
  two-way guard (it also fails if anyone re-raises a banner on the respawn path), and `R42`'s comment now
  says what it actually proves rather than describing a re-raise that no longer exists.

**The level-intro banner** (`WORLD 1-1 — STRAWBERRY FIELDS`, `loadLevel`) is untouched: it is not
checkpoint feedback.

**The palette is untouched, with the grep behind it.** `used`/`usedDark` are the popped-block language
(`sprites.js` `drawBrick`), `pumpkin`/`pumpkinDark`/`pumpkinLit` are the block art, `stone`/`stoneDark`
are stone tiles *and* the gate's arch; `P.white` is eyes, HUD, popups and the gate's highlight. Every one
of them still has users after the deletion. `tools/verify.mjs` never enumerates palette entries — it
names only `PALETTE.black`/`.white`/`.stone`/`.turnipTip` — so nothing asserted palette contents, and
nothing was removed anyway.

## Files touched

`src/sprites.js` (art deleted) · `src/render.js` (import + draw loop deleted, comment added) ·
`src/main.js` (feedback block + guard deleted, comment added) · `src/config.js` (**comment only** — the
`CHECKPOINT_TRIGGER_*` block no longer claims the band "straddles the post `drawCheckpoint()` paints") ·
`tools/verify.mjs` (`R36`/`R38`/`R40`/`R41`/`R42` re-pointed, `R45` registered) · `README.md` ·
`architecture.md` · `WORKFLOW_STATE.md`.

## Every harness clause the greps turned up (`'power'` · `CHECKPOINT` · `popup` · `bannerT` · `drawCheckpoint` · `checkpoints`)

| hit | disposition |
|---|---|
| `const { … drawCheckpoint … } = spritesModule` (import) | entry removed; without it `R38` **threw** `fn is not a function` the moment the sprite went. Added `const { render: renderScene }` for `R45` |
| `R38` art clauses: `drawInto(drawCheckpoint, 0, 192, false/true)`, "inked nothing", "banked art differs", art rows inside 128..207, art x-extent ≤ `CHECKPOINT_TRIGGER_W` | **deleted** (art only). **Every map-data clause kept**: 2 flags/level, sorted by x, before the exit, marker tile cleared to `.`, solid ground under post ±2, the full 4-row × ±2-column clearance band, `CLEARANCE_EXCEPTIONS` + its "consulted exactly once" audit, and the 24–48 column gap rule. The band is now justified by the TRIGGER constants and pinned to them by three new `eq`s (`CHECKPOINT_TRIGGER_TOP/TOP/W` → 4 tiles / standing surface / 2 tiles), replacing the coupling the art used to provide. Header rewritten with a `[SUPERSEDED]` block |
| `R36` clause 1: `bannerT > 0`, `sfx('power') > 0`, and "exactly 1 `CHECKPOINT` popup at `cp.x`, `cp.y − TILE`" | replaced by **state**: `G.checkpointIndex === 0`, `G.checkpointX === cp.x`, `cp.taken`, `armed.x > cp.x` (crossing, not overlap), **plus a new clause 1b** that holds the two derived floors on that state (`p.x === cp.x`, `cam.x === FLOOR`). 1b runs its own `installLevel` + the identical crossing and re-crosses at the end, so clauses 2/2b/3/3b start from exactly the state they were written against — verified, not assumed: `R36`'s PASS line is byte-identical to the pre-pass line (below) |
| `R40` clause 2: `sfx('power') > 0` | replaced by state: slot armed, `checkpointX`, `cp.taken`, hero pinned on the post after a 120-frame run-back, camera within `CAM_REST_EPS` of `cp.x − CAMERA_FOLLOW_X` |
| `R41` silence clauses: `eq(sfx('power'), 0)` and `eq(ghosts.length, 0)` on the death frame | **deleted, not left behind** — with no producer on any frame they were unfailable, which is the vacuity this file refuses (its own header had already caught this trap once). Replaced by state the bank has to buy: hero on the post, `checkpointIndex`/`checkpointX` surviving the rebuild, the rebuilt level marking that post `taken`, and `cam.x` on the post's floor. Core ordering proof unchanged and re-measured |
| `R42` `eq(G.bannerT, 0)` on the checkpoint respawn (+ the 1.5 baselines) | **kept as a regression guard**, with the comment corrected to name what it pins (`G.bannerT = 0` in `respawnAtCheckpoint`, against `loadLevel`'s 1.5) and the FAIL wording re-measured |
| `R18` / `R25` popup clauses (`'+100'`, the `+1000` gate popup) | **not checkpoint code — untouched** |
| `R37`'s `checkpoints[j].taken` loop, `installLevel`'s per-level checkpoint reset, `R43`'s `level.checkpoints` walk, `R44` | untouched (already state-based); all still green |
| historical `[CORRECTED …]` paragraphs in `R36`/`R41` quoting the popup-producer FAIL and the fanfare FAIL | kept verbatim inside new `[SUPERSEDED …]` blocks, with the claim marked dead and the measurement kept |

## Discrimination proofs (each in its own throwaway copy under the session temp; the repo tree was never mutated)

Control **M0**, an unmodified copy of the working tree: `43/43 pass, 0 fail`, exit 0.

| mutation (throwaway copy) | observed result |
|---|---|
| **M1** `drawCheckpoint` + its import + the deleted render loop restored (the removal reversed) | **42/43, exit 1 — `R45` alone:** `FAIL R45 a checkpoint changed the frame: fillRect #495: with checkpoints [127,128,2,80,"#e8e0c0",null,495], without them [1880,128,2,80,"#e8e0c0",null,495] — nothing may be drawn at a post (1455 fillRect calls with the level's 2 posts, 1425 with none)` |
| **M2a** the whole feedback block re-added to the trigger | **42/43 — `R45` alone:** `FAIL R45 the arrival pushed 1 item(s) into G.items — a checkpoint pushes nothing at all now. …: expected 0, got 1` |
| **M2b** popup line only | **42/43 — `R45` alone**, same items line (the items assert fires first; the popup-count and `banner`/`power` asserts sit behind it as separate legs) |
| **M2c** `audio.sfx('power')` only | **42/43 — `R45` alone:** `FAIL R45 the arrival made 1 audio.sfx('power') call(s). That sound is not dead code — main.js still plays it for berries and berry blocks — but a checkpoint may not use it: expected 0, got 1` |
| **M2d** `G.bannerT = 1` only | **42/43 — `R45` alone:** `FAIL R45 the crossing raised the banner: it peaked at 0.9833 against 0.7500 when the run started, and updateState only ever subtracts 0.0167 from it per frame, so a rise is a re-raise — checkpoints do not get banners` |
| **M3a** silent **and** not arming (all arming writes deleted) | **36/43:** `R45` `FAIL … the hero at RUN_MAX never crossed the post at x=640 (checkpointIndex=-1 after 400 frames) — the scenario never performed the arrival it is here to measure`, plus `R36`/`R37`/`R40`/`R41`/`R42`/`R44` |
| **M3b** arms the slot, never raises the bound | **36/43:** `R45` `FAIL … the silent crossing did not raise the left bound to the post it crossed (checkpointX=0, post 640): expected 640, got 0`, plus `R36`/`R37`/`R40`/`R41`/`R42`/`R44` |
| **M4** `cp.taken = true;` deleted | **43/43 pass** — see "equivalent mutants" below |
| **M9** the re-mark loop deleted, direct write kept | **43/43 pass** — same |
| **M9b** BOTH marking writes deleted | **39/43:** `R36` `the flag reports itself banked once crossed: expected true, got false`, and the same claim red in `R40`/`R41`/`R45` |
| **M5** `G.bannerT = 0;` dropped from `respawnAtCheckpoint` | **42/43 — `R42` alone:** `FAIL R42 a checkpoint respawn shows the 1-1 stage-intro banner (bannerT=1.50) — loadLevel() raised it inside the respawn and respawnAtCheckpoint() must take it back: on a resume the player did not ask for, that reads as "level restarted": expected 0, got 1.5` |
| **M6** arming skipped when the crossing frame is the death frame | **42/43 — `R41` alone:** `FAIL R41 a fatal hit inside the band of an unbanked flag skipped the checkpoint (crossed to x=882.17, checkpointIndex=-1) — the trigger loop must run before the dead-return short-circuit` |
| **M7** solid planted at 1-2 (110,9), inside a post's clearance band | **42/43 — `R38` alone:** `FAIL R38 1-2: the flag at col 112 has X in the walk-up column 110,9` (the surviving map clauses still have teeth after the art clause went) |
| **M8** ground dug out under 1-2 col 112 | **38/43:** loader-first `…'K' at 12,112 has no solid tile below` in `R30`/`R36`/`R38`, plus `R29`/`R43` |

**Two equivalent mutants, recorded so nobody writes a test chasing them.** `cp.taken = true;` and the
re-mark loop (`for (const other of …) if (other.x <= G.checkpointX) other.taken = true;`) each mark the
crossed post on their own, so **deleting either one alone is behaviour-preserving and measures 43/43**
(M4, M9). Only deleting **both** is observable, and then exactly the four state clauses light up (M9b).
`R36`'s comment says this in place, because "delete any writer in the arming block and this goes red" is
a claim that would have been false.

## Coverage deliberately lost (and what, if anything, replaces it)

| lost | replaced by |
|---|---|
| the post art exists and inks (`drawCheckpoint inked nothing`) | **nothing, on purpose** — there is no art. `R45` clause 1 asserts the opposite (identical draw streams with the posts present, emptied and banked), which is the user's actual requirement and can still go red (M1) |
| banked art differs from live art (`taken` was a colour change) | `R45` clause 1's third render: with every post `taken`, the frame must still be **identical**, i.e. `taken` is not readable on screen in any form. State-wise `taken` is pinned by `R36`/`R40`/`R41`/`R45`/`R37` |
| art rows sit inside the trigger band 128..207; art x-extent ≤ `CHECKPOINT_TRIGGER_W` | `R38` now pins the band to `CHECKPOINT_TRIGGER_TOP/BOTTOM/W` directly (3 `eq`s + the non-degenerate-box assert). The coupling the art provided for free is now an assertion instead of a coincidence |
| "arming a flag makes a sound / a banner / exactly one popup" (`R36` clause 1) | state (slot, bound, `taken`, both floors) + `R45` clause 2's silence, which is the direction that is now a requirement |
| "the death frame is silent" (`R41`'s two absence asserts) | deleted rather than kept vacuous; `R45` asserts silence where a regression can still trip it (live crossing, real loop, live banner baseline) |
| `R38`'s art clause as the check that catches a checkpoint **rendering** regression | `R45` clause 1 is strictly stronger: whole-scene draw-stream diff vs the same level with `level.checkpoints = []`, at a camera position with the post on screen |

**Nothing else changed in the suite.** Full output diff vs the pre-pass `42/42` baseline (`git archive`
of `44ac4bf`) touches exactly four lines: `R38` and `R41` (their pass text, by design), `R45` (new), and
**`R19`** — see the disclosure below. `R36`'s, `R37`'s, `R40`'s, `R42`'s, `R43`'s, `R44`'s and every
camera/pixel check's line is byte-identical, which is the evidence that re-pointing five clauses did not
quietly move a threshold: `R36` still prints `8.99px of lag … crosses back over its own floor on frame
6 … deepest shipped seed 87.51px … largest shipped step 39.47px … worst screen x 80`, and `R44` still
prints `bank frame 336 steps 1.833px … 15.44px under … rests exactly on 544`.

## Pixel asserts that WERE counting flagpost pixels (disclosed, not rebaselined)

**`R19`** (the `LEVEL_CLEAR` flash must be drawn **before** the overlay text) compares **draw sequence
numbers** from the shared frame recorder, and every shipped level's two posts were part of that
sequence. Deleting them shifted both numbers by exactly the 30 removed `fillRect`s: `draw #1183 vs
#1184` → `draw #1153 vs #1154`. **No threshold changed and no baseline was edited** — the clause is a
relative comparison (`flash[6] > firstText`), so it keeps proving the same ordering; but its printed
figures are not comparable to the ones quoted in earlier passes, and the brief asked for that to be said
out loud rather than absorbed. No check asserts an absolute rect/pixel count, so nothing else was
affected: `SMOKE`/`R04`/`R18`/`R23`/`R24`/`R30`/`R33` came back byte-identical, and no pixel assert had
to be rebaselined.

## Order-independence and byte-stability

Full run md5 **identical across three consecutive runs** (`29facdb9f516030c782681717e9f5ac1`). The whole
registry run **backwards** (`R45 R44 R43 … R01 SMOKE`) is `43/43` and its output is identical to the
forward run once sorted (`diff` empty). Subsets, all green: `R45 R44 R43 R42 R41 R40 R38 R37 R36 R33
R30 R24 R23 R18 R04 SMOKE` 16/16 · `R36 R45` 2/2 · `R45 R36` 2/2 · `R38 R45 R43` 3/3 · `R41 R42 R45`
3/3 · `SMOKE R45 R01 R44 R20` 5/5 · `R45 R45` 1/1 (a check run twice must be idempotent — `R45` mutates
`level.checkpoints` and restores it). Each of `R36`/`R37`/`R38`/`R40`/`R41`/`R42`/`R44`/`R45` alone:
1/1.

## Where this pass disagrees with the brief (all measured)

1. **`R42`'s checkpoint-respawn `bannerT === 0` is not "trivially true"**. `loadLevel()` inside the
   respawn raises 1.5 and `G.bannerT = 0` is the only suppression, so the clause still has a mutation to
   catch — M5, `R42` alone, 42/43. It was therefore kept as the brief preferred, but for a different
   stated reason, and the comment now names that reason.
2. **`R40`/`R41` never used `sfx('power')` as evidence that arming did NOT happen.** `R40`'s retreat
   clause and jump-over clause already read `checkpointIndex`/`checkpointX`/`cp.taken`; audio appeared
   only as *positive* evidence in `R40` clause 2 and as *absence* in `R41`. Both were re-pointed; nothing
   else in those checks needed touching.
3. **The arming block has two redundant marking writes** (M4/M9 both green) — the brief's framing
   implies each writer is separately observable, and it is not. Recorded rather than "fixed": the
   redundancy is harmless, deleting either write is not this pass's remit, and a test aimed at a single
   one would be asserting nothing.
4. **Deleting the sprite broke `R38` by THROWING (`fn is not a function`), not by a clean FAIL**, which
   silenced every later clause in that check including the map-data clauses. Worth knowing for the next
   removal: an import-time destructure of a deleted export turns a targeted red into a whole-check blind
   spot. The `drawCheckpoint` entry is now gone from the import list entirely.
5. **Cite drift, reported not silently rebaselined.** The brief's `render.js:289` (`Math.floor(cam.x)`)
   is `render.js:288` now, and `main.js:100`/`:182` (the banner writers) are `:101`/`:181`; both were
   already off before this pass. `architecture.md`'s HUD/banner and bitmap-font citations were stale from
   the camera pass and are re-derived here (`render.js:304-306`, `render.js:308-314`, `main.js:101`,
   `main.js:511`, `sprites.js:335-339,405-426`, `sprites.js:407`), which also **closes the font-citation
   drift item fix pass 3 and pass 4 were both still carrying as open**. The one still open is `src/main.js:540` →
   `architecture.md:41`.

## Deliberately NOT done (pass 5)

- **No checkpoint-logic change of any kind**: no geometry, trigger band, crossing test, arming write,
  re-mark loop, loop ordering, respawn, clamp, camera floor, or `K` tile edited. No tile, pit, pipe,
  platform or flagpost column moved (M7/M8 prove the map clauses still watch them).
- **No palette entry removed** — each of `pumpkin`/`pumpkinDark`/`used`/`usedDark`/`stone`/`stoneDark`
  still has users (grep in the Goal section), and no harness clause enumerates palette contents.
- **`src/camera.js` untouched**, as instructed; `makeCamera()`'s `{ x }` shape, `render.js:288`'s
  `Math.floor(cam.x)`, `main.js:101`/`:181` and the floor logic are all as the camera pass left them,
  and no camera check was edited — `R20`/`R36`/`R44` came back byte-identical.
- `p.invulnT = INVULN_TIME` and `G.bannerT = 0` on the respawn path kept (evaluated above, both live).
- Exactly **one** id registered (`R45`); `R34`/`R35`/`R39` stay unregistered; no id reused; no
  check deleted — `R36`/`R38`/`R40`/`R41`/`R42` were all re-pointed in place, so the suite's shape is
  still the same five checkpoint checks plus the new guard.
- The harness helper names (`flagLevel()`, `installLevel()`'s comment, `R36`'s "flag" wording) keep the
  old flag vocabulary: renaming them would churn 200 lines of proofs for no new coverage, and the
  checks' own text now says plainly that a "flag" is a checkpoint marker, not a drawn object.
- Not touched: the deferred `R35` boss-freeze item, the `R39` `Q` double-award candidate, and
  `docs/REVIEW-2026-11-15.md` (its §11 quotes pass-2/4 numbers that this pass does not change).
