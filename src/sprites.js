// HD-2D art data (§5). Every sprite in the game is a matrix of palette letters that registers
// into the atlas once, at module load; nothing here lays a rectangle per frame any more — each
// draw function is one atlas.blit that keeps the old (x, y) contract exactly, because
// hero/enemy hitboxes and the 16 px tile grid are frozen (G5).
//
// FOOTPRINT RULE: each frame's inked box (the union of its non-transparent cells, mapped
// through the entry's anchor) is the same LOGICAL box the pre-atlas sprites.js inked for the
// same arguments, cell for cell. Two entries keep dead cells to hold that line: `turnip`
// leaves matrix col 0 empty and `boss` cols 0-1 empty, because the old code drew them from
// (x - 1) / (x - 2) while inking from (x) / (x) — the anchor is the old draw origin, the ink is
// what the frozen boxes sit on. `boss` also carries a spare top row, because old code let the
// crown bob 1 px above the body box while the body stayed glued to it; the hero's run bob
// instead moves the whole blit up 1 px at draw time, which is what old code did to the sprite.
//
// OUTLINE: nothing in the pad. bakeMatrix's pad outline inks 1 px OUTSIDE the matrix, and the
// harness measures real ink against frozen geometry (R21 counts the rows a turnip paints
// against its 12 px hitbox; R24 measures the fruit icon's ink against the HUD rect `textW`
// reserves), so a padded box is a moved box. Every key whose matrix box is a tile, a hitbox, a
// pickup rect or a HUD layout rect carries its 1 px `deep` rim INSIDE the matrix — the terrain
// and props author it by hand, the characters, `turnip` and `shard` get it from `rim` below.
// The pad survives only on `fx.*`: puff centres with no hitbox, no pickup rect, no layout rect.
//
// LETTER GRAMMAR, shared by every matrix below: `1`-`5` are the deep→hi steps of the entry's
// first material, `a`-`e` and `f`-`j` the same steps of its second and third; `l`/`m`/`n` are
// the deep/shade/base of a structural repeat of the second. `E` marks an emissive cell (it
// lands in that frame's bloom mask), `W` a specular white, `K` ink. Any letter a map does not
// carry is transparent, so no sprite needs a filler colour. No hex literal appears anywhere in
// this file: buildRamps owns every hue, so one palette edit reaches all twenty-odd sprites.

import { ART_SCALE, PALETTE } from './config.js';
import { bakeAll, blit, ready, register } from './atlas.js';
import { buildRamps, seeded } from './pixels.js';

const P = PALETTE;
const RM = buildRamps(P);
const STEPS = ['deep', 'shade', 'base', 'lit', 'hi'];
const FIVE = '12345';

// letters -> ramp steps: ramp(RM.dirt, '12345') binds deep..hi to 1..5; the object form picks
// steps by name, for the few entries that want one stray tone rather than a whole ramp.
function ramp(r, spec, from = 0) {
  const m = {};
  if (typeof spec === 'string') {
    for (let i = 0; i < spec.length; i++) m[spec[i]] = r[STEPS[Math.min(4, from + i)]];
  } else {
    for (const ch in spec) m[ch] = r[spec[ch]];
  }
  return m;
}

function mapOf(...maps) {
  return Object.assign({ K: P.black, W: RM.white.hi }, ...maps);
}

// Pad a hand-typed block to a rectangle, so a missing trailing dot can never shift a column.
function mat(...rows) {
  const w = rows.reduce((n, r) => (r.length > n ? r.length : n), 0);
  return rows.map((r) => (r.length === w ? r : r + '.'.repeat(w - r.length)));
}

// Stamp a hand-authored feature block over a field at (bx, by); '.' lets the field through.
// Faces, keystones, pennants and plinths are authored as small named blocks rather than retyped
// into a 119-row wall of counted dots — the only way the big matrices stay reviewable as art.
function stamp(rows, block, bx, by) {
  const out = rows.slice();
  for (let i = 0; i < block.length; i++) {
    const y = by + i;
    if (y < 0) continue;
    while (out.length <= y) out.push('');
    let s = out[y];
    for (let j = 0; j < block[i].length; j++) {
      const c = block[i][j];
      if (c === '.') continue;
      const x = bx + j;
      while (s.length <= x) s += '.';
      s = s.slice(0, x) + c + s.slice(x + 1);
    }
    out[y] = s;
  }
  return out;
}

