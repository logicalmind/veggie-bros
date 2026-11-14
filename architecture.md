# Veggie Bros. — Architecture

### Tech foundation

- Vanilla JS ES modules + HTML5 `<canvas>`. No dependencies, no build step.
- Internal resolution **256×240** (16 tiles × 15 tiles of 16 px), NES-style. Canvas is CSS-scaled by an integer factor (1–4×, fit to window) with `image-rendering: pixelated` for crisp pixels.
- Fixed-timestep simulation at **60 Hz** (accumulator + `requestAnimationFrame`), rendering every frame.

### File map

```
index.html          page shell, canvas, touch overlay, module entry
README.md           run instructions + controls
architecture.md     this document
src/config.js       all tunable constants (sizes, physics, scoring, palette)
src/sprites.js      all original pixel-art as procedural fillRect draw functions
src/input.js        keyboard + touch input state
src/audio.js        Web Audio synth: SFX, music loop, mute
src/levels.js       the 3 level maps (string grids) + metadata
src/level.js        map parser + tile helpers (no DOM — node-importable)
src/player.js       hero physics, collision, damage/death
src/enemy.js        Turnip Trooper + Bromely (boss)
src/items.js        Sunfruit, Mega Berry, block pops, shards, score popups
src/camera.js       side-scroll camera
src/render.js       background, tiles, entities, HUD, screens
src/main.js         entry: canvas setup, fixed-timestep loop, state machine
```

Only `sprites.js` (text helper) and `main.js`/`input.js`/`render.js` touch the DOM; `config.js`, `levels.js`, `level.js`, `player.js`, `enemy.js`, `items.js`, `camera.js` are DOM-free and importable in Node for testing.

### Game loop

```
acc += min(dt, 0.25);
while (acc >= 1/60) { update(1/60); acc -= 1/60; }
render();
```

### State machine

`TITLE → PLAYING ⇄ PAUSED`; `PLAYING → LEVEL_CLEAR → PLAYING` (next level); boss death in level 3 → `WIN`; 0 lives → `GAME_OVER`; `WIN`/`GAME_OVER` → `TITLE` on Enter. Death is a sub-sequence inside `PLAYING` (`player.dead`, world frozen, 1.2 s timer, then respawn at same level with 1 life lost, or `GAME_OVER`).

- TITLE: logo, subtitle, controls listing; Enter starts a new game (score 0, lives 3, level 1) and unlocks audio.
- PAUSED: overlay; P/Esc resumes, R restarts current level (no life lost), M mutes.
- LEVEL_CLEAR: on gate touch, player auto-slides down the Melon Gate, +1000, then next level loads (1.4 s total).
- WIN / GAME OVER: final score + "PRESS ENTER".

### Coordinate system & physics

World coordinates in px; entity `x, y` = top-left of hitbox. Tile size 16. Player hitbox 12 wide × 12 (small) / 26 (big). Fixed-dt physics, per second units:

| Constant | Value | Note |
|---|---|---|
| GRAVITY | 2300 px/s² | |
| MAX_FALL | 420 px/s | |
| JUMP_VY | −640 px/s | → ~89 px (5.5 tiles) jump height |
| WALK_MAX | 110 px/s | |
| RUN_MAX | 190 px/s | hold Shift |
| ACCEL / AIR_ACCEL | 800 / 600 px/s² | |
| FRICTION | 1400 px/s² | grounded, no input |
| COYOTE | 0.08 s | |
| JUMP_BUFFER | 0.12 s | |
| JUMP_CUT_VY | −200 px/s | on early release, clamp vy if rising |
| STOMP_BOUNCE | −360 px/s | |
| ENEMY_SPEED | 30 px/s | turnip patrol |
| BOSS_SPEED / HOP_COOLDOWN / HOP_RANGE / HOP_VY | 40 / 1.6 s / 120 px / −380 | |
| INVULN_TIME | 2.0 s | after shrinking, 8 Hz blink |

Derived feasibility (do not retune): 3-tile gaps walkable, 4-tile gaps require running; 4-tile walls/platforms climbable; row-9 blocks (4 tiles above ground) hittable from the ground; row-5 blocks only from standing on a row-9 block.

### Collision model

Axis-separated AABB vs tile grid: move x, resolve against solid tiles (clamp, zero vx); move y, resolve (set `onGround`; head-bump detection for upward motion). Solid chars: `X S B P Q U = |`. Out-of-range tiles: solid on left/right/below, air above. Turnips reverse at walls and cliff edges (grounded && no solid below front foot). Enemies are inactive until `x < cam.x + 288` (view + 32 px), then always active.

