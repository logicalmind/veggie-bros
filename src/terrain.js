// Baked background/terrain (GRAPHICS_PLAN.md §4, §5.7, §7). One level = an ambient sky
// canvas, three parallax depths, and terrain strips; every canvas is produced ONCE per
// level (on first sight) and then only ever blitted, so nothing in this module runs per
// frame and the hot path stays `drawImage`.
//
// STRIPS, NOT ONE GIANT CANVAS. 1-1 is 3600x240 logical, i.e. 7200x480 art px (~13 MB):
// older iOS Safari clamps a canvas by AREA long before that. A strip is STRIP_W(64) x
// level-height logical = 128x480 art px ~= 245 KB, so 12 live strips cost ~3 MB and each
// canvas is ~61k px — far under every device limit. A strip evicted by the LRU re-bakes
// from the level on the next sight, which is only legal because baking is PURE: bakeStrip
// reads level tiles at ABSOLUTE world coordinates and never a neighbouring pixel of its
// own canvas, so a crop of the level is byte-identical however it was cropped.
//
// That last point is the load-bearing one, so it is stated where it can rot: **every
// edge/AO term in a strip is computed from level columns (`artTile`/`aoColumns`), never
// from the strip's own pixels, and every seed is an absolute (tx,ty).** Any function that
// reads `tx` relative to its strip, or reads back a canvas, will make the shading
// disagree at every 64 px boundary — a visible seam down the level. The W2 probe proves
// it by re-rendering the same view through two different strip phases (§8 R49-style
// pixel read) and requiring a zero luminance delta at the seams.
//
// No DOM/canvas work at import: `bakeLevel` only *plans* (keys + counts), so the harness
// can plan a level under bare Node; canvases appear on first sight. Terrain must be baked
// after `atlas.bakeAll()` — blit() of an unbaked atlas draws nothing (§3.1).

import { TILE, ROWS, VIEW_W, VIEW_H, ART_SCALE, PALETTE } from './config.js';
import { blit } from './atlas.js';
import { isSolid, tileAt } from './level.js';
import { makeLayer, bakeVertical, buildRamps, seeded, parseColor, colorToCss } from './pixels.js';

const STRIP_W = 64;   // logical px per strip (4 tiles) -> 128x480 art px, ~245 KB
const TILES_PER_STRIP = STRIP_W / TILE;
const MAX_LIVE = 12;  // LRU cap on live strip canvases (~3 MB)
const AO_ROWS = 4;    // how far (in tiles) a ceiling's soft shadow reaches down
const AO_MAX = 0.30;  // alpha at the ceiling itself
const FG_BOTTOM = 12; // §5.7 hard ceilings: the foreground band may never cover the hero's
const FG_TOP = 8;     // feet or a landing surface, so it is clamped by construction
const MAX_BUNDLES = 3; // ambient/parallax canvases kept for recently-seen levels

// §5.7 depth table: far hills 0.25x, clouds/bushes 0.5x, foreground band 1.15x. `period`
// is the tileable pattern length in logical px; a layer canvas is VIEW_W + period wide so
// one blit covers the view for any scroll offset. 128 % 4 == 0 and 96 % 4 == 0 keep the
// block-shaped silhouettes period-exact (no seam where the pattern wraps).
const DEPTHS = [
  { name: 'far', factor: 0.25, period: 128, blocks: 4, alpha: 0.92, hue: 'hillFar', fog: 0.55, baseY: 186, amp: 1 },
  { name: 'mid', factor: 0.5, period: 96, blocks: 4, alpha: 0.96, hue: 'hillNear', fog: 0.3, baseY: 204, amp: 0.6 },
  { name: 'near', factor: 1.15, period: 48, blocks: 6, alpha: 1, hue: 'bush', fog: 0, baseY: VIEW_H, amp: 0 },
];

// One entry per level (levels.js order). `pal` overrides PALETTE hues so buildRamps()
// derives the whole level's ramps from the theme's family (§5.1: ramps, not colours);
// `sky` stops feed pixels.bakeVertical; `fog` is the horizon colour distant depths are
// tinted toward; `shape`/`props`/`near` pick the silhouette, not the art.
const THEMES = {
  fields: {
    pal: {},
    sky: [{ stop: 0, color: '#5fc6ec' }, { stop: 0.35, color: '#9be3f5' }, { stop: 0.62, color: '#bfeefa' },
      { stop: 0.88, color: '#dff2c9' }, { stop: 1, color: '#c8e6a8' }],
    fog: '#dff2c9', shape: 'hills', props: 'clouds', near: 'grass',
  },
  canyon: {
    pal: {
      sky: '#f6a86a', skyDark: '#e0774f', hillFar: '#e0a06a', hillNear: '#c07a45', bush: '#8a5a3a',
      dirt: '#d98c4a', dirtDark: '#8a4a20', grass: '#b0b34a', stone: '#e0b48a', stoneDark: '#9a7550',
      brick: '#d97a4a', cloud: '#fff0d8',
    },
    sky: [{ stop: 0, color: '#8f5fa8' }, { stop: 0.45, color: '#e0774f' }, { stop: 0.72, color: '#f6a86a' },
      { stop: 1, color: '#ffd9a0' }],
    fog: '#ffd9a0', shape: 'mesas', props: 'spires', near: 'tuft',
  },
  palace: {
    pal: {
      sky: '#6a7fc0', skyDark: '#4a5aa8', hillFar: '#9a9ad0', hillNear: '#6a68a8', bush: '#3f7a58',
      dirt: '#c9b07a', dirtDark: '#8a6a3a', grass: '#5fa06a', stone: '#efe6c8', stoneDark: '#a89e78',
      brick: '#d9a86a', brickDark: '#8a6230', cloud: '#e8e0ff',
    },
    sky: [{ stop: 0, color: '#3a4a8a' }, { stop: 0.45, color: '#6a7fc0' }, { stop: 0.75, color: '#a8b0e0' },
      { stop: 1, color: '#ffe0a0' }],
    fog: '#ffe0a0', shape: 'towers', props: 'temples', near: 'vine',
  },
};

