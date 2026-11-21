// chars.js — HD character bakes (R-2, feature/realistic-graphics).
//
// The three living characters — the strawberry hero (small + big), the turnip, and the crowned
// pineapple boss — are painted procedurally once at SCENE_SCALE (4x logical px) and blitted with
// a LOGICAL destination size: under the scene's 4x transform the source lands 1:1 (no
// resampling), and on the logical-resolution HUD canvas the same blit is a bilinear downscale,
// so one bake serves the world and the HUD.
//
// The draw surface is the frozen one from sprites.js: same names, same arguments, same (x, y)
// meaning, same anchors (hero {0,-2}, turnip {-1,-1}, boss {-2,-3}) and same frame tables
// (HERO_BASE, the run bob, the boss pose/bob/hurt math). An optional trailing `shadow` argument
// (0..1 alpha, default 0) asks for a soft contact ellipse under the feet; callers that know the
// character is grounded pass it.
//
// All paint is pure — no Math.random, no clock: same inputs, same bytes, every boot.

import { PALETTE } from './config.js';
import { SCENE_SCALE } from './composite.js';
import { buildRamps, makeLayer } from './pixels.js';

const S = SCENE_SCALE;
const P = PALETTE;
const RM = buildRamps(P);

// ------------------------------------------------------------------ colour helpers
// a >= 1 must emit the bare hex: an "rgba(r,g,b,1)" string re-parsed downstream loses nothing,
// but a toFixed() on 1 would print "1.0" in some engines — bare hex never lies.
function rgba(c, a) {
  if (a >= 1) return c;
  const r = parseInt(c.slice(1, 3), 16);
  const g = parseInt(c.slice(3, 5), 16);
  const b = parseInt(c.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${Math.max(0, Math.min(1, a)).toFixed(3)})`;
}

// deterministic 2-D hash in [0,1), for speckle placement
function h2(x, y, salt) {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(salt, 974634551)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

// ------------------------------------------------------------------ shape helpers
function rr(ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function ell(ctx, cx, cy, rx, ry) {
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
}

// A stubby foot/leg: rounded rect with a vertical top->sole gradient and a dark sole crescent.
// (cx, cy) is the centre; rot tilts it (radians, positive = toes down for a forward leg).
function foot(ctx, cx, cy, w, h, rot, top, mid, deep) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(rot || 0);
  const g = ctx.createLinearGradient(0, -h / 2, 0, h / 2);
  g.addColorStop(0, top);
  g.addColorStop(0.55, mid);
  g.addColorStop(1, deep);
  rr(ctx, -w / 2, -h / 2, w, h, Math.min(w, h) * 0.45);
  ctx.fillStyle = g;
  ctx.fill();
  ell(ctx, 0, h / 2 - h * 0.18, w * 0.34, h * 0.16);
  ctx.fillStyle = rgba(deep, 0.55);
  ctx.fill();
  ctx.restore();
}

// One eye: white, a dark pupil offset toward the facing side (art faces right), a catch light.
// blink draws a closed lid instead.
function eye(ctx, cx, cy, rx, ry, blink) {
  if (blink) {
    ctx.strokeStyle = rgba(P.black, 0.9);
    ctx.lineWidth = 0.5;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(cx - rx * 0.8, cy + rx * 0.1);
    ctx.quadraticCurveTo(cx, cy + rx * 0.55, cx + rx * 0.8, cy + rx * 0.1);
    ctx.stroke();
    return;
  }
  ell(ctx, cx, cy, rx, ry);
  ctx.fillStyle = RM.white.hi;
  ctx.fill();
  ell(ctx, cx + rx * 0.35, cy + ry * 0.3, rx * 0.62, ry * 0.68);
  ctx.fillStyle = P.black;
  ctx.fill();
  ell(ctx, cx + rx * 0.08, cy - ry * 0.32, rx * 0.24, rx * 0.24);
  ctx.fillStyle = rgba('#ffffff', 0.95);
  ctx.fill();
}

// One pointed leaf from base (bx, by) to tip (tx, ty): a curved sliver, base->tip gradient,
// dark edge. halfW is the half-width at the base.
function leaf(ctx, bx, by, tx, ty, halfW, base, tip, edge) {
  const dx = tx - bx;
  const dy = ty - by;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;
  const g = ctx.createLinearGradient(bx, by, tx, ty);
  g.addColorStop(0, base);
  g.addColorStop(1, tip);
  ctx.beginPath();
  ctx.moveTo(bx + nx * halfW, by + ny * halfW);
  ctx.quadraticCurveTo(bx + dx * 0.45 + nx * halfW * 1.15, by + dy * 0.45 + ny * halfW * 1.15, tx, ty);
  ctx.quadraticCurveTo(bx + dx * 0.45 - nx * halfW * 1.15, by + dy * 0.45 - ny * halfW * 1.15, bx - nx * halfW, by - ny * halfW);
  ctx.closePath();
  ctx.fillStyle = g;
  ctx.fill();
  ctx.strokeStyle = rgba(edge, 0.5);
  ctx.lineWidth = 0.3;
  ctx.stroke();
}

// A pressed-in seed dimple: pale pit, dark top edge, light bottom glint.
function seed(ctx, x, y, rot, pit, dark, glint) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ell(ctx, 0, 0, 0.5, 0.68);
  ctx.fillStyle = pit;
  ctx.fill();
  ctx.strokeStyle = rgba(dark, 0.55);
  ctx.lineWidth = 0.28;
  ctx.beginPath();
  ctx.arc(0, 0, 0.45, Math.PI * 1.15, Math.PI * 1.85);
  ctx.stroke();
  ctx.strokeStyle = rgba(glint, 0.7);
  ctx.lineWidth = 0.22;
  ctx.beginPath();
  ctx.arc(0, 0.06, 0.45, Math.PI * 0.15, Math.PI * 0.85);
  ctx.stroke();
  ctx.restore();
}

// ------------------------------------------------------------------ the hero (strawberry)
function bodyPathSmall(ctx) {
  ctx.beginPath();
  ctx.moveTo(6.0, 13.2);
  ctx.bezierCurveTo(3.6, 13.0, 1.6, 10.8, 1.4, 7.8);
  ctx.bezierCurveTo(1.25, 4.7, 3.1, 2.9, 6.0, 2.9);
  ctx.bezierCurveTo(8.9, 2.9, 10.75, 4.7, 10.6, 7.8);
  ctx.bezierCurveTo(10.4, 10.8, 8.4, 13.0, 6.0, 13.2);
  ctx.closePath();
}

function bodyPathBig(ctx) {
  ctx.beginPath();
  ctx.moveTo(6.0, 21.5);
  ctx.bezierCurveTo(3.5, 21.2, 1.6, 18.6, 1.45, 14.6);
  ctx.bezierCurveTo(1.3, 10.4, 1.8, 6.4, 3.0, 4.2);
  ctx.bezierCurveTo(3.8, 2.9, 4.8, 2.9, 6.0, 2.9);
  ctx.bezierCurveTo(7.2, 2.9, 8.2, 2.9, 9.0, 4.2);
  ctx.bezierCurveTo(10.2, 6.4, 10.7, 10.4, 10.55, 14.6);
  ctx.bezierCurveTo(10.4, 18.6, 8.5, 21.2, 6.0, 21.5);
  ctx.closePath();
}

// The leafy cap: a stem and five pointed leaves fanning over the top of the body.
function cap(ctx) {
  rr(ctx, 5.3, 0.15, 1.4, 1.5, 0.55);
  const g = ctx.createLinearGradient(0, 0.15, 0, 1.65);
  g.addColorStop(0, RM.heroLeaf.lit);
  g.addColorStop(1, RM.heroLeaf.base);
  ctx.fillStyle = g;
  ctx.fill();
  const base = RM.heroLeaf.base;
  const tip = RM.heroLeaf.lit;
  const edge = RM.heroLeaf.deep;
  leaf(ctx, 6.0, 3.7, 2.5, 2.5, 0.85, base, tip, edge);
  leaf(ctx, 6.0, 3.7, 9.5, 2.5, 0.85, base, tip, edge);
  leaf(ctx, 6.0, 3.7, 3.8, 1.2, 0.9, base, tip, edge);
  leaf(ctx, 6.0, 3.7, 8.2, 1.2, 0.9, base, tip, edge);
  leaf(ctx, 6.0, 3.7, 6.0, 0.55, 1.0, base, tip, edge);
}

// Feet: [cx, cy, w, h, rot]. Grounded feet end at the art bottom (14 / 28).
const FEET_SMALL = {
  stand:      [[3.9, 12.85, 2.5, 2.3, -0.10], [8.1, 12.85, 2.5, 2.3, 0.10]],
  together:   [[4.8, 12.90, 2.4, 2.2, -0.05], [7.2, 12.90, 2.4, 2.2, 0.05]],
  stride:     [[2.9, 12.85, 2.5, 2.3, -0.08], [9.3, 12.30, 2.5, 2.2, 0.40]],
  pass:       [[4.9, 12.90, 2.4, 2.2, -0.05], [7.1, 12.90, 2.4, 2.2, 0.05]],
  strideBack: [[3.3, 12.30, 2.5, 2.2, -0.40], [9.1, 12.85, 2.5, 2.3, 0.08]],
  splay:      [[2.5, 12.20, 2.4, 2.2, -0.50], [9.5, 12.20, 2.4, 2.2, 0.50]],
  dangle:     [[4.6, 12.80, 2.2, 2.0, -0.25], [7.6, 13.00, 2.2, 2.0, 0.20]],
  flat:       [[3.1, 13.05, 3.0, 1.9, -0.06], [8.9, 13.05, 3.0, 1.9, 0.06]],
};

const FEET_BIG = {
  stand:      [[3.9, 25.00, 2.6, 6.0, -0.06], [8.1, 25.00, 2.6, 6.0, 0.06]],
  together:   [[4.8, 25.05, 2.5, 5.9, -0.04], [7.2, 25.05, 2.5, 5.9, 0.04]],
  stride:     [[2.9, 25.00, 2.6, 6.0, -0.06], [9.3, 24.40, 2.5, 5.6, 0.40]],
  pass:       [[4.9, 25.05, 2.5, 5.9, -0.04], [7.1, 25.05, 2.5, 5.9, 0.04]],
  strideBack: [[3.3, 24.40, 2.5, 5.6, -0.40], [9.1, 25.00, 2.6, 6.0, 0.06]],
  splay:      [[2.4, 24.50, 2.5, 5.6, -0.50], [9.6, 24.50, 2.5, 5.6, 0.50]],
  dangle:     [[4.7, 25.40, 2.3, 5.2, -0.22], [7.5, 25.40, 2.3, 5.2, 0.18]],
  flat:       [[3.2, 25.60, 3.1, 4.8, -0.05], [8.8, 25.60, 3.1, 4.8, 0.05]],
};

const SEEDS_SMALL = [
  [1.85, 6.4, -0.20], [10.15, 6.4, 0.20],
  [2.3, 9.6, -0.18], [9.7, 9.6, 0.18],
  [3.2, 11.6, -0.12], [8.8, 11.6, 0.12],
  [6.0, 12.6, 0],
];

const SEEDS_BIG = [
  [1.85, 10.0, -0.20], [10.15, 10.0, 0.20],
  [2.1, 13.8, -0.18], [9.9, 13.8, 0.18],
  [2.6, 17.2, -0.15], [9.4, 17.2, 0.15],
  [3.4, 19.8, -0.10], [8.6, 19.8, 0.10],
  [6.0, 20.6, 0],
];

// One hero frame. o: { big, blink, squash, feet }.
function paintHero(ctx, o) {
  const HB = RM.heroBody;
  for (const f of o.feet) foot(ctx, f[0], f[1], f[2], f[3], f[4] || 0, HB.shade, HB.base, HB.deep);
  const squash = o.squash;
  if (squash) {
    const py = o.big ? 25.5 : 12.8;
    ctx.save();
    ctx.translate(6, py);
    ctx.scale(1.06, 0.94);
    ctx.translate(-6, -py);
  }
  const path = o.big ? bodyPathBig : bodyPathSmall;
  const bot = o.big ? 21.5 : 13.2;
  path(ctx);
  let g = ctx.createLinearGradient(2.6, 3.4, 9.6, bot - 0.4);
  g.addColorStop(0, HB.lit);
  g.addColorStop(0.45, HB.base);
  g.addColorStop(0.8, HB.shade);
  g.addColorStop(1, HB.deep);
  ctx.fillStyle = g;
  ctx.fill();
  // body shading, clipped: bottom AO, upper-left gloss, left key rim
  ctx.save();
  path(ctx);
  ctx.clip();
  g = ctx.createLinearGradient(0, bot - 3.4, 0, bot);
  g.addColorStop(0, rgba(HB.deep, 0));
  g.addColorStop(1, rgba(HB.deep, 0.32));
  ctx.fillStyle = g;
  ctx.fillRect(0, bot - 3.4, 12, 3.4);
  const gy = o.big ? 5.9 : 5.4;
  g = ctx.createRadialGradient(3.9, gy, 0.2, 3.9, gy, 2.7);
  g.addColorStop(0, rgba('#ffffff', 0.42));
  g.addColorStop(1, rgba('#ffffff', 0));
  ctx.fillStyle = g;
  ctx.fillRect(1.2, gy - 2.7, 5.4, 5.4);
  g = ctx.createLinearGradient(1.3, 0, 3.6, 0);
  g.addColorStop(0, rgba(HB.lit, 0.35));
  g.addColorStop(1, rgba(HB.lit, 0));
  ctx.fillStyle = g;
  ctx.fillRect(1.2, 3, 2.6, bot - 3);
  ctx.restore();
  const seeds = o.big ? SEEDS_BIG : SEEDS_SMALL;
  for (const s of seeds) seed(ctx, s[0], s[1], s[2], RM.heroSeed.lit, HB.deep, RM.heroSeed.hi);
  // contact shadow where the cap meets the body, then the cap itself
  ctx.save();
  path(ctx);
  ctx.clip();
  ell(ctx, 6.0, 3.9, 3.5, 0.9);
  ctx.fillStyle = rgba(HB.deep, 0.26);
  ctx.fill();
  ctx.restore();
  cap(ctx);
  // face
  const ey = o.big ? 6.5 : 5.9;
  const ex = o.big ? 0.5 : 0.35;
  eye(ctx, 3.85 - ex, ey, o.big ? 1.2 : 1.15, o.big ? 1.35 : 1.32, o.blink);
  eye(ctx, 8.15 + ex, ey, o.big ? 1.2 : 1.15, o.big ? 1.35 : 1.32, o.blink);
  const my = o.big ? 9.3 : 8.2;
  ctx.strokeStyle = rgba(P.black, 0.7);
  ctx.lineWidth = 0.42;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.arc(6, my - 0.25, o.big ? 0.95 : 0.85, Math.PI * 0.2, Math.PI * 0.8);
  ctx.stroke();
  if (squash) ctx.restore();
}

// Nine frames, in the frozen order:
// 0 idle, 1 blink, 2-5 run (stride, pass, strideBack, together), 6 jump, 7 fall, 8 land.
function heroFrames(big) {
  const F = big ? FEET_BIG : FEET_SMALL;
  const specs = [
    ['stand', false, false],
    ['together', true, false],
    ['stride', false, false],
    ['pass', false, false],
    ['strideBack', false, false],
    ['together', false, false],
    ['splay', false, false],
    ['dangle', false, false],
    ['flat', false, true],
  ];
  return specs.map(([pose, blink, squash]) => (ctx) => paintHero(ctx, { big, blink, squash, feet: F[pose] }));
}

// ------------------------------------------------------------------ the turnip
const FEET_TURNIP = [
  [[4.5, 12.00, 2.3, 1.9, -0.06], [8.5, 12.00, 2.3, 1.9, 0.06]], // spread
  [[5.7, 12.05, 2.2, 1.8, -0.04], [7.3, 12.05, 2.2, 1.8, 0.04]], // together
  [[5.2, 11.95, 2.2, 1.8, -0.05], [7.8, 12.05, 2.2, 1.8, 0.05]], // passing
  [[5.0, 12.00, 2.3, 1.9, -0.06], [9.0, 11.55, 2.2, 1.8, 0.45]], // kick
];

function paintTurnipFrame(ctx, footPose) {
  const T = RM.turnipBody;
  const L = RM.heroLeaf;
  for (const f of FEET_TURNIP[footPose]) foot(ctx, f[0], f[1], f[2], f[3], f[4] || 0, T.base, T.shade, T.deep);
  ctx.beginPath();
  ctx.moveTo(6.5, 11.0);
  ctx.bezierCurveTo(4.9, 10.9, 3.2, 9.6, 2.75, 7.2);
  ctx.bezierCurveTo(2.35, 5.0, 3.4, 3.35, 6.5, 3.35);
  ctx.bezierCurveTo(9.6, 3.35, 10.65, 5.0, 10.25, 7.2);
  ctx.bezierCurveTo(9.8, 9.6, 8.1, 10.9, 6.5, 11.0);
  ctx.closePath();
  let g = ctx.createLinearGradient(3.8, 3.5, 9.2, 10.4);
  g.addColorStop(0, T.lit);
  g.addColorStop(0.5, T.base);
  g.addColorStop(1, T.shade);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.save();
  ctx.clip();
  // tan tint toward the root tip, faint creases, cap contact shadow, speckle
  g = ctx.createRadialGradient(6.5, 10.8, 0.3, 6.5, 10.8, 3.4);
  g.addColorStop(0, rgba(P.turnipTip, 0.5));
  g.addColorStop(1, rgba(P.turnipTip, 0));
  ctx.fillStyle = g;
  ctx.fillRect(2, 7, 9, 4);
  ctx.strokeStyle = rgba(T.deep, 0.16);
  ctx.lineWidth = 0.4;
  for (const y of [5.6, 7.6]) {
    ctx.beginPath();
    ctx.moveTo(3.3, y - 0.15);
    ctx.quadraticCurveTo(6.5, y + 0.75, 9.7, y - 0.15);
    ctx.stroke();
  }
  ell(ctx, 6.5, 3.9, 3.1, 0.8);
  ctx.fillStyle = rgba(T.deep, 0.22);
  ctx.fill();
  for (let i = 0; i < 10; i++) {
    const x = 3 + h2(i, 1, 41) * 7;
    const y = 4.4 + h2(i, 2, 41) * 5.6;
    if (x > 3.8 && x < 9.2 && y > 4.2 && y < 8.2) continue; // keep the face clean
    ell(ctx, x, y, 0.14, 0.14);
    ctx.fillStyle = rgba(T.deep, 0.1);
    ctx.fill();
  }
  ctx.restore();
  // root hair
  ctx.strokeStyle = rgba(P.turnipTip, 0.55);
  ctx.lineWidth = 0.5;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(6.5, 11.0);
  ctx.quadraticCurveTo(6.9, 11.9, 6.6, 12.6);
  ctx.stroke();
  // leaves
  const base = L.base;
  const tip = L.lit;
  const edge = L.deep;
  leaf(ctx, 6.5, 3.5, 2.3, 2.1, 0.7, base, tip, edge);
  leaf(ctx, 6.5, 3.5, 10.7, 2.1, 0.7, base, tip, edge);
  leaf(ctx, 6.5, 3.5, 4.4, 0.9, 0.85, base, tip, edge);
  leaf(ctx, 6.5, 3.5, 8.6, 0.9, 0.85, base, tip, edge);
  leaf(ctx, 6.5, 3.5, 6.5, 0.25, 1.0, base, tip, edge);
  // face
  eye(ctx, 4.9, 5.7, 1.05, 1.25, false);
  eye(ctx, 8.1, 5.7, 1.05, 1.25, false);
  ell(ctx, 6.5, 7.9, 0.42, 0.5);
  ctx.fillStyle = rgba(P.black, 0.65);
  ctx.fill();
}

// ------------------------------------------------------------------ the boss (crowned pineapple)
const BOSS_BODY = [
  // [topY, bottomY, leftX, rightX] per row band, from BOSS_ROWS in the old sprites.js —
  // the silhouette is the same barrel, just smoothed.
  [4, 5, 6, 25], [6, 8, 4, 27], [9, 25, 2, 29], [26, 28, 4, 27], [29, 29, 7, 24], [30, 30, 10, 21],
];

function bossBodyPath(ctx, tuck) {
  ctx.beginPath();
  ctx.moveTo(7.5, 4.8);
  ctx.bezierCurveTo(10.5, 3.4, 19.5, 3.4, 22.5, 4.8);
  ctx.bezierCurveTo(26.8, 6.6, 28.6, 9.8, 28.8, 14.2);
  if (tuck) {
    ctx.bezierCurveTo(28.9, 18.6, 27.6, 23.4, 24.2, 26.4);
    ctx.bezierCurveTo(22.2, 28.6, 18, 29.0, 15, 29.0);
    ctx.bezierCurveTo(12, 29.0, 7.8, 28.6, 5.8, 26.4);
    ctx.bezierCurveTo(2.4, 23.4, 1.1, 18.6, 1.2, 14.2);
  } else {
    ctx.bezierCurveTo(28.9, 19.4, 27.4, 24.8, 23.6, 28.4);
    ctx.bezierCurveTo(21.8, 30.4, 18, 30.8, 15, 30.8);
    ctx.bezierCurveTo(12, 30.8, 8.2, 30.4, 6.4, 28.4);
    ctx.bezierCurveTo(2.6, 24.8, 1.1, 19.4, 1.2, 14.2);
  }
  ctx.bezierCurveTo(1.4, 9.8, 3.2, 6.6, 7.5, 4.8);
  ctx.closePath();
}

// One boss frame. o: { high (crown bob), tuck (hop), flash (hurt) }.
function paintBossFrame(ctx, o) {
  const PN = RM.pineapple;
  const CW = RM.crown;
  bossBodyPath(ctx, o.tuck);
  const bot = o.tuck ? 29.0 : 30.8;
  let g = ctx.createLinearGradient(0, 4, 0, bot);
  g.addColorStop(0, PN.lit);
  g.addColorStop(0.4, PN.base);
  g.addColorStop(0.8, PN.shade);
  g.addColorStop(1, PN.deep);
  ctx.fillStyle = g;
  ctx.fill();
  // texture, clipped to the body
  ctx.save();
  bossBodyPath(ctx, o.tuck);
  ctx.clip();
  // left keylight wash
  g = ctx.createLinearGradient(1, 6, 17, 10);
  g.addColorStop(0, rgba(PN.hi, 0.30));
  g.addColorStop(1, rgba(PN.hi, 0));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 30, 31);
  // pineapple lattice: two diagonal directions, dark line with a light edge (the bevel)
  const step = 6.5;
  for (let pass = 0; pass < 2; pass++) {
    ctx.strokeStyle = pass ? rgba(PN.hi, 0.16) : rgba(PN.deep, 0.30);
    ctx.lineWidth = 0.55;
    ctx.beginPath();
    for (let c = -31; c <= 31; c += step) {
      ctx.moveTo(c, pass ? -0.3 : 0);
      ctx.lineTo(c + 31, pass ? 30.7 : 31);
    }
    for (let c = 2; c <= 62; c += step) {
      ctx.moveTo(c, pass ? -0.3 : 0);
      ctx.lineTo(c - 31, pass ? 30.7 : 31);
    }
    ctx.stroke();
  }
  // key glow + bottom AO + speckle
  g = ctx.createRadialGradient(8.5, 8.5, 0.5, 8.5, 8.5, 11);
  g.addColorStop(0, rgba(PN.hi, 0.32));
  g.addColorStop(1, rgba(PN.hi, 0));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 30, 31);
  g = ctx.createLinearGradient(0, o.tuck ? 24 : 25.5, 0, bot);
  g.addColorStop(0, rgba(PN.deep, 0));
  g.addColorStop(1, rgba(PN.deep, 0.30));
  ctx.fillStyle = g;
  ctx.fillRect(0, 20, 30, 11);
  for (let i = 0; i < 26; i++) {
    const x = 3 + h2(i, 3, 7) * 24;
    const y = 6 + h2(i, 5, 7) * 22;
    ell(ctx, x, y, 0.16, 0.16);
    ctx.fillStyle = rgba(PN.deep, 0.07);
    ctx.fill();
  }
  ctx.restore();
  // face: angry brows, eyes, grin with teeth
  ctx.strokeStyle = rgba(PN.deep, 0.55);
  ctx.lineWidth = 0.9;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(9.0, 11.8);
  ctx.lineTo(12.5, 12.7);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(22.6, 11.8);
  ctx.lineTo(19.1, 12.7);
  ctx.stroke();
  eye(ctx, 10.9, 14.6, 1.7, 2.0, false);
  eye(ctx, 20.9, 14.6, 1.7, 2.0, false);
  ctx.beginPath();
  ctx.moveTo(12.4, 18.8);
  ctx.quadraticCurveTo(15, 21.2, 17.6, 18.8);
  ctx.quadraticCurveTo(15, 19.9, 12.4, 18.8);
  ctx.closePath();
  ctx.fillStyle = rgba(P.black, 0.92);
  ctx.fill();
  ctx.fillStyle = rgba('#ffffff', 0.85);
  ctx.fillRect(13.7, 19.2, 0.7, 0.5);
  ctx.fillRect(15.6, 19.2, 0.7, 0.5);
  // crown: five gold spikes over a banded base, gems on the band
  const tips = [[2.2, 1.1], [7.2, 0.6], [13.0, 0.25], [18.8, 0.6], [23.8, 1.1]];
  for (const [tx, ty0] of tips) {
    const ty = o.high ? Math.max(0.15, ty0 - 1.0) : ty0;
    const sg = ctx.createLinearGradient(tx, ty, tx, 3.0);
    sg.addColorStop(0, CW.lit);
    sg.addColorStop(1, CW.base);
    ctx.beginPath();
    ctx.moveTo(tx - 1.35, 3.0);
    ctx.lineTo(tx, ty);
    ctx.lineTo(tx + 1.35, 3.0);
    ctx.closePath();
    ctx.fillStyle = sg;
    ctx.fill();
    ctx.strokeStyle = rgba(CW.deep, 0.35);
    ctx.lineWidth = 0.25;
    ctx.stroke();
  }
  rr(ctx, 1.8, 2.9, 24.4, 1.9, 0.8);
  g = ctx.createLinearGradient(0, 2.9, 0, 4.8);
  g.addColorStop(0, CW.lit);
  g.addColorStop(0.55, CW.base);
  g.addColorStop(1, CW.deep);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.strokeStyle = rgba(CW.deep, 0.5);
  ctx.lineWidth = 0.3;
  ctx.beginPath();
  ctx.moveTo(2.3, 4.7);
  ctx.lineTo(25.7, 4.7);
  ctx.stroke();
  for (const [gx, gy] of [[6.5, 3.85], [13.0, 3.85], [19.5, 3.85]]) {
    ell(ctx, gx, gy, 0.42, 0.42);
    ctx.fillStyle = rgba(CW.deep, 0.55);
    ctx.fill();
    ell(ctx, gx - 0.12, gy - 0.14, 0.14, 0.14);
    ctx.fillStyle = rgba('#ffffff', 0.5);
    ctx.fill();
  }
  // hurt flash: a bright wash over the inked art only
  if (o.flash) {
    ctx.globalCompositeOperation = 'source-atop';
    ctx.fillStyle = rgba('#fff6d6', 0.72);
    ctx.fillRect(0, 0, 30, 31);
    ctx.globalCompositeOperation = 'source-over';
  }
}

// ------------------------------------------------------------------ bakes + draw surface
// Six frames: 0,1 idle (rest, bob), 2,3 hop (rest, bob), 4,5 hurt (rest, bob).
const BOSS_FRAMES = [
  (ctx) => paintBossFrame(ctx, { high: false, tuck: false, flash: false }),
  (ctx) => paintBossFrame(ctx, { high: true, tuck: false, flash: false }),
  (ctx) => paintBossFrame(ctx, { high: false, tuck: true, flash: false }),
  (ctx) => paintBossFrame(ctx, { high: true, tuck: true, flash: false }),
  (ctx) => paintBossFrame(ctx, { high: false, tuck: false, flash: true }),
  (ctx) => paintBossFrame(ctx, { high: true, tuck: false, flash: true }),
];

const HERO_BASE = { idle: 0, run: 2, jump: 6, fall: 7, land: 8 };

// Contact shadow specs: {ax, ay} is the art anchor (same as the blit), (cx, cy) the ellipse
// centre in art pixels, rx/ry the radii. The ellipse is drawn live (never baked), so it can
// extend past the art canvas onto the scene.
const SHADOWS = {
  small: { ax: 0, ay: -2, cx: 6, cy: 13.7, rx: 4.6, ry: 1.0 },
  big: { ax: 0, ay: -2, cx: 6, cy: 28.3, rx: 4.9, ry: 1.1 },
  turnip: { ax: -1, ay: -1, cx: 6.5, cy: 13.0, rx: 4.2, ry: 0.9 },
  boss: { ax: -2, ay: -3, cx: 15, cy: 31.1, rx: 11.5, ry: 1.7 },
};

function drawShadow(ctx, x, y, sd, alpha) {
  const cx = Math.floor(x + sd.ax) + sd.cx;
  const cy = Math.floor(y + sd.ay) + sd.cy;
  const g = ctx.createRadialGradient(cx, cy, 0.5, cx, cy, sd.rx);
  g.addColorStop(0, rgba(P.black, alpha));
  g.addColorStop(1, rgba(P.black, 0));
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(1, sd.ry / sd.rx);
  ctx.translate(-cx, -cy);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(cx, cy, sd.rx, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

let HD = null;

function bake(w, h, fn) {
  const { c, ctx } = makeLayer(w * S, h * S);
  ctx.scale(S, S);
  fn(ctx);
  return c;
}

function ensure() {
  if (HD) return;
  HD = {
    small: heroFrames(false).map((fn) => bake(12, 14, fn)),
    big: heroFrames(true).map((fn) => bake(12, 28, fn)),
    turnip: [0, 1, 2, 3].map((f) => bake(13, 13, (ctx) => paintTurnipFrame(ctx, f))),
    boss: BOSS_FRAMES.map((fn) => bake(30, 31, fn)),
  };
}

// Blit a baked canvas at LOGICAL size (w, h): 1:1 under the scene transform, bilinear
// downscale on the logical HUD canvas. Same anchor/flip rect math as atlas.drawRec.
function hdBlit(ctx, c, w, h, x, y, ax, ay, flip) {
  const dx = Math.floor(x + ax);
  const dy = Math.floor(y + ay);
  if (flip) {
    ctx.save();
    ctx.translate(dx + w, dy);
    ctx.scale(-1, 1);
    ctx.drawImage(c, 0, 0, c.width, c.height, 0, 0, w, h);
    ctx.restore();
  } else {
    ctx.drawImage(c, 0, 0, c.width, c.height, dx, dy, w, h);
  }
}

function facingLeft(facing) {
  return facing === -1 || facing === 'left';
}

// Frozen surface (sprites.js had the same signatures; `shadow` is a new optional trailing
// argument, default 0).
export function drawHero(ctx, x, y, facing, big, pose, frame, shadow = 0) {
  ensure();
  const base = HERO_BASE[pose] === undefined ? 0 : HERO_BASE[pose];
  const f = pose === 'run' ? base + (frame & 3) : pose === 'idle' ? base + (frame & 1) : base;
  const bob = pose === 'run' && (frame & 1) ? -1 : 0;
  const set = big ? HD.big : HD.small;
  if (shadow > 0) drawShadow(ctx, x, y, SHADOWS[big ? 'big' : 'small'], shadow);
  hdBlit(ctx, set[f], 12, big ? 28 : 14, x, y + bob, 0, -2, facingLeft(facing));
}

export function drawTurnip(ctx, x, y, frame, facing, shadow = 0) {
  ensure();
  if (shadow > 0) drawShadow(ctx, x, y, SHADOWS.turnip, shadow);
  hdBlit(ctx, HD.turnip[frame & 3], 13, 13, x, y, -1, -1, facingLeft(facing));
}

export function drawBoss(ctx, x, y, frame, facing, hurt, shadow = 0) {
  ensure();
  const f = (hurt ? 4 : (frame & 2) === 2 ? 2 : 0) + (frame & 1);
  if (shadow > 0) drawShadow(ctx, x, y, SHADOWS.boss, shadow);
  hdBlit(ctx, HD.boss[f], 30, 31, x, y, -2, -3, facingLeft(facing));
}
