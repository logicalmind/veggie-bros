# Orchestration Resume State — Veggie Bros.

Last updated: 2026-11-14, after Step 3 merged to `main` (user-requested pause).

## Current position
- Protocol: `IMPLEMENTATION.md` — orchestrator/worker/reviewer loop; strictly sequential (one worker or reviewer at a time, shared checkout).
- Progress: `VEGGIE_BROS_PLAN.md` — Steps 1–3 Done; **resume at Step 4 (`src/input.js`)**.
- Git: work on `main`, clean tree. Keep branches `step-02-index-config` and `step-03-sprites` — retained per protocol, do not delete.
- IMPORTANT: after a worker finishes, the working tree is left on the step branch. Before spawning the next worker run `git checkout main && git status --porcelain` (must be empty) and confirm `main` contains the latest merge + plan-update commit.

## Approved deviations (already merged; include in future worker/reviewer briefs, do NOT relitigate)
1. `SOLID = "XSBPQU=|"` (Step 2). Plan's literal string is `"XSBPQU="`; pipe `|` must be solid per architecture.md "Solid chars: `X S B P Q U = |`". Levels use `||` columns as jump-over obstacles.
2. `drawPixelText` (Step 3) fills the cached offscreen glyphs with the `color` argument (cache keyed by text+color) instead of the spec's literal white-fill: Step 10's render calls it with non-white colors (`#e8434f` title, `#ffffff` popups), so a white-only mask would make `color` dead. Geometry (12×24 cells, 12-px advance, per-char drawImage at 6×12·scale, returns `text.length*6*scale`) is exactly per spec.
3. `drawGate(ctx, x, y)` (Step 3): caller passes the G-tile pixel coords from `level.gate` — that tile is the BOTTOM row of the 7-tile-tall gate (sits on ground); gate drawn 2 tiles wide × 7 tiles tall extending UP from that tile, bottom-up, watermelon arch in the top 2×2 tiles, pennant above.

## Loop mechanics (recap for the resuming orchestrator)
- Per step: spawn worker (self-contained brief: verbatim spec text + branch `step-NN-<slug>` from `main` + "touch only named files" + self-check `node --input-type=module --check < src/<file>.js` must print nothing + commit + return files/self-check/deviations) → spawn reviewer (same spec + `git diff main...<branch>` or instruction to run it + approved deviations + verdict PASS / numbered gaps with file:line) → on PASS: `git checkout main && git merge <branch>` (keep branch), collapse step in `VEGGIE_BROS_PLAN.md` to `Done — <one-line summary>`, commit plan update on main → next step. On FAIL: new worker on the same branch with the gap list; max 3 fix rounds, then stop and report the open dispute.
- Stop conditions (ask user): blocking spec ambiguity, fix loop not converging after 3 rounds, unexpected git state (dirty tree at loop start, diverged branches).
- All plan step specs are complete/verbatim in the file. Lines 33, 76, 80, 139 (original numbering) are long and get truncated in terminal display — read them with `:raw:N` before quoting them into a brief (done for all of them on 2026-11-14; re-verify when quoting).
- Node v26.13.0 and python3 are available on this machine (needed for the final http-server E2E).
- Expectations from the 2026-11-14 run: workers take ~3–25 min (large files generate slowly); reviewers are thorough (stub-canvas verification, ~15–20 min). Do not kill on elapsed time alone.
- Remaining: Steps 4 (input), 5 (audio), 6 (levels+level), 7 (items), 8 (enemy), 9 (player), 10 (camera+render), 11 (main), 12 (README), then plan §Verification: (1) syntax sweep `for f in src/*.js; do node --input-type=module --check < "$f"; done`, (2) throwaway level smoke test in /tmp importing `src/levels.js` + `src/level.js`, (3) browser end-to-end via `python3 -m http.server 8000` (title → 1-1 → 1-2 → 1-3 boss → WIN; pause/restart/mute; GAME OVER; touch buttons in device mode), (4) kill the server.

## Restart prompt (paste into a fresh session at the repo root)
Read IMPLEMENTATION.md, then RESUME.md, then VEGGIE_BROS_PLAN.md, architecture.md, and requirements.md. Act as the orchestrator and run the loop from the first step without a "Done" marker (currently Step 4, `src/input.js`). Work autonomously through the plan; stop and ask me only on the stop conditions defined in IMPLEMENTATION.md.
