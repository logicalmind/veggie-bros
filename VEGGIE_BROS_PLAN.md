# Veggie Bros. — Build Plan

## Context

Build a complete, playable 2D side-scrolling platformer in `/Users/jasonjordan/repos/veggie_bros` per `requirements.md`: 8-bit-inspired, fruit/vegetable themed, original content only (no Nintendo assets/branding), title/pause/win/game-over screens, 3 levels ending in a pineapple boss fight, synthesized audio, keyboard + touch controls, and clean run instructions. The repo is empty except `requirements.md`; there is no existing language/framework to follow, so this plan fixes the stack. Deliverables: `architecture.md`, the implemented game, `README.md`.

## Locked decisions (confirmed with user)

- **Stack**: vanilla JavaScript (ES modules) + HTML5 Canvas. Zero dependencies, no build step, no `package.json`. Runs via any static file server.
- **Audio**: original 8-bit-style SFX + looping chiptune music, all synthesized in code via Web Audio API. Mute toggle.
- **Levels**: 3 levels, escalating difficulty; level 3 ends in a boss fight (Bromely the Pineapple King); defeating the boss → win screen.

Game and character names (all original): game **"Veggie Bros."**; hero **Poppy** (strawberry); enemies **Turnip Troopers**; boss **Bromely the Pineapple King**; coin **Sunfruit**; power-up **Mega Berry** (blueberry); goal **Melon Gate**; pipes **Melon Pipes**; destructible block **Pebble Brick**; mystery block **Pumpkin Block**; levels **1-1 "Strawberry Fields"**, **1-2 "Carrot Canyon"**, **1-3 "Pineapple Palace"**.

---

## Architecture (this is the content of `architecture.md`)

Write `architecture.md` exactly from this section.

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

---

## Approach

Bottom-up so every step is standalone-valid. After **each** src file write, run: `node --input-type=module --check < src/<file>.js` (verified working; must print nothing). Do not run linters/formatters; do not add test files to the repo.

### Step 1 — `architecture.md`

Create `architecture.md` at repo root containing the **Architecture** section above, verbatim (from "Tech foundation" through "Rendering pipeline", with the `# Veggie Bros. — Architecture` title).

### Step 2 — `index.html` + `src/config.js`

`index.html` (exact structure): `<!DOCTYPE html>`, head with `<meta charset="utf-8">`, `<meta name="viewport" content="width=device-width, initial-scale=1">`, `<title>Veggie Bros.</title>`, `<style>`: `html,body{margin:0;height:100%;background:#14141f;display:flex;align-items:center;justify-content:center;overflow:hidden}`, `canvas{image-rendering:pixelated;image-rendering:crisp-edges}`, `#touch{position:fixed;left:0;right:0;bottom:0;display:none;justify-content:space-between;padding:12px 16px;pointer-events:none}`, `#touch .g{display:flex;gap:12px;pointer-events:auto}`, `#touch button{width:56px;height:56px;border-radius:50%;border:2px solid #555;background:rgba(255,255,255,.15);color:#fff;font-size:20px}`. Body: `<canvas id="game" width="256" height="240"></canvas>`, then `<div id="touch"><div class="g"><button id="t-left">◀</button><button id="t-right">▶</button></div><div class="g"><button id="t-jump">A</button></div></div>`, then `<script type="module" src="src/main.js"></script>`.

`src/config.js` exports: `TILE=16, VIEW_W=256, VIEW_H=240, ROWS=15, STEP=1/60, GRAVITY=2300, MAX_FALL=420, JUMP_VY=-640, WALK_MAX=110, RUN_MAX=190, ACCEL=800, AIR_ACCEL=600, FRICTION=1400, COYOTE=0.08, JUMP_BUFFER=0.12, JUMP_CUT_VY=-200, STOMP_BOUNCE=-360, PLAYER_W=12, PLAYER_SMALL_H=12, PLAYER_BIG_H=26, INVULN_TIME=2.0, START_LIVES=3, ENEMY_SPEED=30, BOSS_SPEED=40, BOSS_HP=3, BOSS_HOP_COOLDOWN=1.6, BOSS_HOP_RANGE=120, BOSS_HOP_VY=-380, BERRY_SPEED=60, BERRY_LIFE=15, SCORE={fruit:100,stomp:200,block:50,berry:1000,gate:1000,bossHit:500,bossDown:2000}`, `SOLID="XSBPQU="`, and `PALETTE` with these named hex values:

```
sky #9be3f5 · skyDark #7fd4ec · cloud #ffffff · hillFar #a8e08f · hillNear #6cc760 · bush #3f9e4d
dirt #d98c4a · dirtDark #a35f2c · grass #5fbf4a
stone #e8e0c0 · stoneDark #a89e78
brick #e0a45c · brickDark #9c6428
pumpkin #f08c1e · pumpkinDark #b35c0a · pumpkinLit #ffd23e
used #b08050 · usedDark #7a5230
platform #e8c86a · platformDark #b08830
pipe #4fc76a · pipeDark #2f8f47 · pipeFlesh #dff2c8
heroBody #e8434f · heroDark #b02531 · heroSeed #ffd23e · heroLeaf #3f9e4d
white #ffffff · black #1a1a1a
turnipBody #f2e8dc · turnipTip #c9a86a
berryBody #4a6cf0 · berryDark #2f4ab0
pineapple #e8b83e · pineappleDark #a87820 · crown #ffd23e
red #e8434f
```