// Tile char -> atlas key + ramp family. Only keys §3.1 lists; no art is invented here.
// 'Q' (mega-berry block) shares the pumpkin block's art on purpose: main.js turns BOTH
// 'P' and 'Q' into 'U' when they are punched, and 'U' has exactly one sprite
// (`pumpkin.used`), so the two are one block family with one spent look.
const TILE_ART = {
  X: { key: 'ground.body', hue: 'dirt' },
  S: { key: 'stone', hue: 'stone' },
  B: { key: 'brick', hue: 'brick' },
  P: { key: 'pumpkin', hue: 'pumpkin' },
  Q: { key: 'pumpkin', hue: 'pumpkin' },
  U: { key: 'pumpkin.used', hue: 'used' },
  '=': { key: 'platform', hue: 'platform' },
  '|': { key: 'pipe.body', hue: 'pipe' },
};
const SURFACE_KEY = 'ground.top'; // an 'X' with air above wears the grass cap

// ---------------------------------------------------------------- live caches
// Map order IS the LRU order: ensureStrip() deletes+re-sets on a hit, so the first key is
// always the least recently used.
const strips = new Map();
const bundles = new Map(); // levelId -> { ambient: {canvas}, parallax: [layer] }
let stripsBaked = 0; // cumulative, never decremented: "how much baking did this session do"

const themeCache = new Map();

// ---------------------------------------------------------------- small helpers

function rgba(rgb, a) {
  return colorToCss({ r: rgb.r, g: rgb.g, b: rgb.b, a: Math.max(0, Math.min(1, a)) });
}

// Alpha rides along: every consumer hands the result to `colorToCss`, which formats a
// missing alpha as `rgba(r,g,b,NaN)` — an INVALID css colour the canvas silently ignores, so
// that fill draws in whatever fillStyle was last valid (measured in the browser: assigning it
// leaves `fillStyle` unchanged, and the fields mid layer's clouds came out `#eff9e4` instead
// of `#ffffff`). The same string is unparseable ink in the harness' ink model, which throws
// the moment such a pixel is blitted with globalAlpha < 1. Both inputs here are always opaque
// — `rgb()` and this function both set `a: 1` — so the blend is opaque by construction.
function mix(a, b, t) {
  return { r: a.r + (b.r - a.r) * t, g: a.g + (b.g - a.g) * t, b: a.b + (b.b - a.b) * t,
    a: a.a === undefined ? 1 : a.a };
}

function rgb(css, fallback) {
  const c = parseColor(css);
  return c || parseColor(fallback) || { r: 0, g: 0, b: 0, a: 1 };
}

// Positive modulo — camX may be fractional after parallax scaling and negative in tests.
function pmod(v, m) {
  const r = v % m;
  return r < 0 ? r + m : r;
}

// tileAt is the GAMEPLAY wall: it answers 'X' outside the map, which is right for a foot
// and wrong for shading — a shadow field seeded by the map's own edge would stripe the
// first and last column of every level. Art reads the same accessor, with the map's left
// and right edges treated as air and the rows below the floor kept solid (undersides of
// the level stay dark). Absolute coordinates in, tile out: never a strip-relative index.
function artTile(level, cols, tx, ty) {
  if (tx < 0 || tx >= cols) return ty >= ROWS ? 'X' : '.';
  return tileAt(level, tx, ty);
}

function solidArt(level, cols, tx, ty) {
  return isSolid(artTile(level, cols, tx, ty));
}

// One FNV-1a over the strip's tile chars plus the shadow kernel's context: two columns
// on each side, matching the 5-wide kernel's reach exactly. It is what makes the strip
// cache self-healing: main.js turns a punched 'P' into 'U' in level.tiles, the digest
// changes, and that one strip re-bakes once with its spent block instead of serving stale
// art forever. A punched block two columns over moves the shadow here, so the context
// must span the kernel or the neighbour strip would keep its old shadow. Same level in
// => same keys out (§R50).
function stripDigest(level, cols, firstCol) {
  let h = 0x811c9dc5;
  for (let tx = firstCol - 2; tx <= firstCol + TILES_PER_STRIP + 1; tx++) {
    for (let ty = 0; ty < ROWS; ty++) {
      h ^= artTile(level, cols, tx, ty).charCodeAt(0);
      h = Math.imul(h, 0x01000193);
    }
  }
  return (h >>> 0).toString(36);
}

// ---------------------------------------------------------------- themes

