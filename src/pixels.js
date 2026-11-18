// Bake-time pixel primitives. NOTHING here runs per frame (§3): every function returns a
// pre-baked canvas or a colour string, so the hot path stays `drawImage`.
// hash()/seeded() are the project's ONLY randomness — deterministic, so a bake reproduces
// byte-for-byte and R50's "same state => same draw stream" holds. No Math.random, ever.

import { PALETTE } from './config.js';

// deterministic pure-integer hash of i (no Math.random)
export function hash(i) {
  let h = Math.imul(i, 0x9e3779b1) ^ 0x85ebca6b;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

// The project's only RNG. `salt` is folded in multiplicatively (not added) so seeded(i,1)
// and seeded(i+1,0) cannot land on the same value.
export function seeded(i, salt) {
  return hash(Math.imul(i + 1, 0x27d4eb2d) ^ Math.imul(salt + 1, 0x165667b1)) / 4294967296;
}

// Offscreen buffer for baked art. Called only from bake code — never at import time, so
// this module stays importable under bare Node (the harness has no DOM).
export function makeLayer(w, h) {
  const c = typeof OffscreenCanvas === 'function'
    ? new OffscreenCanvas(w, h)
    : document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  // baked art is nearest-neighbour by construction; smoothing here pre-blurs the atlas
  ctx.imageSmoothingEnabled = false;
  return { c, ctx };
}

// ---------------------------------------------------------------- colour helpers

function hex2(n) {
  const s = n.toString(16);
  return s.length < 2 ? '0' + s : s;
}

export function rgbToHex(r, g, b) {
  return '#' + hex2(Math.round(Math.max(0, Math.min(255, r))))
    + hex2(Math.round(Math.max(0, Math.min(255, g))))
    + hex2(Math.round(Math.max(0, Math.min(255, b))));
}

// '#rgb' | '#rrggbb' | 'rgb(...)' | 'rgba(...)': PALETTE is all #rrggbb, but ramps get fed
// colours back out of a canvas too.
export function parseColor(css) {
  if (typeof css !== 'string') return null;
  const s = css.trim();
  if (s[0] === '#') {
    const hx = s.slice(1);
    if (/^[0-9a-fA-F]+$/.test(hx) === false) return null;
    if (hx.length === 3 || hx.length === 4) {
      return { r: parseInt(hx[0] + hx[0], 16), g: parseInt(hx[1] + hx[1], 16), b: parseInt(hx[2] + hx[2], 16), a: 1 };
    }
    if (hx.length === 6 || hx.length === 8) {
      return { r: parseInt(hx.slice(0, 2), 16), g: parseInt(hx.slice(2, 4), 16), b: parseInt(hx.slice(4, 6), 16), a: 1 };
    }
    return null;
  }
  const m = /^rgba?\(([^)]+)\)$/.exec(s);
  if (!m) return null;
  const p = m[1].split(/[\s,/]+/).filter((x) => x.length > 0).map(Number);
  if (p.length < 3 || p.some((n) => !Number.isFinite(n))) return null;
  return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
}

export function colorToCss(c) {
  return c.a >= 1
    ? rgbToHex(c.r, c.g, c.b)
    : `rgba(${Math.round(c.r)},${Math.round(c.g)},${Math.round(c.b)},${Math.round(c.a * 1000) / 1000})`;
}

export function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  const l = (mx + mn) / 2;
  const dd = mx - mn;
  let h = 0;
  let s = 0;
  if (dd > 0) {
    s = l > 0.5 ? dd / (2 - mx - mn) : dd / (mx + mn);
    if (mx === r) h = ((g - b) / dd + (g < b ? 6 : 0)) / 6;
    else if (mx === g) h = ((b - r) / dd + 2) / 6;
    else h = ((r - g) / dd + 4) / 6;
  }
  return { h, s, l };
}

function hue2rgb(p, q, t) {
  if (t < 0) t += 1;
  if (t > 1) t -= 1;
  if (t < 1 / 6) return p + (q - p) * 6 * t;
  if (t < 1 / 2) return q;
  if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
  return p;
}

export function hslToRgb(h, s, l) {
  const hh = ((h % 1) + 1) % 1;
  const ss = Math.max(0, Math.min(1, s));
  const ll = Math.max(0, Math.min(1, l));
  if (ss === 0) {
    const v = ll * 255;
    return { r: v, g: v, b: v };
  }
  const q = ll < 0.5 ? ll * (1 + ss) : ll + ss - ll * ss;
  const p = 2 * ll - q;
  return {
    r: hue2rgb(p, q, hh + 1 / 3) * 255,
    g: hue2rgb(p, q, hh) * 255,
    b: hue2rgb(p, q, hh - 1 / 3) * 255,
  };
}