### Step 3 — `src/sprites.js`

Procedural pixel art: every sprite is a function using `ctx.fillStyle` + `ctx.fillRect` at integer coordinates (1 px = 1 internal px). No offscreen canvases except the text helper. Export:

- `drawHero(ctx, x, y, facing, big, pose, frame)` — x,y = top-left of hitbox; draw sprite 12 wide, 14 tall (small) / 12×28 (big) at `(x, y-2)`. Strawberry: cone body `heroBody` (wider top, tapering bottom), 4 seed dots `heroSeed`, green leaf crown (5 spikes `heroLeaf`) + 1 px stem, 2 white eyes with 1 px `black` pupils. `pose`: `idle` (frame 0), `run` (legs 2×4 `heroDark` alternate ±1 px x offset on `frame`, body bounces 1 px on odd frame), `jump` (legs tucked up 2 px). `facing` flips the eye/pupil offset left/right.
- `drawTurnip(ctx, x, y, frame, facing)` — 14×14 at `(x-1, y-1)`: `turnipBody` bulb (roundish: stacked rows 6/10/12/12/10/8 px wide), `turnipTip` 2 px bottom tip, 3-leaf green sprout (`heroLeaf`), 2 eyes, 2 px feet alternating 1 px per `frame`.
- `drawBoss(ctx, x, y, frame, facing, hurt)` — 32×32 at `(x-2, y-2)`: `pineapple` oval body with `pineappleDark` diagonal crosshatch grid, 5-spike green crown, face (eyes + 2 px mouth); `frame` bounces whole sprite 1 px; `hurt` → draw body+face in `white` instead.
- `drawFruit(ctx, x, y, frame)` — 8×8 at `(x, y)`: 5-point `crown`-yellow star with `black` 1 px outline; spin = 4 frames, star width 8/4/2/4 (frame 0..3).
- `drawBerry(ctx, x, y, frame)` — 14×14 at `(x, y)`: `berryBody` circle (rows 8/12/14/14/14/12/8), `berryDark` outline, 2 px `white` highlight, 5 px star scar `berryDark` on top; frame 1: skip bottom 1 px row (pulse).
- `drawGround(ctx, x, y, top)` — 16×16: `dirt` fill, 5 `dirtDark` 1×1 specks at fixed offsets, `black`-ish 1 px bottom edge; if `top`: 4 px `grass` band + 1 px `dirtDark` line under it.
- `drawStone(ctx, x, y)` — `stone` fill, 1 px `stoneDark` bottom+right, 1 px `white` top+left bevel.
- `drawBrick(ctx, x, y)` — `brick` fill, `brickDark` mortar: 1 px lines at y+5, y+10 full width, verticals x+5 / x+11 (top row), x+8 (bottom two rows); 1 px `brickDark` border.
- `drawPumpkin(ctx, x, y, used)` — `pumpkin` fill, `pumpkinDark` vertical ridge lines at x+4, x+11 + border; face: two 2×2 triangle `pumpkinLit` eyes, 3 px zigzag `pumpkinLit` mouth, 1 px `pumpkinDark` stem top-center; `used` → plain `used` with `usedDark` border, no face.
- `drawPlatform(ctx, x, y)` — `platform` fill, `platformDark` 1 px top+bottom edges, 3 `black` seed dots, 1 px green `bush` rind on left+right columns.
- `drawPipe(ctx, x, y, isTop, isLeft)` — 16×16 melon pipe segment: `pipe` fill, `pipeDark` vertical stripes at x+3/x+11, 2 px `pipeFlesh` inner edge on the inside column (left segment: right edge; right segment: left edge); `isTop` row: 2 px `pipeDark` cap overhang extending 2 px beyond the pipe run on its outer side, 3 px `pipeFlesh` lip.
- `drawGate(ctx, x, y)` — 2 tiles wide × 7 tall at tile (x,y): stone post (`stone`/`stoneDark`) 2×16 at bottom tile + `red` pennant flag on a 1 px pole above the arch; watermelon arch on top 2×2 tiles (`pipeFlesh` fill, `pipe` rind, 3 seed dots); draw order bottom-up.
- `drawHill(ctx, x, y, r, color)` / `drawCloud(ctx, x, y)` / `drawBush(ctx, x, y)` — simple stacked-rects approximations in the given colors.
- `drawShard(ctx, x, y, k, t)` — one of 4 `brick` 4×4 rects with per-shard offsets scaled by `t`.
- `drawPixelText(ctx, text, x, y, color, scale=1)` — crisp text: cached offscreen canvas (created lazily via `document.createElement('canvas')`, guarded by `typeof document !== 'undefined'`); draw the text at `24px monospace`, white on transparent (glyph cell 12×24 px, advance 12), then per character i: `ctx.imageSmoothingEnabled = false; ctx.drawImage(off, i*12, 0, 12, 24, x + i*6*scale, y, 6*scale, 12*scale)` → chunky 6×12 px glyphs at scale 1 (12×24 at scale 2, 18×36 at scale 3). Return total width `text.length * 6 * scale`.

