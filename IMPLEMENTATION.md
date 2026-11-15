# Implementation Strategy — Veggie Bros.

Orchestration protocol for executing `VEGGIE_BROS_PLAN.md` step by step.
Step specs live in the plan; this file defines only how work is dispatched, reviewed, and merged.

## Roles

- **Orchestrator** — the main session agent. Owns the loop. Does NOT write or edit code. Its tools: read, spawn subagents, git (`branch`/`merge`/`log`/`diff`/`status`), and collapsing completed plan steps to "Done" notes.
- **Worker** — subagent spawned per plan step (or per fix round). Full edit/bash access. Works ONLY on its own branch and ONLY on files named by its step.
- **Reviewer** — subagent (reviewer agent) spawned after each worker. Read-only. Verifies the step's work against the step spec + `architecture.md`. Returns a verdict.

## The loop

For each plan step, in order, until all are Done:

1. **Select** the next step in `VEGGIE_BROS_PLAN.md` without a "Done" marker.
2. **Worker** — spawn a subagent with a self-contained brief containing:
   - the full text of the step spec (copied verbatim from the plan),
   - branch: `git checkout -b step-NN-<slug> main` (NN = zero-padded step number),
   - implement exactly the spec; touch only the files the step names,
   - self-check per the plan: `node --input-type=module --check < src/<file>.js` for each new/changed src file (must print nothing),
   - no linters, formatters, or test files,
   - commit all work on the branch (clear commit messages),
   - return: files changed, self-check results, any deviation from spec.
3. **Reviewer** — spawn the reviewer agent with:
   - the same step spec,
   - `git diff main...<branch>` (the branch's changes),
   - verdict: PASS, or a numbered list of requirement gaps with file/line evidence.
4. **On PASS** — orchestrator runs `git checkout main && git merge <branch>`. Keep the branch (do NOT delete). Update the plan: collapse the step to `Done — <one-line summary>`. Commit the plan update on main.
5. **On FAIL** — spawn a new worker on the same branch with the gap list; it fixes, commits, and returns. Repeat 3 → 4 → 5. Max 3 fix rounds; if still failing, stop and report the open dispute to the user.
6. **Next step** — go to 1.

## Rules

- Isolation: each worker (and its post-worker reviewer) runs in its own git worktree — `git worktree add /tmp/vb-wt/step-NN-<slug> -b step-NN-<slug> main`; the shared checkout stays on `main` for merges and plan/state updates only. Independent steps (disjoint files) may run in parallel batches; a step that imports or integrates code from a prior step (e.g. step 11) runs after the batch that produced its dependencies. Per-branch review gate, 3-round fix cap, and merge-only-on-main rules are unchanged.
- Orchestrator never edits code; workers never touch files outside their step; reviewer never edits.
- Every worker/reviewer brief is self-contained (subagents share no conversation): include the spec text, file list, verification commands, and "do not touch other files".
- Never rebase or force-push; `main` only moves via merges.
- `architecture.md` is the source of truth for design; the plan is the source of truth for step content and progress.
- Stop and ask the user on: spec ambiguity that blocks a step, a fix loop that doesn't converge after 3 rounds, or unexpected git state (dirty working tree at loop start, diverged branches).

## Current state
- Steps 1–12 Done: `architecture.md`; `index.html` + `src/config.js`; `src/sprites.js`; `src/input.js`; `src/audio.js`; `src/levels.js` + `src/level.js`; `src/items.js`; `src/enemy.js`; `src/player.js`; `src/camera.js` + `src/render.js`; `src/main.js`; `README.md`.
- Verification: **PAUSED by user decision 2026-11-15 (partial)** — syntax sweep PASS; level smoke PASS; browser E2E **9 of 12 checkpoints PASS** (CP 1–5, 7, 8-observed, 10, 12 + GAME OVER); CP6 + CP9 (1-2 pit, boss/WIN) deferred with full handoff. 1-3 sealed-arena fixed via user-approved door commit `8adc78e0`. Build complete — no worker/reviewer rounds remain. Resume per `RESUME.md` "Restart prompt"; full state, incident log, and handoff artifacts there.
