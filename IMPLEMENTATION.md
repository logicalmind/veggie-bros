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

- Strictly sequential: at most one worker or reviewer running at a time (shared checkout).
- Orchestrator never edits code; workers never touch files outside their step; reviewer never edits.
- Every worker/reviewer brief is self-contained (subagents share no conversation): include the spec text, file list, verification commands, and "do not touch other files".
- Never rebase or force-push; `main` only moves via merges.
- `architecture.md` is the source of truth for design; the plan is the source of truth for step content and progress.
- Stop and ask the user on: spec ambiguity that blocks a step, a fix loop that doesn't converge after 3 rounds, or unexpected git state (dirty working tree at loop start, diverged branches).

## Current state

- Step 1 (`architecture.md`): Done.
- Resume at Step 2 (`index.html` + `src/config.js`).