Block interaction (head-bump): `P` → becomes `U`, Sunfruit pop visual, +100; `Q` → becomes `U`, Mega Berry walks out; `B` + big player → tile removed, 4 shard particles, +50; `B` + small → 0.15 s bump animation, thud SFX.

### Level format

`levels.js` exports `LEVELS = [{ label, name, map: [15 strings] }]`. Char legend:

- `.` air
- `X` ground (dirt; grass top rendered when tile above is non-solid)
- `S` stone block (unbreakable)
- `B` Pebble Brick (breakable from below by big player)
- `P` / `Q` Pumpkin Block → Sunfruit / Mega Berry; become `U` (used, solid) after pop
- `=` melon-slice platform (solid)
- `|` melon pipe tile (solid; renderer draws cap on top row of a pipe run)
- `H` hero spawn · `T` turnip spawn · `F` boss spawn · `C` floating Sunfruit · `G` Melon Gate base tile (gate drawn 2 wide × 7 tall; trigger rect `x*16, 7*16, 32, 80`)

`parseLevel(def)` validates: 15 rows, equal row length, exactly one `H`, exactly one `G` or `F` — throws `Error` with the level label otherwise. Returns `{ label, name, widthPx, tiles (mutable 2D char array), playerSpawn, enemies[], boss|null, fruits[], gate|null }` plus runtime state `bumps: [{x,y,t}]`. Marker tiles are converted to `.`.

### Entities

- **Player** (small 12×12 / big 12×26): runs, jumps, variable height; damage: big → small + invuln, small → death; pit (y > 272) → instant death sequence.
- **Turnip Trooper** (12×12): gravity patrol, reverses at walls/edges; stomp → 0.4 s squashed corpse, +200, player bounces; side contact → damage.
- **Bromely** (28×28, 3 HP): walks arena, hops toward player (range/cooldown above); stomp on top 10 px → 1 HP, +500, 1 s white flash, player bounces; HP 0 → 1.5 s defeat anim → `WIN`, +2000.
- **Sunfruit** (8×8): 4-frame spin, static, +100 on overlap.
- **Mega Berry** (14×14): walks right at 60 px/s, gravity, wall bounce, falls off edges, despawns after 15 s; +1000; grows small player (feet stay planted: `y -= 14`).
- Effects: block pop (0.25 s rise), 4 shards (0.5 s), score popup (0.6 s, rises 20 px).

### Scoring & HUD

Sunfruit 100 · stomp 200 · brick break 50 · Mega Berry 1000 · Melon Gate 1000 · boss hit 500 · boss down 2000. HUD top bar: `SCORE 000000`, Sunfruit icon ×NN, `WORLD 1-1`, Poppy icon ×lives, `MUTED` when muted. Level name banner fades for 1.5 s at level start.

### Audio

AudioContext created lazily on first user gesture (Enter on title); if unavailable, all audio calls no-op. Master gain 0.5. SFX via square/triangle oscillators + exponential decay; brick break uses a short noise buffer. Music: 4-bar I–V–vi–IV loop at 132 BPM eighth notes (lookahead scheduler, 30 ms timer, 0.12 s ahead): melody (square, gain 0.16) — bar1 `C5 – E5 – G5 – E5 –`, bar2 `G5 – B5 – D5 – B5 –`, bar3 `A5 – C6 – E5 – C6 –`, bar4 `F5 – A5 – C6 – A5 –` (`–` = rest); bass (triangle, gain 0.2) root+fifth per bar: `C2 G2 · G2 D3 · A2 E3 · F2 C3` (4 eighths each). Music runs in PLAYING; stops in PAUSED/WIN/GAME_OVER; jingles: die, level-clear, win.

### Input

Keyboard: ←/→ or A/D move · Shift run · Space/Z/W/↑ jump (edge-buffered) · Enter start · P/Esc pause · R restart (paused) · M mute. Arrows/Space call `preventDefault`. Touch: on `(pointer: coarse)`, show 3 fixed buttons (◀ ▶ left, A right) that drive the same state.

### Rendering pipeline

Sky → parallax hills (0.25×) → clouds/bushes (0.5×, deterministic hash positions) → visible tiles (17 columns) → gate → items → enemies → player → particles/popups → HUD → state overlays (title / pause / game-over / win / clear slide / level banner). Text uses a crisp `pixelText` helper: draw at 24 px monospace into a cached offscreen canvas, draw back at 1/3 with smoothing off. All character art is procedural `fillRect` pixel drawing (integer coords) — original, no asset files.
