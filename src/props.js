// HD prop art: fruit, berry, shard, the melon gate, and the four FX particle kinds —
// plus the soft emissive masks the bloom pass gathers (composite.js `emissive`).
//
// This is the art successor of the old sprites.js item/tile/FX section and of src/atlas.js,
// which is retired by the same cutover. The draw surface is FROZEN: same export names,
// same arguments, same (x, y) meaning and anchors as the old wrappers
// (fruit/berry/shard at the item origin, gate 103 px above its bottom tile, FX centred on
// the emit point by fx.js's own maths). Only the bodies changed — from 8-bit atlas blits to
// one drawImage each over a lazily-baked vector canvas.
//
// Bake pattern is identical to chars.js: each (key, frame) bakes once into a plain
// OffscreenCanvas at SCENE_SCALE x its LOGICAL size, and every blit uses the logical
// destination size, so under the scene's 4x transform the art lands 1:1 (no resampling) and
// on the 1x HUD canvas it is a clean bilinear downscale.
//
// Light direction matches terrain.js and chars.js: keylight from the TOP-LEFT.

import { PALETTE, SCENE_SCALE } from './config.js';
import { buildRamps, makeLayer, parseColor } from './pixels.js';

const S = SCENE_SCALE;
const P = PALETTE;
const RM = buildRamps(P);

// ---------------------------------------------------------------- helpers

function rgba(hex, a) {
  const c = parseColor(hex);
  return `rgba(${c.r},${c.g},${c.b},${a})`;
}

function ell(ctx, cx, cy, rx, ry) {
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
}

function bake(w, h, fn) {
  const { c, ctx } = makeLayer(w * S, h * S);
  ctx.scale(S, S);
  fn(ctx);
  return c;
}

// ---------------------------------------------------------------- fruit
// The Sunfruit keeps the old eight-point star and its 9x9 art box: the pickup rect is the
// 8x8 at the item origin, and the rim + pip property of the old sprite survives — a dark
// caramel rim ring where the `K` ring was, and the two middle-row pips as true-black seed
// dots on the full-star frame. The spin now squashes around the star's centre (the old
// frames swept the art toward the box's left edge); the sweep range is the same, the
// motion just reads as a rotation instead of a slide.

const FRUIT_CX = 4.5, FRUIT_CY = 4.5;
const FRUIT_SX = [1, 0.62, 0.24, 0.62];