function themeOf(name) {
  let t = themeCache.get(name);
  if (t) return t;
  const def = THEMES[name];
  if (!def) throw new Error(`terrain: unknown theme '${name}' (want fields|canyon|palace)`);
  const ramps = buildRamps(Object.assign({}, PALETTE, def.pal));
  const fog = rgb(def.fog, PALETTE.sky);
  const mat = {};
  for (const ch of Object.keys(TILE_ART)) {
    const r = ramps[TILE_ART[ch].hue] || ramps.stone;
    mat[ch] = {
      key: TILE_ART[ch].key,
      deep: rgb(r.deep, PALETTE.black),
      shade: rgb(r.shade, PALETTE.black),
      lit: rgb(r.lit, PALETTE.white),
      hi: rgb(r.hi, PALETTE.white),
    };
  }
  // Per depth: silhouette body/lit/deep pre-tinted toward the horizon (fog), so the bake
  // needs no per-pixel blending and the layer reads as distance, not as a flat cutout.
  const depths = DEPTHS.map((d) => {
    const r = ramps[d.hue] || ramps.hillFar;
    const body = rgb(r.base, PALETTE.hillFar);
    const lit = rgb(r.lit, PALETTE.white);
    const deep = rgb(r.deep, PALETTE.black);
    return {
      spec: d,
      body: mix(body, fog, d.fog),
      lit: mix(lit, fog, d.fog * 0.8),
      deep: mix(deep, fog, d.fog * 0.7),
      shade: mix(rgb(r.shade, PALETTE.black), fog, d.fog * 0.9),
      accent: mix(rgb(r.hi, PALETTE.white), fog, d.fog),
    };
  });
  t = {
    name,
    sky: def.sky,
    fog,
    shape: def.shape,
    props: def.props,
    near: def.near,
    mat,
    depths,
    ao: mix(rgb(def.pal.skyDark || PALETTE.skyDark, PALETTE.skyDark), { r: 26, g: 26, b: 40 }, 0.45),
  };
  themeCache.set(name, t);
  return t;
}

// ---------------------------------------------------------------- per-level plan

function bundleFor(id) {
  let b = bundles.get(id);
  if (b) return b;
  // Keep recently-seen levels' big canvases alive so a death reload of the same level
  // re-blits instead of re-baking (R48), but bound the set: an old level's canvases are
  // simply re-baked on its next sight.
  while (bundles.size >= MAX_BUNDLES) {
    const oldest = bundles.keys().next().value;
    freeBundle(bundles.get(oldest));
    bundles.delete(oldest);
  }
  b = { ambient: { canvas: null }, parallax: DEPTHS.map(() => ({ canvas: null, alpha: 1, factor: 1, period: 1 })) };
  bundles.set(id, b);
  return b;
}

function freeBundle(b) {
  if (!b) return;
  if (b.ambient) b.ambient.canvas = null;
  for (const L of b.parallax) L.canvas = null;
}

/**
 * Plan a level's baked background. DOM-free: it allocates no canvas, only the strip keys
 * and sizes. Canvases appear on first sight in visibleStrips/ambientFor/parallaxFor.
 * @returns {{theme:string, ambient:{canvas:(CanvasRenderingContext2D|Object|null)},
 *            widthPx:number, heightPx:number, stats:Object}}
 */
export function bakeLevel(level, theme, opts) {
  if (!level || !Array.isArray(level.tiles) || level.tiles.length === 0) {
    throw new Error('terrain: bakeLevel needs a parsed level');
  }
  const o = opts || {};
  // Seam proof only (W2 probe): re-phasing the strip grid moves every 64 px boundary, so
  // a bake that depended on its own crop would show up as a pixel delta between two
  // renders of the same camera. Strips then live at world x = i*STRIP_W - phase (phase
  // snapped to TILE so a tile is never cut in half); shipped callers pass nothing.
  const phase = Math.max(0, Math.min(STRIP_W - TILE, Math.round(((o.stripPhase || 0) | 0) / TILE) * TILE));
  const th = themeOf(theme);
  const cols = level.tiles[0].length;
  const rows = level.tiles.length;
  const widthPx = cols * TILE;
  const stripCount = Math.ceil((widthPx + phase) / STRIP_W);
  const keys = new Array(stripCount);
  for (let i = 0; i < stripCount; i++) {
    keys[i] = `${level.label}|${th.name}|${phase}|${i}|${stripDigest(level, cols, i * TILES_PER_STRIP - phase / TILE)}`;
  }
  const bundle = bundleFor(`${level.label}|${th.name}|${phase}`);
  const stripBytes = STRIP_W * ART_SCALE * rows * TILE * ART_SCALE * 4;
  const ambientBytes = VIEW_W * ART_SCALE * VIEW_H * ART_SCALE * 4;
  let parallaxBytes = 0;
  for (const d of DEPTHS) parallaxBytes += (VIEW_W + d.period) * ART_SCALE * VIEW_H * ART_SCALE * 4;
  return {
    theme: th.name,
    ambient: bundle.ambient, // lazily filled; the object identity is stable per level
    widthPx,
    heightPx: rows * TILE,
    stats: {
      strips: stripCount,
      maxLive: MAX_LIVE,
      stripBytes,
      ambientBytes,
      parallaxBytes,
      residentBytes: Math.min(stripCount, MAX_LIVE) * stripBytes + ambientBytes + parallaxBytes,
    },
    // internals (wave 3 reads the five keys above)
    label: level.label,
    cols,
    rows,
    stripW: STRIP_W,
    stripCount,
    stripPhase: phase,
    stripKeys: keys,
    _level: level,
    _theme: th,
    _bundle: bundle,
  };
}

// ---------------------------------------------------------------- strips