### Step 4 — `src/input.js`

Export singleton `input = { left, right, run, jump, jumpPressed, start, pausePressed, mutePressed, restartPressed }` (all `false`) plus `consumeJumpPressed()`, `consumeStart()`, `consumePause()`, `consumeMute()`, `consumeRestart()` (return + clear). `setupKeyboard()`: window keydown/keyup; map `ArrowLeft|a`→left, `ArrowRight|d`→right, `Shift`→run, `Space|z|w|ArrowUp`→jump (on keydown: if `!jump` set `jumpPressed=true`; `jump=true`; on keyup `jump=false`), `Enter`→start edge, `p|Escape`→pause edge, `m`→mute edge, `r`→restart edge. `keydown` handler calls `preventDefault()` for `ArrowLeft/ArrowRight/ArrowUp/ArrowDown/Space`. `setupTouch()`: if `matchMedia('(pointer: coarse)').matches`, show `#touch` and wire `t-left/t-right/t-jump` `pointerdown/pointerup/pointercancel` to the same fields (jump button sets `jumpPressed` on pointerdown when `!jump`).

### Step 5 — `src/audio.js`

Export singleton `audio = { muted, init(), sfx(name), musicStart(), musicStop(), toggleMute() }`. `init()`: return if already inited or `typeof AudioContext === 'undefined'`; create `AudioContext`, `master = createGain()` (gain 0.5) → destination; store ctx/gains. All methods no-op when not inited. `toggleMute()`: flip `muted`, set master gain `muted ? 0 : 0.5`. `sfx(name)`: per the audio table in Architecture (jump: square 320→640 Hz 0.12 s; stomp: triangle 200→60 Hz 0.15 s; coin: square 988 Hz 0.05 s then 1319 Hz 0.25 s; power: square arpeggio C5 E5 G5 C6, 0.06 s each; break: 0.15 s white-noise buffer through lowpass 800 Hz; bump: square 110 Hz 0.08 s; hurt: sawtooth 400→100 Hz 0.3 s; die: square B4 F4 C4 A3 F3, 0.12 s each; clear: C5 E5 G5 C6 E6, 0.1 s each; win: C5 E5 G5 C6 G5 C6 E6, 0.15 s each; bossHit: square 150 Hz 0.1 s). Each: osc + gain envelope (attack 0.005, exponential decay to 0.0001 at end), start/stop scheduled, `osc.onended` cleanup. Music: `musicStart()` schedules an 8th-note sequence at 132 BPM (eighth = 60/132/2 s) using a 30 ms `setInterval` lookahead (schedule 0.12 s ahead) over the 4-bar pattern in Architecture (32 melody slots + 16 bass slots, `null` = rest); store interval id; `musicStop()` clears it. Note frequencies: standard (C5 523.25, E5 659.25, G5 783.99, B5 987.77, D5 587.33, A5 880, C6 1046.5, F5 698.46, C2 65.41, G2 98, D3 146.83, A2 110, E3 164.81, F2 87.31, C4 261.63, F4 349.23, A3 220, B4 493.88).

### Step 6 — `src/levels.js` + `src/level.js`

`src/levels.js`: export `LEVELS = [{ label:'1-1', name:'Strawberry Fields', map:[…180 chars × 15] }, { label:'1-2', name:'Carrot Canyon', map:[…200 × 15] }, { label:'1-3', name:'Pineapple Palace', map:[…160 × 15] }]` using **exactly** the maps below (validated: equal row lengths, one H, one G/F, full-height right wall, gaps ≤ 4, ground rises ≤ 1 per column except the designed 1-step stairs, every T/F has solid below):