// Move an outline inside the box, in TWO tones, so the silhouette still carries the set's one
// light direction (§5.2) instead of collapsing to a flat contour: cells facing AWAY from the key
// light (transparent neighbour to the right or below) take `deep`, cells the key RAKES (transparent
// above or to the left) take `lit`. Away wins on a cell that is both, so a 1 px limb never loses
// its dark contour — silhouette first (§5.3). Only cell VALUES change: an inked cell stays inked,
// a transparent one stays transparent, nothing is added, so the inked box that the frozen hitboxes
// and HUD rects measure cannot move. `keep` protects emissive cells (they are light sources),
// specular glints and ink lines. `lit` DEFAULTS TO `deep`: an entry that must hold one true
// contour tone — the Sunfruit ring is real `K`, and R24 counts that black ink against the HUD
// rect `textW` reserves — passes no lit tone and stays single-tone, exactly as before.
function rim(rows, deep, lit = deep, keep = 'EWK') {
  const w = rows.reduce((n, r) => (r.length > n ? r.length : n), 0);
  const on = (x, y) => y >= 0 && y < rows.length && x >= 0 && x < rows[y].length &&
    rows[y][x] !== '.' && rows[y][x] !== ' ';
  return rows.map((r, y) => {
    let s = '';
    for (let x = 0; x < w; x++) {
      const c = x < r.length ? r[x] : '.';
      const tone = !on(x + 1, y) || !on(x, y + 1) ? deep
        : !on(x - 1, y) || !on(x, y - 1) ? lit : null;
      s += tone === null || c === '.' || c === ' ' || keep.includes(c) ? c : tone;
    }
    return s;
  });
}

// Generated art still ends up as letters, so the one bake pass treats it exactly like
// hand-authored art; `seeded` is the project's only RNG, so a bake reproduces byte for byte.
function grid(w, h, at) {
  const rows = [];
  for (let y = 0; y < h; y++) {
    let s = '';
    for (let x = 0; x < w; x++) s += at(x, y) || '.';
    rows.push(s);
  }
  return rows;
}

function sp(x, y, salt) {
  return seeded(y * 613 + x * 31 + salt * 7919, 3);
}

// The up-left key light (§5.2) over a flat face, as a step index 0..4 — 4 at the up-left
// corner, 1 in the away corner. Coarse on purpose: a smooth per-pixel gradient inside a 16 px
// tile aliases against ART_SCALE, which §5.5 forbids; the bake's dither pass adds the fine
// grain inside whatever flat field is left.
function litAt(x, y, w, h) {
  const u = w > 1 ? x / (w - 1) : 0;
  const v = h > 1 ? y / (h - 1) : 0;
  return Math.max(0, Math.min(4, Math.round(1 + (1 - (u * 0.55 + v * 0.45)) * 2.6)));
}
const step = (x, y, w, h, letters = FIVE) => letters[litAt(x, y, w, h)];
// Sprinkle detail is decided on a 2 px grid and stamped, never per pixel. `blot` is a 2x2
// patch, `fleck` a 2 px run for the single-row sprinkles; a block is one `sp` draw and four
// pixels, so the same threshold covers the same number of cells as the old per-pixel test —
// the palette budget is untouched, only the size of the mark that carries it.
const blot = (x, y, salt) => sp(x >> 1, y >> 1, salt);
const fleck = (x, y, salt) => sp(x >> 1, y, salt);

// --------------------------------------------------------------------------- terrain
// Dirt is a dithered gradient field, so the auto-lit top row and auto-shaded bottom row a solid
// tile gets from the bake read as soil rather than as a bevel; the buried grit is stone, which
// is where the tile's darkest and lightest tones come from.
//
// Detail is stamped on a 2 px grid, never per pixel. Measured on the shipped per-pixel field:
// 60 of the tile's 107 same-tone runs were exactly 1 px long, the rows ran 5.69 tone changes
// (median 6, max 10) and the median run was 1 px — under the 2x scene scale that is TV static.
// Deciding on `bx, by` blocks puts one threshold across four cells at once, which measured
// 4.19 changes per row (median 4, max 6), a 2 px median run, and the same seven characters.
const dirtField = (seam) => (x, y) => {
  const bx = x >> 1;
  const by = (y + seam) >> 1;
  const s = sp(bx, by, 1);
  if (s > 0.93) return '5'; // grit catching the key
  if (s > 0.86) return '1'; // a pit
  if (sp(bx, by, 2) > 0.955) return 'h'; // a buried pebble
  if (sp(bx, by, 3) > 0.985) return 'i'; // its lit edge
  return step(x, y, 16, 16 - seam, FIVE);
};

