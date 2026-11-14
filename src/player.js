import {
  ACCEL,
  AIR_ACCEL,
  COYOTE,
  FRICTION,
  GRAVITY,
  INVULN_TIME,
  JUMP_BUFFER,
  JUMP_CUT_VY,
  JUMP_VY,
  MAX_FALL,
  PLAYER_SMALL_H,
  PLAYER_W,
  RUN_MAX,
  SOLID,
  TILE,
  WALK_MAX,
} from './config.js';
import { tileAt } from './level.js';

const EPS = 0.001; // skip tiles only touched at an exact edge
const AIR_FRICTION = 200;

export function makePlayer(x, y) {
  return {
    x,
    y,
    vx: 0,
    vy: 0,
    w: PLAYER_W,
    h: PLAYER_SMALL_H,
    facing: 1,
    big: false,
    onGround: false,
    coyoteT: 0,
    bufferT: 0,
    invulnT: 0,
    dead: false,
    deadT: 0,
    deadPit: false,
    headBump: null,
    jumped: false,
    jumpCut: false,
    t: 0,
  };
}

function moveToward(cur, target, amount) {
  if (cur < target) return Math.min(cur + amount, target);
  return Math.max(cur - amount, target);
}

export function updatePlayer(p, dt, input, level) {
  if (p.dead) {
    p.deadT += dt;
    if (!p.deadPit) {
      p.vy += GRAVITY * dt;
      p.y += p.vy * dt;
    }
    return;
  }

  p.headBump = null;

  // Horizontal
  const target = (input.left ? -1 : 0) + (input.right ? 1 : 0);
  const maxSpeed = input.run ? RUN_MAX : WALK_MAX;
  if (target !== 0) {
    p.facing = target;
    const accel = p.onGround ? ACCEL : AIR_ACCEL;
    p.vx = moveToward(p.vx, target * maxSpeed, accel * dt);
  } else {
    const fr = (p.onGround ? FRICTION : AIR_FRICTION) * dt;
    if (p.vx > 0) p.vx = Math.max(0, p.vx - fr);
    else if (p.vx < 0) p.vx = Math.min(0, p.vx + fr);
  }

  // Jump (buffer + coyote) and variable height
  if (input.jumpPressed) p.bufferT = JUMP_BUFFER;
  if (p.onGround) p.coyoteT = COYOTE;
  else p.coyoteT -= dt;
  if (p.bufferT > 0 && p.coyoteT > 0) {
    p.vy = JUMP_VY;
    p.bufferT = 0;
    p.coyoteT = 0;
    p.onGround = false;
    p.jumped = true;
    p.jumpCut = false;
  }
  if (!input.jump && !p.jumpCut && p.vy < JUMP_CUT_VY) {
    p.vy = JUMP_CUT_VY;
    p.jumpCut = true;
  }

  p.bufferT = Math.max(0, p.bufferT - dt);
  p.vy = Math.min(p.vy + GRAVITY * dt, MAX_FALL);

  // X pass
  p.x += p.vx * dt;
  const ty0 = Math.floor(p.y / TILE);
  const ty1 = Math.floor((p.y + p.h - EPS) / TILE);
  if (p.vx > 0) {
    const tx = Math.floor((p.x + p.w - EPS) / TILE);
    for (let ty = ty0; ty <= ty1; ty++) {
      if (SOLID.includes(tileAt(level, tx, ty))) {
        p.x = tx * TILE - p.w;
        p.vx = 0;
        break;
      }
    }
  } else if (p.vx < 0) {
    const tx = Math.floor(p.x / TILE);
    for (let ty = ty0; ty <= ty1; ty++) {
      if (SOLID.includes(tileAt(level, tx, ty))) {
        p.x = (tx + 1) * TILE;
        p.vx = 0;
        break;
      }
    }
  }

  // Y pass
  p.y += p.vy * dt;
  p.onGround = false;
  if (p.vy >= 0) {
    const ty = Math.floor((p.y + p.h - EPS) / TILE);
    const tx0 = Math.floor(p.x / TILE);
    const tx1 = Math.floor((p.x + p.w - EPS) / TILE);
    for (let tx = tx0; tx <= tx1; tx++) {
      if (SOLID.includes(tileAt(level, tx, ty))) {
        p.y = ty * TILE - p.h;
        p.vy = 0;
        p.onGround = true;
        break;
      }
    }
  } else {
    const ty = Math.floor(p.y / TILE);
    const tx0 = Math.floor(p.x / TILE);
    const tx1 = Math.floor((p.x + p.w - EPS) / TILE);
    let bumpX = -1;
    let bestOverlap = 0;
    for (let tx = tx0; tx <= tx1; tx++) {
      if (SOLID.includes(tileAt(level, tx, ty))) {
        const overlap = Math.min(p.x + p.w, (tx + 1) * TILE) - Math.max(p.x, tx * TILE);
        if (overlap > bestOverlap) {
          bestOverlap = overlap;
          bumpX = tx;
        }
      }
    }
    if (bumpX >= 0) {
      p.y = (ty + 1) * TILE;
      p.vy = 0;
      p.headBump = { x: bumpX, y: ty };
    }
  }

  p.invulnT = Math.max(0, p.invulnT - dt);
  p.t += dt;
}

export function hurtPlayer(p) {
  if (p.invulnT > 0 || p.dead) return false;
  if (p.big) {
    p.big = false;
    p.h = PLAYER_SMALL_H;
    p.y += 14;
    p.invulnT = INVULN_TIME;
    return true;
  }
  p.dead = true;
  p.deadT = 0;
  p.vy = -400;
  return true;
}

export function killPlayer(p, pit) {
  if (p.dead) return false;
  p.dead = true;
  p.deadT = 0;
  p.deadPit = pit;
  if (!pit) p.vy = -400;
  return true;
}