// ------------------------------------------------------------- §5.1 ramp builder

// Lit surfaces take on the key light's hue; shadows take the sky's blue-violet bounce.
// "base * 0.7" is exactly what made the old 21-colour screen read flat.
const LIGHT_HUE = { h: 42 / 360, s: 0.85 };
const SHADOW_HUE = { h: 262 / 360, s: 0.55 };
// signed pull toward the target hue (negative = toward blue-violet), in degrees out of 90
const SHIFT = { deep: -46, shade: -22, base: 0, lit: 15, hi: 32 };
const LSTEP = { deep: -0.30, shade: -0.13, base: 0, lit: 0.11, hi: 0.21 };
const SSTEP = { deep: 0.10, shade: 0.04, base: 0, lit: -0.04, hi: -0.11 };
const STEPS = ['deep', 'shade', 'base', 'lit', 'hi'];

// One shared ramp generator. bakeMatrix derives a surface's OWN ramp from whatever colour
// its matrix cell carries, so sprite art and tile art shade identically for free.
function rampFromHex(hex) {
  const c = parseColor(hex);
  if (!c) return null;
  const hsl = rgbToHsl(c.r, c.g, c.b);
  const out = {};
  for (const step of STEPS) {
    const deg = SHIFT[step];
    const target = deg < 0 ? SHADOW_HUE : LIGHT_HUE;
    const frac = Math.abs(deg) / 90;
    let dh = target.h - hsl.h;
    if (dh > 0.5) dh -= 1;
    else if (dh < -0.5) dh += 1;
    // a neutral grey stays neutral: saturation on a zero-sat hue is meaningless and would
    // invent colour on the stone/black/white ramps
    const s = hsl.s < 0.05 ? 0 : Math.max(0, Math.min(1, hsl.s + SSTEP[step] + frac * 0.12));
    const l = Math.max(0.05, Math.min(0.95, hsl.l + LSTEP[step] * (0.75 + 0.5 * hsl.l)));
    const rgb = hslToRgb(hsl.h + dh * frac, s, l);
    out[step] = colorToCss({ r: rgb.r, g: rgb.g, b: rgb.b, a: 1 });
  }
  return out;
}

const rampCache = new Map();
function cachedRamp(hex) {
  let r = rampCache.get(hex);
  if (r === undefined) {
    r = rampFromHex(hex);
    rampCache.set(hex, r);
  }
  return r;
}

// css colour -> packed 0xRRGGBB, memoised: the passes ask for the same few hundred ramp
// strings over and over, and re-parsing them per art pixel would dominate the bake.
const rgbCache = new Map();
function rgbOf(css) {
  let v = rgbCache.get(css);
  if (v === undefined) {
    const c = parseColor(css);
    v = c ? (Math.round(c.r) << 16) | (Math.round(c.g) << 8) | Math.round(c.b) : 0;
    rgbCache.set(css, v);
  }
  return v;
}

// PALETTE hues are the source colours (config.js stays the authority; RAMPS is new keys
// only, G5/G8). The dark sibling lifts the mid tone so `deep` lands close to the colour
// existing art already commits to.
const HUE_SOURCES = [
  ['dirt', 'dirt', 'dirtDark'], ['grass', 'grass', 'heroLeaf'], ['stone', 'stone', 'stoneDark'],
  ['brick', 'brick', 'brickDark'], ['pumpkin', 'pumpkin', 'pumpkinDark'], ['used', 'used', 'usedDark'],
  ['platform', 'platform', 'platformDark'], ['pipe', 'pipe', 'pipeDark'],
  ['heroBody', 'heroBody', 'heroDark'], ['heroSeed', 'heroSeed', 'pumpkinLit'],
  ['heroLeaf', 'heroLeaf', 'bush'], ['sky', 'sky', 'skyDark'], ['cloud', 'cloud', 'white'],
  ['hillFar', 'hillFar', 'hillNear'], ['hillNear', 'hillNear', 'bush'], ['bush', 'bush', 'grass'],
  ['turnipBody', 'turnipBody', 'turnipTip'], ['berryBody', 'berryBody', 'berryDark'],
  ['pineapple', 'pineapple', 'pineappleDark'], ['crown', 'crown', 'pineappleDark'],
  ['white', 'white', 'stoneDark'], ['black', 'black', 'skyDark'], ['red', 'red', 'heroDark'],
];