// The contact shadow toward the tile below is the ramp's own last steps, not a constant row:
// `step`'s field runs 5 -> 4 -> 3 -> 2 down the tile, so the darkest tone the gradient reaches
// ('2') sits along the bottom edge and the tile under it opens on its brightest band.
// R56's clause 2 keeps these bottom rows from collapsing back into a constant tone.
const GROUND_BODY = grid(16, 16, (x, y) => {
  if (y === 13 && fleck(x, y, 4) > 0.7) return '2';
  return dirtField(0)(x, y);
});

const GROUND_TOP = grid(16, 16, (x, y) => {
  if (y > 4) return dirtField(5)(x, y);
  if (y === 4) return fleck(x, y, 6) > 0.6 ? '2' : '1'; // soil lip under the sward
  if (y === 0) return fleck(x, y, 7) > 0.72 ? '5' : '4';
  if (y === 3) return fleck(x, y, 8) > 0.5 ? 'a' : '2'; // sward underside, in shade
  return blot(x, y, 9) > 0.8 ? '4' : step(x, y, 16, 4, 'abcde');
});

// Stone and brick are masonry, so a bevel belongs on them — the tone field runs the other way
// from dirt: brightest on the chamfer, deepest in the joint.
const STONE = grid(16, 16, (x, y) => {
  if (y === 0 || x === 0) return '5';
  if (y === 15 || x === 15) return '1';
  if ((x === 1 && y < 6) || (y === 1 && x < 6)) return '4';
  if (x === 14 || y === 14) return '2';
  if ((x === 4 && y === 9) || (x === 5 && y === 10) || (x === 6 && y === 10)) return '1';
  if ((x === 11 && y === 4) || (x === 10 && y === 5)) return '1';
  if ((x === 12 && y === 4) || (x === 11 && y === 5) || (x === 12 && y === 3)) return '4';
  if (x === 9 && y === 11) return 'W';
  if (blot(x, y, 11) > 0.9) return '3';
  return step(x, y, 16, 16, FIVE);
});

const BRICK = grid(16, 16, (x, y) => {
  const mortar = y === 5 || y === 10;
  const joint = mortar || (y < 5 ? x === 5 || x === 11 : y < 10 ? x === 8 : x === 3 || x === 13);
  if (joint) return y === 15 || x === 15 ? '1' : '2';
  if (y === 15 || x === 15) return '1';
  if (y === 0 || x === 0) return '5';
  if (y === 1 && x > 1 && x < 6) return '4';
  if (blot(x, y, 12) > 0.92) return '3';
  if (blot(x, y, 13) > 0.985) return '5';
  return step(x, y, 16, 16, FIVE);
});

const PLATFORM = grid(16, 16, (x, y) => {
  if (y === 0) return '5';
  if (y === 1) return x % 4 === 3 ? '4' : '5'; // tread highlight
  if (y === 2) return '3';
  if (x === 0 || x === 15) return y < 3 ? 'c' : y > 12 ? 'a' : 'b'; // bush-wrapped ends
  if (y >= 14) return '1';
  if (y === 13) return fleck(x, y, 14) > 0.6 ? '2' : '1';
  if (y === 6 && x > 2 && x < 13) return '4';
  if (blot(x, y, 15) > 0.94) return '4';
  if (blot(x, y, 16) > 0.985) return 'W';
  return step(x, y, 12, 11, FIVE);
});

// Spent prize block: the same silhouette as `pumpkin`, dimmed to the used ramp with the
// Sunfruit knocked down to a dark recess — the same 9x9 silhouette, all deep — so a taken
// block reads as the same block gone empty. One ramp step deeper than the filled block's
// first cut: the spent face must sit clearly below the live gold, not hover beside it.
const STAR_RECESS = mat(
  '...1.1...',
  '...111...',
  '..11111..',
  '.1111111.',
  '111111111',
  '.1111111.',
  '.11...11.',
  '..11.11..',
  '..1...1..'
);
const PUMPKIN_USED = stamp(grid(16, 16, (x, y) => {
  if (y === 0 || y === 15 || x === 0 || x === 15) return '1'; // deep rim
  if (y === 1) return '3';
  if (x === 2 && (y === 2 || y === 13)) return '1'; // corner rivets
  if (x === 13 && (y === 2 || y === 13)) return '1';
  if (y >= 11) return '1';
  return '2';
}), STAR_RECESS, 3, 3);