```
LEVELS[0].map (180 × 15):
"...................................................................................................................................................................................S"
"...................................................................................................................................................................................S"
"...................................................................................................................................................................................S"
"...................................................................................................................................................................................S"
"...................................................................................................................................................................................S"
"...............................................................BPB.................................................................................................................S"
"...................................................................................................................................................................................S"
"...................................................................................................................................................................................S"
"...................................................................................................................................................................................S"
"................P...PBBP................||.....................BPB..................===.......................Q.BPBBP.....................S........................................S"
"..............................||........||.....................................................||........................................SS..................C.C.C.................S"
"..............................||........||.....................................................||.......................................SSS........................................S"
"..H...........................||........||...T......T.........................T................||...T....T......................T......SSSS...........T..............G.............S"
"XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX..XXXXXXXXXX...XXXXXXXXXXX...XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX...XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXS"
"XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX..XXXXXXXXXX...XXXXXXXXXXX...XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX...XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXS"

LEVELS[1].map (200 × 15):
".......................................................................................................................................................................................................S"
".......................................................................................................................................................................................................S"
".......................................................................................................................................................................................................S"
".......................................................................................................................................................................................................S"
".......................................................................................................................................................................................................S"
".................................................................................................................BPB...................................................................................S"
".......................................................................................................................................................................................................S"
".......................................................................................................................................................................................................S"
".......................................................................................................................................................................................................S"
"..................P.....||....................BB.P........BBPBPB..........Q........SSSSSS...................||....P.....======....................||....................Q.........S....................S"
"........................||.............CC.............||..........................SSSSSSS...................||..............................||....||.............................SS...C.C..............S"
"........................||............................||.........................SSSSSSSS...................||..............................||....||............................SSS....................S"
"..H.....................||......T.....................||..........T.............SSSSSSSSS...T...T...........||..............................||....||....T....T.................SSSS...........G........S"
"XXXXXXXXXXXX...XXXXXXXXXXXXXXXXXXXXXXX....XXXXXXXXXXXXXXXXXXXXXXXXXXXX...XXXXXXXXXXXXXXXXXXXXXXXXXXX...XXXXXXXXXXXXXXXXX......XXXXXX....XXXXXXXXXXXXXXXXXXXXXXXX..XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXS"
"XXXXXXXXXXXX...XXXXXXXXXXXXXXXXXXXXXXX....XXXXXXXXXXXXXXXXXXXXXXXXXXXX...XXXXXXXXXXXXXXXXXXXXXXXXXXX...XXXXXXXXXXXXXXXXX......XXXXXX....XXXXXXXXXXXXXXXXXXXXXXXX..XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXS"

LEVELS[2].map (160 × 15):
"...................................................................................................................S.......................................S...."
"...................................................................................................................S.......................................S...."
"...................................................................................................................S.......................................S...."
"...................................................................................................................S.......................................S...."
"...................................................................................................................S.......................................S...."
".................P.............................P...................................................................S.......................................S...."
"...................................................................................................................S.......................................S...."
"...................................................................................................................S.......................................S...."
"...................................................................................................................S.......................................S...."
"................PB......||...........==.......BBB.......................Q.............||...........................S.......................................S...."
"........................||......................................................||....||......SSSSSSS..............S.........C.........C.........C.........S...."
"........................||......................................................||....||.....SSSSSSSS..............S.......................................S...."
"..H.....................||....T.......................T....T....................||....||....SSSSSSSSS...T..........S...................F...................S...."
"XXXXXXXXXX...XXXXXXXXXXXXXXXXXXXXXXX....XXXXXXXXXXXXXXXXXXXXXXXX...XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX...XXSXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXS...."
"XXXXXXXXXX...XXXXXXXXXXXXXXXXXXXXXXX....XXXXXXXXXXXXXXXXXXXXXXXX...XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX...XXSXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXS...."
```

Wrap each row in double quotes in the source. `src/level.js` (DOM-free): export `parseLevel(def)` and `isSolid(ch)` (true for chars in `SOLID`), `tileAt(level, tx, ty)` (returns `'.'` for ty<0; `'X'` for tx<0, tx≥cols, ty≥ROWS; else `tiles[ty][tx]`). `parseLevel`: build the mutable 2D `tiles` array from `map`; scan markers — `H` at (tx,ty) → `playerSpawn = {x: tx*16+2, y: (ty+1)*16-12}`; `T` → `enemies.push({type:'turnip', x: tx*16+2, y: (ty+1)*16-12})`; `F` → `boss = {x: tx*16+4, y: (ty+1)*16-28}`; `C` → `fruits.push({x: tx*16+4, y: ty*16+4})`; `G` → `gate = {x: tx*16, y: ty*16, row: ty}`; then set marker tiles to `'.'`. Validate (throw `Error(\`level ${def.label}: …\`)`): `map.length === ROWS`, all rows same length, exactly one `H`, `count('G') + count('F') === 1`. Return `{ label, name, widthPx: cols*16, tiles, playerSpawn, enemies, boss, fruits, gate, bumps: [] }`.

### Step 7 — `src/items.js`

DOM-free. Export classes/factories:

- `makeFruit(x, y)` → `{ kind:'fruit', x, y, t:0 }`; update: `t += dt`, frame = `Math.floor(t*8) % 4`.
- `makeBerry(x, y)` → `{ kind:'berry', x, y, vx:BERRY_SPEED, vy:0, t:0, onGround:false }`; update: gravity, horizontal move + wall check (reverse vx at wall), vertical move + ground check against `tileAt`; `t += dt`, remove when `t > BERRY_LIFE`.
- `makePop(x, y, what)` → `{ kind:'pop', x, y, what:'fruit'|'berry', t:0 }` — pure visual: sprite rises 16 px over 0.25 s (remove after).
- `makeShards(x, y)` → 4 `{ kind:'shard', x, y, k, t:0 }` — per-shard velocity (`k=0..3`: dx ±40..±90, dy −160..−220), gravity 600, remove at `t>0.5`.
- `makePopup(x, y, text)` → `{ kind:'popup', x, y, text, t:0 }` — rise 20 px over 0.6 s, remove after.
- `updateItems(list, dt, level)` — mutates the array in place (filter removed).

### Step 8 — `src/enemy.js`

DOM-free. Export:

- `makeTurnip(spawn)` → `{ type:'turnip', x, y, vx:-ENEMY_SPEED, vy:0, w:12, h:12, onGround:false, active:false, squashed:false, squashT:0, t:0 }`.
- `updateTurnip(e, dt, level, camX, player)`: if `!e.squashed && !e.active && e.x < camX + VIEW_W + 32` → `e.active = true`; if not active → return. If `squashed`: `squashT += dt`, remove when `> 0.4` (caller filters). Else: gravity + MAX_FALL; horizontal move with wall resolution (on wall hit `vx = -vx`); vertical move + ground; edge check: if `onGround` and `tileAt(level, frontFootTileX, Math.floor((e.y + e.h + 1) / 16)) === '.'` (front = sign of vx) → `vx = -vx`; `t += dt`, frame = `Math.floor(t*4) % 2`.
- `makeBoss(spawn)` → `{ type:'boss', x, y, vx:BOSS_SPEED, vy:0, w:28, h:28, onGround:false, active:false, hurtT:0, hopT:0, defeated:false, defeatT:0, t:0 }`.
- `updateBoss(b, dt, level, camX, player)`: activate like turnip; if `defeated`: `defeatT += dt` (caller ends game at 1.5 s); return. Walk + wall reverse; gravity/ground; `hopT += dt`; if `onGround && hopT > BOSS_HOP_COOLDOWN && !player.dead && Math.abs(player.x - b.x) < BOSS_HOP_RANGE && Math.abs(player.y - b.y) < 48`: `vy = BOSS_HOP_VY`, `vx = Math.sign(player.x - b.x) * 60 || BOSS_SPEED`, `hopT = 0`; `hurtT = max(0, hurtT - dt)`; `t += dt`, frame = `Math.floor(t*3) % 2`.
- Tile collision helpers: implement locally as `moveX(e, dt, level)` / `moveY(e, dt, level)` (same axis-separated clamp logic as player; entities have `w`,`h`).
- Stomp decision lives in main (see step 11).

### Step 9 — `src/player.js`

DOM-free. Export `makePlayer(x, y)` → `{ x, y, vx:0, vy:0, w:12, h:12, facing:1, big:false, onGround:false, coyoteT:0, bufferT:0, invulnT:0, dead:false, deadT:0, deadPit:false, headBump:null, jumped:false, t:0 }` and `updatePlayer(p, dt, input, level)`:

- If `p.dead`: `p.deadT += dt`; if not `deadPit`: `p.vy += GRAVITY*dt; p.y += p.vy*dt` (no collision); return.
- `p.headBump = null`.
- Horizontal: `target = (input.left? -1:0) + (input.right? 1:0)`; `maxSpeed = input.run ? RUN_MAX : WALK_MAX`; if `target !== 0`: `p.facing = target`; accel = `p.onGround ? ACCEL : AIR_ACCEL`; move vx toward `target*maxSpeed` by `accel*dt`, clamped to ±maxSpeed. Else: friction (grounded `FRICTION`, air 200) toward 0.
- Jump: if `input.jumpPressed` → `p.bufferT = JUMP_BUFFER`. If `p.onGround` → `p.coyoteT = COYOTE` else `p.coyoteT -= dt`. If `p.bufferT > 0 && p.coyoteT > 0`: `p.vy = JUMP_VY; p.bufferT = 0; p.coyoteT = 0; p.onGround = false; p.jumped = true; p.jumpCut = false;` (main reads `jumped`, plays SFX, clears it). If `!input.jump && !p.jumpCut && p.vy < JUMP_CUT_VY` → `p.vy = JUMP_CUT_VY; p.jumpCut = true;`.
- `p.bufferT -= dt` (floor 0); `p.vy = min(p.vy + GRAVITY*dt, MAX_FALL)`.
- Move + resolve axis-separated vs `tileAt` (same clamp logic as `moveX/moveY` in enemy.js, inlined here): x-pass sets `p.vx = 0` on wall; y-pass: landing sets `onGround = true`; ceiling hit while `vy < 0` → record `p.headBump = { x: tx, y: ty }` for the bumped tile (prefer the tile with most x-overlap among the overlapping row), `p.vy = 0`.
- `p.invulnT = max(0, p.invulnT - dt)`; `p.t += dt`.
- Export `hurtPlayer(p)`: if `p.invulnT > 0 || p.dead` → return `false`; if `p.big`: `p.big = false; p.h = 12; p.y += 14; p.invulnT = INVULN_TIME; return true`. Else: `p.dead = true; p.deadT = 0; p.vy = -400; return true`.
- Export `killPlayer(p, pit)`: if not dead: `p.dead = true; p.deadT = 0; p.deadPit = pit; if (!pit) p.vy = -400;` (pit callers set `deadPit=true` and skip the pop-up).
- Render pose: `pose = p.dead ? 'jump' : (!p.onGround ? 'jump' : (Math.abs(p.vx) > 10 ? 'run' : 'idle'))`, `frame = pose==='run' ? Math.floor(p.t*10) % 2 : 0`.

### Step 10 — `src/camera.js` + `src/render.js`

`src/camera.js` (DOM-free): export `makeCamera()` → `{ x: 0 }` and `updateCamera(cam, dt, player, levelW)`: `target = player.x - 96`; rate = `target > cam.x ? 10 : 14`; `cam.x += (target - cam.x) * Math.min(1, rate * dt)`; clamp `cam.x` to `[0, levelW - VIEW_W]`; round to integer on render (render uses `Math.floor(cam.x)`).