function starPath(ctx, sx) {
  ctx.beginPath();
  for (let k = 0; k < 16; k++) {
    const r = k % 2 === 0 ? 4.2 : 2.25;
    const a = -Math.PI / 2 + (k * Math.PI) / 8;
    const x = FRUIT_CX + Math.cos(a) * r * sx;
    const y = FRUIT_CY + Math.sin(a) * r;
    if (k === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

function paintFruit(ctx, i) {
  const sx = FRUIT_SX[i];
  starPath(ctx, sx);
  const g = ctx.createRadialGradient(FRUIT_CX - 1.1, FRUIT_CY - 1.3, 0.4, FRUIT_CX, FRUIT_CY, 4.6);
  g.addColorStop(0, RM.crown.hi);
  g.addColorStop(0.45, RM.crown.lit);
  g.addColorStop(0.78, RM.crown.base);
  g.addColorStop(1, RM.crown.deep);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.lineWidth = 0.7;
  ctx.strokeStyle = RM.crown.deep;
  ctx.stroke();
  if (i === 0) {
    ctx.fillStyle = P.black;
    ell(ctx, FRUIT_CX - 0.62, FRUIT_CY, 0.34, 0.34);
    ctx.fill();
    ell(ctx, FRUIT_CX + 0.62, FRUIT_CY, 0.34, 0.34);
    ctx.fill();
  }
  if (i !== 2) {
    ctx.save();
    ctx.translate(FRUIT_CX - 1.4 * sx, FRUIT_CY - 1.6);
    ctx.rotate(-0.5);
    ctx.fillStyle = rgba(P.white, 0.8);
    ell(ctx, 0, 0, 0.75 * sx + 0.2, 0.45);
    ctx.fill();
    ctx.restore();
  }
}

// ---------------------------------------------------------------- berry
// Physics box = art box (items.js BERRY_W/H), so the capsule stays inside 14x7, rim where
// the old matrix's rows 0 and 6 rimmed. The old second frame only moved the glint a row —
// that pulse is the bloom mask's job now, so one frame carries the art.

function paintBerry(ctx) {
  const x0 = 0.5, x1 = 13.5, y0 = 0.5, y1 = 6.5, r = 3;
  ctx.beginPath();
  ctx.arc(x1 - r, 3.5, r, -Math.PI / 2, Math.PI / 2);
  ctx.arc(x0 + r, 3.5, r, Math.PI / 2, -Math.PI / 2);
  ctx.closePath();
  const g = ctx.createRadialGradient(4.3, 2.1, 0.5, 7, 3.5, 8);
  g.addColorStop(0, RM.berryBody.hi);
  g.addColorStop(0.5, RM.berryBody.base);
  g.addColorStop(1, RM.berryBody.deep);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.lineWidth = 0.7;
  ctx.strokeStyle = RM.berryBody.deep;
  ctx.stroke();
  ctx.save();
  ctx.translate(3.7, 2.1);
  ctx.rotate(-0.45);
  ctx.fillStyle = rgba(P.white, 0.85);
  ell(ctx, 0, 0, 1.15, 0.55);
  ctx.fill();
  ctx.restore();
}

// ---------------------------------------------------------------- shard
// 4x4 crystal: four facets under the top-left key (lit top-left, deep bottom-right) with a
// hot glint where the old `W` cell sat.

function paintShard(ctx) {
  const cx = 2, cy = 2, t = 0.15;
  const T = [cx, t], R = [4 - t, cy], B = [cx, 4 - t], L = [t, cy], C = [cx, cy];
  const facet = (a, b, c, color) => {
    ctx.beginPath();
    ctx.moveTo(a[0], a[1]);
    ctx.lineTo(b[0], b[1]);
    ctx.lineTo(c[0], c[1]);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
  };
  facet(T, L, C, RM.brick.lit);
  facet(T, R, C, RM.brick.base);
  facet(L, B, C, RM.brick.shade);
  facet(B, R, C, RM.brick.deep);
  ctx.beginPath();
  ctx.moveTo(T[0], T[1]);
  ctx.lineTo(R[0], R[1]);
  ctx.lineTo(B[0], B[1]);
  ctx.lineTo(L[0], L[1]);
  ctx.closePath();
  ctx.lineWidth = 0.35;
  ctx.strokeStyle = RM.brick.deep;
  ctx.stroke();
  ctx.fillStyle = rgba(P.white, 0.9);
  ell(ctx, 1.35, 1.05, 0.32, 0.32);
  ctx.fill();
}

// ---------------------------------------------------------------- gate
// (x, y) is the bottom gate tile; the art runs 119 px up from it, anchor -103 (frozen). The
// old generator's silhouette is kept: domed melon arch (flat three-row crown, ribs every 8
// px), 2-px melon posts with brick courses, the keystone's glowing gold core, the pole and
// pennant, two eye bolts, and the soffit contact shadow. The one deliberate fix: the old
// right plinth was a 7-wide matrix stamped at x30 into a 32-wide grid, so it clipped to 2 px
// while the left one overhung 7 — both plinths are now symmetric 7-wide, flush with the post.

function paintGate(ctx) {
  const pipe = RM.pipe, stone = RM.stone;

  // posts (drawn first; the arch and soffit overlap their tops)
  const post = (x) => {
    const g = ctx.createLinearGradient(x, 0, x + 2, 0);
    if (x === 0) {
      g.addColorStop(0, pipe.lit);
      g.addColorStop(1, pipe.shade);
    } else {
      g.addColorStop(0, pipe.base);
      g.addColorStop(1, pipe.deep);
    }
    ctx.fillStyle = g;
    ctx.fillRect(x, 38, 2, 74);
    ctx.strokeStyle = rgba(pipe.deep, 0.55);
    ctx.lineWidth = 0.7;
    for (let y = 40; y < 112; y++) {
      if (y % 8 === 0 || y % 8 === 7) {
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + 2, y);
        ctx.stroke();
      }
    }
    ctx.strokeStyle = pipe.deep;
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(x === 0 ? 0.4 : x + 1.6, 38);
    ctx.lineTo(x === 0 ? 0.4 : x + 1.6, 112);
    ctx.stroke();
  };
  post(0);
  post(30);

  // melon arch: dome over the crown rows, solid to the springline at y38
  ctx.beginPath();
  ctx.moveTo(0, 38);
  ctx.lineTo(0, 19);
  ctx.quadraticCurveTo(0, 7, 11, 7);
  ctx.lineTo(21, 7);
  ctx.quadraticCurveTo(32, 7, 32, 19);
  ctx.lineTo(32, 38);
  ctx.closePath();
  const ag = ctx.createLinearGradient(6, 7, 26, 38);
  ag.addColorStop(0, pipe.lit);
  ag.addColorStop(0.55, pipe.base);
  ag.addColorStop(1, pipe.shade);
  ctx.fillStyle = ag;
  ctx.fill();
  // ribs (the old (x-2)%8===0 stripes), bowed to follow the dome
  ctx.lineWidth = 1.1;
  for (const rx of [2, 10, 18, 26]) {
    const top = 15.5 + (rx - 15.5) * 0.8;
    ctx.strokeStyle = rgba(pipe.shade, 0.75);
    ctx.beginPath();
    ctx.moveTo(rx, 38);
    ctx.quadraticCurveTo(rx + (15.5 - rx) * 0.18, 18, top, 7.6);
    ctx.stroke();
  }
  ctx.lineWidth = 1;
  ctx.strokeStyle = pipe.deep;
  ctx.stroke();
  // keylight sheen along the crown
  ctx.beginPath();
  ctx.moveTo(1.5, 17);
  ctx.quadraticCurveTo(1.5, 8.5, 10, 8.3);
  ctx.lineTo(22, 8.3);
  ctx.quadraticCurveTo(30.5, 8.5, 30.5, 17);
  ctx.strokeStyle = rgba(pipe.hi, 0.5);
  ctx.lineWidth = 1;
  ctx.stroke();
  // soffit: the gate's own contact shadow, dark band then soft fade into the doorway
  ctx.fillStyle = rgba(pipe.deep, 0.8);
  ctx.fillRect(0, 36.7, 32, 1.8);
  const cg = ctx.createLinearGradient(0, 38, 0, 40.5);
  cg.addColorStop(0, rgba(P.black, 0.35));
  cg.addColorStop(1, rgba(P.black, 0));
  ctx.fillStyle = cg;
  ctx.fillRect(0, 38, 32, 2.5);

  // keystone: beveled stone crown with the glowing gold core (the old `E` cells)
  const kx = 14, ky = 9;
  ctx.beginPath();
  ctx.moveTo(kx + 0.2, 12.4);
  ctx.lineTo(kx, ky + 0.4);
  ctx.lineTo(kx + 1, ky);
  ctx.lineTo(kx + 4, ky);
  ctx.lineTo(kx + 5, ky + 0.4);
  ctx.lineTo(kx + 4.8, 12.4);
  ctx.lineTo(kx + 0.8, 12.4);
  ctx.closePath();
  const kg = ctx.createLinearGradient(kx, ky, kx + 5, ky + 4);
  kg.addColorStop(0, stone.lit);
  kg.addColorStop(0.5, stone.base);
  kg.addColorStop(1, stone.shade);
  ctx.fillStyle = kg;
  ctx.fill();
  ctx.lineWidth = 0.5;
  ctx.strokeStyle = stone.deep;
  ctx.stroke();
  const gg = ctx.createRadialGradient(15.6, 10.6, 0.2, 16, 11, 2.2);
  gg.addColorStop(0, P.white);
  gg.addColorStop(0.35, P.pumpkinLit);
  gg.addColorStop(1, RM.crown.deep);
  ell(ctx, 16, 11, 1.5, 1.5);
  ctx.fillStyle = gg;
  ctx.fill();
  ctx.fillStyle = rgba(P.white, 0.9);
  ell(ctx, 15.45, 10.45, 0.4, 0.4);
  ctx.fill();

  // pole and pennant (the old `a` pole, `ghi` red flag)
  ctx.fillStyle = stone.shade;
  ctx.fillRect(14.8, 2, 1.1, 5.4);
  ctx.fillStyle = rgba(stone.lit, 0.8);
  ctx.fillRect(14.8, 2, 0.35, 5.4);
  ctx.beginPath();
  ctx.moveTo(15.9, 0.2);
  ctx.quadraticCurveTo(17.4, 0.6, 18.8, 1.2);
  ctx.lineTo(15.9, 2.8);
  ctx.closePath();
  const fg = ctx.createLinearGradient(15.9, 0.2, 18.8, 1.6);
  fg.addColorStop(0, RM.red.lit);
  fg.addColorStop(1, RM.red.deep);
  ctx.fillStyle = fg;
  ctx.fill();
  ctx.lineWidth = 0.4;
  ctx.strokeStyle = RM.red.deep;
  ctx.stroke();

  // plinths (symmetric now; see the header note)
  const plinth = (x) => {
    const pg = ctx.createLinearGradient(x, 112, x + 7, 119);
    pg.addColorStop(0, stone.lit);
    pg.addColorStop(0.55, stone.base);
    pg.addColorStop(1, stone.shade);
    ctx.fillStyle = pg;
    ctx.fillRect(x, 112, 7, 7);
    ctx.fillStyle = rgba(stone.hi, 0.55);
    ctx.fillRect(x, 112, 7, 0.9);
    ctx.strokeStyle = rgba(stone.shade, 0.8);
    ctx.lineWidth = 0.6;
    ctx.beginPath();
    ctx.moveTo(x + 0.5, 115.5);
    ctx.lineTo(x + 6.5, 115.5);
    ctx.stroke();
    ctx.strokeStyle = stone.deep;
    ctx.lineWidth = 0.5;
    ctx.strokeRect(x + 0.25, 112.25, 6.5, 6.5);
  };
  plinth(0);
  plinth(25);

  // eye bolts (the old two `K` cells on the arch face)
  for (const bx of [8.5, 24.5]) {
    ell(ctx, bx, 19.5, 0.75, 0.75);
    ctx.fillStyle = P.black;
    ctx.fill();
    ell(ctx, bx - 0.22, 19.28, 0.2, 0.2);
    ctx.fillStyle = rgba(P.white, 0.55);
    ctx.fill();
  }
}

// ---------------------------------------------------------------- fx particles
// Three- or five-logical-px puffs: a soft radial is the right tool at this size (the old
// matrices faked a ramp with two materials per blob). Frames only carry growth/rotation;
// per-particle alpha, scaleY stretch and flipX come from fx.js's TAB exactly as before.

function paintDust(ctx) {
  const g = ctx.createRadialGradient(1.5, 1, 0.1, 1.5, 1, 1.7);
  g.addColorStop(0, rgba(RM.dirt.lit, 0.95));
  g.addColorStop(0.55, rgba(RM.dirt.base, 0.6));
  g.addColorStop(1, rgba(RM.dirt.base, 0));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 3, 2);
}

function paintSpark(ctx, i) {
  ctx.beginPath();
  const len = i === 0 ? 2.4 : 2.1;
  for (let k = 0; k < 8; k++) {
    const r = k % 2 === 0 ? len : 0.55;
    const a = i * Math.PI / 4 - Math.PI / 2 + (k * Math.PI) / 4;
    const x = 2.5 + Math.cos(a) * r;
    const y = 2.5 + Math.sin(a) * r;
    if (k === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  const g = ctx.createRadialGradient(2.5, 2.5, 0.1, 2.5, 2.5, 2.6);
  g.addColorStop(0, rgba(P.white, 1));
  g.addColorStop(0.4, rgba(P.pumpkinLit, 0.95));
  g.addColorStop(1, rgba(RM.crown.base, 0));
  ctx.fillStyle = g;
  ctx.fill();
  ell(ctx, 2.5, 2.5, 0.55, 0.55);
  ctx.fillStyle = rgba(P.white, 0.95);
  ctx.fill();
}

function paintPoof(ctx, i) {
  const r = 1.3 + i * 0.75;
  const a = 0.9 - i * 0.22;
  const g = ctx.createRadialGradient(2.5, 2.5, 0.15, 2.5, 2.5, r);
  g.addColorStop(0, rgba(P.white, a));
  g.addColorStop(0.6, rgba(RM.used.lit, a * 0.7));
  g.addColorStop(1, rgba(RM.used.lit, 0));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 5, 5);
}

function paintChip(ctx) {
  ctx.beginPath();
  ctx.moveTo(1.5, 0.15);
  ctx.lineTo(2.85, 1.15);
  ctx.lineTo(2.1, 2.85);
  ctx.lineTo(0.45, 2.0);
  ctx.closePath();
  const g = ctx.createLinearGradient(0.5, 0.3, 2.7, 2.6);
  g.addColorStop(0, RM.brick.lit);
  g.addColorStop(1, RM.brick.deep);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.lineWidth = 0.3;
  ctx.strokeStyle = RM.brick.deep;
  ctx.stroke();
  ctx.fillStyle = rgba(P.white, 0.85);
  ell(ctx, 1.35, 0.9, 0.3, 0.2);
  ctx.fill();
}

// ---------------------------------------------------------------- emissive masks
// The bloom pass (composite.js buildBloom) blits these into its 0.25x buffer, so a 4x
// bilinear downsample onto the mask's own art box IS the soft halo — the old hard-edged `E`-cell
// silhouettes, upgraded. R-5 set: fruit, berry, gate and the intact pumpkin blocks (see
// EMISSIVE_KEYS in composite.js). fx.spark stays unmasked: 5x5 art px is 1.25 bloom px — a
// single bright pixel the mip blur smears into noise, and the spark already reads bright in
// the HD art.

function paintFruitMask(ctx) {
  const g = ctx.createRadialGradient(4.5, 4.5, 0.3, 4.5, 4.5, 4.8);
  g.addColorStop(0, rgba(P.pumpkinLit, 1));
  g.addColorStop(0.55, rgba(P.pumpkinLit, 0.5));
  g.addColorStop(1, rgba(P.pumpkinLit, 0));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 9, 9);
}

function paintBerryMask(ctx) {
  const g = ctx.createRadialGradient(7, 3.5, 0.4, 7, 3.5, 6.5);
  g.addColorStop(0, rgba(RM.berryBody.hi, 1));
  g.addColorStop(0.6, rgba(RM.berryBody.hi, 0.45));
  g.addColorStop(1, rgba(RM.berryBody.hi, 0));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 14, 7);
}