export function buildRamps(palette) {
  const src = palette || PALETTE;
  const ramps = {};
  for (const [name, keyLight, keyDark] of HUE_SOURCES) {
    const a = parseColor(src[keyLight]);
    const b = parseColor(src[keyDark]);
    const mid = a && b ? rgbToHex((2 * a.r + b.r) / 3, (2 * a.g + b.g) / 3, (2 * a.b + b.b) / 3) : src[keyLight];
    const r = rampFromHex(mid);
    if (r) ramps[name] = r;
  }
  return ramps;
}

// ------------------------------------------------------------- matrix rasterisation

// Matrix convention: a character absent from `map` (space, '.', '0') is transparent, so a
// sprite never needs a filler colour. `pad` is the transparent ring bakeMatrix adds around
// the matrix so the outline pass has somewhere to live — the atlas folds it into the
// anchors, so matrix cell 0,0 stays where the art says it is.
//
// The grids returned here are the bake's ONLY picture of the sprite: they are built from
// the LETTERS, never from a raster read-back (§7). The harness stub does not rasterise, so
// a pixel-reading bake would bake from zeros and every art check would pass on flat art.
function rasterise(rows, map, scale, pad) {
  const mw = rows.reduce((n, r) => Math.max(n, r.length), 0);
  const mh = rows.length;
  const w = mw + pad * 2;
  const h = mh + pad * 2;
  const { c, ctx } = makeLayer(w * scale, h * scale);
  const solid = new Uint8Array(w * h);
  const colour = new Uint32Array(w * h);
  const alpha = new Uint8Array(w * h);
  for (let y = 0; y < mh; y++) {
    const row = rows[y];
    for (let x = 0; x < row.length; x++) {
      const css = map[row[x]];
      if (css === undefined || css === null) continue;
      const col = parseColor(css);
      if (!col) continue;
      ctx.fillStyle = css;
      ctx.fillRect((x + pad) * scale, (y + pad) * scale, scale, scale);
      const i = (y + pad) * w + x + pad;
      solid[i] = 1;
      colour[i] = (Math.round(col.r) << 16) | (Math.round(col.g) << 8) | Math.round(col.b);
      alpha[i] = Math.round(col.a * 255);
    }
  }
  return { c, ctx, w, h, mw, mh, pad, solid, colour, alpha };
}

// 4x4 Bayer, scaled to 8..248 so the light and dark halves of a dither get an identical
// threshold spread instead of a 0-127 bias.
const BAYER = [8, 136, 40, 168, 200, 72, 232, 104, 56, 184, 24, 152, 248, 120, 216, 88];

