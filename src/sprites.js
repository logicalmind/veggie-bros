import { PALETTE } from './config.js';

const P = PALETTE;

function px(ctx, x, y, w, h, color) {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, h);
}

function dir(facing) {
  return facing === -1 || facing === 'left' ? -1 : 1;
}

export function drawHero(ctx, x, y, facing, big, pose, frame) {
  const fx = dir(facing);
  const top = y - 2;
  const b = top + (pose === 'run' && frame & 1 ? -1 : 0);
  const e = fx === 1 ? 1 : 0;
  const off = pose === 'run' ? (frame & 1 ? 1 : -1) : 0;

  px(ctx, x + 5, b, 1, 1, P.heroLeaf);
  for (const c of [1, 3, 5, 7, 9]) px(ctx, x + c, b + 1, 1, 1, P.heroLeaf);
  px(ctx, x, b + 2, 12, 1, P.heroLeaf);

  if (!big) {
    px(ctx, x, b + 3, 12, 2, P.heroBody);
    px(ctx, x + 1, b + 5, 10, 2, P.heroBody);
    px(ctx, x + 2, b + 7, 8, 2, P.heroBody);
    px(ctx, x + 3, b + 9, 6, 1, P.heroBody);
    px(ctx, x + 3, b + 4, 2, 2, P.white);
    px(ctx, x + 8, b + 4, 2, 2, P.white);
    px(ctx, x + 3 + e, b + 5, 1, 1, P.black);
    px(ctx, x + 8 + e, b + 5, 1, 1, P.black);
    px(ctx, x + 2, b + 6, 1, 1, P.heroSeed);
    px(ctx, x + 9, b + 6, 1, 1, P.heroSeed);
    px(ctx, x + 4, b + 8, 1, 1, P.heroSeed);
    px(ctx, x + 7, b + 8, 1, 1, P.heroSeed);
    const legTop = pose === 'jump' ? b + 12 : b + 10;
    px(ctx, x + 3 + off, legTop, 2, b + 14 - legTop, P.heroDark);
    px(ctx, x + 7 - off, legTop, 2, b + 14 - legTop, P.heroDark);
  } else {
    px(ctx, x, b + 3, 12, 4, P.heroBody);
    px(ctx, x + 1, b + 7, 10, 3, P.heroBody);
    px(ctx, x + 2, b + 10, 8, 3, P.heroBody);
    px(ctx, x + 3, b + 13, 6, 3, P.heroBody);
    px(ctx, x + 4, b + 16, 4, 4, P.heroBody);
    px(ctx, x + 3, b + 5, 2, 2, P.white);
    px(ctx, x + 8, b + 5, 2, 2, P.white);
    px(ctx, x + 3 + e, b + 6, 1, 1, P.black);
    px(ctx, x + 8 + e, b + 6, 1, 1, P.black);
    px(ctx, x + 2, b + 8, 1, 1, P.heroSeed);
    px(ctx, x + 9, b + 8, 1, 1, P.heroSeed);
    px(ctx, x + 4, b + 12, 1, 1, P.heroSeed);
    px(ctx, x + 7, b + 12, 1, 1, P.heroSeed);
    const legTop = pose === 'jump' ? b + 22 : b + 20;
    px(ctx, x + 3 + off, legTop, 2, b + 28 - legTop, P.heroDark);
    px(ctx, x + 7 - off, legTop, 2, b + 28 - legTop, P.heroDark);
  }
}

