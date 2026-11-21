// Pixel-text module — the file is named for its 8-bit-sprite past. Everything else left with
// the art cutover: terrain and characters are terrain.js / chars.js, items + gate + particles
// + the emissive masks are props.js, and the old atlas (src/atlas.js) is retired. What
// remains is the one surface that must take an arbitrary colour per call at any scale, so it
// never lived in the baked art: the authored 5x7 HUD/title font, drawn with fillRect by the
// layer §4 composites last, unshaken and crisp.

// Authored bitmap text (decision 4): a 5x7 font blitted with fillRect, unchanged down to the
// glyph art — the harness reads HUD strings out of this ink, so pitch, glyphs and the
// fill-with-`color` behaviour are frozen.
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
  "'": '..X../..X../.X.../...../...../...../.....',
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
  Z: 'XXXXX/....X/...X./..X../X.../X..../XXXXX',
  '0': '.XXX./X...X/X..XX/X.X.X/XX..X/X...X/.XXX.',
  '1': '..X../.XX../..X../..X../..X../..X../.XXX.',
  '2': '.XXX./X...X/....X/...X./..X../X.../XXXXX',
  '3': '.XXX./....X/....X/.XXX./....X/....X/.XXX.',
  '4': '...X./..XX./.X.X./X..X./XXXXX/...X./...X.',
  '5': 'XXXXX/X..../XXXX./....X/....X/X...X/.XXX.',
  '6': '..XX./.X.../X..../XXXX./X...X/X...X/.XXX.',
  '7': 'XXXXX/....X/...X./..X../X.../X..../..X..',
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
        ctx.fillStyle = color;
        ctx.fillRect(cellX + c * scale, y + (FONT_TOP + r) * scale, run * scale, scale);
        c += run;
      }
    }
  }
  return text.length * TEXT_PITCH * scale;
}