// The one shared pass: §5.1 hue ramps -> §5.2 one light direction -> §5.3 silhouette ->
// §5.5 dither-only-in-flat-fields, in that fixed order, over every sprite and tile, so
// twenty hand-written matrices read as one art set.
//
// opts: { scale, outline:{color,width}, light:{dx,dy}, shade:{strength},
//         rim:{color,width}|null, dither:boolean, emissive:{chars,color,threshold}|null }
// -> { c, ctx, w, h, pad, emissive }  (w/h include the outline pad, in art px)
export function bakeMatrix(rows, map, opts) {
  const o = opts || {};
  const scale = o.scale > 0 ? o.scale : 1;
  const ow = o.outline && o.outline.color ? Math.max(1, o.outline.width || 1) : 0;
  const geo = rasterise(rows, map, scale, ow);
  const ctx = geo.ctx;
  const W = geo.w;
  const H = geo.h;
  const solid = geo.solid;
  const colour = geo.colour;
  const alpha = geo.alpha;
  // Every pass below reads these ORIGINAL matrix values, never its own output, so pass
  // order cannot cascade and the bake stays byte-stable run to run.
  const empty = (x, y) => x < 0 || y < 0 || x >= W || y >= H || solid[y * W + x] === 0;
  const paint = (x, y, rgb, a) => {
    ctx.fillStyle = colorToCss({ r: (rgb >> 16) & 255, g: (rgb >> 8) & 255, b: rgb & 255, a: a === undefined ? 1 : a / 255 });
    ctx.fillRect(x * scale, y * scale, scale, scale);
  };

  // 1. silhouette outline, always OUTSIDE the existing pixels so it can never eat into
  // art the matrix already placed.
  if (ow > 0) {
    const ring = [];
    for (let oy = -ow; oy <= ow; oy++) {
      for (let ox = -ow; ox <= ow; ox++) {
        if ((ox || oy) && Math.abs(ox) + Math.abs(oy) <= ow) ring.push(ox, oy);
      }
    }
    ctx.fillStyle = o.outline.color;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (solid[y * W + x]) continue;
        for (let k = 0; k < ring.length; k += 2) {
          if (!empty(x + ring[k], y + ring[k + 1])) { ctx.fillRect(x * scale, y * scale, scale, scale); break; }
        }
      }
    }
  }

  // 2. directional shading. `light` is the light VECTOR: dx<0, dy<0 puts the key at the
  // top-left, so faces toward it read `lit`, faces away read `shade`, and the exposed
  // bottom/right corner reads `deep`. Tones come from the surface's own ramp, blended by
  // shade.strength — never a flat multiply.
  const light = o.light || { dx: -1, dy: -1 };
  const strength = o.shade && o.shade.strength !== undefined ? o.shade.strength : 1;
  const lx = light.dx < 0 ? -1 : 1;
  const ly = light.dy < 0 ? -1 : 1;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (!solid[i]) continue;
      const key = colour[i];
      const ramp = cachedRamp(rgbToHex((key >> 16) & 255, (key >> 8) & 255, key & 255));
      if (!ramp) continue;
      const away = (empty(x - lx, y) ? 1 : 0) + (empty(x, y - ly) ? 1 : 0);
      let step = null;
      if (empty(x + lx, y) || empty(x, y + ly)) step = 'lit';
      else if (away === 2) step = 'deep';
      else if (away === 1) step = 'shade';
      if (step === null) continue;
      const want = rgbOf(ramp[step]);
      const cr = (key >> 16) & 255;
      const cg = (key >> 8) & 255;
      const cb = key & 255;
      // blend toward the ramp step, keep the matrix cell's own alpha
      paint(x, y,
        (Math.round(cr + (((want >> 16) & 255) - cr) * strength) << 16)
        | (Math.round(cg + (((want >> 8) & 255) - cg) * strength) << 8)
        | Math.round(cb + ((want & 255) - cb) * strength),
        alpha[i]);
    }
  }

  // 3. rim: its own colour on the up-left silhouette, so it survives pass 2 having just
  // repainted those same pixels with the ramp's `lit` step.
  if (o.rim && o.rim.color) {
    const rw = Math.max(1, o.rim.width || 1);
    const ring = [];
    for (let oy = 0; oy <= rw; oy++) {
      for (let ox = 0; ox <= rw; ox++) if ((ox || oy) && ox + oy <= rw) ring.push(-ox, -oy);
    }
    ctx.fillStyle = o.rim.color;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (!solid[y * W + x]) continue;
        for (let k = 0; k < ring.length; k += 2) {
          if (empty(x + ring[k], y + ring[k + 1])) { ctx.fillRect(x * scale, y * scale, scale, scale); break; }
        }
      }
    }
  }

  // 4. dither, gradient fields only (§5.5): a pixel must sit strictly inside one flat
  // region of >= 24 art px — all 8 neighbours solid AND in the same region, so a dithered
  // cell can never be a silhouette edge or an internal colour seam.
  if (o.dither) {
    const owner = new Int32Array(W * H).fill(-1);
    const areas = [];
    const stack = new Int32Array(W * H);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const start = y * W + x;
        if (!solid[start] || owner[start] >= 0) continue;
        const id = areas.length;
        const key = colour[start];
        let sp = 0;
        let area = 0;
        stack[sp++] = start;
        owner[start] = id;
        while (sp > 0) {
          const cur = stack[--sp];
          area++;
          const cx = cur % W;
          const cy = (cur / W) | 0;
          if (cx > 0) { const j = cur - 1; if (solid[j] && owner[j] < 0 && colour[j] === key) { owner[j] = id; stack[sp++] = j; } }
          if (cx + 1 < W) { const j = cur + 1; if (solid[j] && owner[j] < 0 && colour[j] === key) { owner[j] = id; stack[sp++] = j; } }
          if (cy > 0) { const j = cur - W; if (solid[j] && owner[j] < 0 && colour[j] === key) { owner[j] = id; stack[sp++] = j; } }
          if (cy + 1 < H) { const j = cur + W; if (solid[j] && owner[j] < 0 && colour[j] === key) { owner[j] = id; stack[sp++] = j; } }
        }
        areas.push(area);
      }
    }
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        if (!solid[i] || areas[owner[i]] < 24) continue;
        const id = owner[i];
        let interior = true;
        for (let oy = -1; oy <= 1 && interior; oy++) {
          for (let ox = -1; ox <= 1; ox++) {
            if (empty(x + ox, y + oy) || owner[(y + oy) * W + x + ox] !== id) { interior = false; break; }
          }
        }
        if (!interior) continue;
        const ramp = cachedRamp(rgbToHex((colour[i] >> 16) & 255, (colour[i] >> 8) & 255, colour[i] & 255));
        if (!ramp) continue;
        const t = BAYER[(y & 3) * 4 + (x & 3)] / 255;
        paint(x, y, rgbOf(seeded(y * W + x, 7) < t ? ramp.shade : ramp.base), alpha[i]);
      }
    }
  }

  // 5. emissive mask: a parallel canvas, same dims and scale, holding ONLY the cells the
  // caller marked. Rasterised from the raw matrix, so bloom input is unshaded by design.
  const emissive = o.emissive && o.emissive.color
    ? emissiveLayer(rows, o.emissive, scale, geo)
    : null;

  return { c: geo.c, ctx, w: W, h: H, pad: ow, emissive };
}

