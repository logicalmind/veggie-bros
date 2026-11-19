import {
  ART_SCALE,
  CHECKPOINT_TRIGGER_BOTTOM,
  CHECKPOINT_TRIGGER_TOP,
  CHECKPOINT_TRIGGER_W,
  GROW_H,
  INVULN_TIME,
  PLAYER_BIG_H,
  ROWS,
  SCORE,
  START_LIVES,
  STEP,
  STOMP_BOUNCE,
  TILE,
  VIEW_H,
  VIEW_W,
} from './config.js';
import { LEVELS } from './levels.js';
import { isSolid, parseLevel, tileAt } from './level.js';
import { makeBoss, makeTurnip, updateBoss, updateTurnip } from './enemy.js';
import { BERRY_H, BERRY_W, makeBerry, makeFruit, makePop, makePopup, makeShards, updateItems } from './items.js';
import { hurtPlayer, killPlayer, makePlayer, updatePlayer } from './player.js';
import { CAMERA_FOLLOW_X, makeCamera, updateCamera } from './camera.js';
import { render } from './render.js';
import { bakeSprites } from './sprites.js';
import { init as initFx, update as updateFx } from './fx.js';
import {
  consumeJumpPressed,
  consumeMute,
  consumePause,
  consumeRestart,
  consumeStart,
  input,
  setupKeyboard,
  setupTouch,
} from './input.js';
import { audio } from './audio.js';
import { configure as configureComposite, layers as compositeLayers, layout as compositeLayout } from './composite.js';

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
ctx.imageSmoothingEnabled = false;

const SCALE_MIN = 1;
const SCALE_MAX = 4;
const SCALE_STEP = 0.5; // phones fall back to half-steps, desktop keeps whole scales
const TOUCH_BAR_H = 80; // the fixed #touch bar covers this much height on touch devices
const PHONE_MIN_SCALE = 1.5; // below this a phone gets a ~2mm hero, so the bar yields instead
const CRISP_MIN_SCALE = 1.4; // a whole scale this big is always preferred over a half-step

function fit() {
  // On touch devices the canvas must not compete with the control bar, but a short
  // landscape screen cannot spare the whole bar — then it just overlays it.
  const bar = matchMedia('(any-pointer: coarse)').matches
    ? Math.min(TOUCH_BAR_H, Math.max(0, innerHeight - VIEW_H * PHONE_MIN_SCALE))
    : 0;
  const r = Math.min(innerWidth / VIEW_W, (innerHeight - bar) / VIEW_H);
  const whole = Math.floor(r);
  const halfStep = Math.floor(r / SCALE_STEP) * SCALE_STEP;
  const s = Math.min(SCALE_MAX, Math.max(SCALE_MIN, whole >= CRISP_MIN_SCALE ? whole : halfStep));
  const cssW = VIEW_W * s;
  const cssH = VIEW_H * s;
  canvas.style.width = cssW + 'px';
  canvas.style.height = cssH + 'px';
  // §4: the BACKING STORE is the composite's number, never arithmetic re-derived here. `configure`
  // owns the dpr clamp and the MAX_BACKING_PX cap, and it returns the same table `layers()` allocates
  // from, so `upscale` and the backing store cannot disagree about k — a re-derived `cssW * dpr` here
  // would be a second sizing authority and would silently down/up-scale the final blit on a capped
  // display. `window.` is load-bearing: the harness pins devicePixelRatio on the window proxy only.
  const dpr = Math.min(3, Math.max(1, window.devicePixelRatio || 1));
  const lay = configureComposite(cssW, cssH, dpr);
  canvas.width = lay.backing.w;
  canvas.height = lay.backing.h;
  // Resizing a canvas RESETS its 2D context state, and :41's nearest-neighbour flag is the shipped
  // look — re-arm it here, or the first resize after boot turns pass 2 into a bilinear smear.
  ctx.imageSmoothingEnabled = false;
}
window.addEventListener('resize', fit);
fit();

