import {
  BOSS_HOP_COOLDOWN,
  BOSS_HOP_RANGE,
  BOSS_HOP_VY,
  BOSS_HP,
  BOSS_SPEED,
  ENEMY_SPEED,
  GRAVITY,
  MAX_FALL,
  TILE,
  VIEW_W,
} from './config.js';
import { isSolid, tileAt } from './level.js';

const EPS = 0.001; // skip tiles only touched at an exact edge
const SQUASH_LIFE = 0.4;
const CULL_BEHIND = 32; // how far past the left edge an entity may trail the camera

function moveX(e, dt, level) {
  e.x += e.vx * dt;
  const tx = e.vx > 0 ? Math.floor((e.x + e.w - EPS) / TILE) : Math.floor(e.x / TILE);
  const ty0 = Math.floor(e.y / TILE);
  const ty1 = Math.floor((e.y + e.h - EPS) / TILE);
  for (let ty = ty0; ty <= ty1; ty++) {
    if (isSolid(tileAt(level, tx, ty))) {
      e.x = e.vx > 0 ? tx * TILE - e.w : (tx + 1) * TILE;
      e.vx = -e.vx;
      break;
    }
  }
}

function moveY(e, dt, level) {
  e.vy = Math.min(e.vy + GRAVITY * dt, MAX_FALL);
  e.y += e.vy * dt;
  e.onGround = false;
  const ty = Math.floor((e.y + e.h - EPS) / TILE);
  const tx0 = Math.floor(e.x / TILE);
  const tx1 = Math.floor((e.x + e.w - EPS) / TILE);
  for (let tx = tx0; tx <= tx1; tx++) {
    if (isSolid(tileAt(level, tx, ty))) {
      e.y = ty * TILE - e.h;
      e.vy = 0;
      e.onGround = true;
      break;
    }
  }
}

export function makeTurnip(spawn) {
  return { type: 'turnip', x: spawn.x, y: spawn.y, vx: -ENEMY_SPEED, vy: 0, w: 12, h: 12, onGround: false, active: false, squashed: false, squashT: 0, t: 0 };
}

export function makeBoss(spawn) {
  return { type: 'boss', x: spawn.x, y: spawn.y, vx: BOSS_SPEED, vy: 0, w: 28, h: 28, onGround: false, active: false, hp: BOSS_HP, hurtT: 0, hopT: 0, defeated: false, defeatT: 0, t: 0 };
}

export function updateTurnip(e, dt, level, camX, player) {
  // Well behind the ratcheted camera: a live turnip stops being simulated. A squashed
  // one keeps ticking so main.js can still retire it; render.js draws either way.
  if (!e.squashed && e.x + e.w < camX - CULL_BEHIND) return;
  if (!e.squashed && !e.active && e.x < camX + VIEW_W + 32) {
    e.active = true;
  }
  if (!e.active) return;
  if (e.squashed) {
    e.squashT += dt;
    if (e.squashT > SQUASH_LIFE) e.dead = true;
    return;
  }
  moveX(e, dt, level);
  moveY(e, dt, level);
  if (e.onGround) {
    const front = e.vx < 0 ? -1 : 1;
    const footX = front > 0 ? e.x + e.w : e.x;
    // Ask level.js whether the supporting tile is solid rather than testing for '.'; any
    // other non-solid character (' ' and friends) is air to the collision code too.
    if (!isSolid(tileAt(level, Math.floor(footX / TILE), Math.floor((e.y + e.h + 1) / TILE)))) {
      e.vx = -e.vx;
    }
  }
  e.t += dt;
  e.frame = Math.floor(e.t * 4) % 2;
}

export function updateBoss(b, dt, level, camX, player) {
  // Well behind the ratcheted camera: a live boss stops being simulated. A defeated one
  // keeps ticking so main.js can still finish the fight off; render.js draws either way.
  if (!b.defeated && b.x + b.w < camX - CULL_BEHIND) return;
  if (!b.defeated && !b.active && b.x < camX + VIEW_W + 32) {
    b.active = true;
  }
  if (!b.active) return;
  if (b.defeated) {
    b.defeatT += dt;
    return;
  }
  moveX(b, dt, level);
  moveY(b, dt, level);
  b.hopT += dt;
  if (b.onGround && b.hopT > BOSS_HOP_COOLDOWN && !player.dead &&
      Math.abs(player.x - b.x) < BOSS_HOP_RANGE && Math.abs(player.y - b.y) < 48) {
    b.vy = BOSS_HOP_VY;
    const dir = Math.sign(player.x - b.x) || Math.sign(b.vx) || 1;
    b.vx = dir * BOSS_SPEED;
    b.hopT = 0;
  }
  b.hurtT = Math.max(0, b.hurtT - dt);
  b.t += dt;
  b.frame = Math.floor(b.t * 3) % 2;
}