// Emissive-marker convention (the art slice depends on this): set
//   opts.emissive = { chars: 'EF', color: '#ffd23e', threshold: 0 }
// and mark emitting cells with any character listed in `chars` (default 'E'). Only those
// cells survive into the mask, painted solid `color`; everything else is alpha 0. List the
// same character in `map` too when the emitter should also be visible art — then one cell
// is both colour and light source. `threshold` (0..1) deterministically thins the mask via
// seeded() for sparkle-style emitters.
function emissiveLayer(rows, em, scale, geo) {
  const { c, ctx } = makeLayer(geo.w * scale, geo.h * scale);
  const chars = typeof em.chars === 'string' ? em.chars : 'E';
  const thr = em.threshold === undefined ? 0 : em.threshold;
  ctx.fillStyle = em.color;
  for (let y = 0; y < rows.length; y++) {
    const row = rows[y];
    for (let x = 0; x < row.length; x++) {
      if (chars.indexOf(row[x]) < 0) continue;
      if (seeded(y * geo.w + x, 11) < thr) continue;
      ctx.fillRect((x + geo.pad) * scale, (y + geo.pad) * scale, scale, scale);
    }
  }
  return c;
}

// ------------------------------------------------------- pre-baked gradient sprites

// One glow sprite per colour x radius bucket, so §7's lightmap is drawImage only and no
// frame ever calls createRadialGradient. Alpha falls off as (1-t)^2; the stacked discs alone
// top out around 0.96, so the emitting art px is stamped at full strength — a lightmap
// whose core never reaches 1.0 multiplies the emitter's own pixels down and reads grey.
export function bakeRadial(color, radius, scale) {
  const s = scale > 0 ? scale : 1;
  const n = Math.max(2, Math.ceil(radius * s));
  const { c, ctx } = makeLayer(n * 2, n * 2);
  const core = parseColor(color) || { r: 255, g: 255, b: 255, a: 1 };
  const steps = Math.max(6, Math.ceil(n / 2));
  for (let k = steps; k >= 1; k--) {
    const t = k / steps;
    ctx.fillStyle = colorToCss({ r: core.r, g: core.g, b: core.b, a: core.a * (1 - t) * (1 - t) });
    ctx.beginPath();
    ctx.arc(n, n, Math.max(1, n * t), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = colorToCss(core);
  ctx.fillRect(n - (s >> 1), n - (s >> 1), s, s);
  return c;
}

// Sky / fog / vignette: a linear gradient baked once and then sampled per frame.
export function bakeVertical(w, h, stops, scale) {
  const s = scale > 0 ? scale : 1;
  const W = Math.max(1, Math.round(w * s));
  const H = Math.max(1, Math.round(h * s));
  const { c, ctx } = makeLayer(W, H);
  const g = ctx.createLinearGradient(0, 0, 0, H);
  for (const st of stops || []) {
    const col = parseColor(st.color) || { r: 0, g: 0, b: 0, a: 1 };
    g.addColorStop(Math.max(0, Math.min(1, st.stop)), colorToCss(col));
  }
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  return c;
}