export function drawTurnip(ctx, x, y, frame, facing) {
  const fx = dir(facing);
  const sx = x - 1;
  const sy = y - 1;
  px(ctx, sx + 3, sy, 1, 1, P.heroLeaf);
  px(ctx, sx + 6, sy, 2, 1, P.heroLeaf);
  px(ctx, sx + 10, sy, 1, 1, P.heroLeaf);
  px(ctx, sx + 4, sy + 1, 6, 1, P.heroLeaf);
  px(ctx, sx + 4, sy + 2, 6, 1, P.turnipBody);
  px(ctx, sx + 2, sy + 3, 10, 1, P.turnipBody);
  px(ctx, sx + 1, sy + 4, 12, 2, P.turnipBody);
  px(ctx, sx + 2, sy + 6, 10, 1, P.turnipBody);
  px(ctx, sx + 3, sy + 7, 8, 1, P.turnipBody);
  px(ctx, sx + 6, sy + 8, 2, 2, P.turnipTip);
  px(ctx, sx + 4, sy + 4, 2, 2, P.white);
  px(ctx, sx + 9, sy + 4, 2, 2, P.white);
  const e = fx === 1 ? 1 : 0;
  px(ctx, sx + 4 + e, sy + 5, 1, 1, P.black);
  px(ctx, sx + 9 + e, sy + 5, 1, 1, P.black);
  const off = frame & 1 ? 1 : -1;
  px(ctx, sx + 4 + off, sy + 11, 2, 2, P.turnipBody);
  px(ctx, sx + 8 - off, sy + 11, 2, 2, P.turnipBody);
}

export function drawBoss(ctx, x, y, frame, facing, hurt) {
  const fx = dir(facing);
  const sx = x - 2;
  const sy = y - 2;
  const bob = frame & 1 ? -1 : 0;
  const bodyC = hurt ? P.white : P.pineapple;
  const hatchC = hurt ? P.white : P.pineappleDark;
  const faceC = hurt ? P.white : P.black;

  // Only the crown spikes bob (they live above the hitbox top); the body must
  // stay glued to the box because moveY holds the physics box still.
  for (const c of [4, 9, 15, 21, 26]) px(ctx, sx + c, sy + bob, 1, 1, P.heroLeaf);
  for (const c of [3, 8, 14, 19, 25]) px(ctx, sx + c, sy + 1 + bob, 2, 1, P.heroLeaf);
  px(ctx, sx + 2, sy + 2, 28, 1, P.heroLeaf);

  const rows = [
    [3, 4, 6, 25],
    [5, 7, 4, 27],
    [8, 24, 2, 29],
    [25, 27, 4, 27],
    [28, 28, 7, 24],
    [29, 29, 10, 21],
  ];
  for (const [r0, r1, l, r] of rows) px(ctx, sx + l, sy + r0, r - l + 1, r1 - r0 + 1, bodyC);
  for (const [r0, r1, l, r] of rows) {
    for (let rr = r0; rr <= r1; rr++) {
      for (let c = l; c <= r; c++) {
        if ((c + rr) % 7 === 0 || ((c - rr) % 7 + 7) % 7 === 0) px(ctx, sx + c, sy + rr, 1, 1, hatchC);
      }
    }
  }

  px(ctx, sx + 10, sy + 12, 2, 2, P.white);
  px(ctx, sx + 20, sy + 12, 2, 2, P.white);
  const e = fx === 1 ? 1 : 0;
  px(ctx, sx + 10 + e, sy + 13, 1, 1, faceC);
  px(ctx, sx + 20 + e, sy + 13, 1, 1, faceC);
  px(ctx, sx + 14, sy + 18, 4, 2, faceC);
}

const FRUIT_STAR = [
  '...XX...',
  '..XXXX..',
  '..XXXX..',
  '.XXXXXX.',
  'XXXXXXXX',
  '.XX..XX.',
  '.X....X.',
  '..X..X..',
];

export function drawFruit(ctx, x, y, frame) {
  const w = [8, 4, 2, 4][frame & 3];
  const f = w / 8;
  const cells = new Set();
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      if (FRUIT_STAR[r][c] === 'X') cells.add(r * 16 + Math.round(3.5 + (c - 3.5) * f));
    }
  }
  const outline = new Set();
  for (const k of cells) {
    const r = (k / 16) | 0;
    const c = k % 16;
    if (r > 0 && !cells.has(k - 16)) outline.add(k - 16);
    if (r < 15 && !cells.has(k + 16)) outline.add(k + 16);
    if (c > 0 && !cells.has(k - 1)) outline.add(k - 1);
    if (c < 15 && !cells.has(k + 1)) outline.add(k + 1);
  }
  for (const k of outline) px(ctx, x + (k % 16), y + ((k / 16) | 0), 1, 1, P.black);
  for (const k of cells) px(ctx, x + (k % 16), y + ((k / 16) | 0), 1, 1, P.crown);
}

