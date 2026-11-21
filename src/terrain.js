// Baked background/terrain (GRAPHICS_PLAN.md §4, §5.7, §7). One level = an ambient sky
// canvas, three parallax depths, and terrain strips; every canvas is produced ONCE per
// level (on first sight) and then only ever blitted, so nothing in this module runs per
// frame and the hot path stays `drawImage`.
//
// STRIPS, NOT ONE GIANT CANVAS. At SCENE_SCALE 4 a strip is 64 x level-height logical px =
// 256x960 HD px ~= 983 KB; 8 live strips cost ~7.5 MiB, and each canvas is ~244k px —
// under every device clamp an iOS Safari canvas limit cares about. A strip evicted by the
// LRU re-bakes from the level on next sight, which is only legal because baking is PURE:
// bakeStrip reads level tiles at ABSOLUTE world coordinates and never a neighbouring pixel
// of its own canvas, so a crop of the level is byte-identical however it was cropped.
//
// That last point is the load-bearing one, so it is stated where it can rot: **every
// edge/AO term in a strip is computed from level columns (`artTile`/`aoColumns`/`pipeRun`),
// never from the strip's own pixels, and every seed is an absolute (tx,ty).** Any function
// that reads `tx` relative to its strip, or reads back a canvas, will make the shading
// disagree at every 64 px boundary — a visible seam down the level. The W2 probe proves
// it by re-rendering the same view through two different strip phases and requiring a
// zero-delta result at the seams.
//
// All tile and background art is procedural (R-1): vector paths, linear/radial gradients
// and seeded detail — no atlas, no bitmap data — fully deterministic, and it keeps the
// same pure-bake contract the seam argument relies on.

import { TILE, ROWS, VIEW_W, VIEW_H, PALETTE, SCENE_SCALE as HD } from './config.js';
import { isSolid, tileAt } from './level.js';
import { makeLayer, bakeVertical, buildRamps, seeded, parseColor, colorToCss } from './pixels.js';

const STRIP_W = 64;   // logical px per strip (4 tiles) -> 256x960 HD px, ~983 KB
const TILES_PER_STRIP = STRIP_W / TILE;
const MAX_LIVE = 8;   // LRU cap on live strip canvases (~7.5 MiB at HD)
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

// Tile char -> painter key + ramp family. Only the keys §3.1 lists; no art is invented here.
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

// One FNV-1a over the strip's tile chars plus the AO context: two columns on each side —
// the fractional air-AO interpolator taps one column past the 5-wide kernel's reach, so
// the context spans both. It is what makes the strip
// cache self-healing: main.js turns a punched 'P' into 'U' in level.tiles, the digest
// changes, and that one strip re-bakes once with its spent block instead of serving stale
// art forever. A punched block two columns over moves the shadow here, so the context
// must span the kernel or the neighbour strip would keep its old shadow. Same level in
// => same keys out (§R50).
function stripDigest(level, cols, firstCol) {
  let h = 0x811c9dc5;
  for (let tx = firstCol - 2; tx <= firstCol + TILES_PER_STRIP + 2; tx++) {
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
      base: rgb(r.base, PALETTE.stone),
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
    grass: rgb(ramps.grass.base, PALETTE.grass),
    cloud: rgb(def.pal.cloud || PALETTE.cloud, PALETTE.cloud),
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
  const stripBytes = STRIP_W * HD * rows * TILE * HD * 4;
  const ambientBytes = VIEW_W * HD * VIEW_H * HD * 4;
  let parallaxBytes = 0;
  for (const d of DEPTHS) parallaxBytes += (VIEW_W + d.period) * HD * VIEW_H * HD * 4;
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
  const { c, ctx } = makeLayer(STRIP_W * HD, hPx * HD);
  // Think in logical px everywhere: this one transform turns every fill below into the
  // SCENE_SCALE backing store, and the tile painters draw 1:1 HD geometry.
  ctx.scale(HD, HD);
  // AO context: the integer kernel needs two columns each side, and the fractional air-AO
  // interpolator taps one column further right.
  const ao = aoColumns(level, cols, firstCol - 2, firstCol + TILES_PER_STRIP + 2);
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
      // Each tile is clipped to its own 16 px column for the full strip height: the
      // painters let ~1 px of detail (grass tips) lean across a tile edge, and clipping in
      // tile space makes that cut identical in every strip — the only thing that keeps the
      // seam probe (and the LRU that trusts it) honest.
      ctx.save();
      ctx.beginPath();
      ctx.rect(lx, 0, TILE, hPx);
      ctx.clip();
      if (!isSolid(ch)) {
        // Air: the only thing baked into a strip's transparent cells is the soft shadow of
        // whatever ceiling is above it, painted with the fractional 4-subcolumn interpolant
        // so the shadow fades across the tile width instead of stepping in 16-px bands.
        paintAirAO(ctx, th, ao, k, ty, lx);
      } else {
        paintTile(ctx, baked, th, tx, ty, lx, soft);
      }
      ctx.restore();
    }
  }
  return { index, key: baked.stripKeys[index], canvas: c, ctx };
}

// The material ramp for one solid tile: 'X' with air above is the grass-capped surface; a
// pipe's top tile is its cap. The barrel gradient the pipe painter needs is computed from
// the run itself (pipeRun), which reads the level, never the canvas.
function matFor(th, level, cols, tx, ty, ch) {
  const base = th.mat[ch] || th.mat.X;
  if (ch === 'X' && !solidArt(level, cols, tx, ty - 1)) return { key: SURFACE_KEY, base: base.base, deep: base.deep, shade: base.shade, lit: base.lit, hi: base.hi };
  if (ch === '|') {
    const key = artTile(level, cols, tx, ty - 1) !== '|' ? 'pipe.cap' : 'pipe.body';
    return { key, base: base.base, deep: base.deep, shade: base.shade, lit: base.lit, hi: base.hi };
  }
  return base;
}

