# Veggie Bros. — Build Plan

## Context

Build a complete, playable 2D side-scrolling platformer in `/Users/jasonjordan/repos/veggie_bros` per `requirements.md`: 8-bit-inspired, fruit/vegetable themed, original content only (no Nintendo assets/branding), title/pause/win/game-over screens, 3 levels ending in a pineapple boss fight, synthesized audio, keyboard + touch controls, and clean run instructions. The repo is empty except `requirements.md`; there is no existing language/framework to follow, so this plan fixes the stack. Deliverables: `architecture.md`, the implemented game, `README.md`.

## Locked decisions (confirmed with user)

- **Stack**: vanilla JavaScript (ES modules) + HTML5 Canvas. Zero dependencies, no build step, no `package.json`. Runs via any static file server.
- **Audio**: original 8-bit-style SFX + looping chiptune music, all synthesized in code via Web Audio API. Mute toggle.
- **Levels**: 3 levels, escalating difficulty; level 3 ends in a boss fight (Bromely the Pineapple King); defeating the boss → win screen.

Game and character names (all original): game **"Veggie Bros."**; hero **Poppy** (strawberry); enemies **Turnip Troopers**; boss **Bromely the Pineapple King**; coin **Sunfruit**; power-up **Mega Berry** (blueberry); goal **Melon Gate**; pipes **Melon Pipes**; destructible block **Pebble Brick**; mystery block **Pumpkin Block**; levels **1-1 "Strawberry Fields"**, **1-2 "Carrot Canyon"**, **1-3 "Pineapple Palace"**.

---

## Architecture

See `architecture.md` at the repo root — extracted verbatim from this plan.

---

## Approach

Bottom-up so every step is standalone-valid. After **each** src file write, run: `node --input-type=module --check < src/<file>.js` (verified working; must print nothing). Do not run linters/formatters; do not add test files to the repo.

### Step 1 — `architecture.md`

Done — `architecture.md` is at the repo root (verbatim copy; source of truth for the architecture).

### Step 2 — `index.html` + `src/config.js`

Done — page shell + constants module merged; `SOLID` is `"XSBPQU=|"` (pipe solid per architecture; documented deviation).

### Step 3 — `src/sprites.js`

Done — procedural pixel-art module merged (17 draw functions + cached pixel-text helper; text helper fills glyphs with the `color` arg — approved deviation, see RESUME.md).

### Step 4 — `src/input.js`

Done — keyboard + touch input module merged (edge-consume pattern for start/pause/mute/restart; touch overlay shown only on coarse pointers).

### Step 5 — `src/audio.js`

Done — Web Audio synth module merged (11 SFX + looping 4-bar music scheduler + mute; bass modeled as 32 eighth-slots — audible schedule identical to spec, approved deviation).

### Step 6 — `src/levels.js` + `src/level.js`

Done — 3 level maps (byte-exact vs plan) + DOM-free parser/tile helpers merged; all entity positions re-derived independently and matched.

### Step 7 — `src/items.js`

Done — DOM-free items module merged (5 factories + in-place updateItems; berry 14×14 wall-bounce physics, 15 s life; deterministic per-k shards; makeShards returns an array of 4 — step 11 spec updated to spread it).

### Step 8 — `src/enemy.js`

Done — `src/enemy.js` merged (Turnip Trooper + Bromely boss: activation at view+32, wall/edge reversal, squash-corpse + defeat states, hop AI; `hp: BOSS_HP` added per step-11 requirement — recorded deviation).

### Step 9 — `src/player.js`

Done — `src/player.js` merged (axis-separated move + most-overlap headBump, coyote/buffer/jump-cut per spec bullet order, big/small damage + pit/death states; `jumpCut:false` init + boolean `killPlayer` return — recorded deviations).

### Step 10 — `src/camera.js` + `src/render.js`

Done — `src/camera.js` + `src/render.js` merged (lerp side-scroll camera + full render pipeline: parallax background, tiles, gate, all item/enemy/player kinds, HUD, every state overlay; all draw calls audited against sprites.js signatures).

### Step 11 — `src/main.js`

Done — `src/main.js` merged (entry: fixed-timestep loop + 6-state machine + all interactions; fix round 1 added `consumeJumpPressed()` in both PLAYING branches and `G.levelIndex = i` in `loadLevel` — round-1 review FAIL, round-2 re-review PASS 34/34).

### Step 12 — `README.md`

Done — README.md merged (run instructions, controls table cross-checked against src/input.js, goal + architecture pointer — all per spec).

---

## Critical files & anchors

