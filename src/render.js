import { ART_SCALE, PALETTE, VIEW_H, VIEW_W } from './config.js';
import { applyBloom, applyLightmap, buildBloom, drawLightmap, layers, setAmbient } from './composite.js';
import { draw as drawFx, shakeOffset } from './fx.js';
import { ambientFor, bakeLevel, parallaxFor, visibleStrips } from './terrain.js';
import { colorToCss } from './pixels.js';
import {
  TEXT_PITCH,
  drawBerry,
  drawBoss,
  drawFruit,
  drawGate,
  drawGround,
  drawHero,
  drawPixelText,
  drawShard,
  drawTurnip,
} from './sprites.js';

const P = PALETTE;
// the HUD/title ink and the title/GameOver red are the palette's own black/red — alias them
// so a palette edit in config.js reaches the text too
const INK = P.black;
const RED = P.red;
// offset of the INK backing pass behind the white score popups, in source pixels
const POPUP_BACKING_DX = 1;
const POPUP_BACKING_DY = 1;
// ceiling for the LEVEL_CLEAR white flash so the screen never goes full-strength white
const CLEAR_FLASH_MAX_ALPHA = 0.6;
// squashed turnip corpse: the flattened sprite is a turnipBody band this tall, with a
// turnipTip root strip CORPSE_TIP_H rows tall along its bottom edge
const CORPSE_H = 4;
const CORPSE_TIP_H = 1;
// width of the sprite's root column, centred inside the band (sprites draw at x - 1)
const CORPSE_TIP_W = 2;
// gap between the lives cluster and the MUTED badge on the right of the HUD row 1
const MUTED_GAP = 4;
// the 12x12 lives icon draws from y-2 (2 px leaf overhang), so y=6 puts its leaf at the
// top of the 6 px text row instead of floating 2 px above the text it labels
const LIVES_ICON_Y = 6;

function textW(text, scale = 1) {
  return text.length * TEXT_PITCH * scale;
}

function centerText(ctx, text, y, color, scale = 1) {
  drawPixelText(ctx, text, (VIEW_W - textW(text, scale)) / 2, y, color, scale);
}

// The three shipped levels' terrain themes, in level order — the same mapping
// /tmp/vb-w2-logic.mjs sweeps, and the only three names terrain.js's THEMES table carries.
const THEME_NAMES = ['fields', 'canyon', 'palace'];
// One bake PLAN per level, keyed on the level object identity plus the theme: loadLevel()
// re-parses the level, so a restart re-plans and terrain's own bundle/strip cache re-blits
// instead of re-baking (R48). A plan allocates no canvas — strips, ambient and parallax
// appear on first sight inside the three accessors below — so `bakeLevel` runs once per
// level and never inside a steady frame.
let bakedFor = null;
function worldFor(g) {
  const theme = THEME_NAMES[g.levelIndex] || 'fields';
  if (bakedFor && bakedFor.level === g.level && bakedFor.theme === theme) return bakedFor.baked;
  const baked = bakeLevel(g.level, theme);
  // §7's `multiply` base is the LEVEL's aerial-fog tint (`_theme.fog`, an `{r,g,b,a}` object —
  // terrain.js's `mix()` carries `a`), converted through `colorToCss`, the one stringifier that
  // cannot emit `rgba(...,NaN)` from it. Once per level, next to the bake it keys on. A baked
  // plan with no `_theme` leaves composite's own default in place rather than guessing a colour.
  const fog = baked._theme && baked._theme.fog;
  if (fog) setAmbient(colorToCss(fog));
  bakedFor = { level: g.level, theme, baked };
  return baked;
}