`src/render.js`: export `render(ctx, g)` where `g` is the game state object from main (fields: `state, level, player, enemies, items, cam, score, fruitCount, lives, levelIndex, clearT, bannerT, winT, overT, muted`). `const camX = Math.floor(g.cam.x)`. Order:

1. Sky: fill `PALETTE.sky` full 256×240.
2. Parallax hills: for `i` over the visible range at 96 px steps of `camX*0.25` scroll: `drawHill` alternating `hillFar` (r 40, base y 150) / `hillNear` (r 28, base y 168) with ±8 height variance from a hash of `i`.
3. Clouds (0.5× parallax, 128 px steps, y from hash 20–70) + bushes (0.5×, 160 px steps) near the ground line; simple, drawn behind tiles.
4. Tiles: `tx0 = floor(camX/16)` to `tx0+16`: for `ty` 0..14, `ch = level.tiles[ty][tx]`: skip `'.'`; `X` → `drawGround(x, y, tile above non-solid)`; `S` → `drawStone`; `B` → `drawBrick` (offset y by −4·sin(π·t/0.15) if in `level.bumps`); `P`/`Q` → `drawPumpkin(x, y, false)` (same bump offset); `U` → `drawPumpkin(x, y, true)`; `=` → `drawPlatform`; `|` → `drawPipe(x, y, tileAbove !== '|', isLeftColumn)`.
5. Gate (if `level.gate`): `drawGate` at the gate tile.
6. Items: per `kind`: fruit → `drawFruit` (frame `floor(t*8)%4`); berry → `drawBerry`; pop → sprite at `y − 16·(t/0.25)`; shard → `drawShard`; popup → `drawPixelText(text, x, y − 20·(t/0.6), '#ffffff')`.
7. Enemies: turnip → `drawTurnip(x, y, frame, facing)` (squashed: 12×4 flat at bottom of hitbox); boss → `drawBoss(…, hurt: b.hurtT > 0)`; defeated boss: 3-frame flip spin while falling.
8. Player: skip if `dead && deadPit`; blink: skip drawing on odd `Math.floor(t*8)%2` while `invulnT > 0`; else `drawHero(x, y, facing, big, pose, frame)`.
9. HUD (PLAYING/PAUSED/LEVEL_CLEAR): `drawPixelText('SCORE ' + String(score).padStart(6,'0'), 8, 6, '#1a1a1a')`; Sunfruit icon (drawFruit frame 0) at (8, 18) + `'x' + padStart(2)` count; `'WORLD ' + level.label` centered; Poppy mini icon + `'x' + lives` right side; `'MUTED'` far right when `g.muted`.
10. State overlays:
   - TITLE: ground strip (`drawGround` row at y 208 across), `drawPixelText('VEGGIE BROS.', 29, 60, '#e8434f', 3)` (11 chars × 18 px = 198 wide, centered), subtitle `'A STRAWBERRY S ADVENTURE'` scale 1 centered y 110, `'PRESS ENTER TO START'` blinking at 2 Hz y 150, controls scale 1: `'< > / A D  MOVE   SHIFT RUN'` y 180 and `'SPACE / Z  JUMP  P PAUSE  M MUTE'` y 194; draw hero + turnip sprites standing on the strip.
   - PAUSED: `rgba(0,0,0,0.5)` full rect + `'PAUSED'` scale 2 centered y 96 + `'P RESUME  R RESTART  M MUTE'` y 140.
   - LEVEL_CLEAR: `'STAGE CLEAR'` scale 2 centered y 96 + `'+1000'` y 124.
   - WIN: `'HARVEST SAVED!'` scale 2 y 80, `'SCORE ' + score` y 120, `'PRESS ENTER'` y 150.
   - GAME_OVER: `'GAME OVER'` scale 2 y 80 (red), `'SCORE ' + score` y 120, `'PRESS ENTER'` y 150.
   - Level banner: if `bannerT > 0` (PLAYING): centered `'WORLD ' + label + ' — ' + name.toUpperCase()`, `ctx.globalAlpha = min(1, bannerT)`.
   - Clear fade: during the last 0.5 s of LEVEL_CLEAR, white full rect with `globalAlpha` ramping to 1.

### Step 11 — `src/main.js`

Entry module (the only module that starts anything):