- `src/levels.js` — the three map arrays are the exact validated strings above; a single bad character breaks gameplay. Copy verbatim, one string literal per row.
- `src/player.js` — axis-separated tile resolution + `headBump` reporting + coyote/buffer/jump-cut is the core game feel; `enemy.js`/`items.js` reuse the same `moveX/moveY` clamp pattern.
- `src/main.js` — state machine + interaction ordering (fruits → berry → head-bump → enemies → gate → pit). Death is `dyingT` inside PLAYING, not a separate state.
- `src/level.js` — `parseLevel` validation + `tileAt` out-of-bounds rule (solid left/right/below, air above) is load-bearing for every collider.
- `src/audio.js` — lazy `init()` on first Enter (autoplay policy); every call must no-op safely when not initialized.

## Verification
**Status (2026-11-15, paused by user decision):** item 1 PASS; item 2 PASS; item 3 PARTIAL — 9 of 12 checkpoints PASS (CP 1–5, 7, 8-observed, 10, 12 + GAME OVER), CP6 + CP9 deferred with handoff in `RESUME.md` "Restart prompt"; item 4 done (servers killed, lsof-verified). 1-3 map: sealed boss arena fixed by user-approved 2-tile door, commit `8adc78e0`.

All from repo root `/Users/jasonjordan/repos/veggie_bros`.

1. **Syntax** (after each step, and once at the end): `for f in src/*.js; do node --input-type=module --check < "$f" || echo "FAIL $f"; done` → no FAIL lines.
2. **Level smoke test** (throwaway script in `/tmp`, NOT the repo): a Node ESM script importing `src/levels.js` + `src/level.js` (both DOM-free) that parses all 3 levels and asserts: `tiles.length === 15`; all rows same length (180/200/160); `playerSpawn` set; exactly one of `gate`/`boss`; rightmost column all non-`'.'`; ground reachability — for the lowest standing surface per column, consecutive rises ≤ 4 tiles and no ground gap wider than 4 columns. Expected: all assertions pass, silent. (The maps as written satisfy these — they were validated during planning; if one fails, fix the map in `levels.js` to satisfy the invariant, do not loosen the checker.)
3. **Browser end-to-end**: `python3 -m http.server 8010` (background; **NEVER port 8000 — that is the splash inference engine's port**) → open `http://localhost:8010` in a browser tab.
   - Title screen: "VEGGIE BROS." logo, controls listed, no console errors.
   - Enter → level 1-1 "Strawberry Fields" banner, player visible, music playing.
   - Walk/jump/run responsive; jump onto the first Melon Pipe (480 px from level start).
   - Hit the Pumpkin Block at x=16 from below → Sunfruit pop, +100, block turns used.
   - Stomp a Turnip Trooper → +200, squash.
   - Collect the Mega Berry from the Q-block at x=110 → Poppy grows; as big, head-bump the Pebble Brick at x=112 → it breaks, +50.
   - Touch a turnip as small (or fall in a gap) → lose a life, and respawn **at the last `K` flagpost banked** (or at the `H` spawn if none has been): small form, score kept, seated on the post's own tile with ~2 s of invulnerability and **no** `WORLD 1-1 …` stage-intro banner. With nothing banked it is the old full restart — `H` spawn, no grace, banner shown. Behaviour: `architecture.md` → Deviations ("Death respawns at the last flag"); checks `R37`/`R41`/`R42`.
   - Reach the Melon Gate at x=165 → slide + "STAGE CLEAR" → level 1-2 loads.
   - Clear 1-2 → level 1-3 "Pineapple Palace"; in the arena, stomp Bromely 3 times (he flashes white per hit) → WIN screen with total score; Enter → title.
   - P → PAUSED overlay (R restarts level, M shows `MUTED` in HUD); 0 lives → GAME OVER screen → Enter → title.
   - DevTools device mode (or narrow window) → touch buttons appear and drive movement/jump.
4. Kill the http server when done.

## Assumptions & contingencies

- Stack, audio, and 3-level scope are the user's confirmed choices (recorded above).
- No time limits and no save persistence — requirements ask only for lives/retry + score; do not add these. **No per-level checkpoints — REVERSED by explicit user decision 2026-11-16, superseded.** They now ship: a `K` flagpost arms a one-way left bound for the hero and the camera, and death respawns at the last flag banked (`src/level.js`, `src/main.js`, `src/camera.js`; behaviour recorded in `architecture.md` → Deviations, checks `R20`/`R36`/`R37`/`R38`/`R40`/`R41`/`R42`/`R43`). This line's prohibition on **time limits** and **save persistence** still stands.
- If `AudioContext` construction fails (no WebAudio), the game must run silently; `audio.js` no-ops already guarantee this — do not add audio guards to other modules.
- Boss difficulty: stomp window is the top 10 px of the 28-px hitbox with a −360 bounce; if it proves impossible in browser testing, increase that 10 px to 14 — do not change boss speed or HP.
- Very small windows: scale clamps to 1× (no fractional scaling).
- Touch layout is a "nice to have" per requirements; if the fixed-overlay buttons overlap gameplay on a tested device, adjust the existing CSS button sizes — do not redesign the input system.