function ensureStrip(baked, index) {
  const key = baked.stripKeys[index];
  let s = strips.get(key);
  if (s !== undefined) {
    strips.delete(key); // touch: Map order is the LRU order
    strips.set(key, s);
    return s;
  }
  s = bakeStrip(baked, index);
  strips.set(key, s);
  stripsBaked += 1;
  while (strips.size > MAX_LIVE) {
    const victimKey = strips.keys().next().value;
    const victim = strips.get(victimKey);
    strips.delete(victimKey);
    // Dropping the map entry is enough: nothing else holds the record after its frame.
    // Nulling the canvas here would break a caller that kept the array across frames.
  }
  return s;
}

/**
 * Bake strip `index` of a planned level. PURE in (level, theme, stripIndex): every tile
 * read, every neighbour test and every seed speaks absolute world coordinates, and the
 * only pixels it touches are the ones it writes. An evicted strip re-bakes identical.
 */
function bakeStrip(baked, index) {
  const level = baked._level;
  const th = baked._theme;
  const cols = baked.cols;
  const rows = baked.rows;
  const hPx = baked.heightPx;
  // Absolute world x of this strip's left edge. Everything below is derived from it and
  // from nothing else, which is what makes a crop of the level reproducible.
  const origin = index * STRIP_W - baked.stripPhase;
  const firstCol = origin / TILE;
  const { c, ctx } = makeLayer(STRIP_W * ART_SCALE, hPx * ART_SCALE);
  // Think in logical px everywhere: blit's destination is logical px, and this transform
  // turns it (and every shading fill below) into the art-scale backing store.
  ctx.scale(ART_SCALE, ART_SCALE);
  // Two columns of AO context on each side: the soft shadow is a 5-column kernel, so a
  // strip must be able to see two doors down's ceiling without next door's pixels.
  const ao = aoColumns(level, cols, firstCol - 2, firstCol + TILES_PER_STRIP + 1);
  for (let k = 0; k < TILES_PER_STRIP; k++) {
    const tx = firstCol + k;
    if (tx >= cols) break; // past the map's right edge: sky, not terrain
    const lx = tx * TILE - origin;
    for (let ty = 0; ty < rows; ty++) {
      // 5-column weighted average centred on this tile's column: same intensities as the
      // old 3-column kernel at every covered spot, plus a soft tail two columns out —
      // the old kernel's hard 16 px side steps read as blocky shadow edges.
      const soft = aoKernel(ao, k, ty);
      const ch = artTile(level, cols, tx, ty);
      if (!isSolid(ch)) {
        // Air: the only thing baked into a strip's transparent cells is the soft shadow
        // of whatever ceiling is above it, which is what makes an overhang read as depth.
        // The field is per-tile, so paint it as a 1-px row ramp between this tile's value
        // and the tile below's: the old per-tile constant fill left four 16-px hard bands
        // down every shadow pillar.
        if (soft > 0.004) {
          const below = aoKernel(ao, k, ty + 1);
          if (Math.abs(below - soft) > 0.004) {
            for (let p = 0; p < TILE; p++) {
              const s = soft + ((below - soft) * (p + 1)) / TILE;
              if (s <= 0.004) break; // the field is non-increasing downwards, so this is last
              ctx.fillStyle = rgba(th.ao, AO_MAX * s);
              ctx.fillRect(lx, ty * TILE + p, TILE, 1);
            }
          } else {
            ctx.fillStyle = rgba(th.ao, AO_MAX * soft);
            ctx.fillRect(lx, ty * TILE, TILE, TILE);
          }
        }
        continue;
      }
      const m = matFor(th, level, cols, tx, ty, ch);
      blit(ctx, m.key, m.frame || 0, lx, ty * TILE);
      shadeTile(ctx, baked, th, m, tx, ty, lx, soft);
    }
  }
  return { index, key: baked.stripKeys[index], canvas: c, ctx };
}

// The atlas key for one solid tile: 'X' with air above is the grass-capped surface. A pipe
// run is two tiles wide (no wider in shipped levels): the left column blits frame 0, the
// right frame 1, so the run shades as one barrel lit from the left; the run's top tile is
// its cap. All of it reads the level, never the canvas.
function matFor(th, level, cols, tx, ty, ch) {
  const base = th.mat[ch] || th.mat.X;
  if (ch === 'X' && !solidArt(level, cols, tx, ty - 1)) return { key: SURFACE_KEY, deep: base.deep, shade: base.shade, lit: base.lit, hi: base.hi };
  if (ch === '|') {
    const frame = artTile(level, cols, tx - 1, ty) === '|' ? 1 : 0;
    const key = artTile(level, cols, tx, ty - 1) !== '|' ? 'pipe.cap' : 'pipe.body';
    return { key, frame, deep: base.deep, shade: base.shade, lit: base.lit, hi: base.hi };
  }
  return base;
}