setupKeyboard();
setupTouch();

// Boot, not frame 1: `sprites.js:867 ensure()` bakes lazily today, so the atlas bake (27 ms
// measured in-browser at ART_SCALE 2; the doc's 14–19 ms does not reproduce) lands inside the
// first rendered frame, and R48 (S-13) would count a bake call there — it expects exactly one
// bake per boot. `initFx()` allocates the particle pool once, per §6's "allocated once at
// boot", instead of inside the first `fx.update`.
// Terrain stays out of main.js: `render.js:58 worldFor()` owns the once-per-level plan bake
// and the level→theme mapping, so duplicating either here would be a second convention.
bakeSprites(ART_SCALE);
initFx();

// The single mutable game state. It is exported as a deliberate test seam: tools/verify.mjs
// imports { G } and drives the game by reading and writing it, so do not un-export it.
export const G = {
  state: 'TITLE',
  score: 0,
  fruitCount: 0,
  lives: START_LIVES,
  levelIndex: 0,
  level: null,
  player: null,
  enemies: [],
  items: [],
  cam: makeCamera(),
  clearT: 0,
  bannerT: 0,
  winT: 0,
  overT: 0,
  dyingT: 0,
  gateScored: false,
  // The shared left authority. checkpointX is the furthest flag the hero has banked and
  // checkpointIndex its slot in level.checkpoints (-1 = none yet), so the camera floor, the
  // player clamp and the death respawn all read one pair instead of three copies of it.
  checkpointX: 0,
  checkpointIndex: -1,
  muted: false,
};

function loadLevel(i) {
  G.levelIndex = i;
  G.level = parseLevel(LEVELS[i]);
  G.enemies = G.level.enemies.map(makeTurnip);
  if (G.level.boss) G.enemies.push(makeBoss(G.level.boss));
  G.items = G.level.fruits.map((f) => makeFruit(f.x, f.y));
  G.player = makePlayer(G.level.playerSpawn.x, G.level.playerSpawn.y);
  G.cam = makeCamera();
  G.bannerT = 1.5;
  G.gateScored = false;
  G.checkpointX = 0;
  G.checkpointIndex = -1;
  // Per-level like the rest. Every kill site zeroes it and the death branch zeroes it again when
  // a death resolves, so today it is always 0 on entry — but a future kill path that forgets to
  // would be handed a stale clock and the fresh level's FIRST frame would resolve the death,
  // skipping the death arc.
  G.dyingT = 0;
}

function startGame() {
  G.score = 0;
  G.fruitCount = 0;
  G.lives = START_LIVES;
  loadLevel(0);
  G.state = 'PLAYING';
  audio.init();
  audio.musicStart();
}

function addScore(n, x, y) {
  G.score += n;
  G.items.push(makePopup(x, y, '+' + n));
}

// The one place the left authority is turned into numbers. The hero's floor is the flag itself
// and the camera's floor is that minus CAMERA_FOLLOW_X, its steady-state lead: so a hero held
// against a checkpoint sits at screen x 96, the same place it stands while running, rather than
// being shoved to the left edge of the view. Both consumers must call this — if the two floors
// ever disagreed the hero could be pinned offscreen or the camera could outrun the clamp.
function checkpointBounds() {
  const x = Math.max(0, G.checkpointX);
  return { playerX: x, camX: Math.max(0, x - CAMERA_FOLLOW_X) };
}

function onDeathResolved() {
  G.lives -= 1;
  if (G.lives <= 0) {
    G.state = 'GAME_OVER';
    G.overT = 0;
    audio.musicStop();
  } else {
    respawnAtCheckpoint();
    // The kill sites stopped the loop so the die jingle plays alone, and this is the only way
    // back into PLAYING that does not go through a state branch (startGame, the pause
    // transitions and LEVEL_CLEAR all restart it themselves). It sits after the call, not inside
    // respawnAtCheckpoint(): that function returns early on its no-checkpoint fallback, and a
    // restart it never reached would leave that — the common, first-death — path silent.
    audio.musicStart();
  }
}