// A pipe is one extruded barrel lit from the left. Shipped runs are exactly two tiles wide
// (checked against levels.js), so the barrel is authored as TWO frames instead of a mirrored
// half: frame 0 is the left column — a bright band on the outer edge falling toward the seam
// — and frame 1 the right column — mid at the seam falling to a dark outer edge. A mirrored
// single half cannot shade a cylinder (bright-left, dark-right), which is why the old
// one-cell art read as two identical bars with a gap between them. `terrain.matFor` picks the
// frame by run position; the keys stay 'pipe.body'/'pipe.cap' so nothing else moves.
const PIPE_BODY = [
  grid(16, 16, (x) => {
    if (x === 0) return '2';
    if (x < 5) return '5'; // key band on the outer left edge
    if (x < 15) return '4';
    return '3';
  }),
  grid(16, 16, (x) => {
    if (x < 4) return '3'; // mid at the seam
    if (x < 10) return '2';
    return '1';
  }),
];

// The cap is the same barrel with a lit top face (and a short specular glint), a rim band and
// a 1-px lip shadow, then the body continues to the tile's bottom so no gap band opens under
// the rim. Stacked body tiles get their 1-px joint line from shadeTile.
const PIPE_CAP = [
  grid(16, 16, (x, y) => {
    if (y === 0) return x === 0 ? '2' : x > 1 && x < 5 ? 'W' : '5'; // top face, glint
    if (y === 1) return x === 0 ? '2' : x < 5 ? '5' : x < 15 ? '4' : '3'; // rim band
    if (y === 2) return '1'; // lip shadow
    if (x === 0) return '2';
    if (x < 5) return '5';
    if (x < 15) return '4';
    return '3';
  }),
  grid(16, 16, (x, y) => {
    if (y === 0) return x === 15 ? '4' : '5';
    if (y === 1) return x < 4 ? '3' : x < 10 ? '2' : '1';
    if (y === 2) return '1';
    if (x < 4) return '3';
    if (x < 10) return '2';
    return '1';
  }),
];

// Hills are one baked silhouette each, scaled to the radius render.js asks for, so their tone
// field is deliberately smooth: fine grain would alias under that scale (§5.5). The near slope
// takes the key, the away slope falls into the blue-violet bounce, and the far range picks up a
// haze band along its ridge for depth.
function hillField(fog) {
  return grid(97, 49, (x, y) => {
    const half = 48 - y;
    if (x < 48 - half || x > 48 + half) return '.';
    const l = 48 - half;
    const u = half > 0 ? (x - l) / (half * 2) : 0.5; // 0 = up-lit slope, 1 = away slope
    if (y === 48) return '1';
    if (fog && y < 6 && u < 0.6) return 'a'; // haze on the lit ridge
    if (y > 42 && u > 0.5) return '1';
    if (u < 0.12) return fog ? '4' : '5';
    if (u > 0.9) return '1';
    if (u > 0.62) return '2';
    if (u < 0.32) return '4';
    return '3';
  });
}

const CLOUD = grid(15, 5, (x, y) => {
  const onRow = (y === 0 && x > 3 && x < 11) || (y === 1 && x > 1 && x < 13) || y > 1;
  if (!onRow) return '.';
  if (y === 0) return '5';
  if (y === 1) return x < 5 ? '5' : '3';
  if (y === 4) return x < 4 ? 'b' : x < 10 ? 'a' : '2'; // underside picks up sky bounce
  if (y === 3) return x < 3 ? 'b' : x > 11 ? '2' : '3';
  return x < 4 ? '4' : '3';
});

const BUSH = grid(14, 5, (x, y) => {
  const onRow = (y === 0 && x > 2 && x < 11) || (y === 1 && x > 0 && x < 13) || y > 1;
  if (!onRow) return '.';
  if (y === 0) return x === 5 || x === 8 ? '5' : '4';
  if (y === 4) return x < 4 ? '1' : '2';
  if (x === 0 || x === 13) return '2';
  if ((x === 4 && y === 2) || (x === 9 && y === 3)) return '5'; // lit tips
  if ((x === 6 && y === 1) || (x === 11 && y === 2)) return 'f'; // berries
  if (blot(x, y, 21) > 0.88) return '2';
  return step(x, y, 14, 5, FIVE);
});

// --------------------------------------------------------------------------- props
// The Sunfruit keeps the eight-point star the old sprite was cut from, and keeps its outline
// INSIDE the 9x9 box: the old sprite ringed every star cell in `black`, and the HUD's fruit
// counter (R24) measures that black ink against the rect `textW` reserves, so the rim has to be
// real `K`, not a dark tone. `rim` does the silhouette; the two `K` cells in the middle row are
// the pip — interior cells, which the bake's shading pass leaves untouched, so the icon keeps a
// pixel of true black after the ramp pass. The spin frames are 4-6 px wide, where a black ring
// would eat the body; their rim stays the material's own `deep`.
const FRUIT_STAR = rim(mat(
  '...E.E...',
  '...EE4...',
  '..44444..',
  '.4E44444.',
  '444KK4444',
  '.4441144.',
  '.41...14.',
  '..41.14..',
  '..2...2..'
), 'K');
const FRUIT_SPIN = mat(
  '..EE.....',
  '..E4.....',
  '.4444....',
  '.E444....',
  '.444444..',
  '.44111...',
  '.44.11...',
  '.1...1...',
  '.1...1...'
);
const FRUIT_EDGE = mat(
  '..EE..',
  '..E4..',
  '..544.',
  '..E44.',
  '..4444',
  '..411.',
  '..4.2.',
  '..1.1.',
  '..1..1'
);