// Directional shading + contact shadows + burial tint, all from level columns (§5.1-§5.3).
// Kept separate from the blit so the seam argument is auditable in one place.
function shadeTile(ctx, baked, th, m, tx, ty, lx, soft) {
  const level = baked._level;
  const cols = baked.cols;
  const ch = artTile(level, cols, tx, ty);
  const up = solidArt(level, cols, tx, ty - 1);
  const left = solidArt(level, cols, tx - 1, ty);
  const right = solidArt(level, cols, tx + 1, ty);
  const y = ty * TILE;
  if (up) {
    // §5.3: the 1-px joint where two solids meet, so stacked ground does not read as one
    // slab. Only the top edge of the lower tile gets it, so the line is one pixel thick.
    ctx.fillStyle = rgba(m.deep, 0.2);
    ctx.fillRect(lx, y, TILE, 1);
  } else {
    // Exposed top face catches the key light (§5.2 up-left): a bright hairline, then a
    // wider lit band, then the body — three tone bands on an otherwise flat cap.
    ctx.fillStyle = rgba(m.hi, 0.34);
    ctx.fillRect(lx, y, TILE, 1);
    ctx.fillStyle = rgba(m.lit, 0.18);
    ctx.fillRect(lx, y + 1, TILE, 2);
    // Sparse surface speckle, seeded on ABSOLUTE tile coords so a re-crop is identical.
    for (let s = 0; s < 2; s++) {
      const r0 = seeded(tx * 131 + ty * 17 + s, 71);
      const r1 = seeded(tx * 71 + ty * 131 + s, 72);
      ctx.fillStyle = rgba(r0 < 0.5 ? m.shade : m.lit, 0.16);
      ctx.fillRect(lx + Math.min(TILE - 1, (r0 * TILE) | 0), y + 3 + ((r1 * (TILE - 4)) | 0), 1, 1);
    }
  }
  if (!left) {
    ctx.fillStyle = rgba(m.lit, 0.16);
    ctx.fillRect(lx, y, 1, TILE);
  }
  if (!right) {
    ctx.fillStyle = rgba(m.shade, 0.24);
    ctx.fillRect(lx + TILE - 1, y, 1, TILE);
  }
  // Buried ground cools off with depth, which is what makes a pit wall read as cut earth,
  // and carries two faint strata lines so a wall of `ground.body` is not one flat field
  // (§5.4 wants 3 tone bands per material; the art may already have them, and low-alpha
  // lines over art that does are invisible). Seeded on ABSOLUTE tile coords.
  const depth = buriedRows(level, cols, tx, ty);
  if (depth > 0) {
    ctx.fillStyle = rgba(th.ao, 0.05 * depth);
    ctx.fillRect(lx, y, TILE, TILE);
    if (m.key === 'ground.body') {
      for (let s = 0; s < 2; s++) {
        const sy = 3 + ((seeded(tx * 53 + ty * 97 + s, 73) * (TILE - 5)) | 0);
        ctx.fillStyle = rgba(m.deep, 0.07 + 0.06 * seeded(tx * 17 + ty * 5 + s, 74));
        ctx.fillRect(lx, y + sy, TILE, 1);
      }
    }
  }
  // The same ceiling shadow that darkens the air also settles on the tile face below it.
  if (soft > 0.02) {
    if (up && artTile(level, cols, tx, ty - 1) === ch) {
      // Stacked / buried body (X under X, | under |): keep the old flat deep tone — a
      // fade here would sawtooth at every 16-px body boundary.
      ctx.fillStyle = rgba(th.ao, AO_MAX * soft * 0.7);
      ctx.fillRect(lx, y, TILE, TILE);
    } else {
      // A ceiling shadow landing on an exposed face (ground under a floating block, or a
      // pipe's base on the ground): fade it down the tile so the contact shadow reads as
      // a soft patch, not a hard-edged 16-px square.
      for (let p = 0; p < TILE; p++) {
        const a = AO_MAX * soft * 0.7 * (1 - p / TILE);
        if (a <= 0.004) break;
        ctx.fillStyle = rgba(th.ao, a);
        ctx.fillRect(lx, y + p, TILE, 1);
      }
    }
  }
}

function buriedRows(level, cols, tx, ty) {
  let n = 0;
  while (n < 4 && solidArt(level, cols, tx, ty + n + 1)) n++;
  return n;
}

// The 5-wide shadow kernel at tile `k`, row `ty`: a weighted AVERAGE, weights
// 0.25/0.75/1.5/0.75/0.25 over columns k-2..k+2 (the `ao` array is offset so the tile's
// own column is index k+2), divided by the weight sum 3.5. A full-weight column under a
// ceiling reads the same as the old 3-column (a+2b+c)/4 kernel did — a fully covered
// centre stays 1.0, a lone ceiling 0.43 (old 0.5) — but the average extends two columns
// further, so shadow edges get a 0.29/0.07 tail instead of a hard 16-px step.
function aoKernel(ao, k, ty) {
  return (0.25 * ao[k][ty] + 0.75 * ao[k + 1][ty] + 1.5 * ao[k + 2][ty] + 0.75 * ao[k + 3][ty] + 0.25 * ao[k + 4][ty]) / 3.5;
}

// Soft ambient occlusion, per LEVEL column (O(cols*rows) once per strip bake): a solid
// tile seeds a shadow field of 1 and it decays to 0 over AO_ROWS tiles of air. Returned
// indexed 0..(to-from) so the caller's 5-wide kernel spans neighbouring columns.
function aoColumns(level, cols, from, to) {
  const out = [];
  for (let tx = from; tx <= to; tx++) {
    const f = new Float32Array(ROWS + 1);
    let v = 0;
    for (let ty = 0; ty < ROWS; ty++) {
      v = solidArt(level, cols, tx, ty - 1) ? 1 : Math.max(0, v - 1 / AO_ROWS);
      f[ty] = v;
    }
    out.push(f);
  }
  return out;
}

/** The strips to blit for this camera, in draw order: `dx` is the destination x in
 *  logical px relative to the view's left edge (integer, so nearest-neighbour stays
 *  crisp). Minimal set: no gaps, no overlap, nothing outside the level. */