// R-5's two new masks, same pattern: a soft radial field in the light's OWN colour, so the
// bloom buffer's 'lighter' add tints the halo (gate green, pumpkin orange) instead of
// whitening it. The hexes mirror composite.js's GLOW table (gate #a6ff72, pumpkin #ff9b2e).
function paintGateMask(ctx) {
  // 32x119: one radial centred on the melon-body column; the falloff leaves the plinth corners
  // nearly clear, so the halo reads as the gate's body, not a glowing rectangle.
  const g = ctx.createRadialGradient(16, 52, 3, 16, 52, 60);
  g.addColorStop(0, rgba('#a6ff72', 1));
  g.addColorStop(0.5, rgba('#a6ff72', 0.55));
  g.addColorStop(1, rgba('#a6ff72', 0));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 32, 119);
}

function paintPumpkinMask(ctx) {
  // 16x16 = one tile; the mask fades to zero at the tile edge so a row of blocks reads as one
  // continuous warm band, not a grid of dots.
  const g = ctx.createRadialGradient(8, 8, 0.5, 8, 8, 8.5);
  g.addColorStop(0, rgba('#ff9b2e', 1));
  g.addColorStop(0.6, rgba('#ff9b2e', 0.5));
  g.addColorStop(1, rgba('#ff9b2e', 0));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 16, 16);
}

