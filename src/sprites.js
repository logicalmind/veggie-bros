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

// A pose: a hand-authored torso matrix with a hand-authored leg block dropped in at `top`.
// '.' in the leg block lets the torso through. Legs are art, not derivation — one block per
// stance, reused across a run cycle instead of retyped per frame.
function pose(rows, legs, top) {
  const w = Math.max(...rows.map((r) => r.length), ...legs.map((r) => r.length));
  const out = rows.map((r) => r + '.'.repeat(w - r.length));
  for (let i = 0; i < legs.length; i++) {
    const y = top + i;
    while (out.length <= y) out.push('.'.repeat(w));
    const cur = out[y];
    let s = '';
    for (let x = 0; x < w; x++) {
      const c = legs[i][x] === undefined ? '.' : legs[i][x];
      s += c === '.' ? cur[x] : c;
    }
    out[y] = s;
  }
  return out;
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

// --------------------------------------------------------------------------- terrain
// Dirt is a dithered gradient field, so the auto-lit top row and auto-shaded bottom row a solid
// tile gets from the bake read as soil rather than as a bevel; the buried grit is stone, which
// is where the tile's darkest and lightest tones come from.
const dirtField = (seam) => (x, y) => {
  const s = sp(x, y + seam, 1);
  if (s > 0.93) return '5'; // grit catching the key
  if (s > 0.86) return '1'; // a pit
  if (sp(x, y + seam, 2) > 0.955) return 'h'; // a buried pebble
  if (sp(x, y + seam, 3) > 0.985) return 'i'; // its lit edge
  return step(x, y, 16, 16 - seam, FIVE);
};

const GROUND_BODY = grid(16, 16, (x, y) => {
  if (y >= 14) return '1'; // contact shadow toward the tile below
  if (y === 13 && sp(x, 13, 4) > 0.7) return '2';
  return dirtField(0)(x, y);
});

const GROUND_TOP = grid(16, 16, (x, y) => {
  if (y > 4) return dirtField(5)(x, y);
  if (y === 4) return sp(x, y, 6) > 0.6 ? '2' : '1'; // soil lip under the sward
  if (y === 0) return sp(x, y, 7) > 0.72 ? '5' : '4';
  if (y === 3) return sp(x, y, 8) > 0.5 ? 'a' : '2'; // sward underside, in shade
  return sp(x, y, 9) > 0.8 ? '4' : step(x, y, 16, 4, 'abcde');
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
  if (sp(x, y, 11) > 0.9) return '3';
  return step(x, y, 16, 16, FIVE);
});

const BRICK = grid(16, 16, (x, y) => {
  const mortar = y === 5 || y === 10;
  const joint = mortar || (y < 5 ? x === 5 || x === 11 : y < 10 ? x === 8 : x === 3 || x === 13);
  if (joint) return y === 15 || x === 15 ? '1' : '2';
  if (y === 15 || x === 15) return '1';
  if (y === 0 || x === 0) return '5';
  if (y === 1 && x > 1 && x < 6) return '4';
  if (sp(x, y, 12) > 0.92) return '3';
  if (sp(x, y, 13) > 0.985) return '5';
  return step(x, y, 16, 16, FIVE);
});

const PLATFORM = grid(16, 16, (x, y) => {
  if (y === 0) return '5';
  if (y === 1) return x % 4 === 3 ? '4' : '5'; // tread highlight
  if (y === 2) return '3';
  if (x === 0 || x === 15) return y < 3 ? 'c' : y > 12 ? 'a' : 'b'; // bush-wrapped ends
  if (y >= 14) return '1';
  if (y === 13) return sp(x, y, 14) > 0.6 ? '2' : '1';
  if (y === 6 && x > 2 && x < 13) return '4';
  if (sp(x, y, 15) > 0.94) return '4';
  if (sp(x, y, 16) > 0.985) return 'W';
  return step(x, y, 12, 11, FIVE);
});

const PUMPKIN_USED = grid(16, 16, (x, y) => {
  if (y === 0 || x === 0) return '3';
  if (y === 15 || x === 15) return '1';
  if (y === 1 && x === 1) return '4';
  if ((x === 5 && y > 2 && y < 9) || (x === 10 && y > 4 && y < 12)) return '1'; // split ribs
  if ((x === 6 && y === 9) || (x === 11 && y === 12)) return '2';
  if ((x === 4 && y === 4) || (x === 12 && y === 6)) return '2'; // hollowed faces
  if (sp(x, y, 17) > 0.93) return '4';
  return step(x, y, 16, 16, FIVE);
});

// A pipe is one extruded barrel: a pale flesh ridge down the middle of the run, a deep seam
// either side of it, the near edge lit. The body is authored as the RIGHT-hand half of a run
// and mirrored with flipX for the left half, which is what puts the highlight on the inner
// seam both halves need. `pipe.cap` is authored as the LEFT half for the same reason.
const PIPE_BODY = grid(14, 16, (x, y) => {
  if (x === 1) return 'a'; // flesh ridge
  if (x === 0) return '4';
  if (x === 2) return '5';
  if (x === 3) return '1'; // seam
  if (x === 11) return '2';
  if (x === 13) return '2';
  if (y === 0) return x === 1 || x === 2 ? '5' : '4';
  if (y === 15) return '1';
  if (sp(x, y, 18) > 0.95) return '4';
  return step(x, y, 14, 16, FIVE);
});

const PIPE_CAP = grid(16, 16, (x, y) => {
  if (y === 0) return x === 0 || x === 15 ? '5' : '4';
  if (y === 1) return x < 2 || x > 13 ? '3' : '1'; // the lip's underside
  if (y === 2) return x === 0 || x === 15 ? '3' : 'a';
  if (y === 3) return '4';
  if (y === 4) return '2';
  if (x < 2) return y > 4 ? '4' : '3'; // body inset 2 px on the outer side
  if (x === 4) return '1';
  if (x === 12) return '2';
  if (x === 15) return '2';
  if (y === 15) return '1';
  if (sp(x, y, 19) > 0.95) return '4';
  return step(x, y, 14, 16, FIVE);
});

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
  if (sp(x, y, 21) > 0.88) return '2';
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

// The squashed-turnip corpse, registered for wave 3: the flattened band render.js still
// fillRects today (CORPSE_H), drawn as art, bottom-anchored where those rectangles sit.
const TURNIP_SQUASH = mat(
  '.4444444444..',
  '344333334432.',
  '232222222321.',
  '111111111111.'
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

// Pumpkin block: a ribbed melon with a cut stem and two glow clusters. The emissive cells are
// the block's own light source in the bloom pass (§7), so they are art and light at once. The
// dark rim is authored in (a tile cannot wear a pad outline — it would stripe the level).
const PUMPKIN = mat(
  '.......cc.......',
  '......bddb......',
  '4455155515554432',
  '1445144414444432',
  '1455155415544432',
  '1EE5155415544432',
  '1EE4144414444432',
  '1444144414444432',
  '1444144414EE4532',
  '1444134413EE3432',
  '1444133313333321',
  '1344133313333321',
  '1333133313332321',
  '1333133213322321',
  '1332122212222221',
  '1111111111111111'
);

// --------------------------------------------------------------------------- characters
// The hero is four hand-authored torsos and eight leg blocks; the nine frames are poses of
// them, which is how a sheet author works and why a run cycle cannot drift. Facing is flipX on
// the blit, so the art is authored looking right and eyes, seeds and brim mirror with it.
const HERO_S_TORSO = mat(
  '.....5......',
  '.3.4.5.4.3..',
  '544433332221',
  'aaaaaaaaaaaa',
  'bddWWcccWWbb',
  '.ddWKcccWKb.',
  '.cicccccicb.',
  '..ccccccbb..',
  '..cbibbiba..',
  '...baaaab...'
);

const HERO_S_TORSO_BLINK = mat(
  '.....4......',
  '.2.4.5.4.2..',
  '544433332221',
  'aaaaaaaaaaaa',
  'bddccccccddb',
  '.ddKccccKcb.',
  '.cicccccicb.',
  '..ccccccbb..',
  '..cbbiibba..',
  '...baaaab...'
);

const HERO_S_TORSO_RUN = mat(
  '....5.......',
  '.2.4.5.4.3..',
  '444433332221',
  'aaaaaaaaaaaa',
  'bdWWcccWWbbb',
  '.dWKcccWKbbb',
  '.cicccccicb.',
  '..ccccccbb..',
  '..cbibbiba..',
  '...baaaab...'
);

// Landing squash: shorter through the middle, twice as wide at the hem.
const HERO_S_TORSO_LAND = mat(
  '.....5......',
  '.3.4.4.4.3..',
  '544433332221',
  'aaaaaaaaaaaa',
  'bddWWcccWWbb',
  'bddWKcccWKbb',
  'bicccccccibb',
  'bbccccccccbb',
  'bbccibbiccbb',
  'abaaaaaaaaab'
);

const HERO_S_LEGS = {
  stand: mat('...mm.mm..', '...nn.nn..', '...nn.nn..', '...ll.ll..'),
  together: mat('....mmmm....', '....nnnn....', '....nnnn....', '....llll....'),
  stride: mat('..mm...mm...', '..nn...nn...', '..nn...nn...', '..ll...ll...'),
  strideBack: mat('...mm...mm..', '...nn...nn..', '..nn...nn...', '..ll...ll...'),
  pass: mat('....mm.mm...', '....nn.nn...', '....nn.nn...', '....ll.ll...'),
  splay: mat('', '', '..mm...mm...', '..ll...ll...'),
  dangle: mat('', '...nn.nn....', '...nn.nn....', '...ll.ll....'),
  flat: mat('', '', '..mmm..mmm..', '..lll..lll..'),
};

const HERO_SMALL = [
  pose(HERO_S_TORSO, HERO_S_LEGS.stand, 10),
  pose(HERO_S_TORSO_BLINK, HERO_S_LEGS.together, 10),
  pose(HERO_S_TORSO_RUN, HERO_S_LEGS.stride, 10),
  pose(HERO_S_TORSO_RUN, HERO_S_LEGS.pass, 10),
  pose(HERO_S_TORSO_RUN, HERO_S_LEGS.strideBack, 10),
  pose(HERO_S_TORSO_RUN, HERO_S_LEGS.together, 10),
  pose(HERO_S_TORSO, HERO_S_LEGS.splay, 10),
  pose(HERO_S_TORSO, HERO_S_LEGS.dangle, 10),
  pose(HERO_S_TORSO_LAND, HERO_S_LEGS.flat, 10),
];

const HERO_B_TORSO = mat(
  '.....5......',
  '.3.4.5.4.3..',
  '544433332221',
  'aaaaaaaaaaaa',
  'bddccccccddb',
  'bdWWccccWWdb',
  'bdWKccccWKdb',
  '.ddccccccdb.',
  '.diccccccib.',
  '.ddccccccdb.',
  '..ccccccbb..',
  '..cbbbbbbc..',
  '..cbibbiba..',
  '...baaaab...',
  '...baaaab...',
  '...baaaab...',
  '....bbbb....',
  '....bccb....',
  '....bccb....',
  '....baab....'
);

const HERO_B_TORSO_BLINK = mat(
  '.....4......',
  '.2.4.5.4.2..',
  '544433332221',
  'aaaaaaaaaaaa',
  'bddccccccddb',
  'bdcccccccbdb',
  'bdKcccccKbdb',
  '.ddccccccdb.',
  '.diccccccib.',
  '.ddccccccdb.',
  '..ccccccbb..',
  '..cbbiibbc..',
  '..cbbbbbbc..',
  '...baaaab...',
  '...baaaab...',
  '...baaaab...',
  '....bbbb....',
  '....bccb....',
  '....bccb....',
  '....baab....'
);

const HERO_B_TORSO_RUN = mat(
  '....5.......',
  '.2.4.5.4.3..',
  '444433332221',
  'aaaaaaaaaaaa',
  'bddccccccddb',
  'bdWWccccWWdb',
  'bdWKccccWKdb',
  '.ddccccccdb.',
  '.diccccccib.',
  '.ddccccccdb.',
  '..ccccccbb..',
  '..cbbbbbbc..',
  '..cbibbiba..',
  '...baaaab...',
  '...baaaab...',
  '...baaaab...',
  '....bbbb....',
  '....bccb....',
  '....bccb....',
  '....baab....'
);

const HERO_B_TORSO_LAND = mat(
  '.....5......',
  '.3.4.4.4.3..',
  '544433332221',
  'aaaaaaaaaaaa',
  'bddccccccddb',
  'bdWWccccWWdb',
  'bdWKccccWKdb',
  'bddccccccddb',
  'bdiccccccibd',
  'bddccccccddb',
  'bbccccccccbb',
  'bbcbbiibbcbb',
  'bbccbbbbccbb',
  'bbbbaaaabbbb',
  'bbbbaaaabbbb',
  '.bbbaaaabbb.',
  '..bbbbbbbb..',
  '..bbbbbbbb..',
  '..baabbaabb.',
  '..aaaaaaaa..'
);

const HERO_B_LEGS = {
  stand: mat('...mm.mm..', '...nn.nn..', '...nn.nn..', '...nn.nn..', '...nn.nn..', '...nn.nn..', '...nn.nn..', '...ll.ll..'),
  together: mat('....mmmm....', '....nnnn....', '....nnnn....', '....nnnn....', '....nnnn....', '....nnnn....', '....nnnn....', '....llll....'),
  stride: mat('..mm...mm...', '..nn...nn...', '..nn...nn...', '..nn...nn...', '..nn...nn...', '...nn...nn..', '...nn...nn..', '...ll...ll..'),
  strideBack: mat('...mm...mm..', '...nn...nn..', '..nn...nn...', '..nn...nn...', '..nn...nn...', '..nn...nn...', '..nn...nn...', '..ll...ll...'),
  pass: mat('....mm.mm...', '....nn.nn...', '....nn.nn...', '....nn.nn...', '....nn.nn...', '....nn.nn...', '....nn.nn...', '....ll.ll...'),
  splay: mat('', '', '', '..mm...mm...', '..nn...nn...', '..nn...nn...', '..nn...nn...', '..ll...ll...'),
  dangle: mat('', '', '...nn.nn....', '...nn.nn....', '...nn.nn....', '...nn.nn....', '...nn.nn....', '...ll.ll....'),
  flat: mat('', '', '', '', '...nn.nn....', '..mmm..mmm..', '..nnn..nnn..', '..lll..lll..'),
};

const HERO_BIG = [
  pose(HERO_B_TORSO, HERO_B_LEGS.stand, 20),
  pose(HERO_B_TORSO_BLINK, HERO_B_LEGS.together, 20),
  pose(HERO_B_TORSO_RUN, HERO_B_LEGS.stride, 20),
  pose(HERO_B_TORSO_RUN, HERO_B_LEGS.pass, 20),
  pose(HERO_B_TORSO_RUN, HERO_B_LEGS.strideBack, 20),
  pose(HERO_B_TORSO_RUN, HERO_B_LEGS.together, 20),
  pose(HERO_B_TORSO, HERO_B_LEGS.splay, 20),
  pose(HERO_B_TORSO, HERO_B_LEGS.dangle, 20),
  pose(HERO_B_TORSO_LAND, HERO_B_LEGS.flat, 20),
];

// Turnip: 13 columns with col 0 dead — old code drew from (x - 1) but inked from (x).
const TURNIP_BODY = mat(
  '...b...cc..b.',
  '....dccccd...',
  '....233332...',
  '..233333332..',
  '.2344WW334WW2',
  '.2344WK334WK2',
  '.22333333322.',
  '..233333332..',
  '...2111112...',
  '.....111.....',
  '',
  '',
  ''
);
const TURNIP_LEGS = {
  spread: mat('..33.....33..', '..22.....22..'),
  together: mat('.....3333....', '.....2222....'),
  passing: mat('....33.33....', '....22.22....'),
  kick: mat('.....33.33...', '.....22.22...'),
};
const TURNIP = [
  pose(TURNIP_BODY, TURNIP_LEGS.spread, 11),
  pose(TURNIP_BODY, TURNIP_LEGS.together, 11),
  pose(TURNIP_BODY, TURNIP_LEGS.passing, 11),
  pose(TURNIP_BODY, TURNIP_LEGS.kick, 11),
];

// Boss: the silhouette is a row table (the old sprite's box rows, dropped one to make room for
// the crown bob), the diamond hatch is the body's MATERIAL so it is generated over that
// silhouette from one ramp, and the crown, eyes and mouth are stamped blocks. Hurt is the same
// art painted with the pineapple ramp's brightest steps: a flash, not a redraw.
const BOSS_ROWS = [
  [4, 5, 6, 25],
  [6, 8, 4, 27],
  [9, 25, 2, 29],
  [26, 28, 4, 27],
  [29, 29, 7, 24],
  [30, 30, 10, 21],
];

function bossBody(o) {
  const s = o || {};
  return grid(30, 31, (x, y) => {
    let box = null;
    for (const r of BOSS_ROWS) if (y >= r[0] && y <= r[1]) box = r;
    if (!box) return '.';
    let l = box[2];
    let rr = box[3];
    if (s.tuck && y >= 26) { l += 1; rr -= 1; } // hop: the base pulls up under the body
    if (x < l || x > rr) return '.';
    if (s.flash) return (x + y) % 3 === 0 ? '5' : '4';
    const u = (x - l) / Math.max(1, rr - l);
    const lit = y <= 5 || (y < 14 && u < 0.28);
    if ((x + y) % 7 === 0 || ((((x - y) % 7) + 7) % 7) === 0) return lit ? '3' : '1';
    if (y >= 30 || u > 0.93) return '1';
    if (lit) return '4';
    if (u > 0.78 || y > 27) return '2';
    return '3';
  });
}

// The old crown's exact spike columns, kept. Low is the resting frame; high is the 1 px bob odd
// frames get, which is what the spare matrix row 0 exists for.
function bossCrown(high) {
  const tips = [2, 7, 13, 19, 24];
  const wide = [1, 6, 12, 17, 23];
  const isWide = (x) => wide.some((c) => x === c || x === c + 1);
  return grid(28, 4, (x, y) => {
    const base = high ? 0 : 1;
    if (y === base && tips.indexOf(x) >= 0) return 'e';
    if (y === base + 1 && isWide(x)) return 'd';
    if (y === 3) return '4';
    if (y === 2) return high ? 'b' : (isWide(x) ? 'd' : '.');
    return '.';
  });
}

function bossFrame(high, body) {
  let rows = mat(...bossBody(body));
  rows = stamp(rows, bossCrown(high), 2, 0);
  rows = stamp(rows, mat('WW', 'WK'), 10, 13);
  rows = stamp(rows, mat('WW', 'WK'), 20, 13);
  rows = stamp(rows, mat('KKKK', 'KKKK'), 14, 19);
  return rows;
}

// Two frames per pose rather than one, because the old sprite's crown bob depended on the
// `frame` argument even while hurt and while spinning: (x, y, 0, …) inked one row lower than
// (x, y, 1, …) in every one of those states, and that 1 px is part of the frozen footprint.
const BOSS = [
  bossFrame(false, {}), // idle, crown resting
  bossFrame(true, {}), // idle, crown bobbed up
  bossFrame(false, { tuck: true }), // hop, base tucked under
  bossFrame(true, { tuck: true }),
  bossFrame(false, { flash: true }), // hurt flash
  bossFrame(true, { flash: true }),
];

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

const M_HERO = mapOf(ramp(RM.heroLeaf, '12345'), ramp(RM.heroBody, 'abcde'), ramp(RM.heroSeed, 'fghij'),
  { l: RM.heroBody.deep, m: RM.heroBody.shade, n: RM.heroBody.base });
const M_TURNIP = mapOf(ramp(RM.turnipBody, '12345'), ramp(RM.heroLeaf, 'abcde'));
const M_BOSS = mapOf(ramp(RM.pineapple, '12345'), ramp(RM.heroLeaf, 'abcde'));
const M_GROUND = mapOf(ramp(RM.dirt, '12345'), ramp(RM.grass, 'abcde'), ramp(RM.stone, 'fghij'));
const M_STONE = mapOf(ramp(RM.stone, '12345'));
const M_BRICK = mapOf(ramp(RM.brick, '12345'));
const M_PLATFORM = mapOf(ramp(RM.platform, '12345'), ramp(RM.bush, 'abcde'));
const M_USED = mapOf(ramp(RM.used, '12345'));
const M_PUMPKIN = mapOf(ramp(RM.pumpkin, '12345'), ramp(RM.heroLeaf, 'abcde'), ramp(RM.crown, 'fghij'),
  { E: RM.crown.hi });
const M_PIPE = mapOf(ramp(RM.pipe, '12345'), { a: RM.grass.hi });
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

// Keys whose box the harness measures wear their rim INSIDE the matrix, because the pad outline
// would ink a row the frozen geometry does not know about. `rim` recolours cells that are
// already on the silhouette, so the inked box it reports is the box that gets painted. The lit
// tone is the same material one ramp step up (`m` is `heroBody.shade` in `M_HERO`), so what is
// recovered is a ramp step, not an invented colour. Measured by atlas readback, distinct colours
// per key before -> after: hero.small 29->34, hero.big 25->28, lives 19->21, boss 16->24,
// shard 11->14.
// `turnip` stays SINGLE-TONE, deliberately: a distinct lit letter pulls its key-lit silhouette
// cells into bakeMatrix's directional pass, which at shade.strength 1 replaces the cell colour
// with a ramp step outright (src/pixels.js:302-326), collapsing 6 body tones into one `lit` —
// 22 colours -> 19, tone bands 17 -> 15. `deep` is the tone that pass leaves alone, so a
// one-tone rim keeps the turnip its ramp. Both `2` and `3` as the lit tone measured identically,
// so this is the pass, not the letter.
const HERO_SMALL_RIM = HERO_SMALL.map((f) => rim(f, 'l', 'm'));
const HERO_BIG_RIM = HERO_BIG.map((f) => rim(f, 'l', 'm'));
const TURNIP_RIM = TURNIP.map((f) => rim(f, '1'));
const TURNIP_SQUASH_RIM = rim(TURNIP_SQUASH, '1');
const BOSS_RIM = BOSS.map((f) => rim(f, '1', '2'));
const SHARD_RIM = rim(SHARD, '1', '2');

register({ key: 'hero.small', frames: HERO_SMALL_RIM, map: M_HERO, anchor: { x: 0, y: -2 }, opts: opts() });
register({ key: 'hero.big', frames: HERO_BIG_RIM, map: M_HERO, anchor: { x: 0, y: -2 }, opts: opts() });
register({ key: 'lives', frames: [HERO_SMALL_RIM[0]], map: M_HERO, anchor: { x: 0, y: -2 }, opts: opts() });
register({ key: 'turnip', frames: TURNIP_RIM, map: M_TURNIP, anchor: { x: -1, y: -1 }, opts: opts() });
register({ key: 'turnip.squash', frames: [TURNIP_SQUASH_RIM], map: M_TURNIP, anchor: { x: -1, y: 0 }, opts: opts() });
register({ key: 'boss', frames: BOSS_RIM, map: M_BOSS, anchor: { x: -2, y: -3 }, opts: opts() });
register({ key: 'ground.top', frames: [GROUND_TOP], map: M_GROUND, anchor: { x: 0, y: 0 }, opts: opts(DITHER) });
register({ key: 'ground.body', frames: [GROUND_BODY], map: M_GROUND, anchor: { x: 0, y: 0 }, opts: opts(DITHER) });
register({ key: 'stone', frames: [STONE], map: M_STONE, anchor: { x: 0, y: 0 }, opts: opts(DITHER) });
register({ key: 'brick', frames: [BRICK], map: M_BRICK, anchor: { x: 0, y: 0 }, opts: opts(DITHER) });
register({ key: 'pumpkin', frames: [PUMPKIN], map: M_PUMPKIN, anchor: { x: 0, y: 0 }, opts: opts({ emissive: { chars: 'E', color: P.pumpkinLit } }) });
register({ key: 'pumpkin.used', frames: [PUMPKIN_USED], map: M_USED, anchor: { x: 0, y: 0 }, opts: opts(DITHER) });
register({ key: 'platform', frames: [PLATFORM], map: M_PLATFORM, anchor: { x: 0, y: 0 }, opts: opts(DITHER) });
register({ key: 'pipe.cap', frames: [PIPE_CAP], map: M_PIPE, anchor: { x: 0, y: 0 }, opts: opts(DITHER) });
register({ key: 'pipe.body', frames: [PIPE_BODY], map: M_PIPE, anchor: { x: 0, y: 0 }, opts: opts(DITHER) });
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

// idle x2, run x4, jump, fall, land: the pose picks the frame and the frame index picks inside
// it. Old code bobbed the whole sprite 1 px up on odd run frames, and the atlas anchor is
// per-entry, so that bob stays where it always was — on the draw position.
const HERO_BASE = { idle: 0, run: 2, jump: 6, fall: 7, land: 8 };

export function drawHero(ctx, x, y, facing, big, pose, frame) {
  ensure();
  const base = HERO_BASE[pose] === undefined ? 0 : HERO_BASE[pose];
  const f = pose === 'run' ? base + (frame & 3) : pose === 'idle' ? base + (frame & 1) : base;
  const bob = pose === 'run' && (frame & 1) ? -1 : 0;
  blit(ctx, big ? 'hero.big' : 'hero.small', f, x, y + bob, facingLeft(facing));
}

export function drawTurnip(ctx, x, y, frame, facing) {
  ensure();
  blit(ctx, 'turnip', frame & 3, x, y, facingLeft(facing));
}

export function drawBoss(ctx, x, y, frame, facing, hurt) {
  ensure();
  // The pose picks the pair; the low bit of `frame` keeps the old crown bob exactly, so the
  // inked box of any (frame, hurt) call is the box the old sprite put on the grid.
  const f = (hurt ? 4 : (frame & 2) === 2 ? 2 : 0) + (frame & 1);
  blit(ctx, 'boss', f, x, y, facingLeft(facing));
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