export function visibleStrips(baked, camX) {
  const x = Math.max(0, Math.floor(camX || 0));
  const shift = x + baked.stripPhase; // strips are at world i*STRIP_W - phase
  const first = Math.floor(shift / STRIP_W);
  let last = Math.floor((shift + VIEW_W - 1) / STRIP_W);
  if (last >= baked.stripCount) last = baked.stripCount - 1;
  const out = [];
  for (let i = first; i <= last; i++) {
    const s = ensureStrip(baked, i);
    out.push({ canvas: s.canvas, dx: i * STRIP_W - baked.stripPhase - x });
  }
  return out;
}

// ---------------------------------------------------------------- ambient (sky + wash)

function bakeAmbient(baked) {
  const th = baked._theme;
  const sky = bakeVertical(VIEW_W, VIEW_H, th.sky, ART_SCALE); // the one gradient of the level
  const { c, ctx } = makeLayer(VIEW_W * ART_SCALE, VIEW_H * ART_SCALE);
  ctx.drawImage(sky, 0, 0);
  // Horizon haze + a cool ceiling, in bands. §5.5 wants dither only in gradient fields and
  // forbids a period that aliases with ART_SCALE, so a smooth ramp is left smooth: these
  // are wide flat washes, where a 2-px dither is both safe and cheap.
  ctx.scale(ART_SCALE, ART_SCALE);
  for (let k = 0; k < 4; k++) {
    const y0 = VIEW_H - 56 + k * 14;
    ctx.fillStyle = rgba(th.fog, 0.05 + k * 0.045);
    ctx.fillRect(0, y0, VIEW_W, 14);
  }
  ctx.fillStyle = rgba(th.ao, 0.07);
  ctx.fillRect(0, 0, VIEW_W, 26);
  ctx.fillStyle = rgba(th.ao, 0.04);
  ctx.fillRect(0, 26, VIEW_W, 20);
  if (baked.theme === 'palace') {
    // A handful of deterministic stars — the only sparkle the dusk theme gets.
    for (let i = 0; i < 26; i++) {
      const sx = (seeded(i, 91) * VIEW_W) | 0;
      const sy = (seeded(i, 92) * 64) | 0;
      ctx.fillStyle = rgba({ r: 255, g: 255, b: 255 }, 0.25 + 0.5 * seeded(i, 93));
      ctx.fillRect(sx, sy, 1, 1);
    }
  }
  return c;
}

function ensureAmbient(baked) {
  if (baked.ambient.canvas === null) baked.ambient.canvas = bakeAmbient(baked);
  return baked.ambient;
}

/** The baked sky/ambient wash: one canvas, blitted once per frame at the view origin.
 *  `camX` is part of the contract but cannot move it — the sky is screen-aligned, and the
 *  world-locked half of §7's ambient (per-column soft AO) is baked into the strips, which
 *  is the only way it can scroll with the level without a per-window or per-frame bake. */
export function ambientFor(baked, camX) {
  return ensureAmbient(baked);
}

// ---------------------------------------------------------------- parallax

function bakeParallax(baked) {
  const th = baked._theme;
  const layers = baked._bundle.parallax;
  for (let d = 0; d < DEPTHS.length; d++) {
    if (layers[d].canvas !== null) continue;
    const spec = DEPTHS[d];
    const look = th.depths[d];
    const w = VIEW_W + spec.period;
    const { c, ctx } = makeLayer(w * ART_SCALE, VIEW_H * ART_SCALE);
    ctx.scale(ART_SCALE, ART_SCALE);
    if (d === 0) drawFar(ctx, th, spec, look, 3);
    else if (d === 1) drawMid(ctx, th, spec, look, 11);
    else drawNear(ctx, th, spec, look);
    // Aerial fog: source-atop keeps the haze on the silhouette only, so the sky behind it
    // stays the ambient ramp's colour (no readback, §7).
    ctx.globalCompositeOperation = 'source-atop';
    for (let k = 0; k < 3; k++) {
      ctx.fillStyle = rgba(th.fog, spec.fog * (0.1 + 0.14 * k));
      ctx.fillRect(0, VIEW_H - 96 + k * 32, w, 32);
    }
    ctx.globalCompositeOperation = 'source-over';
    layers[d].canvas = c;
    layers[d].alpha = spec.alpha;
    layers[d].factor = spec.factor;
    layers[d].period = spec.period;
  }
  return layers;
}

// Tileable pattern: layer canvas x draws pattern(x), so blitting at
// dx = -floor((camX * factor) mod period) shows pattern(camX*factor + screenX) exactly.
/** The three parallax depths for this camera, far first. */
export function parallaxFor(baked, camX) {
  const layers = bakeParallax(baked);
  const x = camX || 0;
  const out = [];
  for (const L of layers) {
    const dx = -Math.floor(pmod(x * L.factor, L.period));
    out.push({ canvas: L.canvas, dx, alpha: L.alpha });
  }
  return out;
}

// ---- silhouettes. All height fields are functions of `x mod period`, which is what makes
// a layer canvas wrap with zero seam, and all randomness is seeded() on pattern coords.

