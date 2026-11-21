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

// Lit surfaces take on the key light's hue; a shadow takes only a nudge toward the sky's
// blue-violet bounce, never a commitment to it. "base * 0.7" is what made the flat 21-colour read.
const LIGHT_HUE = { h: 42 / 360, s: 0.85 };
const SHADOW_HUE = { h: 262 / 360, s: 0.55 };
// signed pull toward the target hue (negative = toward the sky bounce), in degrees out of 90,
// taken along the SHORTEST arc — so a warm base (27-47°) reaching 262° at -46 ran backwards
// through red into wine (dirt #c77d40 27° -> #5d103f 323°) and 16 of the 115 ramp steps landed
// saturated inside the wine/petrol bands. At -16/-8 the widest base->deep arc is 27.7° (shade
// 14.2°) and no step lands in those bands; the bands and the arcs are what R55 gates.
const SHIFT = { deep: -16, shade: -8, base: 0, lit: 15, hi: 32 };
const LSTEP = { deep: -0.30, shade: -0.13, base: 0, lit: 0.11, hi: 0.21 };
const SSTEP = { deep: 0.10, shade: 0.04, base: 0, lit: -0.04, hi: -0.11 };
const STEPS = ['deep', 'shade', 'base', 'lit', 'hi'];

// One shared ramp generator: buildRamps derives each surface's ramp from its own light/dark
// palette anchors, so props, characters and terrain shade identically for free.
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
