// ui.js — HD UI: real vector font, soft panels, screens (R-4).
//
// R-4 replaced the 5x7 pixel font (the old sprites.js module) with the OS font stack, and
// retired the 256x240 `hud` composite layer: every UI surface now draws on the SCENE layer
// under the HD transform, in the same LOGICAL px grid the pixel font used, so glyphs
// rasterize at 4x device resolution and the 12x12 / 9x9 icon blits (hero lives icon, fruit
// counter) land 1:1 instead of bilinear-downscaling. render.js owns the order: these
// surfaces draw AFTER applyLightmap/applyBloom, so UI is never multiplied, bloomed, or
// shaken, and the world pass's camera shake never reaches it.

import { PALETTE, VIEW_W, VIEW_H } from './config.js';
import { drawHero, drawTurnip } from './chars.js';
import { drawFruit } from './props.js';

const P = PALETTE;
// Zero-dependency stack: the OS UI face (SF Pro on macOS, Segoe UI on Windows). Weights
// 500-800 are used below; canvas rasterizes the vector glyphs at the destination (device)
// resolution, which is the whole point of drawing on the 4x scene instead of the old layer.
const STACK = `-apple-system, "Segoe UI", "Helvetica Neue", Arial, sans-serif`;
// One soft surface for every pill. 0.55 fill, never pure black: the lit sky reads through,
// which is the glass look the panels want over a 1024x960 scene.
const PANEL_FILL = 'rgba(18,22,30,0.55)';
const PANEL_EDGE = 'rgba(255,255,255,0.22)';
// The LEVEL_CLEAR white flash ceiling moved here with the overlay it clamps (render.js
// no longer draws it).
const CLEAR_FLASH_MAX_ALPHA = 0.6;

function setFont(ctx, size, weight) {
  ctx.font = `${weight} ${size}px ${STACK}`;
}

// One pass for every UI string. `align` anchors x (left|center), `mid` centres the text
// vertically on y instead of top-anchoring it. Explicit font/align/baseline every call, so
// nothing leaks into the world passes. Returns the laid-out width.
function text(ctx, str, x, y, o = {}) {
  const { size = 9, weight = 600, color = P.white, align = 'left', mid = false } = o;
  setFont(ctx, size, weight);
  ctx.textAlign = align;
  ctx.textBaseline = mid ? 'middle' : 'top';
  ctx.fillStyle = color;
  ctx.fillText(str, x, y);
  return ctx.measureText(str).width;
}

function textW(ctx, str, size = 9, weight = 600) {
  setFont(ctx, size, weight);
  return ctx.measureText(str).width;
}

// Centre-anchored text.
function centerText(ctx, str, y, o = {}) {
  return text(ctx, str, VIEW_W / 2, y, { ...o, align: 'center' });
}

// Rounded-rect subpath (arcTo, no roundRect dependency).
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

// Soft pill: dark 0.55 fill, device-space drop shadow (shadow offsets/blur ignore the
// current transform, so 10/3 below are DEVICE px), and a 2-device-px light edge.
function panel(ctx, x, y, w, h, r = 5) {
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.35)';
  ctx.shadowBlur = 10;
  ctx.shadowOffsetY = 3;
  ctx.fillStyle = PANEL_FILL;
  rr(ctx, x, y, w, h, r);
  ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.strokeStyle = PANEL_EDGE;
  ctx.lineWidth = 0.5; // logical = 2 device px
  rr(ctx, x + 0.25, y + 0.25, w - 0.5, h - 0.5, Math.max(1, r - 0.25));
  ctx.stroke();
  ctx.restore();
}