// Death puts the hero back at the last flag it banked. loadLevel() re-parses the map, which
// rebuilds level.checkpoints with nothing taken and the player at the H spawn, so the checkpoint
// state is captured, the level is rebuilt underneath it, and only then re-applied. With no flag
// banked this is exactly the old full-level restart, banner and all.
function respawnAtCheckpoint() {
  const x = G.checkpointX;
  const index = G.checkpointIndex;
  loadLevel(G.levelIndex);
  // loadLevel() has just cleared the pair to 0/-1, so an index that cannot be resolved — nothing
  // banked, or a slot the rebuilt level does not have — falls back to that plain restart instead
  // of throwing on cp.row from inside the death handler.
  if (index < 0 || index >= G.level.checkpoints.length) return;
  G.checkpointX = x;
  G.checkpointIndex = index;
  for (const cp of G.level.checkpoints) {
    if (cp.x <= x) cp.taken = true;
  }
  const cp = G.level.checkpoints[index];
  const p = G.player;
  p.x = x;
  // same standing-surface convention as level.js's spawn formula and main.js's gate slide
  p.y = (cp.row + 1) * 16 - p.h;
  p.vx = 0;
  p.vy = 0;
  p.prevBottom = p.y + p.h;
  p.prevX = p.x; // the respawn is the hero's last accepted position too, not the H spawn it came from
  // The flagpost cells were never authored as safe ground — in shipped 1-1 a turnip patrol is
  // already on its way to the second one — so the hero gets the same grace a hit grants, from the
  // same constant. The no-checkpoint path above deliberately still has none: the classic spawn is
  // untouched.
  p.invulnT = INVULN_TIME;
  // loadLevel() raised the WORLD x-y intro banner, which here reads as "stage restarted" right
  // next to a resume the player did not ask for. Only this path takes it back.
  G.bannerT = 0;
  G.cam.x = checkpointBounds().camX;
}

function onGate() {
  G.state = 'LEVEL_CLEAR';
  G.clearT = 0;
  G.gateScored = true;
  G.score += SCORE.gate;
  audio.musicStop();
  audio.sfx('clear');
  G.player.vx = 0;
  G.player.vy = 0;
}

// Shared WIN transition. It is deliberately not the same function as onBossDown(): a gate
// walked into on the last level also ends the run, and that player has not beaten a boss, so
// routing them through onBossDown() would pay out SCORE.bossDown for touching an arch.
function goWin() {
  G.state = 'WIN';
  G.winT = 0;
  audio.musicStop();
  audio.sfx('win');
}

function onBossDown() {
  G.score += SCORE.bossDown;
  goWin();
}