function ridgeTable(shape, spec, salt) {
  const P = spec.period;
  const t = new Int16Array(P);
  const base = spec.baseY;
  if (shape === 'hills') {
    const TAU = Math.PI * 2;
    const a1 = (10 + 12 * seeded(salt, 1)) * spec.amp;
    const a2 = (4 + 7 * seeded(salt, 2)) * spec.amp;
    const a3 = (2 + 4 * seeded(salt, 3)) * spec.amp;
    const p1 = seeded(salt, 4) * TAU;
    const p2 = seeded(salt, 5) * TAU;
    const p3 = seeded(salt, 6) * TAU;
    for (let x = 0; x < P; x++) {
      const u = (x / P) * TAU; // integer harmonics of the period => tiles exactly
      t[x] = Math.round(base
        - a1 * (0.5 + 0.5 * Math.cos(u + p1))
        - a2 * (0.5 + 0.5 * Math.cos(2 * u + p2))
        - a3 * (0.5 + 0.5 * Math.cos(3 * u + p3)));
    }
    return t;
  }
  // mesas / towers: flat-topped blocks with 2-px stepped shoulders, so the far band reads
  // as cut rock and cut stone rather than as noise. `blocks` divides the period by table
  // construction, so the last block meets the first one cleanly.
  const nb = Math.max(1, spec.blocks);
  const block = Math.max(8, Math.floor(P / nb));
  const tops = new Int16Array(nb);
  for (let b = 0; b < nb; b++) {
    tops[b] = Math.round((shape === 'towers' ? 10 : 12) + seeded(b * 7 + salt, 11) * (shape === 'towers' ? 44 : 32));
  }
  for (let b = 0; b < nb; b++) {
    const left = tops[(b - 1 + nb) % nb];
    const right = tops[(b + 1) % nb];
    for (let x = 0; x < block && b * block + x < P; x++) {
      let hh = tops[b];
      if (x < 3 && hh > left) hh -= (3 - x) * 2;
      if (x > block - 4 && hh > right) hh -= (x - (block - 4)) * 2;
      t[b * block + x] = base - hh;
    }
  }
  for (let x = nb * block; x < P; x++) t[x] = base - tops[nb - 1]; // period remainder
  return t;
}

function drawRidge(ctx, look, ridge, period, w) {
  for (let x = 0; x < w; x++) {
    const y = ridge[x % period];
    ctx.fillStyle = colorToCss(look.body);
    ctx.fillRect(x, y, 1, VIEW_H - y);
    ctx.fillStyle = colorToCss(look.lit); // sunlit rim along the ridge (§5.2)
    ctx.fillRect(x, y, 1, 1);
    ctx.fillStyle = colorToCss(look.shade);
    ctx.fillRect(x, y + 1, 1, 1);
    ctx.fillStyle = colorToCss(look.deep); // a deeper foot so the band has three tones
    ctx.fillRect(x, VIEW_H - 3, 1, 3);
  }
}

function drawFar(ctx, th, spec, look, salt) {
  const ridge = ridgeTable(th.shape, spec, salt);
  drawRidge(ctx, look, ridge, spec.period, VIEW_W + spec.period);
}

// Ellipse by scanlines: pixel-art puffs, no arc() in a bake the harness has to model.
function puff(ctx, cx, cy, r, body, lit, deep) {
  for (let dy = -r; dy <= r; dy++) {
    const hw = Math.round(r * Math.sqrt(Math.max(0, 1 - (dy * dy) / (r * r))));
    if (hw <= 0) continue;
    ctx.fillStyle = colorToCss(dy < -r * 0.35 ? lit : dy > r * 0.4 ? deep : body);
    ctx.fillRect(cx - hw, cy + dy, hw * 2 + 1, 1);
  }
}

