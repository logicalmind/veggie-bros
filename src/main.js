import {
  PLAYER_BIG_H,
  PLAYER_SMALL_H,
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
import { updateCamera } from './camera.js';
import { render } from './render.js';
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
  canvas.style.width = VIEW_W * s + 'px';
  canvas.style.height = VIEW_H * s + 'px';
}
window.addEventListener('resize', fit);
fit();

setupKeyboard();
setupTouch();

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
  cam: { x: 0 },
  clearT: 0,
  bannerT: 0,
  winT: 0,
  overT: 0,
  dyingT: 0,
  gateScored: false,
  muted: false,
};

function loadLevel(i) {
  G.levelIndex = i;
  G.level = parseLevel(LEVELS[i]);
  G.enemies = G.level.enemies.map(makeTurnip);
  if (G.level.boss) G.enemies.push(makeBoss(G.level.boss));
  G.items = G.level.fruits.map((f) => makeFruit(f.x, f.y));
  G.player = makePlayer(G.level.playerSpawn.x, G.level.playerSpawn.y);
  G.cam = { x: 0 };
  G.bannerT = 1.5;
  G.gateScored = false;
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

function onDeathResolved() {
  G.lives -= 1;
  if (G.lives <= 0) {
    G.state = 'GAME_OVER';
    G.overT = 0;
    audio.musicStop();
  } else {
    loadLevel(G.levelIndex);
  }
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
const GROW_H = PLAYER_BIG_H - PLAYER_SMALL_H;
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

    if (p.dead) {
      G.dyingT += dt;
      updatePlayer(p, dt, input, G.level);
      consumeJumpPressed();
      if (G.dyingT > 1.2) {
        onDeathResolved();
        G.dyingT = 0;
      }
      return;
    }

    updatePlayer(p, dt, input, G.level);
    consumeJumpPressed();
    if (p.jumped) {
      audio.sfx('jump');
      p.jumped = false;
    }

    updateCamera(G.cam, dt, p, G.level.widthPx);

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
        updateTurnip(e, dt, G.level, camX, p);
      }
      // The same line the player's pit check uses below: tileAt() reports solid ground
      // below the map, so anything whose feet reach the bottom row has fallen into a gap
      // and would otherwise patrol that hidden floor forever — on the last drawn row, and
      // lethal. Checked after the update (updateTurnip/updateBoss return early once an
      // entity trails the camera, so a pre-update check could never run again) and before
      // the dead-filter, so the squashed/defeated retirement above still gets its frames.
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
          p.h = 26;
          p.y -= 14;
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
        // place the player on top of the boss before bouncing, same as the stomps above
        p.y = boss.y - p.h;
        p.vy = STOMP_BOUNCE;
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
    // height check: any player whose feet reach the map's bottom row has fallen in.
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
      acc -= STEP;
    }
    render(ctx, G);
  } catch (err) {
    console.error(err);
  }
}
requestAnimationFrame(frame);