// The berry's physics box IS its art box (items.js), so the capsule and its dark rim are
// authored inside 14x7: rows 0 and 6 are rim, never body, and the glint is one column wide.
// The E cell is the bloom source §7 reads; the old sprite's second frame only moved its
// glint a row, which the glow does better now.
const BERRY = mat(
  '...11111111...',
  '..1444444441..',
  '.1455W4444441.',
  '1444444E444441',
  '13333334444441',
  '.133333333331.',
  '...11111111...'
);


const SHARD = mat('4W21', '4321', '3321', '3221');

// Particles are three or five cells wide, so the only way they carry a real ramp is to use
// two materials per puff: the key-lit half is dirt, the trailing half is stone, and the dark
// corner is what gives the blob its tone spread.
const FX_DUST = mat('cW4', '21d');
const FX_SPARK = [
  mat('.5E5.', '.EWE.', 'E5W5E', '.E4E.', '.2E2.'),
  mat('1.E.1', '.5E5.', 'E5W5E', '.5E5.', '1.E.1'),
];
const FX_POOF = [
  mat('..c..', '.23c.', '234W3', '.232.', '..2..'),
  mat('.121.', '12321', '23W32', '12321', '.121.'),
  mat('a1.1a', '1.2.2', '.2W2.', '2.2.1', 'b1.1b'),
];
const FX_CHIP = mat('4W2', '432', '321');

// Prize block: a gold question-block (crown ramp) with a deep rim, corner rivets and a 9x9
// Sunfruit emblem — the exact silhouette of the collected fruit (FRUIT_STAR above), all
// emissive, so the block reads as "contains that star" rather than a decoration. The crown
// ramp sits one step deeper than the first cut (body '3', top '4'): the bright gold read as
// too hot at play scale and buried the white star; the deeper tone also lifts the contrast
// between star and body. The emblem is the block's light source in the bloom pass (§7) and
// the anchor of the R53 glow disc.
const STAR_EMBLEM = mat(
  '...E.E...',
  '...EEE...',
  '..EEEEE..',
  '.EEEEEEE.',
  'EEEEEEEEE',
  '.EEEEEEE.',
  '.EE...EE.',
  '..EE.EE..',
  '..E...E..'
);
const PUMPKIN = stamp(grid(16, 16, (x, y) => {
  if (y === 0 || y === 15 || x === 0 || x === 15) return '1'; // deep rim
  if (y === 1) return '4';
  if (x === 1 && y < 4) return '4'; // key-lit left edge
  if (x === 2 && (y === 2 || y === 13)) return '1'; // corner rivets
  if (x === 13 && (y === 2 || y === 13)) return '1';
  if (y >= 11) return '2';
  return '3';
}), STAR_EMBLEM, 3, 3);

// --------------------------------------------------------------------------- characters
// The hero, turnip and boss are HD procedural bakes in src/chars.js — same anchors, same
// frozen frame tables (HERO_BASE, crown-bob math), rendered as vector art under the 4x
// scene transform instead of matrix blits.

// No checkpoint sprite, deliberately: a banked checkpoint is invisible in play. The `K` tiles in
// the maps are authoring markers and a trigger band in config.js only — see render.js's note at
// the former draw call, and R45 in tools/verify.mjs, which fails if anything ever draws at a
// post again.

// Melon Gate: (x, y) is the bottom gate tile and the posts run up to the arch, so the anchor is
// -103. The 119-row post and arch field is one generator — typed out that is four thousand
// characters of pure repetition, and every cell of it would have to agree with the bake's single
// light direction by hand. Everything that makes the gate a landmark is stamped: pennant, pole,
// keystone, plinths, and the two dark eyes and lintel bolt the old sprite had.
const GATE_PENNANT = mat('ghi', 'gh.', 'g..');
const GATE_POLE = mat('a', 'a', 'a', 'a', 'a');
const GATE_KEYSTONE = mat(
  '.ddd.',
  'dEWEd',
  'dEEEd',
  '.bbb.'
);
const GATE_PLINTH = mat('ec', 'ed', 'dc', 'db', 'cb', 'ca', 'ba');