function drawMid(ctx, th, spec, look, salt) {
  const P = spec.period;
  const w = VIEW_W + P;
  const ridge = ridgeTable(th.shape, spec, salt);
  drawRidge(ctx, look, ridge, P, w);
  if (th.props === 'clouds') {
    for (let k = 0; k < 4; k++) {
      const cx = Math.round(seeded(k * 5 + salt, 21) * (P - 24)) + 12;
      const cy = Math.round(24 + seeded(k * 5 + salt + 1, 22) * 58);
      const r = 7 + Math.round(seeded(k * 5 + salt + 2, 23) * 7);
      // `a: 1` is not decoration: `puff` stringifies these objects with `colorToCss`, and an
      // alpha-less one becomes `rgba(255,255,255,NaN)` — invalid css the canvas ignores, so the
      // cloud rows drew in the previous fillStyle (measured: 21035 px of `#eff9e4` and 0 px of
      // `#ffffff` before, 16592 px of `#ffffff` after) and the harness' ink model threw on that
      // layer's 0.96-alpha blit.
      const cloud = { r: 255, g: 255, b: 255, a: 1 };
      for (let m = 0; m * P < w + P; m++) {
        const x = cx + m * P;
        puff(ctx, x, cy, r, cloud, cloud, mix(cloud, th.fog, 0.5));
        puff(ctx, x - r, cy + 3, Math.max(3, r - 4), cloud, cloud, mix(cloud, th.fog, 0.5));
        puff(ctx, x + r, cy + 4, Math.max(3, r - 5), cloud, cloud, mix(cloud, th.fog, 0.5));
      }
    }
  } else if (th.props === 'spires') {
    for (let k = 0; k < 3; k++) {
      const cx = Math.round(seeded(k * 3 + salt, 24) * (P - 20)) + 10;
      const h = 16 + Math.round(seeded(k * 3 + salt + 1, 25) * 20);
      for (let m = 0; m * P < w + P; m++) {
        const x = cx + m * P;
        const gy = ridge[x % P];
        for (let dy = 0; dy < h; dy++) {
          const hw = Math.max(1, Math.round(4 - dy * 0.16));
          ctx.fillStyle = colorToCss(dy < 2 ? look.accent : dy > h - 6 ? look.shade : look.body);
          ctx.fillRect(x - hw, gy - dy, hw * 2 + 1, 1);
        }
      }
    }
  } else {
    // temples: tiered roofs on the mid ridge, with a few lit windows for night-time depth.
    for (let k = 0; k < 3; k++) {
      const cx = Math.round(seeded(k * 3 + salt, 26) * (P - 28)) + 14;
      const tiers = 3 + Math.round(seeded(k * 3 + salt + 1, 27) * 2);
      for (let m = 0; m * P < w + P; m++) {
        const x = cx + m * P;
        let gy = ridge[x % P];
        for (let t = 0; t < tiers; t++) {
          const hw = 10 - t * 2;
          const hh = 8;
          ctx.fillStyle = colorToCss(t === 0 ? look.lit : look.body);
          ctx.fillRect(x - hw, gy - hh, hw * 2 + 1, hh);
          ctx.fillStyle = colorToCss(look.deep);
          ctx.fillRect(x - hw - 1, gy - hh, hw * 2 + 3, 1);
          if (t === 1) {
            ctx.fillStyle = colorToCss(look.accent);
            ctx.fillRect(x - 1, gy - hh + 3, 1, 2);
            ctx.fillRect(x + 1, gy - hh + 3, 1, 2);
          }
          gy -= hh + 1;
        }
      }
    }
  }
  if (th.near !== 'tuft') {
    // bushes / hedges on the mid ridge, fields + palace only
    for (let k = 0; k < 6; k++) {
      const cx = Math.round(seeded(k * 7 + salt, 28) * (P - 12)) + 6;
      const r = 4 + Math.round(seeded(k * 7 + salt + 1, 29) * 4);
      for (let m = 0; m * P < w + P; m++) {
        const x = cx + m * P;
        puff(ctx, x, ridge[x % P] - 1, r, look.body, look.lit, look.deep);
      }
    }
  }
}

// Foreground grass/leaves band. §5.7: <= FG_BOTTOM along the bottom, <= FG_TOP at the
// top, so it can never hide the hero's feet or a landing surface. Clamped by construction.
function drawNear(ctx, th, spec, look) {
  const P = spec.period;
  const w = VIEW_W + P;
  const down = new Int16Array(P);
  const up = new Int16Array(P);
  for (let x = 0; x < P; x++) {
    const dense = th.near === 'vine' ? 0.85 : th.near === 'tuft' ? 0.6 : 1;
    const base = 3 + seeded(x, 31) * (FG_BOTTOM - 3);
    down[x] = Math.min(FG_BOTTOM, Math.max(2, Math.round(base * (0.55 + 0.45 * dense) + 2)));
    const hang = th.near === 'vine' ? 1 : 0.55;
    up[x] = seeded(x, 33) < 0.55 ? 0 : Math.min(FG_TOP, Math.round(seeded(x, 34) * FG_TOP * hang + 2));
  }
  for (let x = 0; x < w; x++) {
    const h = down[x % P];
    const y = VIEW_H - h;
    ctx.fillStyle = colorToCss(look.deep);
    ctx.fillRect(x, VIEW_H - 2, 1, 2); // soil / base line
    ctx.fillStyle = colorToCss(look.body);
    ctx.fillRect(x, y + 1, 1, h - 3 > 0 ? h - 3 : 1);
    ctx.fillStyle = colorToCss(th.near === 'vine' ? look.accent : look.lit);
    ctx.fillRect(x, y, 1, 1); // lit tip
    if (th.near === 'tuft' && (x % 7) === 3) {
      ctx.fillStyle = colorToCss(look.accent);
      ctx.fillRect(x, VIEW_H - 4, 2, 1); // pebble catching the light
    }
    const u = up[x % P];
    if (u > 0) {
      ctx.fillStyle = colorToCss(look.body);
      ctx.fillRect(x, 0, 1, u - 1);
      ctx.fillStyle = colorToCss(look.deep);
      ctx.fillRect(x, u - 1, 1, 1); // shaded leaf tip
      if ((x & 3) === 0) {
        ctx.fillStyle = colorToCss(look.lit);
        ctx.fillRect(x, 0, 1, 1);
      }
    }
  }
}

// ---------------------------------------------------------------- cache control

/** Drop every baked strip and every level's ambient/parallax (level change, or a theme
 *  swap). Cumulative counters survive: `stats().stripsBaked` keeps reporting total work. */
export function invalidate() {
  strips.clear();
  for (const b of bundles.values()) freeBundle(b);
  bundles.clear();
}

/** Live cache accounting for the harness (R47/R48): how much baking has happened, how
 *  many strip canvases are held, and what they cost in bytes (RGBA backing store). */
export function stats() {
  let bytes = 0;
  for (const s of strips.values()) bytes += canvasBytes(s.canvas);
  for (const b of bundles.values()) {
    bytes += canvasBytes(b.ambient && b.ambient.canvas);
    for (const L of b.parallax) bytes += canvasBytes(L.canvas);
  }
  return { stripsBaked, live: strips.size, cacheBytes: bytes };
}

function canvasBytes(c) {
  return c && c.width > 0 && c.height > 0 ? c.width * c.height * 4 : 0;
}
