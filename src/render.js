import { PALETTE, ROWS, SOLID, VIEW_H, VIEW_W } from './config.js';
import {
  TEXT_PITCH,
  drawBerry,
  drawBrick,
  drawBoss,
  drawBush,
  drawCloud,
  drawFruit,
  drawGate,
  drawGround,
  drawHero,
  drawHill,
  drawPipe,
  drawPixelText,
  drawPlatform,
  drawPumpkin,
  drawShard,
  drawStone,
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

// deterministic pure-integer hash of i (no Math.random)
function hash(i) {
  let h = Math.imul(i, 0x9e3779b1) ^ 0x85ebca6b;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

function textW(text, scale = 1) {
  return text.length * TEXT_PITCH * scale;
}

function centerText(ctx, text, y, color, scale = 1) {
  drawPixelText(ctx, text, (VIEW_W - textW(text, scale)) / 2, y, color, scale);
}

function drawSky(ctx) {
  ctx.fillStyle = P.sky;
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
}

// far hills, 96 px steps, 0.25x scroll, alternating far/near with +/-8 height variance
function drawHills(ctx, camX) {
  const off = camX * 0.25;
  const i0 = Math.floor((off - 48) / 96);
  const i1 = Math.ceil((off + VIEW_W + 48) / 96);
  for (let i = i0; i <= i1; i++) {
    const v = (hash(i) % 17) - 8;
    const sx = Math.floor(i * 96 - off);
    if (i & 1) drawHill(ctx, sx, 168, 28 + v, P.hillNear);
    else drawHill(ctx, sx, 150, 40 + v, P.hillFar);
  }
}

// clouds (128 px steps) and bushes (160 px steps), 0.5x scroll, behind tiles
function drawBackdrops(ctx, camX) {
  const off = camX * 0.5;
  const c0 = Math.floor((off - 16) / 128);
  const c1 = Math.ceil((off + VIEW_W + 16) / 128);
  for (let i = c0; i <= c1; i++) {
    drawCloud(ctx, Math.floor(i * 128 - off), 20 + (hash(i + 777) % 51));
  }
  const b0 = Math.floor((off - 40) / 160);
  const b1 = Math.ceil((off + VIEW_W + 40) / 160);
  for (let i = b0; i <= b1; i++) {
    const h = hash(i + 1234);
    if (h % 5 === 0) continue;
    drawBush(ctx, Math.floor(i * 160 - off) + (h % 24), 219);
  }
}

function bumpOffset(level, tx, ty) {
  for (const b of level.bumps) {
    if (b.x === tx && b.y === ty) return -4 * Math.sin((Math.PI * b.t) / 0.15);
  }
  return 0;
}

function drawTiles(ctx, level, camX) {
  const cols = level.tiles[0].length;
  const tx0 = Math.floor(camX / 16);
  for (let tx = tx0; tx <= tx0 + 16; tx++) {
    if (tx < 0 || tx >= cols) continue;
    const sx = tx * 16 - camX;
    for (let ty = 0; ty < ROWS; ty++) {
      const ch = level.tiles[ty][tx];
      if (ch === '.' || ch === ' ' || ch === undefined) continue;
      const sy = ty * 16;
      const above = ty > 0 ? level.tiles[ty - 1][tx] : '.';
      switch (ch) {
        case 'X':
          drawGround(ctx, sx, sy, !SOLID.includes(above));
          break;
        case 'S':
          drawStone(ctx, sx, sy);
          break;
        case 'B':
          drawBrick(ctx, sx, sy + bumpOffset(level, tx, ty));
          break;
        case 'P':
        case 'Q':
          drawPumpkin(ctx, sx, sy + bumpOffset(level, tx, ty), false);
          break;
        case 'U':
          drawPumpkin(ctx, sx, sy, true);
          break;
        case '=':
          drawPlatform(ctx, sx, sy);
          break;
        case '|': {
          const isLeft = tx === 0 || level.tiles[ty][tx - 1] !== '|';
          drawPipe(ctx, sx, sy, above !== '|', isLeft);
          break;
        }
      }
    }
  }
}

function drawItems(ctx, items, camX) {
  for (const it of items) {
    const ix = it.x - camX;
    switch (it.kind) {
      case 'fruit':
        drawFruit(ctx, ix, it.y, Math.floor(it.t * 8) % 4);
        break;
      case 'berry':
        drawBerry(ctx, ix, it.y, 0);
        break;
      case 'pop': {
        const py = it.y - 16 * (it.t / 0.25);
        if (it.what === 'berry') drawBerry(ctx, ix, py, 0);
        else drawFruit(ctx, ix, py, 0);
        break;
      }
      case 'shard':
        drawShard(ctx, ix, it.y, it.k, it.t);
        break;
      case 'popup': {
        const py = it.y - 20 * (it.t / 0.6);
        // INK backing pass first (offset down-right), then the white text on top,
        // so the popup stays legible over the light sky and stone tiles
        drawPixelText(ctx, it.text, ix + POPUP_BACKING_DX, py + POPUP_BACKING_DY, INK);
        drawPixelText(ctx, it.text, ix, py, P.white);
        break;
      }
    }
  }
}

function drawEnemies(ctx, enemies, camX) {
  for (const e of enemies) {
    if (!e || e.dead) continue;
    const ex = e.x - camX;
    const facing = Math.sign(e.vx) || -1;
    if (e.type === 'boss') {
      if (e.defeated) {
        // 3-frame flip spin over the 1.5 s defeat window
        const spin = Math.floor(e.defeatT * 8) % 3;
        drawBoss(ctx, ex, e.y, spin, spin & 1 ? -facing : facing, false);
      } else {
        drawBoss(ctx, ex, e.y, e.frame || 0, facing, e.hurtT > 0);
      }
    } else {
      const frame = e.frame || 0;
      if (e.squashed) {
        // Corpse: draw the flattened sprite directly — a turnipBody band with the
        // turnipTip root strip on its bottom edge, bottom-anchored at the hitbox floor.
        // Squashing with ctx.scale(1, 4 / 14) instead landed the art on fractional rows
        // (8.29..12.29 of the 14 px-tall art), and fillRect antialiases fractional
        // geometry, so the corpse came out as a faint blurry band.
        const top = e.y + e.h - CORPSE_H;
        ctx.fillStyle = P.turnipBody;
        ctx.fillRect(ex - 1, top, e.w, CORPSE_H);
        ctx.fillStyle = P.turnipTip;
        ctx.fillRect(ex - 1 + (e.w - CORPSE_TIP_W) / 2, top + CORPSE_H - CORPSE_TIP_H, CORPSE_TIP_W, CORPSE_TIP_H);
      } else {
        drawTurnip(ctx, ex, e.y, frame, facing);
      }
    }
  }
}

function drawPlayer(ctx, player, camX) {
  const p = player;
  if (!p || (p.dead && p.deadPit)) return;
  if (p.invulnT > 0 && Math.floor(p.t * 8) % 2 === 1) return; // blink
  const pose = p.dead ? 'jump' : !p.onGround ? 'jump' : Math.abs(p.vx) > 10 ? 'run' : 'idle';
  const frame = pose === 'run' ? Math.floor(p.t * 10) % 2 : 0;
  drawHero(ctx, p.x - camX, p.y, p.facing, p.big, pose, frame);
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

  drawSky(ctx);
  drawHills(ctx, camX);
  drawBackdrops(ctx, camX);
  drawTiles(ctx, level, camX);
  if (level.gate) drawGate(ctx, level.gate.x - camX, level.gate.y);
  drawItems(ctx, g.items, camX);
  drawEnemies(ctx, g.enemies, camX);
  drawPlayer(ctx, g.player, camX);

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