// ---------------------------------------------------------------- HUD
// Row geometry, logical px (the same grid the pixel font occupied): left pill (4, 2, 88, 34)
// holds the SCORE row and the fruit row; the WORLD pill is centred at y 2, h 15; the lives
// pill (hero icon 12x12 + "x3") sits far right, the MUTED pill to its left when shown.
export function hud(ctx, g) {
  panel(ctx, 4, 2, 88, 34);
  text(ctx, 'SCORE', 10, 7, { size: 7, weight: 700, color: 'rgba(255,255,255,0.72)' });
  text(ctx, String(g.score).padStart(6, '0'), 86, 5.5, { size: 11, weight: 800, color: P.crown, align: 'right' });
  drawFruit(ctx, 10, 21, 0);
  text(ctx, 'x' + String(g.fruitCount).padStart(2, '0'), 25, 21, { size: 9, weight: 700 });

  const world = 'WORLD ' + g.level.label;
  const ww = textW(ctx, world, 9, 700);
  panel(ctx, (VIEW_W - ww - 14) / 2, 2, ww + 14, 15, 7);
  centerText(ctx, world, 9.5, { size: 9, weight: 700, mid: true });

  // lives far right: the ONE source of the icon+text width so the MUTED pill can never drift
  // into the cluster.
  const livesText = 'x' + g.lives;
  const lw = textW(ctx, livesText, 9, 700);
  const livesW = 5 + 12 + 4 + lw + 5;
  let livesX = VIEW_W - 4 - livesW;
  if (g.muted) {
    const mw = textW(ctx, 'MUTED', 8, 600);
    const mutedW = mw + 12;
    panel(ctx, livesX - 4 - mutedW, 2, mutedW, 15, 7);
    text(ctx, 'MUTED', livesX - 4 - mutedW + 6, 9.5, { size: 8, weight: 600, color: 'rgba(255,255,255,0.8)', mid: true });
    livesX -= 4 + mutedW;
  }
  panel(ctx, livesX, 2, livesW, 15, 7);
  drawHero(ctx, livesX + 5, 2.5, 1, false, 'idle', 0);
  text(ctx, livesText, livesX + 5 + 12 + 4, 9.5, { size: 9, weight: 700, mid: true });
}