// ---------------------------------------------------------------- bake + blit

let B = null;

function ensure() {
  if (B) return;
  B = {
    fruit: [0, 1, 2, 3].map((i) => bake(9, 9, (ctx) => paintFruit(ctx, i))),
    berry: bake(14, 7, paintBerry),
    shard: bake(4, 4, paintShard),
    gate: bake(32, 119, paintGate),
    fx: {
      'fx.dust': { w: 3, h: 2, frames: [bake(3, 2, paintDust)] },
      'fx.spark': { w: 5, h: 5, frames: [bake(5, 5, (c) => paintSpark(c, 0)), bake(5, 5, (c) => paintSpark(c, 1))] },
      'fx.poof': { w: 5, h: 5, frames: [bake(5, 5, (c) => paintPoof(c, 0)), bake(5, 5, (c) => paintPoof(c, 1)), bake(5, 5, (c) => paintPoof(c, 2))] },
      'fx.chip': { w: 3, h: 3, frames: [bake(3, 3, paintChip)] },
    },
    mask: {
      fruit: { w: 9, h: 9, c: bake(9, 9, paintFruitMask) },
      berry: { w: 14, h: 7, c: bake(14, 7, paintBerryMask) },
      gate: { w: 32, h: 119, c: bake(32, 119, paintGateMask) },
      pumpkin: { w: 16, h: 16, c: bake(16, 16, paintPumpkinMask) },
    },
  };
}