const GATE = (() => {
  let rows = grid(32, 119, (x, y) => {
    if (y < 7) return '.';
    if (y === 7) return x > 1 && x < 30 ? '4' : '.';
    if (y === 8) return x > 1 && x < 30 ? (x === 2 || x === 29 ? '2' : '3') : '.';
    if (y === 9) return x > 0 && x < 31 ? (x === 1 || x === 30 ? '2' : '4') : '.';
    if (y <= 38) {
      if (y === 38) return '1'; // the soffit is the gate's own contact shadow
      if (y === 37) return '2';
      if (x === 0 || x === 31) return '2';
      if (x === 1 || x === 30) return '4';
      if ((x - 2) % 8 === 0) return y > 24 ? '2' : '3'; // melon ribs
      if (y > 30) return '2';
      return litAt(x, y, 32, 32) >= 3 ? '4' : '3';
    }
    if (x > 1 && x < 30) return '.'; // below the springline the middle IS the doorway
    const course = y % 8 === 0 || y % 8 === 7;
    if (x === 0) return course ? '4' : '3';
    if (x === 1) return course ? '2' : '1';
    if (x === 30) return course ? '1' : '2';
    return course ? '2' : '1';
  });
  rows = stamp(rows, GATE_POLE, 15, 2);
  rows = stamp(rows, GATE_PENNANT, 16, 0);
  rows = stamp(rows, GATE_KEYSTONE, 14, 9);
  rows = stamp(rows, GATE_PLINTH, 0, 112);
  rows = stamp(rows, GATE_PLINTH.map((r) => r.split('').reverse().join('')), 30, 112);
  rows = stamp(rows, mat('K', 'K'), 8, 19);
  rows = stamp(rows, mat('K', 'K'), 24, 19);
  return mat(...rows);
})();

// --------------------------------------------------------------------------- registration
// One shared bake opts shape: the same light vector, the same ramp blend, so twenty-odd
// matrices bake as one art set (§5.2). No entry gets an outline from here; `PADDED` is the one
// way to ask for the pad, and only the particle keys use it.
const LIGHT = { dx: -1, dy: -1 };
const SHADE = { strength: 1 };

function opts(extra) {
  return Object.assign({ light: LIGHT, shade: SHADE }, extra || {});
}

const PADDED = (deep) => ({ outline: { color: deep, width: 1 } });

const M_GROUND = mapOf(ramp(RM.dirt, '12345'), ramp(RM.grass, 'abcde'), ramp(RM.stone, 'fghij'));
const M_STONE = mapOf(ramp(RM.stone, '12345'));
const M_BRICK = mapOf(ramp(RM.brick, '12345'));
const M_PLATFORM = mapOf(ramp(RM.platform, '12345'), ramp(RM.bush, 'abcde'));
const M_USED = mapOf(ramp(RM.used, '12345'));
const M_PUMPKIN = mapOf(ramp(RM.crown, '12345'), { E: RM.white.hi });
const M_PIPE = mapOf(ramp(RM.pipe, '12345'));
const M_GATE = mapOf(ramp(RM.pipe, '12345'), ramp(RM.stone, 'abcde'), ramp(RM.red, 'fghij'),
  { E: RM.crown.hi });
const M_FRUIT = mapOf(ramp(RM.crown, '12345'), { E: P.crown });
const M_BERRY = mapOf(ramp(RM.berryBody, '12345'), { E: RM.berryBody.hi });
const M_BUSH = mapOf(ramp(RM.bush, '12345'), ramp(RM.berryBody, 'fghij'));
const M_HILL_FAR = mapOf(ramp(RM.hillFar, '12345'), ramp(RM.sky, { a: 'lit' }));
const M_HILL_NEAR = mapOf(ramp(RM.hillNear, '12345'), ramp(RM.sky, { a: 'lit' }));
const M_CLOUD = mapOf(ramp(RM.cloud, '12345'), ramp(RM.sky, { a: 'shade', b: 'base' }));
const M_SHARD = mapOf(ramp(RM.brick, '12345'));
const M_DUST = mapOf(ramp(RM.dirt, '12345'), ramp(RM.stone, 'abcde'));
const M_SPARK = mapOf(ramp(RM.crown, '12345'), { E: P.crown });
const M_POOF = mapOf(ramp(RM.used, '12345'), ramp(RM.stone, 'abcde'));
const M_CHIP = mapOf(ramp(RM.brick, '12345'));

const DITHER = { dither: true };

// The shard wears its rim INSIDE the matrix so the measured ink box is exactly the silhouette.
const SHARD_RIM = rim(SHARD, '1', '2');