// --------------------------------------------------------------------------- tile art
// The HD tile painters (R-1). Every painter is a pure function of (level columns,
// absolute (tx,ty), theme ramps) — the seam contract in one place. No atlas, no blits:
// vector paths, linear/radial gradients, seeded detail.

// Gradient fill helpers: stops are [offset, css] pairs.
function vgrad(ctx, x, y0, y1, stops) {
  const g = ctx.createLinearGradient(x, y0, x, y1);
  for (const [o, c] of stops) g.addColorStop(o, c);
  ctx.fillStyle = g;
}
function hgrad(ctx, y, x0, x1, stops) {
  const g = ctx.createLinearGradient(x0, y, x1, y);
  for (const [o, c] of stops) g.addColorStop(o, c);
  ctx.fillStyle = g;
}
function roundRectPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
function starPath(ctx, cx, cy, ro, ri) {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
    const r = i % 2 === 0 ? ro : ri;
    const px = cx + Math.cos(a) * r;
    const py = cy + Math.sin(a) * r;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
}
// The contiguous '|' run this tile belongs to, walked through the level only, so the
// barrel gradient is identical for every column of the run even when the run crosses a
// strip boundary (a cap keeps its run's gradient, so it reads as the rim of the same
// barrel as its neighbours).
function pipeRun(level, cols, tx, ty) {
  let left = tx;
  while (artTile(level, cols, left - 1, ty) === '|') left--;
  let right = tx;
  while (artTile(level, cols, right + 1, ty) === '|') right++;
  return { left, w: right - left + 1 };
}
// Shared contact terms for solid tiles, last step in every painter: burial cool, ceiling
// shadow settle, and the lit/shaded bands on open side edges. Level columns only.
function paintContact(ctx, th, m, level, cols, tx, ty, lx, y, ch, soft) {
  const depth = buriedRows(level, cols, tx, ty);
  if (depth > 0) {
    ctx.fillStyle = rgba(th.ao, 0.05 * depth);
    ctx.fillRect(lx, y, TILE, TILE);
  }
  if (soft > 0.02) {
    const a = AO_MAX * soft * 0.7;
    if (artTile(level, cols, tx, ty - 1) === ch) {
      ctx.fillStyle = rgba(th.ao, a);
      ctx.fillRect(lx, y, TILE, TILE);
    } else {
      vgrad(ctx, lx, y, y + TILE, [[0, rgba(th.ao, a)], [1, rgba(th.ao, 0)]]);
      ctx.fillRect(lx, y, TILE, TILE);
    }
  }
  if (artTile(level, cols, tx - 1, ty) === '.') {
    hgrad(ctx, y, lx, lx + 2, [[0, rgba(m.lit, 0.22)], [1, rgba(m.lit, 0)]]);
    ctx.fillRect(lx, y, 2, TILE);
  }
  if (artTile(level, cols, tx + 1, ty) === '.') {
    hgrad(ctx, y, lx + TILE - 2.5, lx + TILE, [[0, rgba(m.shade, 0)], [1, rgba(m.shade, 0.3)]]);
    ctx.fillRect(lx + TILE - 2.5, y, 2.5, TILE);
  }
}
// Grass-capped surface ('X' with air above): a dirt body with pebbles under a grass cap
// that has a lit crown, a dark contact line at the soil, a bright top rim and blades.
function paintGroundTop(ctx, th, m, tx, ty, lx, y) {
  vgrad(ctx, lx, y + 6, y + TILE, [
    [0, colorToCss(mix(m.shade, m.deep, 0.45))],
    [0.45, colorToCss(m.shade)],
    [1, colorToCss(m.deep)],
  ]);
  ctx.fillRect(lx, y + 6, TILE, TILE - 6);
  for (let p = 0; p < 5; p++) {
    const r1 = seeded(tx * 31 + ty * 7 + p, 101);
    const r2 = seeded(tx * 31 + ty * 7 + p, 102);
    const r3 = seeded(tx * 31 + ty * 7 + p, 103);
    ctx.fillStyle = r2 > 0.5 ? rgba(m.deep, 0.3) : rgba(m.lit, 0.22 + 0.2 * r3);
    ctx.beginPath();
    ctx.arc(lx + 1 + r1 * 14, y + 8.5 + r2 * 6, 0.5 + r3 * 0.7, 0, Math.PI * 2);
    ctx.fill();
  }
  vgrad(ctx, lx, y, y + 6.5, [
    [0, colorToCss(mix(m.hi, th.grass, 0.4))],
    [0.45, colorToCss(th.grass)],
    [1, colorToCss(mix(m.shade, th.grass, 0.45))],
  ]);
  ctx.fillRect(lx, y, TILE, 6.5);
  ctx.fillStyle = rgba(m.deep, 0.3);
  ctx.fillRect(lx, y + 6, TILE, 0.8);
  vgrad(ctx, lx, y, y + 1.4, [[0, rgba(m.hi, 0.5)], [1, rgba(m.hi, 0)]]);
  ctx.fillRect(lx, y, TILE, 1.4);
  for (let b = 0; b < 9; b++) {
    const r0 = seeded(tx * 13 + ty * 7 + b, 104);
    const r1 = seeded(tx * 13 + ty * 7 + b, 105);
    const r2 = seeded(tx * 13 + ty * 7 + b, 106);
    const bx = lx + 0.6 + r0 * 14.8;
    const bh = 2.6 + r1 * 3.2;
    const lean = (r2 - 0.5) * 2.4;
    ctx.strokeStyle = r2 > 0.5 ? rgba(m.lit, 0.8) : rgba(mix(th.grass, m.hi, 0.3), 0.8);
    ctx.lineWidth = 0.7 + 0.4 * r2;
    ctx.beginPath();
    ctx.moveTo(bx, y + 1.2);
    ctx.quadraticCurveTo(bx + lean * 0.4, y + 1.2 - bh * 0.6, bx + lean, y + 1.2 - bh);
    ctx.stroke();
  }
}
// Buried dirt body ('X' with solid art above): joint line under the ceiling tile, a
// vertical body gradient, two faint strata lines and pebbles.
function paintGroundBody(ctx, th, m, level, cols, tx, ty, lx, y, soft) {
  if (solidArt(level, cols, tx, ty - 1)) {
    ctx.fillStyle = rgba(m.deep, 0.22);
    ctx.fillRect(lx, y, TILE, 1);
  }
  vgrad(ctx, lx, y, y + TILE, [
    [0, colorToCss(mix(m.shade, m.lit, 0.35))],
    [0.5, colorToCss(m.shade)],
    [1, colorToCss(mix(m.shade, m.deep, 0.5))],
  ]);
  ctx.fillRect(lx, y, TILE, TILE);
  for (let s = 0; s < 2; s++) {
    const r0 = seeded(tx * 17 + ty * 11 + s, 111);
    const r1 = seeded(tx * 17 + ty * 11 + s, 112);
    const sy = y + 3 + r0 * 10;
    ctx.strokeStyle = rgba(m.deep, 0.08 + 0.08 * r1);
    ctx.lineWidth = 0.7;
    ctx.beginPath();
    ctx.moveTo(lx, sy);
    ctx.bezierCurveTo(lx + 4, sy - 1 + r1 * 2, lx + 11, sy + 1 - r1 * 2, lx + TILE, sy);
    ctx.stroke();
  }
  for (let p = 0; p < 4; p++) {
    const r1 = seeded(tx * 19 + ty * 13 + p, 113);
    const r2 = seeded(tx * 19 + ty * 13 + p, 114);
    const r3 = seeded(tx * 19 + ty * 13 + p, 115);
    ctx.fillStyle = r3 > 0.5 ? rgba(m.deep, 0.25) : rgba(m.lit, 0.18);
    ctx.fillRect(lx + 1 + r1 * 14, y + 2 + r2 * 12, 0.9 + r3, 0.9);
  }
  paintContact(ctx, th, m, level, cols, tx, ty, lx, y, 'X', soft);
}
// Stone block ('S'): a beveled slab — diagonal body gradient, diagonal key sweep, four
// bevel bands, seeded cracks and speckle.
function paintStone(ctx, th, m, level, cols, tx, ty, lx, y, soft) {
  const g = ctx.createLinearGradient(lx, y, lx + 11, y + 11);
  g.addColorStop(0, colorToCss(mix(m.base, m.lit, 0.4)));
  g.addColorStop(1, colorToCss(mix(m.base, m.shade, 0.4)));
  ctx.fillStyle = g;
  ctx.fillRect(lx, y, TILE, TILE);
  const sweep = ctx.createLinearGradient(lx, y, lx + 11, y + 11);
  sweep.addColorStop(0, rgba(m.hi, 0.28));
  sweep.addColorStop(1, rgba(m.hi, 0));
  ctx.fillStyle = sweep;
  ctx.fillRect(lx, y, TILE, TILE);
  vgrad(ctx, lx, y, y + 2, [[0, rgba(m.hi, 0.5)], [1, rgba(m.hi, 0)]]);
  ctx.fillRect(lx, y, TILE, 2);
  vgrad(ctx, lx, y + TILE - 3, y + TILE, [[0, rgba(m.deep, 0)], [1, rgba(m.deep, 0.55)]]);
  ctx.fillRect(lx, y + TILE - 3, TILE, 3);
  hgrad(ctx, y, lx, lx + 1.5, [[0, rgba(m.lit, 0.35)], [1, rgba(m.lit, 0)]]);
  ctx.fillRect(lx, y, 1.5, TILE);
  hgrad(ctx, y, lx + TILE - 2.5, lx + TILE, [[0, rgba(m.shade, 0)], [1, rgba(m.shade, 0.4)]]);
  ctx.fillRect(lx + TILE - 2.5, y, 2.5, TILE);
  const cracks = 1 + (seeded(tx * 7 + ty * 13, 121) < 0.5 ? 0 : 1);
  ctx.strokeStyle = rgba(m.deep, 0.16);
  ctx.lineWidth = 0.6;
  for (let cc = 0; cc < cracks; cc++) {
    const x0 = lx + 2 + seeded(tx * 5 + ty * 3 + cc, 122) * 10;
    const y0 = y + 2 + seeded(tx * 5 + ty * 3 + cc, 123) * 10;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x0 + (seeded(tx * 5 + ty * 3 + cc, 124) - 0.5) * 5, y0 + 2 + seeded(tx * 5 + ty * 3 + cc, 125) * 3);
    ctx.lineTo(x0 + (seeded(tx * 5 + ty * 3 + cc, 126) - 0.5) * 7, y0 + 4 + seeded(tx * 5 + ty * 3 + cc, 127) * 5);
    ctx.stroke();
  }
  for (let s = 0; s < 3; s++) {
    ctx.fillStyle = rgba(m.shade, 0.3);
    ctx.fillRect(lx + 1 + seeded(tx * 3 + ty * 5 + s, 128) * 14, y + 1 + seeded(tx * 3 + ty * 5 + s, 129) * 14, 0.8, 0.8);
  }
  paintContact(ctx, th, m, level, cols, tx, ty, lx, y, 'S', soft);
}
// Brick block ('B'): deep mortar, running-bond bricks 7x3 on an 8x4 pitch — one brick per
// world 8-px column (slot j = tx*2 + b) so a brick straddling a tile boundary gets its
// tint from the same slot in both strips.
function paintBrick(ctx, th, m, level, cols, tx, ty, lx, y, soft) {
  ctx.fillStyle = colorToCss(m.deep);
  ctx.fillRect(lx, y, TILE, TILE);
  for (let row = 0; row < 4; row++) {
    const by = y + row * 4;
    const off = row % 2 === 1 ? 4 : 0;
    for (let b = -1; b <= 2; b++) {
      const bx = lx + b * 8 + off;
      const x0 = Math.max(bx, lx);
      const x1 = Math.min(bx + 7, lx + TILE);
      if (x0 >= x1) continue;
      const j = tx * 2 + b;
      const t = seeded(j * 47 + row * 7 + ty * 977, 131);
      const base = t < 0.5 ? mix(m.base, m.shade, (0.5 - t) * 0.32) : mix(m.base, m.lit, (t - 0.5) * 0.32);
      vgrad(ctx, x0, by, by + 3, [
        [0, colorToCss(mix(base, m.hi, 0.18))],
        [1, colorToCss(mix(base, m.shade, 0.25))],
      ]);
      ctx.fillRect(x0, by, x1 - x0, 3);
    }
    vgrad(ctx, lx, by + 3, by + 4, [[0, rgba(m.deep, 0.4)], [1, rgba(m.deep, 0.05)]]);
    ctx.fillRect(lx, by + 3, TILE, 1);
  }
  vgrad(ctx, lx, y, y + 1.5, [[0, rgba(m.hi, 0.4)], [1, rgba(m.hi, 0)]]);
  ctx.fillRect(lx, y, TILE, 1.5);
  vgrad(ctx, lx, y + TILE - 2.5, y + TILE, [[0, rgba(m.deep, 0)], [1, rgba(m.deep, 0.5)]]);
  ctx.fillRect(lx, y + TILE - 2.5, TILE, 2.5);
  hgrad(ctx, y, lx, lx + 1.5, [[0, rgba(m.lit, 0.3)], [1, rgba(m.lit, 0)]]);
  ctx.fillRect(lx, y, 1.5, TILE);
  hgrad(ctx, y, lx + TILE - 2.5, lx + TILE, [[0, rgba(m.shade, 0)], [1, rgba(m.shade, 0.35)]]);
  ctx.fillRect(lx + TILE - 2.5, y, 2.5, TILE);
  paintContact(ctx, th, m, level, cols, tx, ty, lx, y, 'B', soft);
}
// Prize block ('P'/'Q'): a rounded pumpkin — vertical body ramp, radial key light from
// the top-left, a bottom-right shade, two segment ridges and the glowing star seal.
function paintPumpkin(ctx, th, m, level, cols, tx, ty, lx, y, soft) {
  const g = ctx.createLinearGradient(lx, y, lx, y + TILE);
  g.addColorStop(0, colorToCss(mix(m.lit, m.hi, 0.3)));
  g.addColorStop(0.45, colorToCss(m.base));
  g.addColorStop(1, colorToCss(mix(m.shade, m.deep, 0.5)));
  ctx.fillStyle = g;
  roundRectPath(ctx, lx + 0.5, y + 0.5, 15, 15, 3);
  ctx.fill();
  ctx.save();
  roundRectPath(ctx, lx + 0.5, y + 0.5, 15, 15, 3);
  ctx.clip();
  let rg = ctx.createRadialGradient(lx + 5, y + 4.5, 0.5, lx + 5, y + 4.5, 13);
  rg.addColorStop(0, rgba(m.hi, 0.5));
  rg.addColorStop(0.4, rgba(m.lit, 0.15));
  rg.addColorStop(1, rgba(m.lit, 0));
  ctx.fillStyle = rg;
  ctx.fillRect(lx, y, TILE, TILE);
  const lg = ctx.createLinearGradient(lx + 12, y + 10, lx, y + 2);
  lg.addColorStop(0, rgba(m.deep, 0.42));
  lg.addColorStop(1, rgba(m.deep, 0));
  ctx.fillStyle = lg;
  ctx.fillRect(lx, y, TILE, TILE);
  ctx.strokeStyle = rgba(m.deep, 0.14);
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.moveTo(lx + 4.5, y + 1);
  ctx.quadraticCurveTo(lx + 3.2, y + 8, lx + 4.5, y + 15);
  ctx.moveTo(lx + 11.5, y + 1);
  ctx.quadraticCurveTo(lx + 12.8, y + 8, lx + 11.5, y + 15);
  ctx.stroke();
  const sg = ctx.createRadialGradient(lx + 8, y + 8.4, 0.5, lx + 8, y + 8.4, 5);
  sg.addColorStop(0, rgba(mix(m.lit, m.hi, 0.7), 0.95));
  sg.addColorStop(1, rgba(mix(m.lit, m.hi, 0.3), 0.75));
  ctx.fillStyle = sg;
  starPath(ctx, lx + 8, y + 8.4, 4.6, 2.0);
  ctx.fill();
  vgrad(ctx, lx, y, y + 2.6, [[0, rgba(m.hi, 0.5)], [1, rgba(m.hi, 0)]]);
  ctx.fillRect(lx, y, TILE, 2.6);
  ctx.restore();
  ctx.strokeStyle = rgba(m.deep, 0.5);
  ctx.lineWidth = 0.9;
  roundRectPath(ctx, lx + 0.5, y + 0.5, 15, 15, 3);
  ctx.stroke();
  paintContact(ctx, th, m, level, cols, tx, ty, lx, y, 'P', soft);
}
// Spent block ('U'): the same rounded body in the muted 'used' ramp, with a dark hollow
// where the prize used to be.
function paintPumpkinUsed(ctx, th, m, level, cols, tx, ty, lx, y, soft) {
  const g = ctx.createLinearGradient(lx, y, lx, y + TILE);
  g.addColorStop(0, colorToCss(mix(m.lit, m.hi, 0.25)));
  g.addColorStop(1, colorToCss(mix(m.shade, m.deep, 0.55)));
  ctx.fillStyle = g;
  roundRectPath(ctx, lx + 0.5, y + 0.5, 15, 15, 3);
  ctx.fill();
  ctx.save();
  roundRectPath(ctx, lx + 0.5, y + 0.5, 15, 15, 3);
  ctx.clip();
  const hg = ctx.createRadialGradient(lx + 8, y + 8, 1, lx + 8, y + 8, 6.5);
  hg.addColorStop(0, rgba(m.deep, 0.85));
  hg.addColorStop(1, rgba(m.deep, 0.55));
  ctx.fillStyle = hg;
  roundRectPath(ctx, lx + 3.5, y + 3.5, 10, 10, 2);
  ctx.fill();
  vgrad(ctx, lx, y, y + 2.6, [[0, rgba(m.hi, 0.4)], [1, rgba(m.hi, 0)]]);
  ctx.fillRect(lx, y, TILE, 2.6);
  ctx.restore();
  ctx.strokeStyle = rgba(m.deep, 0.5);
  ctx.lineWidth = 0.9;
  roundRectPath(ctx, lx + 0.5, y + 0.5, 15, 15, 3);
  ctx.stroke();
  paintContact(ctx, th, m, level, cols, tx, ty, lx, y, 'U', soft);
}
// Floating platform ('='): a wood plank band with lit/shaded edge lines, grain flecks and
// dark end caps where the plank is not continued by a neighbour.
function paintPlatform(ctx, th, m, level, cols, tx, ty, lx, y, soft) {
  vgrad(ctx, lx, y + 4, y + 12, [
    [0, colorToCss(mix(m.lit, m.base, 0.5))],
    [0.5, colorToCss(m.base)],
    [1, colorToCss(mix(m.shade, m.deep, 0.4))],
  ]);
  ctx.fillRect(lx, y + 4, TILE, 8);
  ctx.fillStyle = rgba(m.hi, 0.6);
  ctx.fillRect(lx, y + 4, TILE, 1);
  ctx.fillStyle = rgba(m.deep, 0.5);
  ctx.fillRect(lx, y + 12, TILE, 1);
  const r1 = seeded(tx * 7 + ty * 5, 141);
  const r2 = seeded(tx * 7 + ty * 5, 142);
  ctx.fillStyle = rgba(m.shade, 0.35);
  ctx.fillRect(lx + 2 + r1 * 9, y + 5.5 + r2 * 4, 2, 0.8);
  ctx.fillRect(lx + 3 + (1 - r1) * 9, y + 6 + (1 - r2) * 4, 2, 0.8);
  if (artTile(level, cols, tx - 1, ty) !== '=') {
    ctx.fillStyle = rgba(m.deep, 0.55);
    ctx.fillRect(lx, y + 4, 1.2, 8);
  }
  if (artTile(level, cols, tx + 1, ty) !== '=') {
    ctx.fillStyle = rgba(m.deep, 0.55);
    ctx.fillRect(lx + TILE - 1.2, y + 4, 1.2, 8);
  }
  paintContact(ctx, th, m, level, cols, tx, ty, lx, y, '=', soft);
}
// Pipe ('|'): the barrel gradient spans the WHOLE run in run-local x, plus a vertical
// edge modulation; the top tile of a run adds a cap band (rim, seam line, under-rim
// shadow) that never overhangs past its own tile — only in-tile ink is seam-safe.
function paintPipe(ctx, th, m, level, cols, tx, ty, lx, y, soft) {
  const run = pipeRun(level, cols, tx, ty);
  const rx = run.left * TILE - tx * TILE + lx; // this tile's left edge in run-local x
  const g = ctx.createLinearGradient(rx, 0, rx + run.w * TILE, 0);
  g.addColorStop(0, colorToCss(m.deep));
  g.addColorStop(0.1, colorToCss(mix(m.deep, m.lit, 0.45)));
  g.addColorStop(0.26, colorToCss(m.lit));
  g.addColorStop(0.5, colorToCss(m.base));
  g.addColorStop(0.78, colorToCss(mix(m.base, m.shade, 0.55)));
  g.addColorStop(1, colorToCss(m.deep));
  ctx.fillStyle = g;
  ctx.fillRect(lx, y, TILE, TILE);
  vgrad(ctx, lx, y, y + TILE, [
    [0, rgba(m.deep, 0.1)], [0.25, rgba(m.deep, 0)], [0.75, rgba(m.deep, 0)], [1, rgba(m.deep, 0.18)],
  ]);
  ctx.fillRect(lx, y, TILE, TILE);
  if (m.key === 'pipe.cap') {
    ctx.fillStyle = g;
    ctx.fillRect(lx, y, TILE, 10);
    vgrad(ctx, lx, y, y + 1.6, [[0, rgba(m.hi, 0.55)], [1, rgba(m.hi, 0)]]);
    ctx.fillRect(lx, y, TILE, 1.6);
    ctx.strokeStyle = rgba(m.deep, 0.5);
    ctx.lineWidth = 0.7;
    ctx.beginPath();
    ctx.moveTo(lx, y + 9.3);
    ctx.lineTo(lx + TILE, y + 9.3);
    ctx.stroke();
    vgrad(ctx, lx, y + 10, y + 12.5, [[0, rgba(m.deep, 0.4)], [1, rgba(m.deep, 0)]]);
    ctx.fillRect(lx, y + 10, TILE, 2.5);
  }
  if (artTile(level, cols, tx, ty + 1) === 'X') {
    // A pipe standing on the ground casts a contact shadow onto the soil.
    vgrad(ctx, lx, y + 13, y + 16, [[0, rgba(th.ao, 0)], [1, rgba(th.ao, 0.3)]]);
    ctx.fillRect(lx, y + 13, TILE, 3);
  }
  paintContact(ctx, th, m, level, cols, tx, ty, lx, y, '|', soft);
}
// The one entry point for solid tiles: character -> painter.
function paintTile(ctx, baked, th, tx, ty, lx, soft) {
  const level = baked._level;
  const cols = baked.cols;
  const ch = artTile(level, cols, tx, ty);
  if (ch === '.') return;
  const m = matFor(th, level, cols, tx, ty, ch);
  const y = ty * TILE;
  if (ch === 'X') {
    if (m.key === SURFACE_KEY) paintGroundTop(ctx, th, m, tx, ty, lx, y);
    else paintGroundBody(ctx, th, m, level, cols, tx, ty, lx, y, soft);
  } else if (ch === 'S') paintStone(ctx, th, m, level, cols, tx, ty, lx, y, soft);
  else if (ch === 'B') paintBrick(ctx, th, m, level, cols, tx, ty, lx, y, soft);
  else if (ch === 'P' || ch === 'Q') paintPumpkin(ctx, th, m, level, cols, tx, ty, lx, y, soft);
  else if (ch === 'U') paintPumpkinUsed(ctx, th, m, level, cols, tx, ty, lx, y, soft);
  else if (ch === '=') paintPlatform(ctx, th, m, level, cols, tx, ty, lx, y, soft);
  else if (ch === '|') paintPipe(ctx, th, m, level, cols, tx, ty, lx, y, soft);
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
// Fractional air-AO: the integer kernel's five taps evaluated one subcolumn to the right,
// interpolating between each pair of neighbour columns. f = 0 reproduces aoKernel exactly;
// f in (0,1) taps one column further right, which is why the context fetch and the digest
// each widen by one.
function aoKernelF(ao, k, f, ty) {
  // Same index space as aoKernel: the ao array starts at the strip's firstCol - 2, so the
  // tile at local k taps ao[k..k+5] here (the +1 is the fractional column's reach, which
  // is why the context fetch and the digest each widen by one).
  const W = [0.25, 0.75, 1.5, 0.75, 0.25];
  let s = 0;
  for (let j = 0; j < 5; j++) {
    const a = ao[k + j] ? ao[k + j][ty] || 0 : 0;
    const b = ao[k + j + 1] ? ao[k + j + 1][ty] || 0 : 0;
    s += W[j] * (a + (b - a) * f);
  }
  return s / 3.5;
}

// Air shadow for one tile: four 4-px subcolumns, each a vertical gradient from the
// fractional field at its own x between this row and the next. Subcolumns fade the shadow
// across the tile width; the rows ramp it vertically as the old per-pixel paint did.
function paintAirAO(ctx, th, ao, k, ty, lx) {
  for (let j = 0; j < 4; j++) {
    const f = (j + 0.5) / 4;
    const aTop = AO_MAX * aoKernelF(ao, k, f, ty);
    const aBot = AO_MAX * aoKernelF(ao, k, f, ty + 1);
    if (aTop < 0.004 && aBot < 0.004) continue;
    const g = ctx.createLinearGradient(lx + j * 4, ty * TILE, lx + j * 4, ty * TILE + TILE);
    g.addColorStop(0, rgba(th.ao, aTop));
    g.addColorStop(1, rgba(th.ao, aBot));
    ctx.fillStyle = g;
    ctx.fillRect(lx + j * 4, ty * TILE, 4, TILE);
  }
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

// The sun, per theme: fields a high white, canyon a low hazy orange, palace a warm gold.
const SUNS = {
  fields: { x: 196, y: 44, color: '#ffffff' },
  canyon: { x: 70, y: 150, color: '#ffd9a0' },
  palace: { x: 184, y: 64, color: '#ffe0a0' },
};

function bakeAmbient(baked) {
  const th = baked._theme;
  const sky = bakeVertical(VIEW_W, VIEW_H, th.sky, HD); // the one gradient of the level
  const { c, ctx } = makeLayer(VIEW_W * HD, VIEW_H * HD);
  ctx.drawImage(sky, 0, 0);
  ctx.scale(HD, HD);
  // Sun: a broad radial glow plus a small bright core.
  const sun = SUNS[baked.theme] || SUNS.fields;
  const sc = rgb(sun.color, PALETTE.white);
  let g = ctx.createRadialGradient(sun.x, sun.y, 2, sun.x, sun.y, 46);
  g.addColorStop(0, rgba(sc, 0.55));
  g.addColorStop(0.25, rgba(sc, 0.25));
  g.addColorStop(1, rgba(sc, 0));
  ctx.fillStyle = g;
  ctx.fillRect(sun.x - 46, sun.y - 46, 92, 92);
  g = ctx.createRadialGradient(sun.x, sun.y, 0, sun.x, sun.y, 7);
  g.addColorStop(0, rgba(sc, 0.9));
  g.addColorStop(1, rgba(sc, 0));
  ctx.fillStyle = g;
  ctx.fillRect(sun.x - 7, sun.y - 7, 14, 14);
  // Horizon glow: fog light pooling where the background meets the ground.
  g = ctx.createRadialGradient(128, VIEW_H - 40, 10, 128, VIEW_H - 40, 150);
  g.addColorStop(0, rgba(th.fog, 0.4));
  g.addColorStop(1, rgba(th.fog, 0));
  ctx.fillStyle = g;
  ctx.fillRect(0, VIEW_H - 190, VIEW_W, 190);
  // Ceiling wash: the scene darkens gently toward the top, echoing the lightmap.
  vgrad(ctx, 0, 0, 46, [[0, rgba(th.ao, 0.1)], [1, rgba(th.ao, 0)]]);
  ctx.fillRect(0, 0, VIEW_W, 46);
  if (baked.theme === 'palace') {
    // A handful of deterministic stars — the only sparkle the dusk theme gets.
    for (let i = 0; i < 26; i++) {
      const sx = (seeded(i, 91) * VIEW_W) | 0;
      const sy = (seeded(i, 92) * 64) | 0;
      ctx.fillStyle = rgba({ r: 255, g: 255, b: 255 }, 0.25 + 0.5 * seeded(i, 93));
      ctx.beginPath();
      ctx.arc(sx + 0.5, sy + 0.5, 0.8, 0, Math.PI * 2);
      ctx.fill();
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
    const { c, ctx } = makeLayer(w * HD, VIEW_H * HD);
    ctx.scale(HD, HD);
    if (d === 0) drawFar(ctx, th, spec, look, 3);
    else if (d === 1) drawMid(ctx, th, spec, look, 11);
    else drawNear(ctx, th, spec, look);
    // Aerial fog pools at the bottom of the background: one soft gradient band, and
    // source-atop keeps the haze on the silhouette only, so the sky behind it stays the
    // ambient ramp's colour (no readback, §7).
    ctx.globalCompositeOperation = 'source-atop';
    vgrad(ctx, 0, VIEW_H - 100, VIEW_H, [[0, rgba(th.fog, spec.fog * 0.1)], [1, rgba(th.fog, spec.fog * 0.5)]]);
    ctx.fillRect(0, VIEW_H - 100, w, 100);
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

// One background layer's silhouette: a single closed path filled with a vertical
// lit->body->deep gradient, and a 1-px lit rim along the ridge line.
function drawRidge(ctx, look, ridge, period, w) {
  let minY = VIEW_H;
  for (let i = 0; i < period; i++) minY = Math.min(minY, ridge[i]);
  const g = ctx.createLinearGradient(0, minY, 0, VIEW_H);
  g.addColorStop(0, colorToCss(look.lit));
  g.addColorStop(0.18, colorToCss(look.body));
  g.addColorStop(1, colorToCss(look.deep));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(-1, VIEW_H + 1);
  ctx.lineTo(-1, ridge[0]);
  for (let x = 0; x <= w; x++) ctx.lineTo(x, ridge[x % period]);
  ctx.lineTo(w + 1, VIEW_H + 1);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = rgba(look.lit, 0.55);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(-1, ridge[0]);
  for (let x = 0; x <= w; x++) ctx.lineTo(x, ridge[x % period]);
  ctx.stroke();
}


function drawFar(ctx, th, spec, look, salt) {
  const ridge = ridgeTable(th.shape, spec, salt);
  drawRidge(ctx, look, ridge, spec.period, VIEW_W + spec.period);
}

// Ellipse by scanlines: pixel-art puffs, no arc() in a bake the harness has to model.
// Soft puff: a radial-gradient unit circle scaled to (rx, ry) — a volume of light, not a
// scanline blob. The alpha is mixed into the colour at a=1, so rgba() never has to encode
// a sub-1 alpha (it cannot, exactly).
function puffGrad(ctx, color, a) {
  const g = ctx.createRadialGradient(0, 0, 0.1, 0, 0, 1);
  g.addColorStop(0, rgba(color, a));
  g.addColorStop(0.6, rgba(color, a * 0.8));
  g.addColorStop(1, rgba(color, 0));
  return g;
}
function puff(ctx, cx, cy, rx, ry, grad) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(rx, ry);
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(0, 0, 1, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}


function drawMid(ctx, th, spec, look, salt) {
  const P = spec.period;
  const w = VIEW_W + P;
  const ridge = ridgeTable(th.shape, spec, salt);
  drawRidge(ctx, look, ridge, P, w);
  if (th.props === 'clouds') {
    // Soft multi-lobe puffs: each lobe is a radial-gradient unit circle, so a cloud is a
    // volume of light, not a blob. The lower lobes tint toward the fog so the cloud sits
    // in the air instead of floating above it. Positions keep every lobe inside one
    // period tile, so the wrap is seamless.
    const white = th.cloud;
    const gTop = puffGrad(ctx, white, 0.9);
    const gLow = puffGrad(ctx, mix(white, th.fog, 0.3), 0.7);
    for (let k = 0; k < 4; k++) {
      const r = 9 + Math.round(seeded(k * 5 + salt + 2, 23) * 8);
      const cx = Math.round(1.4 * r + seeded(k * 5 + salt, 21) * (P - 2.8 * r));
      const cy = Math.round(24 + seeded(k * 5 + salt + 1, 22) * 58);
      for (let m = 0; m * P < w + P; m++) {
        const x = cx + m * P;
        puff(ctx, x - 0.7 * r, cy + 4, 0.55 * r, 0.4 * r, gLow);
        puff(ctx, x + 0.75 * r, cy + 3.5, 0.6 * r, 0.42 * r, gLow);
        puff(ctx, x, cy + 2, r, 0.62 * r, gLow);
        puff(ctx, x, cy, 0.8 * r, 0.55 * r, gTop);
      }
    }
  } else if (th.props === 'spires') {
    // Tapered rock spires rising from the mid ridge: accent tip into a shaded foot.
    for (let k = 0; k < 3; k++) {
      const cx = Math.round(seeded(k * 3 + salt, 24) * (P - 20)) + 10;
      const h = 16 + Math.round(seeded(k * 3 + salt + 1, 25) * 20);
      for (let m = 0; m * P < w + P; m++) {
        const x = cx + m * P;
        const gy = ridge[x % P];
        const g = ctx.createLinearGradient(0, gy - h, 0, gy);
        g.addColorStop(0, colorToCss(look.accent));
        g.addColorStop(0.3, colorToCss(look.body));
        g.addColorStop(1, colorToCss(look.deep));
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.moveTo(x, gy - h);
        ctx.lineTo(x + 2.5, gy - 3);
        ctx.lineTo(x + 4, gy);
        ctx.lineTo(x - 4, gy);
        ctx.lineTo(x - 2.5, gy - 3);
        ctx.closePath();
        ctx.fill();
      }
    }
  } else {
    // Temples: tiered roofs on the mid ridge, the top tier lit, an accent window on the
    // middle tier.
    for (let k = 0; k < 3; k++) {
      const cx = Math.round(seeded(k * 3 + salt, 26) * (P - 28)) + 14;
      const tiers = 3 + Math.round(seeded(k * 3 + salt + 1, 27) * 2);
      for (let m = 0; m * P < w + P; m++) {
        const x = cx + m * P;
        let gy = ridge[x % P];
        for (let t = 0; t < tiers; t++) {
          const hw = 10 - t * 2;
          const hh = 8;
          const g = ctx.createLinearGradient(0, gy - hh, 0, gy);
          g.addColorStop(0, colorToCss(t === 0 ? look.lit : look.body));
          g.addColorStop(1, colorToCss(look.body));
          ctx.fillStyle = g;
          ctx.fillRect(x - hw, gy - hh, hw * 2 + 1, hh);
          ctx.fillStyle = colorToCss(look.deep);
          ctx.fillRect(x - hw - 1, gy - hh, hw * 2 + 3, 1);
          if (t === 1) {
            ctx.fillStyle = colorToCss(look.accent);
            ctx.fillRect(x - 1, gy - hh + 3, 1, 2.2);
            ctx.fillRect(x + 1, gy - hh + 3, 1, 2.2);
          }
          gy -= hh + 1;
        }
      }
    }
  }
  if (th.near !== 'tuft') {
    // Bushes on the mid ridge: a shaded root lobe, a body, a lit crown.
    const gDeep = puffGrad(ctx, look.deep, 0.7);
    const gBody = puffGrad(ctx, look.body, 1);
    const gLit = puffGrad(ctx, look.lit, 0.8);
    for (let k = 0; k < 6; k++) {
      const cx = Math.round(seeded(k * 7 + salt, 28) * (P - 12)) + 6;
      const r = 4 + Math.round(seeded(k * 7 + salt + 1, 29) * 4);
      for (let m = 0; m * P < w + P; m++) {
        const x = cx + m * P;
        const by = ridge[x % P] - 1;
        puff(ctx, x - 0.7 * r, by + 1, 0.6 * r, 0.5 * r, gDeep);
        puff(ctx, x, by, r, 0.8 * r, gBody);
        puff(ctx, x + 0.6 * r, by - 0.2 * r, 0.55 * r, 0.45 * r, gLit);
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
    // One column of grass: lit tip into body into deep root, a dark soil foot.
    const g = ctx.createLinearGradient(0, y, 0, VIEW_H);
    g.addColorStop(0, colorToCss(look.lit));
    g.addColorStop(0.35, colorToCss(look.body));
    g.addColorStop(1, colorToCss(look.deep));
    ctx.fillStyle = g;
    ctx.fillRect(x, y, 1, h);
    if (th.near === 'vine') {
      ctx.fillStyle = colorToCss(look.accent);
      ctx.fillRect(x, y, 1, 1);
    }
    if (th.near === 'tuft' && (x % 7) === 3) {
      ctx.fillStyle = colorToCss(look.accent);
      ctx.fillRect(x, VIEW_H - 4, 2, 1);
    }
    const u = up[x % P];
    if (u > 0) {
      // Hanging vine: dark where it drops from the top edge, body at the tip.
      const gu = ctx.createLinearGradient(0, 0, 0, u);
      gu.addColorStop(0, colorToCss(look.deep));
      gu.addColorStop(1, colorToCss(look.body));
      ctx.fillStyle = gu;
      ctx.fillRect(x, 0, 1, u);
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
