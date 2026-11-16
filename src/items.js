import { BERRY_LIFE, BERRY_SPEED, GRAVITY, MAX_FALL, SOLID, TILE } from './config.js';
import { tileAt } from './level.js';

// The berry's physics box is its art exactly (sprites.js drawBerry inks cols 0..BERRY_W-1
// and rows 0..BERRY_H-1, outline included), so a berry at rest puts its outline's bottom
// row on the floor instead of floating above it, and nothing outside the art is collectable.
// moveBerryX/Y use this pair for collisions and main.js uses it for the pickup rect.
export const BERRY_W = 14;
export const BERRY_H = 7;
const EPS = 0.001; // skip tiles only touched at an exact edge
const POP_LIFE = 0.25;
const POPUP_LIFE = 0.6;
const SHARD_LIFE = 0.5;
const SHARD_GRAVITY = 600;
const SHARD_VX = [-90, -45, 45, 90];
const SHARD_VY = [-160, -190, -190, -160];

function moveBerryX(b, dt, level) {
  b.x += b.vx * dt;
  const tx = b.vx > 0 ? Math.floor((b.x + BERRY_W - EPS) / TILE) : Math.floor(b.x / TILE);
  const ty0 = Math.floor(b.y / TILE);
  const ty1 = Math.floor((b.y + BERRY_H - EPS) / TILE);
  for (let ty = ty0; ty <= ty1; ty++) {
    if (SOLID.includes(tileAt(level, tx, ty))) {
      b.x = b.vx > 0 ? tx * TILE - BERRY_W : (tx + 1) * TILE;
      b.vx = -b.vx;
      break;
    }
  }
}

function moveBerryY(b, dt, level) {
  b.vy = Math.min(b.vy + GRAVITY * dt, MAX_FALL);
  b.y += b.vy * dt;
  b.onGround = false;
  const ty = Math.floor((b.y + BERRY_H - EPS) / TILE);
  const tx0 = Math.floor(b.x / TILE);
  const tx1 = Math.floor((b.x + BERRY_W - EPS) / TILE);
  for (let tx = tx0; tx <= tx1; tx++) {
    if (SOLID.includes(tileAt(level, tx, ty))) {
      b.y = ty * TILE - BERRY_H;
      b.vy = 0;
      b.onGround = true;
      break;
    }
  }
}

export function makeFruit(x, y) {
  return { kind: 'fruit', x, y, t: 0 };
}

export function makeBerry(x, y) {
  return { kind: 'berry', x, y, vx: BERRY_SPEED, vy: 0, t: 0, onGround: false };
}

export function makePop(x, y, what) {
  return { kind: 'pop', x, y, what, t: 0 };
}

export function makeShards(x, y) {
  const shards = [];
  for (let k = 0; k < 4; k++) {
    shards.push({ kind: 'shard', x, y, k, t: 0 });
  }
  return shards;
}

export function makePopup(x, y, text) {
  return { kind: 'popup', x, y, text, t: 0 };
}

export function updateItems(list, dt, level) {
  const keep = [];
  for (const it of list) {
    switch (it.kind) {
      case 'fruit':
        it.t += dt;
        keep.push(it);
        break;
      case 'berry':
        moveBerryX(it, dt, level);
        moveBerryY(it, dt, level);
        it.t += dt;
        if (it.t <= BERRY_LIFE) keep.push(it);
        break;
      case 'shard':
        it.x += SHARD_VX[it.k] * dt;
        it.y += (SHARD_VY[it.k] + SHARD_GRAVITY * it.t) * dt;
        it.t += dt;
        if (it.t <= SHARD_LIFE) keep.push(it);
        break;
      case 'pop':
        it.t += dt;
        if (it.t <= POP_LIFE) keep.push(it);
        break;
      case 'popup':
        it.t += dt;
        if (it.t <= POPUP_LIFE) keep.push(it);
        break;
    }
  }
  list.length = 0;
  list.push(...keep);
}
