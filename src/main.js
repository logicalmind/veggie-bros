import { ROWS, SCORE, START_LIVES, STEP, STOMP_BOUNCE, TILE, VIEW_H, VIEW_W } from './config.js';
import { LEVELS } from './levels.js';
import { parseLevel } from './level.js';
import { makeBoss, makeTurnip, updateBoss, updateTurnip } from './enemy.js';
import { makeBerry, makeFruit, makePop, makePopup, makeShards, updateItems } from './items.js';
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

function onBossDown() {
  G.state = 'WIN';
  G.winT = 0;
  G.score += SCORE.bossDown;
  audio.musicStop();
  audio.sfx('win');
}

function rectOverlap(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
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
      if (it.kind === 'berry' && rectOverlap(p, { x: it.x, y: it.y, w: 14, h: 14 })) {
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

  if (G.state === 'LEVEL_CLEAR') {
    G.clearT += dt;
    const p = G.player;
    const gate = G.level.gate;
    p.y = Math.min(p.y + 120 * dt, (gate.row + 1) * 16 - p.h);
    if (G.clearT > 1.4) {
      G.levelIndex += 1;
      loadLevel(G.levelIndex);
      G.state = 'PLAYING';
      audio.musicStart();
    }
    return;
  }

  if (G.state === 'WIN') {
    G.winT += dt;
    if (consumeStart()) G.state = 'TITLE';
    return;
  }

  G.overT += dt;
  if (consumeStart()) G.state = 'TITLE';
}

let last = performance.now();
let acc = 0;

function frame(now) {
  let dt = (now - last) / 1000;
  last = now;
  if (dt > 0.25) dt = 0.25;
  acc += dt;
  while (acc >= STEP) {
    update(STEP);
    acc -= STEP;
  }
  render(ctx, G);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