// ---------------------------------------------------------------- title
// The backdrop (baked world, level 1, cam 0) is drawn by render.js before this; the scrim,
// logo, copy and the hero/turnip pair (now 1:1 scene blits, not HUD downscales) are here.
export function title(ctx, now) {
  // Gradient scrim: dark at the top where the logo sits, gone by the mid-frame, so the sky
  // art stays the backdrop instead of a flat colour.
  const sky = ctx.createLinearGradient(0, 0, 0, 170);
  sky.addColorStop(0, 'rgba(10,14,22,0.45)');
  sky.addColorStop(0.55, 'rgba(10,14,22,0.18)');
  sky.addColorStop(1, 'rgba(10,14,22,0)');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, VIEW_W, 170);

  // Logo: warm fruit gradient, black rim (round joins, stroke under fill), a device-space
  // drop shadow, and a 1.5 px bob so the front page is alive.
  const ly = 42 + Math.sin(now / 900) * 1.5;
  ctx.save();
  const grad = ctx.createLinearGradient(0, ly, 0, ly + 42);
  grad.addColorStop(0, '#ffe27a');
  grad.addColorStop(0.45, P.crown);
  grad.addColorStop(0.8, '#ff8a30');
  grad.addColorStop(1, P.red);
  ctx.font = `800 34px ${STACK}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.lineJoin = 'round';
  ctx.lineWidth = 5;
  ctx.strokeStyle = P.black;
  ctx.shadowColor = 'rgba(0,0,0,0.4)';
  ctx.shadowBlur = 16;
  ctx.shadowOffsetY = 6;
  ctx.strokeText('VEGGIE BROS.', VIEW_W / 2, ly);
  ctx.shadowColor = 'transparent';
  ctx.fillStyle = grad;
  ctx.fillText('VEGGIE BROS.', VIEW_W / 2, ly);
  ctx.restore();

  centerText(ctx, "A STRAWBERRY'S ADVENTURE", 96, { size: 9.5, weight: 600, color: 'rgba(255,255,255,0.92)' });
  if (Math.floor(now / 500) % 2 === 0) {
    const s = 'PRESS ENTER TO START';
    const w = textW(ctx, s, 11, 700);
    panel(ctx, (VIEW_W - w - 28) / 2, 132, w + 28, 20, 10);
    centerText(ctx, s, 142, { size: 11, weight: 700, mid: true });
  }
  centerText(ctx, '< > / A D   MOVE     SHIFT RUN', 170, { size: 8, weight: 500, color: 'rgba(255,255,255,0.75)' });
  centerText(ctx, 'SPACE / Z   JUMP    P PAUSE    M MUTE', 184, { size: 8, weight: 500, color: 'rgba(255,255,255,0.75)' });
  // The title pair stands on the real baked ground at cam 0 — same logical spots as the old
  // HUD draws, now crisp 1:1 bakes with their live contact shadows.
  drawHero(ctx, 100, 197, 1, false, 'idle', 0, 0.24);
  drawTurnip(ctx, 140, 196, 0, -1, 0.22);
}

// ---------------------------------------------------------------- banner + overlays
// Level-start banner: one pill + line, fading with the gameplay-owned bannerT.
export function banner(ctx, g) {
  const s = 'WORLD ' + g.level.label + ' \u2014 ' + g.level.name.toUpperCase();
  const w = textW(ctx, s, 11, 700);
  ctx.save();
  ctx.globalAlpha = Math.min(1, g.bannerT);
  panel(ctx, (VIEW_W - w - 28) / 2, 52, w + 28, 22, 11);
  centerText(ctx, s, 63, { size: 11, weight: 700, mid: true });
  ctx.restore();
}

// Full-frame scrim behind the pause/end text; the old 0.5 flat black, warmed a touch.
function scrim(ctx) {
  ctx.fillStyle = 'rgba(10,12,16,0.55)';
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
}

const blink = (now) => Math.floor(now / 500) % 2 === 0;

// PAUSED / LEVEL_CLEAR / WIN / GAME_OVER. LEVEL_CLEAR keeps its white flash (clamped) and
// puts its title line on a dark pill so it stays readable over BOTH the flash and the scene;
// the other three get the full scrim.
export function overlay(ctx, g, now) {
  switch (g.state) {
    case 'PAUSED':
      scrim(ctx);
      centerText(ctx, 'PAUSED', 88, { size: 24, weight: 800 });
      centerText(ctx, 'P RESUME    R RESTART    M MUTE', 136, { size: 9, weight: 600, color: 'rgba(255,255,255,0.85)' });
      break;
    case 'LEVEL_CLEAR':
      if (g.clearT > 0.9) {
        ctx.save();
        ctx.globalAlpha = Math.min(CLEAR_FLASH_MAX_ALPHA, (g.clearT - 0.9) / 0.5);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, VIEW_W, VIEW_H);
        ctx.restore();
      }
      {
        const s = 'STAGE CLEAR';
        const w = textW(ctx, s, 24, 800);
        panel(ctx, (VIEW_W - w - 36) / 2, 82, w + 36, 36, 10);
        centerText(ctx, s, 100, { size: 24, weight: 800, mid: true });
      }
      centerText(ctx, '+1000', 128, { size: 12, weight: 700, color: P.crown });
      break;
    case 'WIN':
      scrim(ctx);
      centerText(ctx, 'HARVEST SAVED!', 80, { size: 24, weight: 800 });
      centerText(ctx, 'SCORE ' + g.score, 120, { size: 12, weight: 700, color: P.crown });
      if (blink(now)) centerText(ctx, 'PRESS ENTER', 150, { size: 10, weight: 600 });
      break;
    case 'GAME_OVER':
      scrim(ctx);
      centerText(ctx, 'GAME OVER', 80, { size: 24, weight: 800, color: P.red });
      centerText(ctx, 'SCORE ' + g.score, 120, { size: 12, weight: 700, color: P.crown });
      if (blink(now)) centerText(ctx, 'PRESS ENTER', 150, { size: 10, weight: 600 });
      break;
  }
}

// Score popup ("+100" etc) inside drawItems: white with a black rim, top-left anchored at
// the item's logical spot exactly where the pixel text used to land.
export function popup(ctx, str, x, y) {
  setFont(ctx, 8.5, 800);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.lineJoin = 'round';
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = P.black;
  ctx.strokeText(str, x, y);
  ctx.fillStyle = P.white;
  ctx.fillText(str, x, y);
}