// The whole background in 1 + 3 + (4..6) blits: baked sky wash, the three parallax depths,
// then the level's terrain strips. `o` is fx's ONE signed shake int, applied as (o, -o) to
// the destination coordinates — this renderer never sets a canvas transform, so the jolt is
// arithmetic and R45's draw-stream diff keeps working.
function drawWorld(ctx, baked, camX, o, oy) {
  // The ambient ramp is screen-aligned by terrain's contract, so it takes no shake: a
  // shifted full-view blit would leave a transparent row along one edge of the frame.
  ctx.drawImage(ambientFor(baked, camX).canvas, 0, 0, VIEW_W, VIEW_H);
  // Parallax is queried with the TRUE camera (its depth factors are scroll, not shake) and
  // shifted by the whole offset, so the jolt moves the frame rigidly.
  const layers = parallaxFor(baked, camX);
  for (let i = 0; i < layers.length; i++) {
    const L = layers[i];
    ctx.globalAlpha = L.alpha;
    // The layer canvases are art-scale: dest is their logical size, (VIEW_W + period) wide.
    ctx.drawImage(L.canvas, L.dx + o, oy, L.canvas.width / ART_SCALE, L.canvas.height / ART_SCALE);
  }
  ctx.globalAlpha = 1;
  // Strips. The coverage query takes the shake-shifted camera (camX - o) so the 1-3 px the
  // view gains at the trailing edge is painted too, and `dx` is then already relative to
  // that camera — no extra dest offset. The dest is the FULL strip width: a 63-px dest
  // leaves a 1-px uncovered column at every boundary and fakes seam gaps (the seam probe's
  // control measured maxD 233 that way).
  const strips = visibleStrips(baked, camX - o);
  for (let i = 0; i < strips.length; i++) {
    ctx.drawImage(strips[i].canvas, strips[i].dx, oy, baked.stripW, VIEW_H);
  }
}

// `oy` is the vertical half of the camera shake (fx's offset negated); it defaults to 0 so
// every non-shaking call site and harness path draws exactly where it always did.
function drawItems(ctx, items, camX, oy = 0) {
  for (const it of items) {
    const ix = it.x - camX;
    switch (it.kind) {
      case 'fruit':
        drawFruit(ctx, ix, it.y + oy, Math.floor(it.t * 8) % 4);
        break;
      case 'berry':
        drawBerry(ctx, ix, it.y + oy, 0);
        break;
      case 'pop': {
        const py = it.y - 16 * (it.t / 0.25) + oy;
        if (it.what === 'berry') drawBerry(ctx, ix, py, 0);
        else drawFruit(ctx, ix, py, 0);
        break;
      }
      case 'shard':
        drawShard(ctx, ix, it.y + oy, it.k, it.t);
        break;
      case 'popup': {
        const py = it.y - 20 * (it.t / 0.6) + oy;
        // INK backing pass first (offset down-right), then the white text on top,
        // so the popup stays legible over the light sky and stone tiles
        drawPixelText(ctx, it.text, ix + POPUP_BACKING_DX, py + POPUP_BACKING_DY, INK);
        drawPixelText(ctx, it.text, ix, py, P.white);
        break;
      }
    }
  }
}

function drawEnemies(ctx, enemies, camX, oy = 0) {
  for (const e of enemies) {
    if (!e || e.dead) continue;
    const ex = e.x - camX;
    const facing = Math.sign(e.vx) || -1;
    if (e.type === 'boss') {
      if (e.defeated) {
        // 3-frame flip spin over the 1.5 s defeat window
        const spin = Math.floor(e.defeatT * 8) % 3;
        drawBoss(ctx, ex, e.y + oy, spin, spin & 1 ? -facing : facing, false);
      } else {
        drawBoss(ctx, ex, e.y + oy, e.frame || 0, facing, e.hurtT > 0);
      }
    } else {
      const frame = e.frame || 0;
      if (e.squashed) {
        // Corpse: draw the flattened sprite directly — a turnipBody band with the
        // turnipTip root strip on its bottom edge, bottom-anchored at the hitbox floor.
        // Squashing with ctx.scale(1, 4 / 14) instead landed the art on fractional rows
        // (8.29..12.29 of the 14 px-tall art), and fillRect antialiases fractional
        // geometry, so the corpse came out as a faint blurry band.
        const top = e.y + e.h - CORPSE_H + oy;
        ctx.fillStyle = P.turnipBody;
        ctx.fillRect(ex - 1, top, e.w, CORPSE_H);
        ctx.fillStyle = P.turnipTip;
        ctx.fillRect(ex - 1 + (e.w - CORPSE_TIP_W) / 2, top + CORPSE_H - CORPSE_TIP_H, CORPSE_TIP_W, CORPSE_TIP_H);
      } else {
        drawTurnip(ctx, ex, e.y + oy, frame, facing);
      }
    }
  }
}