export function drawBerry(ctx, x, y, frame) {
  // The art is authored inside the berry's hitbox (items.js BERRY_W/BERRY_H = 14x8):
  // body rows 2..6, with the outline generators landing on rows 1 and 7 and columns
  // 0..13. The bottom outline row IS the hitbox's bottom row, so a berry at rest sits
  // on the floor instead of floating above it, and the pickup rect covers the art.
  const widths = [8, 12, 12, 12, 8];
  const cells = new Set();
  for (let i = 0; i < widths.length; i++) {
    const r = 2 + i;
    const l = (14 - widths[i]) / 2;
    for (let c = l; c < l + widths[i]; c++) cells.add(r * 16 + c);
  }
  const outline = new Set();
  for (const k of cells) {
    const r = (k / 16) | 0;
    const c = k % 16;
    if (r > 0 && !cells.has(k - 16)) outline.add(k - 16);
    if (r < 15 && !cells.has(k + 16)) outline.add(k + 16);
    if (c > 0 && !cells.has(k - 1)) outline.add(k - 1);
    if (c < 15 && !cells.has(k + 1)) outline.add(k + 1);
  }
  for (const k of outline) px(ctx, x + (k % 16), y + ((k / 16) | 0), 1, 1, P.berryDark);
  for (const k of cells) px(ctx, x + (k % 16), y + ((k / 16) | 0), 1, 1, P.berryBody);
  px(ctx, x + 5, y + 3, 5, 1, P.berryDark);
  px(ctx, x + 3, y + 4 + (frame & 1 ? 1 : 0), 1, 2, P.white);
}

export function drawGround(ctx, x, y, top) {
  px(ctx, x, y, 16, 16, P.dirt);
  px(ctx, x + 2, y + 4, 1, 1, P.dirtDark);
  px(ctx, x + 7, y + 6, 1, 1, P.dirtDark);
  px(ctx, x + 12, y + 5, 1, 1, P.dirtDark);
  px(ctx, x + 4, y + 11, 1, 1, P.dirtDark);
  px(ctx, x + 11, y + 13, 1, 1, P.dirtDark);
  px(ctx, x, y + 15, 16, 1, P.black);
  if (top) {
    px(ctx, x, y, 16, 4, P.grass);
    px(ctx, x, y + 4, 16, 1, P.dirtDark);
  }
}

export function drawStone(ctx, x, y) {
  px(ctx, x, y, 16, 16, P.stone);
  px(ctx, x, y, 16, 1, P.white);
  px(ctx, x, y, 1, 16, P.white);
  px(ctx, x, y + 15, 16, 1, P.stoneDark);
  px(ctx, x + 15, y, 1, 16, P.stoneDark);
}

export function drawBrick(ctx, x, y) {
  px(ctx, x, y, 16, 16, P.brick);
  px(ctx, x, y + 5, 16, 1, P.brickDark);
  px(ctx, x, y + 10, 16, 1, P.brickDark);
  px(ctx, x + 5, y, 1, 5, P.brickDark);
  px(ctx, x + 11, y, 1, 5, P.brickDark);
  px(ctx, x + 8, y + 6, 1, 9, P.brickDark);
  px(ctx, x, y, 16, 1, P.brickDark);
  px(ctx, x, y + 15, 16, 1, P.brickDark);
  px(ctx, x, y, 1, 16, P.brickDark);
  px(ctx, x + 15, y, 1, 16, P.brickDark);
}