register({ key: 'ground.top', frames: [GROUND_TOP], map: M_GROUND, anchor: { x: 0, y: 0 }, opts: opts(DITHER) });
register({ key: 'ground.body', frames: [GROUND_BODY], map: M_GROUND, anchor: { x: 0, y: 0 }, opts: opts(DITHER) });
register({ key: 'stone', frames: [STONE], map: M_STONE, anchor: { x: 0, y: 0 }, opts: opts(DITHER) });
register({ key: 'brick', frames: [BRICK], map: M_BRICK, anchor: { x: 0, y: 0 }, opts: opts(DITHER) });
register({ key: 'pumpkin', frames: [PUMPKIN], map: M_PUMPKIN, anchor: { x: 0, y: 0 }, opts: opts({ emissive: { chars: 'E', color: P.pumpkinLit } }) });
register({ key: 'pumpkin.used', frames: [PUMPKIN_USED], map: M_USED, anchor: { x: 0, y: 0 }, opts: opts(DITHER) });
register({ key: 'platform', frames: [PLATFORM], map: M_PLATFORM, anchor: { x: 0, y: 0 }, opts: opts(DITHER) });
register({ key: 'pipe.cap', frames: PIPE_CAP, map: M_PIPE, anchor: { x: 0, y: 0 }, opts: opts(DITHER) });
register({ key: 'pipe.body', frames: PIPE_BODY, map: M_PIPE, anchor: { x: 0, y: 0 }, opts: opts(DITHER) });
register({ key: 'gate', frames: [GATE], map: M_GATE, anchor: { x: 0, y: -103 }, opts: opts({ dither: true, emissive: { chars: 'E', color: P.pumpkinLit } }) });
register({ key: 'fruit', frames: [FRUIT_STAR, FRUIT_SPIN, FRUIT_EDGE, FRUIT_SPIN], map: M_FRUIT, anchor: { x: 0, y: 0 }, opts: opts({ emissive: { chars: 'E', color: P.crown } }) });
register({ key: 'berry', frames: [BERRY], map: M_BERRY, anchor: { x: 0, y: 0 }, opts: opts({ emissive: { chars: 'E', color: RM.berryBody.hi } }) });
register({ key: 'shard', frames: [SHARD_RIM], map: M_SHARD, anchor: { x: 0, y: 0 }, opts: opts() });
register({ key: 'bush', frames: [BUSH], map: M_BUSH, anchor: { x: 0, y: 0 }, opts: opts() });
register({ key: 'hill.far', frames: [hillField(true)], map: M_HILL_FAR, anchor: { x: -48, y: -48 }, opts: opts() });
register({ key: 'hill.near', frames: [hillField(false)], map: M_HILL_NEAR, anchor: { x: -48, y: -48 }, opts: opts() });
register({ key: 'cloud', frames: [CLOUD], map: M_CLOUD, anchor: { x: 0, y: 0 }, opts: opts() });
// Particles are the only keys that may wear the pad: a puff has no hitbox, no pickup rect and
// no HUD layout rect, so one inked cell outside its matrix measures nothing.
register({ key: 'fx.dust', frames: [FX_DUST], map: M_DUST, anchor: { x: 0, y: 0 }, opts: opts(PADDED(RM.dirt.deep)) });
register({ key: 'fx.spark', frames: FX_SPARK, map: M_SPARK, anchor: { x: 0, y: 0 }, opts: opts({ ...PADDED(RM.crown.deep), emissive: { chars: 'E', color: P.crown, threshold: 0.2 } }) });
register({ key: 'fx.poof', frames: FX_POOF, map: M_POOF, anchor: { x: 0, y: 0 }, opts: opts(PADDED(RM.used.deep)) });
register({ key: 'fx.chip', frames: [FX_CHIP], map: M_CHIP, anchor: { x: 0, y: 0 }, opts: opts(PADDED(RM.brick.deep)) });

/** The ground tile grids, for the harness's texture census (R56). The bake cannot answer
 *  "is this a tone seam or the §5.5 stipple?" from colour: pass 4 paints a dithered cell
 *  `ramp.base` or `ramp.shade`, and on the dirt ladder the shade of the '4' tone is exactly
 *  the '3' map tone, so a stippled field and a real seam are the same two colours. The
 *  character grid is where that distinction lives; the game only ever reads it through the
 *  atlas, which bakes these same arrays. */
export function tileGrid(key) {
  return key === 'ground.top' ? GROUND_TOP : key === 'ground.body' ? GROUND_BODY : null;
}