- Get `#game` canvas, `ctx = canvas.getContext('2d')`, `ctx.imageSmoothingEnabled = false`.
- Fit: `function fit()` — `s = clamp(Math.floor(Math.min(innerWidth/VIEW_W, innerHeight/VIEW_H)), 1, 4)`; `canvas.style.width = VIEW_W*s + 'px'`; same for height; `window.addEventListener('resize', fit)`; call once.
- `setupKeyboard()`, `setupTouch()`.
- Game state:
```js
const G = { state:'TITLE', score:0, fruitCount:0, lives:START_LIVES, levelIndex:0, level:null, player:null, enemies:[], items:[], cam:{x:0}, clearT:0, bannerT:0, winT:0, overT:0, dyingT:0, gateScored:false };
```
- `loadLevel(i)`: `G.level = parseLevel(LEVELS[i])`; build enemies via `makeTurnip`/`makeBoss` from spawns; fruits via `makeFruit`; `G.player = makePlayer(spawn.x, spawn.y)`; `G.cam = { x: 0 }`; `G.items = []; G.bannerT = 1.5; G.gateScored = false`.
- `startGame()`: `G.score = 0; G.fruitCount = 0; G.lives = START_LIVES; loadLevel(0); G.state = 'PLAYING'; audio.init(); audio.musicStart();`.
- `addScore(n, x, y)`: `G.score += n; G.items.push(makePopup(x, y, '+' + n))`.
- `onDeathResolved()`: `G.lives -= 1; if (G.lives <= 0) { G.state = 'GAME_OVER'; G.overT = 0; audio.musicStop(); } else { loadLevel(G.levelIndex); }`.
- `onGate()`: `G.state = 'LEVEL_CLEAR'; G.clearT = 0; G.gateScored = true; G.score += SCORE.gate; audio.musicStop(); audio.sfx('clear'); G.player.vx = 0; G.player.vy = 0;`.
- `onBossDown()`: `G.state = 'WIN'; G.winT = 0; G.score += SCORE.bossDown; audio.musicStop(); audio.sfx('win');`.
- `update(dt)`:
  - Always: `if (consumeMute()) audio.toggleMute();`
  - TITLE: `if (consumeStart()) startGame();`
  - PLAYING:
    - If `G.player.dead`: `G.dyingT += dt`; `updatePlayer(G.player, dt, input, G.level)` (death fall); if `G.dyingT > 1.2` → `onDeathResolved(); G.dyingT = 0;` return.
    - Else: `updatePlayer(p, dt, input, G.level)`; if `p.jumped` → `audio.sfx('jump'); p.jumped = false;`.
    - `updateCamera(G.cam, dt, p, G.level.widthPx)`.
    - `updateItems(G.items, dt, G.level)`; decay `G.level.bumps` (`t += dt`, filter `t > 0.15`).
    - Enemies: turnip → `updateTurnip`, boss → `updateBoss`; filter removed (squashed expired). If boss `defeated` and `defeatT > 1.5` → `onBossDown(); return;`.
    - Fruit pickup: AABB overlap (player vs 8×8 fruit box) → `G.fruitCount++; addScore(SCORE.fruit, f.x, f.y); audio.sfx('coin');` remove.
    - Berry pickup: overlap 14×14 → `addScore(SCORE.berry, …); audio.sfx('power'); if (!p.big) { p.big = true; p.h = 26; p.y -= 14; }` remove.
    - Head bump: if `p.headBump` → `{x: tx, y: ty}`, `ch = G.level.tiles[ty][tx]`:
      - `'P'` → `tiles = 'U'; G.items.push(makePop(tx*16+4, ty*16-16, 'fruit')); G.fruitCount++; addScore(SCORE.fruit, tx*16+4, ty*16); audio.sfx('coin');`
      - `'Q'` → `tiles = 'U'; G.items.push(makePop(tx*16+4, ty*16-16, 'berry')); G.items.push(makeBerry(tx*16+1, ty*16-16)); addScore(SCORE.berry, tx*16+4, ty*16); audio.sfx('power');`
      - `'B'` + `p.big` → `tiles = '.'; G.items.push(makeShards(tx*16+4, ty*16+6)); addScore(SCORE.block, tx*16+4, ty*16); audio.sfx('break');`
      - `'B'` + small → `G.level.bumps.push({x: tx, y: ty, t: 0}); audio.sfx('bump');`
    - Turnip collision: for each active, not-squashed turnip with AABB overlap: if `p.vy > 0 && (p.y + p.h) - e.y < 10` → `e.squashed = true; e.squashT = 0; addScore(SCORE.stomp, e.x, e.y); audio.sfx('stomp'); p.vy = STOMP_BOUNCE; p.onGround = false;` else if `hurtPlayer(p)` → `audio.sfx('hurt'); if (p.dead) { G.dyingT = 0; audio.musicStop(); audio.sfx('die'); }`.
    - Boss collision: same stomp rule against the top 10 px of the boss: `b.hp -= 1; b.hurtT = 1.0; addScore(SCORE.bossHit, b.x, b.y); audio.sfx('bossHit'); p.vy = STOMP_BOUNCE; if (b.hp <= 0) { b.defeated = true; b.defeatT = 0; b.vx = 0; }`; side contact → `hurtPlayer` path (same as turnip).
    - Gate: if `G.level.gate && !G.gateScored && p.x + p.w > G.level.gate.x && p.x < G.level.gate.x + 32 && p.y + p.h > G.level.gate.y && p.y < G.level.gate.y + 80` → `onGate()`.
    - Pit: if `p.y > VIEW_H + 32` → `killPlayer(p, true); G.dyingT = 0; audio.musicStop(); audio.sfx('die');`.
    - `G.bannerT = max(0, G.bannerT - dt)`.
    - `if (consumePause()) { G.state = 'PAUSED'; audio.musicStop(); }`
  - PAUSED: `if (consumePause()) { G.state='PLAYING'; audio.musicStart(); }`; `if (consumeRestart()) { loadLevel(G.levelIndex); G.state='PLAYING'; audio.musicStart(); }`
  - LEVEL_CLEAR: `G.clearT += dt`; slide: `G.player.y = min(G.player.y + 120*dt, (G.level.gate.row + 1) * 16 - G.player.h)`; if `G.clearT > 1.4` → `G.levelIndex += 1; loadLevel(G.levelIndex); G.state = 'PLAYING'; audio.musicStart();`
  - WIN / GAME_OVER: `winT/overT += dt`; `if (consumeStart()) G.state = 'TITLE';`