export function drawPumpkin(ctx, x, y, used) {
  if (used) {
    px(ctx, x, y, 16, 16, P.used);
    px(ctx, x, y, 16, 1, P.usedDark);
    px(ctx, x, y + 15, 16, 1, P.usedDark);
    px(ctx, x, y, 1, 16, P.usedDark);
    px(ctx, x + 15, y, 1, 16, P.usedDark);
    return;
  }
  px(ctx, x, y, 16, 16, P.pumpkin);
  px(ctx, x + 4, y, 1, 16, P.pumpkinDark);
  px(ctx, x + 11, y, 1, 16, P.pumpkinDark);
  px(ctx, x + 7, y, 1, 2, P.pumpkinDark);
  px(ctx, x + 3, y + 7, 2, 1, P.pumpkinLit);
  px(ctx, x + 4, y + 6, 1, 1, P.pumpkinLit);
  px(ctx, x + 10, y + 6, 1, 1, P.pumpkinLit);
  px(ctx, x + 10, y + 7, 2, 1, P.pumpkinLit);
  px(ctx, x + 6, y + 10, 1, 1, P.pumpkinLit);
  px(ctx, x + 8, y + 11, 1, 1, P.pumpkinLit);
  px(ctx, x + 10, y + 10, 1, 1, P.pumpkinLit);
  px(ctx, x, y, 16, 1, P.pumpkinDark);
  px(ctx, x, y + 15, 16, 1, P.pumpkinDark);
  px(ctx, x, y, 1, 16, P.pumpkinDark);
  px(ctx, x + 15, y, 1, 16, P.pumpkinDark);
}

export function drawPlatform(ctx, x, y) {
  px(ctx, x, y, 16, 16, P.platform);
  px(ctx, x, y, 1, 16, P.bush);
  px(ctx, x + 15, y, 1, 16, P.bush);
  px(ctx, x, y, 16, 1, P.platformDark);
  px(ctx, x, y + 15, 16, 1, P.platformDark);
  px(ctx, x + 4, y + 6, 1, 1, P.black);
  px(ctx, x + 8, y + 9, 1, 1, P.black);
  px(ctx, x + 12, y + 5, 1, 1, P.black);
}

export function drawPipe(ctx, x, y, isTop, isLeft) {
  // body inset 2 px on the outer side so the top cap can overhang the pipe run
  const bx = isLeft ? x + 2 : x;
  px(ctx, bx, y, 14, 16, P.pipe);
  px(ctx, x + 3, y, 1, 16, P.pipeDark);
  px(ctx, x + 11, y, 1, 16, P.pipeDark);
  if (isLeft) px(ctx, x + 14, y, 2, 16, P.pipeFlesh);
  else px(ctx, x, y, 2, 16, P.pipeFlesh);
  if (isTop) {
    px(ctx, x, y, 16, 2, P.pipeDark);
    px(ctx, x, y + 2, 16, 3, P.pipeFlesh);
  }
}

export function drawGate(ctx, x, y) {
  // (x, y) is the bottom gate tile; posts run up to the arch
  px(ctx, x, y - 64, 2, 80, P.stone);
  px(ctx, x + 1, y - 64, 1, 80, P.stoneDark);
  px(ctx, x + 30, y - 64, 2, 80, P.stone);
  px(ctx, x + 31, y - 64, 1, 80, P.stoneDark);

  const ay = y - 96; // top 2x2 tiles
  px(ctx, x + 2, ay, 28, 2, P.pipe);
  px(ctx, x + 1, ay + 2, 30, 1, P.pipe);
  px(ctx, x, ay + 3, 32, 29, P.pipe);
  px(ctx, x + 4, ay, 24, 2, P.pipeFlesh);
  px(ctx, x + 3, ay + 2, 26, 1, P.pipeFlesh);
  px(ctx, x + 2, ay + 3, 28, 29, P.pipeFlesh);
  px(ctx, x + 8, ay + 12, 1, 1, P.black);
  px(ctx, x + 24, ay + 12, 1, 1, P.black);
  px(ctx, x + 16, ay + 16, 1, 1, P.black);

  px(ctx, x + 15, ay - 5, 1, 5, P.stoneDark);
  px(ctx, x + 16, ay - 7, 3, 1, P.red);
  px(ctx, x + 16, ay - 6, 2, 1, P.red);
  px(ctx, x + 16, ay - 5, 1, 1, P.red);
}