// Boot drives this; the draw wrappers below also guard, so the module is safe however wave 3
// sequences the boot (R48 counts these calls and expects exactly one).
export function bakeSprites(scale = ART_SCALE) {
  return bakeAll(scale);
}

// --------------------------------------------------------------------------- draw wrappers
// The frozen public surface: same names, same arguments, same (x, y) meaning. Only the body of
// each one changed — from a stack of fillRects to one blit.
const FACE_LEFT = Object.freeze({ flipX: true });
const FACE_RIGHT = null;

function facingLeft(facing) {
  return facing === -1 || facing === 'left' ? FACE_LEFT : FACE_RIGHT;
}

function ensure() {
  if (!ready()) bakeAll(ART_SCALE);
}

export function drawGround(ctx, x, y, top) {
  ensure();
  blit(ctx, top ? 'ground.top' : 'ground.body', 0, x, y, null);
}

export function drawStone(ctx, x, y) {
  ensure();
  blit(ctx, 'stone', 0, x, y, null);
}

export function drawBrick(ctx, x, y) {
  ensure();
  blit(ctx, 'brick', 0, x, y, null);
}

export function drawPumpkin(ctx, x, y, used) {
  ensure();
  blit(ctx, used ? 'pumpkin.used' : 'pumpkin', 0, x, y, null);
}

export function drawPlatform(ctx, x, y) {
  ensure();
  blit(ctx, 'platform', 0, x, y, null);
}

export function drawPipe(ctx, x, y, isTop, isLeft) {
  ensure();
  if (isTop) blit(ctx, 'pipe.cap', 0, x, y, isLeft ? FACE_RIGHT : FACE_LEFT);
  else blit(ctx, 'pipe.body', 0, isLeft ? x + 2 : x, y, isLeft ? FACE_LEFT : FACE_RIGHT);
}

export function drawGate(ctx, x, y) {
  ensure();
  blit(ctx, 'gate', 0, x, y, null);
}

export function drawFruit(ctx, x, y, frame) {
  ensure();
  blit(ctx, 'fruit', frame & 3, x, y, null);
}

// The berry's old `frame` only moved its glint one row; that pulse is bloom's job now, so the
// argument stays for call-site compatibility and the single frame carries the art.
export function drawBerry(ctx, x, y, frame) {
  ensure();
  blit(ctx, 'berry', frame & 3, x, y, null);
}

export function drawShard(ctx, x, y, k, t) {
  ensure();
  const ox = (k % 2) * 8;
  const oy = k < 2 ? 0 : 8;
  const dx = k % 2 ? 1 : -1;
  const dy = k < 2 ? -1 : 1;
  const o = Math.round(t * 8);
  blit(ctx, 'shard', 0, x + ox + dx * o, y + oy + dy * o, null);
}

export function drawBush(ctx, x, y) {
  ensure();
  blit(ctx, 'bush', 0, x, y, null);
}

export function drawCloud(ctx, x, y) {
  ensure();
  blit(ctx, 'cloud', 0, x, y, null);
}

// One hill silhouette, scaled to the radius. The 48 px apex-to-base canonical matrix is the
// largest radius render.js asks for, so every draw is a downscale, never a blurry upscale, and
// the integer maths below land the inked triangle on exactly the old rows: dest
// [x - r, x + r + 1) x [y - r, y + 1).
const HILL_R = 48;
const HILL_W = HILL_R * 2 + 1;
const HILL_SCALE = [];
for (let r = 0; r <= HILL_R; r++) {
  HILL_SCALE[r] = Object.freeze({ scaleX: (r * 2 + 1) / HILL_W, scaleY: (r + 1) / (HILL_R + 1) });
}

export function drawHill(ctx, x, y, r, color) {
  ensure();
  const rr = r < 0 ? 0 : r > HILL_R ? HILL_R : r | 0;
  blit(ctx, color === P.hillFar ? 'hill.far' : 'hill.near', 0, x + HILL_R - rr, y + HILL_R - rr, HILL_SCALE[rr]);
}

// Authored bitmap text (decision 4): a 5x7 font blitted with fillRect, unchanged down to the
// glyph art — the harness reads HUD strings out of this ink, so pitch, glyphs and the
// fill-with-`color` behaviour are frozen. Text is the one exception to "art comes from the
// atlas": it must take an arbitrary colour per call (INK, RED, white popups) at any scale, and
// it is the layer §4 composites last, unshaken and crisp.
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
        ctx.fillStyle = color;
        ctx.fillRect(cellX + c * scale, y + (FONT_TOP + r) * scale, run * scale, scale);
        c += run;
      }
    }
  }
  return text.length * TEXT_PITCH * scale;
}