function drawPlayer(ctx, player, camX, oy = 0) {
  const p = player;
  if (!p || (p.dead && p.deadPit)) return;
  if (p.invulnT > 0 && Math.floor(p.t * 8) % 2 === 1) return; // blink
  const pose = p.dead ? 'jump' : !p.onGround ? 'jump' : Math.abs(p.vx) > 10 ? 'run' : 'idle';
  const frame = pose === 'run' ? Math.floor(p.t * 10) % 2 : 0;
  drawHero(ctx, p.x - camX, p.y + oy, p.facing, p.big, pose, frame);
}

function drawHud(ctx, g) {
  drawPixelText(ctx, 'SCORE ' + String(g.score).padStart(6, '0'), 8, 6, INK);
  drawFruit(ctx, 8, 18, 0);
  drawPixelText(ctx, 'x' + String(g.fruitCount).padStart(2, '0'), 18, 18, INK);
  const world = 'WORLD ' + g.level.label;
  centerText(ctx, world, 6, INK);
  // lives on the right (Poppy mini icon = idle hero), MUTED far right, shifted left when shown
  const livesText = 'x' + g.lives;
  // the MUTED badge width has ONE source so the lives cluster and the badge can never
  // drift into each other: textW('MUTED') = 5 chars * TEXT_PITCH = 30 px at scale 1.
  const MUTED_W = textW('MUTED');
  const mutedShift = g.muted ? MUTED_W + MUTED_GAP : 0;
  const livesX = VIEW_W - 8 - (12 + 1 + textW(livesText)) - mutedShift;
  drawHero(ctx, livesX, LIVES_ICON_Y, 1, false, 'idle', 0);
  drawPixelText(ctx, livesText, livesX + 13, 6, INK);
  if (g.muted) drawPixelText(ctx, 'MUTED', VIEW_W - 8 - MUTED_W, 6, INK);
}

function drawTitle(ctx) {
  ctx.fillStyle = P.sky;
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  for (let sx = 0; sx < VIEW_W; sx += 16) drawGround(ctx, sx, 208, true);
  drawPixelText(ctx, 'VEGGIE BROS.', 29, 60, RED, 3);
  centerText(ctx, 'A STRAWBERRY S ADVENTURE', 110, INK);
  if (Math.floor(Date.now() / 500) % 2 === 0) {
    centerText(ctx, 'PRESS ENTER TO START', 150, INK);
  }
  centerText(ctx, '< > / A D  MOVE   SHIFT RUN', 180, INK);
  centerText(ctx, 'SPACE / Z  JUMP  P PAUSE  M MUTE', 194, INK);
  drawHero(ctx, 100, 197, 1, false, 'idle', 0);
  drawTurnip(ctx, 140, 196, 0, -1);
}