export function drawHill(ctx, x, y, r, color) {
  for (let h = 0; h <= r; h++) {
    const half = r - h;
    px(ctx, x - half, y - h, half * 2 + 1, 1, color);
  }
}

export function drawCloud(ctx, x, y) {
  px(ctx, x + 4, y, 7, 1, P.cloud);
  px(ctx, x + 2, y + 1, 11, 2, P.cloud);
  px(ctx, x, y + 3, 15, 2, P.cloud);
}

export function drawBush(ctx, x, y) {
  px(ctx, x + 3, y, 8, 1, P.bush);
  px(ctx, x + 1, y + 1, 12, 2, P.bush);
  px(ctx, x, y + 3, 14, 2, P.bush);
}

export function drawShard(ctx, x, y, k, t) {
  const ox = (k % 2) * 8;
  const oy = k < 2 ? 0 : 8;
  const dx = k % 2 ? 1 : -1;
  const dy = k < 2 ? -1 : 1;
  const o = Math.round(t * 8);
  px(ctx, x + ox + dx * o, y + oy + dy * o, 4, 4, P.brick);
}

// Authored bitmap text (decision 4): a procedural 5x7 font blitted with fillRect.
// No canvas text API and no offscreen canvas, so ink is identical on every platform,
// the glyph advance can never disagree with the cell, and the renderer needs no DOM.
// A cell is TEXT_PITCH wide (5 inked columns + 1 gap column) and TEXT_CELL_H tall;
// the glyph is centred vertically in the cell so the baseline stays where callers
// already place it.
export const TEXT_PITCH = 6;
export const TEXT_CELL_H = 12;
const FONT_W = 5;
const FONT_H = 7;
const FONT_TOP = Math.round((TEXT_CELL_H - FONT_H) / 2);
const INKED = 'X'; // glyph art marker: 'X' is ink, '.' is empty