function rectOverlap(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

// A berry only grows the hero when the taller box actually fits. The extra height it needs
// beyond the small box is the band [y - GROW_H, y), so if any tile there is solid the grown
// box is buried, the next X pass ejects the hero a whole tile sideways to untangle it, and no
// headBump is ever reported. In a 1-tile-high tunnel the grown box can never fit and the only
// way back down is taking a hit, so refusing the pickup is the one honest option.
const GROW_EPS = 0.001; // skip tiles only touched at an exact edge, as player.js does

function hasGrowHeadroom(p, level) {
  const tx0 = Math.floor(p.x / TILE);
  const tx1 = Math.floor((p.x + p.w - GROW_EPS) / TILE);
  const ty0 = Math.floor((p.y - GROW_H) / TILE);
  const ty1 = Math.floor((p.y - GROW_EPS) / TILE);
  for (let ty = ty0; ty <= ty1; ty++) {
    for (let tx = tx0; tx <= tx1; tx++) {
      if (isSolid(tileAt(level, tx, ty))) return false;
    }
  }
  return true;
}

// The gate's trigger band is the arch its art actually draws, so these numbers come from
// sprites.js drawGate(): a 2-tile-wide gate whose posts run from gate.y - 64 to gate.y + 16.
// gate.y is the top of the gate's ground tile, not the top of the arch, so the old rect
// (gate.y .. gate.y + 80) caught only the bottom of the art and hung 64 px below the floor.
const GATE_W = TILE * 2;
const GATE_TRIGGER_TOP = TILE * 4;
const GATE_TRIGGER_BOTTOM = TILE;

// The one-shot flags on `input` are frame-scoped: the consume*() helpers stay the authority
// for reads, and endFrame() only guarantees that a flag never survives a frame it was not
// consumed in. Otherwise a jump pressed while paused fires on the resume frame, a single R
// press latches until the next pause restarts the level, and Enter held from play snaps
// GAME_OVER/WIN straight back to TITLE. Held-direction flags are deliberately absent here:
// they belong to the input layer, not to a frame.
const TRANSIENT_INPUT = ['jumpPressed', 'start', 'pausePressed', 'mutePressed', 'restartPressed'];

function endFrame() {
  for (const flag of TRANSIENT_INPUT) input[flag] = false;
}

// try/finally instead of an endFrame() call on each of the state machine's return paths
// (dead branch, R04's death-frame return, onGate/onBossDown, every state branch), so a new
// early return cannot reintroduce a leak.
function update(dt) {
  try {
    updateState(dt);
  } finally {
    endFrame();
  }
}

function updateState(dt) {
  if (consumeMute()) {
    audio.toggleMute();
    G.muted = audio.muted;
  }

  if (G.state === 'TITLE') {
    if (consumeStart()) startGame();
    return;
  }

  if (G.state === 'PLAYING') {
    const p = G.player;
    const bounds = checkpointBounds();

    if (p.dead) {
      G.dyingT += dt;
      updatePlayer(p, dt, input, G.level, bounds.playerX);
      consumeJumpPressed();
      if (G.dyingT > 1.2) {
        onDeathResolved();
        G.dyingT = 0;
      }
      return;
    }

    updatePlayer(p, dt, input, G.level, bounds.playerX);
    consumeJumpPressed();
    if (p.jumped) {
      audio.sfx('jump');
      p.jumped = false;
    }

    updateCamera(G.cam, dt, p, G.level.widthPx, bounds.camX);

    updateItems(G.items, dt, G.level);
    for (const b of G.level.bumps) b.t += dt;
    G.level.bumps = G.level.bumps.filter((b) => b.t <= 0.15);

    const camX = Math.floor(G.cam.x);
    let boss = null;
    for (const e of G.enemies) {
      if (e.type === 'boss') {
        boss = e;
        updateBoss(e, dt, G.level, camX, p);
      } else {
        updateTurnip(e, dt, G.level, camX);
      }
      // The same line the player's pit check uses below: tileAt() reports solid ground
      // below the map, so anything whose feet reach the bottom edge line (ROWS * TILE) has
      // fallen into a gap and would otherwise patrol that hidden floor forever — on the last
      // drawn row, and lethal. Checked after the update (updateTurnip/updateBoss return early
      // once an entity trails the camera, so a pre-update check could never run again) and
      // before the dead-filter, so the squashed/defeated retirement above still gets its frames.
      if (e.y + e.h >= ROWS * TILE) {
        if (e.type === 'boss') {
          // A boss must not simply vanish: 1-3 has no gate, so a boss removed here could
          // never be beaten again and the run would be unwinnable. Retire it exactly as a
          // stomp at hp 0 does (and only once — resetting defeatT every frame would stall
          // the win path below forever) so falling in a pit still ends the fight.
          if (!e.defeated) {
            e.defeated = true;
            e.defeatT = 0;
            e.vx = 0;
          }
        } else {
          e.dead = true;
        }
        continue;
      }
    }
    G.enemies = G.enemies.filter((e) => !e.dead);
    if (boss && boss.defeated && boss.defeatT > 1.5) {
      onBossDown();
      return;
    }

    for (let i = G.items.length - 1; i >= 0; i--) {
      const it = G.items[i];
      if (it.kind === 'fruit' && rectOverlap(p, { x: it.x, y: it.y, w: 8, h: 8 })) {
        G.fruitCount++;
        addScore(SCORE.fruit, it.x, it.y);
        audio.sfx('coin');
        G.items.splice(i, 1);
      }
    }

    for (let i = G.items.length - 1; i >= 0; i--) {
      const it = G.items[i];
      if (it.kind === 'berry' && rectOverlap(p, { x: it.x, y: it.y, w: BERRY_W, h: BERRY_H })) {
        // No headroom, no growth: the berry stays in G.items so it can still be picked up
        // later under a real gap in the ceiling, instead of burying the hero in the block above.
        if (!p.big && !hasGrowHeadroom(p, G.level)) continue;
        addScore(SCORE.berry, it.x, it.y);
        audio.sfx('power');
        if (!p.big) {
          p.big = true;
          p.h = PLAYER_BIG_H;
          p.y -= GROW_H;
        }
        G.items.splice(i, 1);
      }
    }

    if (p.headBump) {
      const tx = p.headBump.x;
      const ty = p.headBump.y;
      const ch = G.level.tiles[ty][tx];
      if (ch === 'P') {
        G.level.tiles[ty][tx] = 'U';
        G.items.push(makePop(tx * 16 + 4, ty * 16 - 16, 'fruit'));
        G.fruitCount++;
        addScore(SCORE.fruit, tx * 16 + 4, ty * 16);
        audio.sfx('coin');
      } else if (ch === 'Q') {
        G.level.tiles[ty][tx] = 'U';
        G.items.push(makePop(tx * 16 + 4, ty * 16 - 16, 'berry'));
        G.items.push(makeBerry(tx * 16 + 1, ty * 16 - 16));
        addScore(SCORE.berry, tx * 16 + 4, ty * 16);
        audio.sfx('power');
      } else if (ch === 'B') {
        if (p.big) {
          G.level.tiles[ty][tx] = '.';
          G.items.push(...makeShards(tx * 16 + 4, ty * 16 + 6));
          addScore(SCORE.block, tx * 16 + 4, ty * 16);
          audio.sfx('break');
        } else {
          G.level.bumps.push({ x: tx, y: ty, t: 0 });
          audio.sfx('bump');
        }
      }
    }

    for (const e of G.enemies) {
      if (e.type !== 'turnip' || !e.active || e.squashed) continue;
      if (!rectOverlap(p, e)) continue;
      // over-the-top only: legal when the feet were above the enemy's top last frame,
      // which rules out walking into its flank
      if (p.vy > 0 && p.prevBottom <= e.y + 0.5) {
        e.squashed = true;
        e.squashT = 0;
        addScore(SCORE.stomp, e.x, e.y);
        audio.sfx('stomp');
        // separate before bouncing: one bounce step lifts less than the deepest
        // first-frame overlap, so the boxes would still touch next frame with p.vy < 0
        p.y = e.y - p.h;
        p.vy = STOMP_BOUNCE;
        p.onGround = false;
      } else if (hurtPlayer(p)) {
        audio.sfx('hurt');
        if (p.dead) {
          G.dyingT = 0;
          audio.musicStop();
          audio.sfx('die');
        }
      }
    }

    if (boss && !boss.defeated && rectOverlap(p, boss)) {
      if (p.vy > 0 && p.prevBottom <= boss.y + 0.5) {
        boss.hp -= 1;
        boss.hurtT = 1.0;
        addScore(SCORE.bossHit, boss.x, boss.y);
        audio.sfx('bossHit');
        // place the player on top of the boss before bouncing, same as the stomps above, and
        // clear onGround to match them: the landing that set it this frame is over, and
        // leaving it set would refresh coyoteT next frame and hand out a free jump off a box
        // the hero is no longer standing on
        p.y = boss.y - p.h;
        p.vy = STOMP_BOUNCE;
        p.onGround = false;
        if (boss.hp <= 0) {
          boss.defeated = true;
          boss.defeatT = 0;
          boss.vx = 0;
        }
      } else if (hurtPlayer(p)) {
        audio.sfx('hurt');
        if (p.dead) {
          G.dyingT = 0;
          audio.musicStop();
          audio.sfx('die');
        }
      }
    }

    // Checkpoints advance forward only, and only one flag at a time: the scan starts after the
    // flag already banked, so a banked flag can never re-arm and nothing can move the left
    // authority backwards. Every flag at or behind the new bound is marked taken, which is the
    // same invariant the death respawn re-imposes after it rebuilds the level. Forward is also
    // meant forward on the X axis: the hero's left edge has to pass the post, judged against last
    // frame's x exactly as the stomps above judge prevBottom. Band overlap alone let a hero
    // RETREATING into an unbanked flag arm it — the floor jumped out in front of it mid-stride and
    // stopped it dead against a wall that had appeared behind it, camera floor popping right.
    //
    // It sits above the dead-return below for the same reason the gate test writes its own
    // !p.dead instead of trusting that return: a fatal hit inside an unbanked flag's band must
    // still bank the flag, or the hero loses the respawn it had already reached.
    for (let i = G.checkpointIndex + 1; i < G.level.checkpoints.length; i++) {
      const cp = G.level.checkpoints[i];
      const band = {
        x: cp.x,
        y: cp.y - CHECKPOINT_TRIGGER_TOP,
        w: CHECKPOINT_TRIGGER_W,
        h: CHECKPOINT_TRIGGER_TOP + CHECKPOINT_TRIGGER_BOTTOM,
      };
      if (!rectOverlap(p, band)) continue;
      if (!(p.prevX <= cp.x && p.x > cp.x)) continue; // not a left-to-right crossing of the post
      cp.taken = true;
      G.checkpointIndex = i;
      G.checkpointX = Math.max(G.checkpointX, cp.x);
      for (const other of G.level.checkpoints) {
        if (other.x <= G.checkpointX) other.taken = true;
      }
      // Nothing else happens here, on purpose: an arrival is silent and invisible now. The block
      // that used to sit here (fanfare + 'CHECKPOINT' popup + banner re-raise, all behind `if
      // (!p.dead)`) was feedback only; the guard existed solely to keep that feedback off the death
      // frame, so it goes with it. Arming is unchanged on EVERY frame including a fatal one — this
      // loop still runs above the dead-return, which is what R41 pins.
      break;
    }

    // a hit taken in this same frame must end the update: falling through would let
    // the corpse reach the gate (free stage clear) or the pit check below
    if (p.dead) return;

    if (G.level.gate && !G.gateScored) {
      const gate = G.level.gate;
      if (!p.dead && p.x + p.w > gate.x && p.x < gate.x + GATE_W &&
          p.y + p.h > gate.y - GATE_TRIGGER_TOP && p.y < gate.y + GATE_TRIGGER_BOTTOM) {
        onGate();
        return;
      }
    }

    // tileAt() reports solid ground below the map, so pit death is an explicit
    // height check: any player whose feet reach the map's bottom edge line
    // (ROWS * TILE) has fallen in.
    if (p.y + p.h >= ROWS * TILE) {
      killPlayer(p, true);
      G.dyingT = 0;
      audio.musicStop();
      audio.sfx('die');
    }

    G.bannerT = Math.max(0, G.bannerT - dt);

    if (consumePause()) {
      G.state = 'PAUSED';
      audio.musicStop();
    }
    return;
  }

  if (G.state === 'PAUSED') {
    if (consumePause()) {
      G.state = 'PLAYING';
      audio.musicStart();
    }
    if (consumeRestart()) {
      loadLevel(G.levelIndex);
      G.state = 'PLAYING';
      audio.musicStart();
    }
    return;
  }

  // Items keep animating outside PLAYING: the gate's +1000 popup has to rise through the
  // whole 1.4 s clear window, and WIN/GAME_OVER have no dimming rect, so mid-flight shards
  // and any live berry would otherwise hang there frozen. (The p.dead branch above stays a
  // full freeze — the world is frozen during death, architecture.md:41.)
  if (G.state === 'LEVEL_CLEAR') {
    G.clearT += dt;
    updateItems(G.items, dt, G.level);
    const p = G.player;
    const gate = G.level.gate;
    p.y = Math.min(p.y + 120 * dt, (gate.row + 1) * 16 - p.h);
    if (G.clearT > 1.4) {
      // Bounds check first: LEVELS has a fixed length, so on the last level there is no next
      // level to load and loadLevel() would hand parseLevel() an undefined map. The final
      // gate ends the run instead, and levelIndex stays on the last index.
      if (G.levelIndex + 1 >= LEVELS.length) {
        goWin();
      } else {
        G.levelIndex += 1;
        loadLevel(G.levelIndex);
        G.state = 'PLAYING';
        audio.musicStart();
      }
    }
    return;
  }

  if (G.state === 'WIN') {
    G.winT += dt;
    updateItems(G.items, dt, G.level);
    if (consumeStart()) G.state = 'TITLE';
    return;
  }

  G.overT += dt;
  updateItems(G.items, dt, G.level);
  if (consumeStart()) G.state = 'TITLE';
}

let last = performance.now();
let acc = 0;

// §4's two-pass composite, and the ONLY thing that ever draws on the visible canvas. Three
// nearest-neighbour blits (the ctx flags are all false), the `k` step integer so nothing downscales:
//   1. `scene` (logical 256x240, LIT) → `upscale` at sceneW*k × sceneH*k
//   2. `hud`   (logical 256x240, unlit) → the SAME rect, on top: never multiplied/lighted, never shaken
//   3. `upscale` → the canvas at the exact backing size `configure` chose (pass 2, the only fractional one)
// No clearRect of `upscale` or of the canvas: blit 1 covers both 1:1 every frame, and both logical
// layers are themselves whole-surface cleared by render.js — TITLE included, whose `drawTitle` opens
// with an opaque sky fill, so the stale `scene` content blit 1 lays down is always covered. Blits 1
// and 2 landing on `upscale` also keeps the live context's per-frame op stream at ONE drawImage.
function composite() {
  const lay = compositeLayout();
  const L = compositeLayers();
  const w = lay.sceneW * lay.k, h = lay.sceneH * lay.k;
  const up = L.upscale.ctx;
  up.drawImage(L.scene.c, 0, 0, w, h);
  up.drawImage(L.hud.c, 0, 0, w, h);
  ctx.drawImage(L.upscale.c, 0, 0, lay.backing.w, lay.backing.h);
}

function frame(now) {
  // Re-arm before doing any work: one throw from update() or render() must not be able to
  // stop the loop, or the canvas freezes for good with no way back but a page reload. The
  // catch keeps the frame boundary the last line of defence — the error is logged per throw
  // so a recurring bug still shows up in the console instead of silently repeating.
  requestAnimationFrame(frame);
  try {
    let dt = (now - last) / 1000;
    last = now;
    if (dt > 0.25) dt = 0.25;
    acc += dt;
    while (acc >= STEP) {
      update(STEP);
      // Every fixed step, regardless of G.state: fx owns its own idle state and a paused pool
      // must still decay its shake/squash — the precedent is the items rule at :550-553 (they
      // animate outside PLAYING for the same reason). STEP, never the outer `dt`: the fixed
      // step is the determinism boundary, so `fx` must not see a variable interval.
      updateFx(STEP);
      acc -= STEP;
    }
    render(G);
    composite();
  } catch (err) {
    console.error(err);
  }
}
requestAnimationFrame(frame);