- Loop:
```js
let last = performance.now(); let acc = 0;
function frame(now) {
  let dt = (now - last) / 1000; last = now;
  if (dt > 0.25) dt = 0.25;
  acc += dt;
  while (acc >= STEP) { update(STEP); acc -= STEP; }
  render(ctx, G);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
```
- `rectOverlap(a, b)`: standard AABB test (a/b have x, y, w, h).

### Step 12 — `README.md`

Content: title **Veggie Bros.**; one-line description; **Run** (no install needed): from repo root, `python3 -m http.server 8000`, open `http://localhost:8000` (alternative: `npx serve .`); **Controls** table (←/→ or A/D move · Shift run · Space/Z/W/↑ jump · Enter start/confirm · P/Esc pause · R restart level while paused · M mute; touch buttons appear on small/touch screens); **Goal**: collect Sunfruit, stomp Turnip Troopers, grow with the Mega Berry, reach the Melon Gate at the end of 1-1 and 1-2, defeat Bromely the Pineapple King in 1-3; **Structure**: pointer to `architecture.md`.

---

## Critical files & anchors

- `src/levels.js` — the three map arrays are the exact validated strings above; a single bad character breaks gameplay. Copy verbatim, one string literal per row.
- `src/player.js` — axis-separated tile resolution + `headBump` reporting + coyote/buffer/jump-cut is the core game feel; `enemy.js`/`items.js` reuse the same `moveX/moveY` clamp pattern.
- `src/main.js` — state machine + interaction ordering (fruits → berry → head-bump → enemies → gate → pit). Death is `dyingT` inside PLAYING, not a separate state.
- `src/level.js` — `parseLevel` validation + `tileAt` out-of-bounds rule (solid left/right/below, air above) is load-bearing for every collider.
- `src/audio.js` — lazy `init()` on first Enter (autoplay policy); every call must no-op safely when not initialized.

## Verification

All from repo root `/Users/jasonjordan/repos/veggie_bros`.

1. **Syntax** (after each step, and once at the end): `for f in src/*.js; do node --input-type=module --check < "$f" || echo "FAIL $f"; done` → no FAIL lines.
2. **Level smoke test** (throwaway script in `/tmp`, NOT the repo): a Node ESM script importing `src/levels.js` + `src/level.js` (both DOM-free) that parses all 3 levels and asserts: `tiles.length === 15`; all rows same length (180/200/160); `playerSpawn` set; exactly one of `gate`/`boss`; rightmost column all non-`'.'`; ground reachability — for the lowest standing surface per column, consecutive rises ≤ 4 tiles and no ground gap wider than 4 columns. Expected: all assertions pass, silent. (The maps as written satisfy these — they were validated during planning; if one fails, fix the map in `levels.js` to satisfy the invariant, do not loosen the checker.)
3. **Browser end-to-end**: `python3 -m http.server 8000` (background) → open `http://localhost:8000` in a browser tab.
   - Title screen: "VEGGIE BROS." logo, controls listed, no console errors.
   - Enter → level 1-1 "Strawberry Fields" banner, player visible, music playing.
   - Walk/jump/run responsive; jump onto the first Melon Pipe (480 px from level start).
   - Hit the Pumpkin Block at x=16 from below → Sunfruit pop, +100, block turns used.
   - Stomp a Turnip Trooper → +200, squash.
   - Collect the Mega Berry from the Q-block at x=110 → Poppy grows; as big, head-bump the Pebble Brick at x=112 → it breaks, +50.
   - Touch a turnip as small (or fall in a gap) → lose a life, respawn at level start in small form with score kept.
   - Reach the Melon Gate at x=165 → slide + "STAGE CLEAR" → level 1-2 loads.
   - Clear 1-2 → level 1-3 "Pineapple Palace"; in the arena, stomp Bromely 3 times (he flashes white per hit) → WIN screen with total score; Enter → title.
   - P → PAUSED overlay (R restarts level, M shows `MUTED` in HUD); 0 lives → GAME OVER screen → Enter → title.
   - DevTools device mode (or narrow window) → touch buttons appear and drive movement/jump.
4. Kill the http server when done.

## Assumptions & contingencies

- Stack, audio, and 3-level scope are the user's confirmed choices (recorded above).
- No time limits, no per-level checkpoints, no save persistence — requirements ask only for lives/retry + score; do not add these.
- If `AudioContext` construction fails (no WebAudio), the game must run silently; `audio.js` no-ops already guarantee this — do not add audio guards to other modules.
- Boss difficulty: stomp window is the top 10 px of the 28-px hitbox with a −360 bounce; if it proves impossible in browser testing, increase that 10 px to 14 — do not change boss speed or HP.
- Very small windows: scale clamps to 1× (no fractional scaling).
- Touch layout is a "nice to have" per requirements; if the fixed-overlay buttons overlap gameplay on a tested device, adjust the existing CSS button sizes — do not redesign the input system.