// Static, so callers (fx.js's per-particle frame pick) can read counts before the first bake.
const FRAMES = Object.freeze({
  fruit: 4, berry: 1, shard: 1, gate: 1,
  'fx.dust': 1, 'fx.spark': 2, 'fx.poof': 3, 'fx.chip': 1,
});

export function frames(key) {
  return FRAMES[key] || 0;
}

function blitC(ctx, c, w, h, x, y) {
  ctx.drawImage(c, 0, 0, c.width, c.height, x, y, w, h);
}

// ---------------------------------------------------------------- frozen draw surface

export function drawFruit(ctx, x, y, frame) {
  ensure();
  let f = (frame | 0) % 4;
  if (f < 0) f += 4;
  blitC(ctx, B.fruit[f], 9, 9, Math.floor(x), Math.floor(y));
}

export function drawBerry(ctx, x, y, frame) {
  ensure();
  blitC(ctx, B.berry, 14, 7, Math.floor(x), Math.floor(y));
}

export function drawShard(ctx, x, y, k, t) {
  ensure();
  const ox = (k % 2) * 8;
  const oy = k < 2 ? 0 : 8;
  const dx = k % 2 ? 1 : -1;
  const dy = k < 2 ? -1 : 1;
  const o = Math.round(t * 8);
  blitC(ctx, B.shard, 4, 4, Math.floor(x + ox + dx * o), Math.floor(y + oy + dy * o));
}