// 7 rows of 5 columns, top row first, '/' separated. Covers everything the game draws:
// A-Z 0-9 space : . , - + / ! < > x (HUD "x03") plus the em dash in the level banner
// and the left arrow used by touch hints. Lowercase falls back to uppercase.
const GLYPH_ART = {
  ' ': '...../...../...../...../...../...../.....',
  '!': '..X../..X../..X../..X../..X../...../..X..',
  '+': '...../..X../..X../XXXXX/..X../..X../.....',
  '-': '...../...../...../.XXX./...../...../.....',
  '/': '...../....X/....X/...X./..X../.X.../X....',
  ',': '...../...../...../...../..X../..X../.X...',
  '.': '...../...../...../...../...../..X../..X..',
  ':': '...../..X../..X../...../..X../..X../.....',
  '<': '...X./..X../.X.../X..../.X.../..X../...X.',
  '>': '.X.../..X../...X./....X/...X./..X../.X...',
  A: '.XXX./X...X/X...X/XXXXX/X...X/X...X/X...X',
  B: 'XXXX./X...X/X...X/XXXX./X...X/X...X/XXXX.',
  C: '.XXX./X...X/X..../X..../X..../X...X/.XXX.',
  D: 'XXXX./X...X/X...X/X...X/X...X/X...X/XXXX.',
  E: 'XXXXX/X..../X..../XXXX./X..../X..../XXXXX',
  F: 'XXXXX/X..../X..../XXXX./X..../X..../X....',
  G: '.XXX./X...X/X..../X.XXX/X...X/X...X/.XXX.',
  H: 'X...X/X...X/X...X/XXXXX/X...X/X...X/X...X',
  I: 'XXXXX/..X../..X../..X../..X../..X../XXXXX',
  J: 'XXXXX/...X./...X./...X./...X./X..X./.XX..',
  K: 'X...X/X..X./X.X../XX.../X.X../X..X./X...X',
  L: 'X..../X..../X..../X..../X..../X..../XXXXX',
  M: 'X...X/XX.XX/X.X.X/X.X.X/X...X/X...X/X...X',
  N: 'X...X/XX..X/XX..X/X.X.X/X..XX/X..XX/X...X',
  O: '.XXX./X...X/X...X/X...X/X...X/X...X/.XXX.',
  P: 'XXXX./X...X/X...X/XXXX./X..../X..../X....',
  Q: '.XXX./X...X/X...X/X...X/X.X.X/X..X./.XX.X',
  R: 'XXXX./X...X/X...X/XXXX./X.X../X..X./X...X',
  S: '.XXX./X...X/X..../.XXX./....X/X...X/.XXX.',
  T: 'XXXXX/..X../..X../..X../..X../..X../..X..',
  U: 'X...X/X...X/X...X/X...X/X...X/X...X/.XXX.',
  V: 'X...X/X...X/X...X/X...X/X...X/.X.X./..X..',
  W: 'X...X/X...X/X...X/X.X.X/X.X.X/XX.XX/X...X',
  X: 'X...X/X...X/.X.X./..X../.X.X./X...X/X...X',
  Y: 'X...X/X...X/.X.X./..X../..X../..X../..X..',
  Z: 'XXXXX/....X/...X./..X../.X.../X..../XXXXX',
  '0': '.XXX./X...X/X..XX/X.X.X/XX..X/X...X/.XXX.',
  '1': '..X../.XX../..X../..X../..X../..X../.XXX.',
  '2': '.XXX./X...X/....X/...X./..X../.X.../XXXXX',
  '3': '.XXX./....X/....X/.XXX./....X/....X/.XXX.',
  '4': '...X./..XX./.X.X./X..X./XXXXX/...X./...X.',
  '5': 'XXXXX/X..../XXXX./....X/....X/X...X/.XXX.',
  '6': '..XX./.X.../X..../XXXX./X...X/X...X/.XXX.',
  '7': 'XXXXX/....X/...X./..X../..X../..X../..X..',
  '8': '.XXX./X...X/X...X/.XXX./X...X/X...X/.XXX.',
  '9': '.XXX./X...X/X...X/.XXXX/....X/...X./.XX..',
  x: '...../...../X...X/.X.X./..X../.X.X./X...X',
  '\u2014': '...../...../...../XXXXX/...../...../.....',
  '\u2190': '...../..X../.X.../XXXXX/.X.../..X../.....',
};

const FONT = new Map();
for (const [ch, art] of Object.entries(GLYPH_ART)) FONT.set(ch, art.split('/'));

function glyphRows(ch) {
  return FONT.get(ch) || FONT.get(ch.toUpperCase());
}

// Draws `text` one cell (TEXT_PITCH px) per character and returns the laid-out width.
export function drawPixelText(ctx, text, x, y, color, scale = 1) {
  for (let i = 0; i < text.length; i++) {
    const rows = glyphRows(text[i]);
    if (!rows) continue; // unknown glyph: keep its cell blank, never shift the pitch
    const cellX = x + i * TEXT_PITCH * scale;
    for (let r = 0; r < FONT_H; r++) {
      const row = rows[r];
      let c = 0;
      while (c < FONT_W) {
        if (row[c] !== INKED) {
          c++;
          continue;
        }
        let run = 1;
        while (c + run < FONT_W && row[c + run] === INKED) run++;
        px(ctx, cellX + c * scale, y + (FONT_TOP + r) * scale, run * scale, scale, color);
        c += run;
      }
    }
  }
  return text.length * TEXT_PITCH * scale;
}