function drawOverlay(ctx, g) {
  switch (g.state) {
    case 'PAUSED':
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(0, 0, VIEW_W, VIEW_H);
      centerText(ctx, 'PAUSED', 96, '#ffffff', 2);
      centerText(ctx, 'P RESUME  R RESTART  M MUTE', 140, '#ffffff');
      break;
    case 'LEVEL_CLEAR':
      // white flash first, clamped, so the overlay text and the HUD stay on top of the fade
      if (g.clearT > 0.9) {
        ctx.save();
        ctx.globalAlpha = Math.min(CLEAR_FLASH_MAX_ALPHA, (g.clearT - 0.9) / 0.5);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, VIEW_W, VIEW_H);
        ctx.restore();
      }
      centerText(ctx, 'STAGE CLEAR', 96, INK, 2);
      centerText(ctx, '+1000', 124, INK);
      break;
    case 'WIN':
      centerText(ctx, 'HARVEST SAVED!', 80, INK, 2);
      centerText(ctx, 'SCORE ' + g.score, 120, INK);
      centerText(ctx, 'PRESS ENTER', 150, INK);
      break;
    case 'GAME_OVER':
      centerText(ctx, 'GAME OVER', 80, RED, 2);
      centerText(ctx, 'SCORE ' + g.score, 120, INK);
      centerText(ctx, 'PRESS ENTER', 150, INK);
      break;
  }
}

export function render(ctx, g) {
  if (g.state === 'TITLE') {
    drawTitle(ctx);
    return;
  }
  const level = g.level;
  const camX = Math.floor(g.cam.x);

  // Camera shake enters as arithmetic: fx hands over ONE signed int, and the world is drawn
  // at (o, -o) by shifting the camera it is measured against. This file sets no canvas
  // transform anywhere (R45 diffs the draw stream), and never the HUD or the overlays (R52).
  const o = shakeOffset();
  const baked = worldFor(g);
  // Everything that can be LIT is drawn into the scene layer, which is a persistent buffer: it
  // is emptied first so the frame cannot inherit last frame's bloom, and the single blit below
  // is the only thing the live canvas ever takes from the world (§7, R52).
  const L = layers();
  const sc = L.scene.ctx;
  sc.clearRect(0, 0, VIEW_W, VIEW_H);
  drawWorld(sc, baked, camX, o, -o);
  // Checkpoints draw NOTHING. `level.checkpoints` stays live gameplay state — the arming band, the
  // hero's left clamp and the camera floor all read it (main.js) — but a banked post is invisible,
  // so there is deliberately no draw call here. `R45` renders a level with and without its
  // checkpoints and requires identical draw streams; the gate below stays world furniture drawn by
  // manual -camX arithmetic, and it sets no canvas transform.
  if (level.gate) drawGate(sc, level.gate.x - (camX - o), level.gate.y - o);
  drawItems(sc, g.items, camX - o, -o);
  drawEnemies(sc, g.enemies, camX - o, -o);
  drawPlayer(sc, g.player, camX - o, -o);
  // Particles sit UNDER the passes (a spark is a light source, not a highlight), and `fx.draw`
  // floors its own destinations and writes no state, so the shake still enters only through
  // the camera it is measured against.
  drawFx(sc, camX - o);
  // §7's fixed order: `drawLightmap` fills the ambient base AND gathers this frame's lights,
  // `buildBloom` reuses that gather (it must run after it, on the same `g`), and each `apply*`
  // is one upscaled blit back into the scene — `multiply` then `lighter`, no other op touches it.
  drawLightmap(g, baked);
  applyLightmap(sc);
  buildBloom(g, baked);
  applyBloom(sc);
  // One blit, 1:1 logical px, on the live context's own nearest-neighbour flag.
  ctx.drawImage(L.scene.c, 0, 0, VIEW_W, VIEW_H);

  // HUD, banner and overlay stay on the LIVE context, after the composite, and take no shake:
  // glyph ink never goes through the scene buffer, so no `multiply`/`lighter` upscale can blur it.
  if (g.state === 'PLAYING' || g.state === 'PAUSED' || g.state === 'LEVEL_CLEAR') {
    drawHud(ctx, g);
  }

  if (g.state === 'PLAYING' && g.bannerT > 0) {
    const text = 'WORLD ' + level.label + ' \u2014 ' + level.name.toUpperCase();
    ctx.save();
    ctx.globalAlpha = Math.min(1, g.bannerT);
    drawPixelText(ctx, text, (VIEW_W - textW(text)) / 2, 60, INK);
    ctx.restore();
  }

  drawOverlay(ctx, g);
}