export function drawGate(ctx, x, y) {
  ensure();
  blitC(ctx, B.gate, 32, 119, Math.floor(x), Math.floor(y - 103));
}

// The particle blit: same contract as the retired atlas blit (top-left anchor, round dest
// size, multiplicative alpha, destination-space mirror), which is what fx.js's per-particle
// maths is built against.
export function fxBlit(ctx, key, frame, x, y, opts) {
  if (!B) ensure();
  const e = B.fx[key];
  if (!e) return;
  let f = frame | 0;
  if (f < 0) f = 0;
  else if (f >= e.frames.length) f = e.frames.length - 1;
  const c = e.frames[f];
  const dw = Math.round(e.w * (opts !== undefined && opts !== null && opts.scaleX !== undefined ? opts.scaleX : 1));
  const dh = Math.round(e.h * (opts !== undefined && opts !== null && opts.scaleY !== undefined ? opts.scaleY : 1));
  if (dw <= 0 || dh <= 0) return;
  const alpha = opts !== undefined && opts !== null && opts.alpha !== undefined ? opts.alpha : 1;
  const flip = opts !== undefined && opts !== null && opts.flipX === true;
  if (alpha !== 1) {
    const held = ctx.globalAlpha;
    ctx.globalAlpha = held * alpha;
    if (flip) {
      ctx.save();
      ctx.translate(x + dw, y);
      ctx.scale(-1, 1);
      ctx.drawImage(c, 0, 0, c.width, c.height, 0, 0, dw, dh);
      ctx.restore();
    } else {
      ctx.drawImage(c, 0, 0, c.width, c.height, x, y, dw, dh);
    }
    ctx.globalAlpha = held;
  } else if (flip) {
    ctx.save();
    ctx.translate(x + dw, y);
    ctx.scale(-1, 1);
    ctx.drawImage(c, 0, 0, c.width, c.height, 0, 0, dw, dh);
    ctx.restore();
  } else {
    ctx.drawImage(c, 0, 0, c.width, c.height, x, y, dw, dh);
  }
}

// Bloom input: the same rect maths as the old atlas.emissive, so composite.js's emitMask
// contract (screen coords in, the caller's buffer transform out) is unchanged.
export function emissive(ctx, key, frame, x, y) {
  ensure();
  const m = B.mask[key];
  if (!m) return;
  blitC(ctx, m.c, m.w, m.h, Math.floor(x), Math.floor(y));
}
