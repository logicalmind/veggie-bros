// composite.js — HD-2D compositor buffers: DPR sizing math, layer table, dynamic lightmap.
//
// Resolution model (GRAPHICS_PLAN.md §4, decided 2026-11-18):
//   backing  = floor(css * dpr), scaled down (aspect preserved) past MAX_BACKING_PX
//   k        = largest integer with scene*k <= backing on BOTH axes (per-axis floor)
//   scene    = LOGICAL resolution (256x240) — SCENE_SCALE = 1
//   lightmap/bloom/bloomHalf = sub-native FX buffers (§7); their upscale is the
//              compositor's own bilinear step, NOT the k nearest-neighbor step.
//
// Scene at 1x logical is deliberate, not a simplification: blitting an art-scale
// terrain strip (128x480 art px) into a 64-logical dest drops every odd art column
// and costs only 3 of 242 exact colours / 0 of 118 q8 buckets
// (integrator measurement, 2026-11-18). Export SCENE_SCALE so a later slice can
// raise it without changing any call geometry.
//
// Sizing authority for the DOM canvas (`canvas.style`, integer SCALE_STEP) stays in
// main.js; this module owns buffer geometry only and is window-free at import, so
// the harness can import it.

import { VIEW_W, VIEW_H, TILE, ROWS, FX_SCALE } from './config.js';
import { makeLayer, bakeRadial, parseColor, rgbToHex } from './pixels.js';
import { tileAt } from './level.js';
import { emissive } from './atlas.js';

// The only resolution budget knob (plan §4); exported because S-09's boot sizing reads
// it. NOT parity with config.js's MAX_SCREEN_PX / MAX_LAYERS, which §3 measures wrong.
export const MAX_BACKING_PX = 1024 * 960;   // 983040
const DPR_MIN = 1, DPR_MAX = 3;
export const SCENE_SCALE = 1;
// §7 bloom ceiling, mirroring render.js's CLEAR_FLASH_MAX_ALPHA. Nothing consumes it
// yet — S-06's bloom composite does.
export const BLOOM_MAX_ALPHA = 0.35;
const BYTE_BUDGET = 8 * 1024 * 1024; // sanity ceiling over the five layers
const LAYER_NAMES = ['scene', 'upscale', 'lightmap', 'bloom', 'bloomHalf'];

const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);

// Largest integer k with upscale <= backing on BOTH axes, so pass 1 (nearest-neighbour)
// is integral and pass 2 (upscale -> canvas) can only ever UPSCALE. Area-sqrt k fails it
// in the shipped domain: css 384x360@1 (fit()'s s = 1.5) has 138240 backing px, and
// round(sqrt(138240/61440)) = 2 -> 512x480, wider than the backing => a 0.75x downscale.
export function kFor(sceneW, sceneH, backing) {
  const bw = backing?.w ?? 0, bh = backing?.h ?? 0;
  if (!(bw > 0 && bh > 0 && sceneW > 0 && sceneH > 0)) return 1;
  return Math.max(1, Math.min(Math.floor(bw / sceneW), Math.floor(bh / sceneH)));
}

let cfg = null;                    // last computed layout
const allocated = new Map();       // name -> { c, ctx, w, h }
let allocations = 0;

// §4: dpr-scaled backing, scaled down on both axes (aspect kept) past the cap.
function backingSize(cssW, cssH, dpr) {
  let w = Math.floor(cssW * dpr), h = Math.floor(cssH * dpr);
  let capped = false;
  if (w * h > MAX_BACKING_PX) {
    const s = Math.sqrt(MAX_BACKING_PX / (cssW * cssH));
    w = Math.floor(cssW * s);
    h = Math.floor(cssH * s);
    capped = true;
  }
  return { w, h, capped };
}

// Sizes only — pure math, no canvas, no window.
function build(cssW, cssH, dpr) {
  const backing = backingSize(cssW, cssH, dpr);
  // The scene buffer is LOGICAL resolution, viewport-independent: it is the art
  // grid the world passes draw into, so a 1024x960 css box still shares 256x240.
  const sceneW = Math.floor(VIEW_W * SCENE_SCALE);
  const sceneH = Math.floor(VIEW_H * SCENE_SCALE);
  const k = kFor(sceneW, sceneH, backing);
  // FX buffers are fractions of LOGICAL resolution (§7): lightmap 1/2, bloom 1/4.
  const lightW = Math.floor(VIEW_W * FX_SCALE), lightH = Math.floor(VIEW_H * FX_SCALE);
  const bloomW = Math.floor(lightW * FX_SCALE), bloomH = Math.floor(lightH * FX_SCALE);
  const layers = {
    scene: { w: sceneW, h: sceneH },
    upscale: { w: sceneW * k, h: sceneH * k },
    lightmap: { w: lightW, h: lightH },
    bloom: { w: bloomW, h: bloomH },
    bloomHalf: { w: Math.floor(bloomW * FX_SCALE), h: Math.floor(bloomH * FX_SCALE) },
  };
  let bytes = 0;
  for (const name of LAYER_NAMES) bytes += layers[name].w * layers[name].h * 4;
  return { cssW, cssH, dpr, backing: { w: backing.w, h: backing.h }, capped: backing.capped,
           k, sceneW, sceneH, layers, bytes };
}

export function layout() {
  return cfg || build(VIEW_W, VIEW_H, 1);   // never reads window.devicePixelRatio
}

export function configure(cssW, cssH, dpr) {
  cfg = build(cssW, cssH, clamp(dpr || 1, DPR_MIN, DPR_MAX));
  if (cfg.bytes > BYTE_BUDGET) {
    console.warn(`[composite] layer bytes ${cfg.bytes} over ${BYTE_BUDGET} at ${cssW}x${cssH} dpr ${dpr}`);
  }
  return cfg;
}

// Allocated on demand; a layer is only re-made when its size actually changed.
function ensure(name, w, h) {
  const cur = allocated.get(name);
  if (cur && cur.w === w && cur.h === h) return cur;
  const l = makeLayer(w, h);
  l.w = w; l.h = h;
  allocations++;
  allocated.set(name, l);
  return l;
}

export function layers() {
  const L = layout().layers;
  const out = {};
  for (const name of LAYER_NAMES) out[name] = ensure(name, L[name].w, L[name].h);
  // §7: smoothing IS the blur for the bloom mip chain; makeLayer leaves it off.
  out.bloom.ctx.imageSmoothingEnabled = true;
  out.bloomHalf.ctx.imageSmoothingEnabled = true;
  return out;
}

// layers() builds a fresh name->layer object per call, so the FX passes cache the record and
// re-validate it against the size table: ensure() only re-makes a layer on a size change.
let lmLayer = null;
function lightmapLayer() {
  const want = layout().layers.lightmap;
  if (lmLayer === null || lmLayer.w !== want.w || lmLayer.h !== want.h) lmLayer = layers().lightmap;
  return lmLayer;
}

// ---------------------------------------------------------------- dynamic lightmap (§7)
//
// Rebuilt every frame from frozen state only: one `fillRect` of the ambient base, then `'lighter'`
// blits of pre-baked glow discs. No gradient / pattern / blur-op / shadow-cast API is reachable at
// runtime at all — `pixels.bakeRadial` stacks alpha discs rather than baking a gradient object,
// and it runs once per bucket, lazily, on first use.
//
// The base is FLAT, not §7's "the baked ambient": terrain.ambientFor()'s canvas is the level's SKY
// art, which S-07 already draws behind the world, and multiplying a scene by sky-blue on top of
// the sky it shows double-tints it. `baked` stays in the signature because §7 specifies it, but it
// is deliberately unread — measured on 1-1, `_theme.fog` #dff2c9 is that sky and `_theme.ao` #528094.
export const MAX_LIGHTS = 12;
const AMBIENT_DEFAULT = '#fff4e0';
let ambientCss = AMBIENT_DEFAULT;
// ceil(VIEW_W/TILE)+2 = 18 columns: the view is 16 exact tiles wide, and the two margin columns
// keep a camera parked mid-tile from lighting a block only after it has already uncovered it.
const LM_COLS = Math.ceil(VIEW_W / TILE) + 2;
// Radii are LOGICAL px (§7's small / large / gate) baked at scale 1 so the disc is art-crisp, and
// blitted at FX_SCALE: GLOW[].dw is the lightmap-px footprint, so a '12' bucket covers 12 logical
// px on screen. Base alphas are all distinct, so a probe can attribute a blit by (dw, alpha) alone.
const HURT = 0, GATE = 1, WARM_S = 2, WARM_L = 3, PUMPKIN = 4, PUMPKIN_DIM = 5;
const GLOW_SPEC = [
  { key: 'hurt', color: '#ff5138', r: 24, a: 0.95 },
  { key: 'gate', color: '#a6ff72', r: 32, a: 0.60 },
  { key: 'warm-s', color: '#ffe3a6', r: 12, a: 0.85 },
  { key: 'warm-l', color: '#ffc46a', r: 24, a: 0.70 },
  { key: 'pumpkin', color: '#ff9b2e', r: 12, a: 0.80 },
  { key: 'pumpkin-dim', color: '#c9701c', r: 12, a: 0.22 },
];
const GLOW = GLOW_SPEC.map((s) => ({ key: s.key, a: s.a, c: null,
  dw: Math.max(1, Math.round(s.r * 2 * FX_SCALE)) }));
let glowBakes = 0;
function glowBucket(i) {
  const b = GLOW[i];
  if (b.c !== null) return b;
  b.c = bakeRadial(GLOW_SPEC[i].color, GLOW_SPEC[i].r, 1);
  glowBakes++;                        // lazy: > 0 only on the frame that first needs a bucket
  return b;
}

// One triple buffer for the whole frame: (x, y, alpha multiplier) in float32 — positions are
// rounded to whole lightmap px at blit time — plus the bucket id in an int array, which a float32
// slot cannot hold losslessly next to a fraction. Gather order IS §7's drop order (boss hurt, gate,
// fruit/berry, blocks) and the cap is fx.js's "newest refused", so no sort or staging buffer.
const LIGHTS = new Float32Array(MAX_LIGHTS * 3);
const LIGHT_B = new Int32Array(MAX_LIGHTS);
let lightN = 0;
let lmW = 0, lmH = 0;

// (sx, sy) are lightmap px, i.e. (world - cam.x) * FX_SCALE on x. Culling runs BEFORE the cap
// check, so an off-screen berry can never eat a slot an on-screen pumpkin needs.
function addLight(bi, sx, sy, mul) {
  const r = GLOW[bi].dw >> 1;
  if (sx + r < 0 || sy + r < 0 || sx - r > lmW || sy - r > lmH) return;
  if (lightN >= MAX_LIGHTS) return;
  const i = lightN++;
  LIGHTS[i * 3] = sx; LIGHTS[i * 3 + 1] = sy; LIGHTS[i * 3 + 2] = mul;
  LIGHT_B[i] = bi;
}

// Entity origins are sprite top-left (level.js / enemy.js), so block lights centre on their tile and
// enemies centre on their own w/h; items carry neither, so their glow sits half a sprite up-left of
// the art — harmless at 6 lightmap px of radius, and S-09 can bias it once the atlas is the source.
function scanBlocks(level, tx0, camX) {
  for (let ty = 0; ty < ROWS && lightN < MAX_LIGHTS; ty++) {
    for (let c = 0; c < LM_COLS; c++) {
      const ch = tileAt(level, tx0 + c, ty);
      let bi;
      if (ch === 'P' || ch === 'Q') bi = PUMPKIN;      // 'Q' shares the pumpkin family (terrain.js:84)
      else if (ch === 'U') bi = PUMPKIN_DIM;           // punched: one spent sprite, one spent glow
      else continue;
      addLight(bi, ((tx0 + c + 0.5) * TILE - camX) * FX_SCALE, (ty + 0.5) * TILE * FX_SCALE, 1);
    }
  }
}

export function drawLightmap(g, baked) {
  const lm = lightmapLayer();
  const ctx = lm.ctx;
  lmW = lm.w; lmH = lm.h;
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
  ctx.fillStyle = ambientCss;
  ctx.fillRect(0, 0, lm.w, lm.h);

  lightN = 0;
  const camX = g.cam.x;
  const enemies = g.enemies;
  for (let i = 0; i < enemies.length; i++) {
    const e = enemies[i];
    if (e.type === 'boss' && e.hurtT > 0) addLight(HURT, (e.x + e.w / 2 - camX) * FX_SCALE, (e.y + e.h / 2) * FX_SCALE, e.hurtT);
  }
  const lv = g.level;
  // The Melon Gate is NOT in level.tiles: parseLevel clears every marker to '.' (level.js:102) and
  // keeps the position in level.gate, so a tile scan could never see a 'G'. The offsets are its art
  // extent — 2 tiles wide from gate.x, posts running gate.y-64..+16 (main.js:242).
  if (lv && lv.gate) addLight(GATE, (lv.gate.x + TILE - camX) * FX_SCALE, (lv.gate.y - 3 * TILE / 2) * FX_SCALE, 1);
  const items = g.items;
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    // only the collectables glow; pop / shard / popup share the list and must stay dark
    const bi = it.kind === 'fruit' ? WARM_S : it.kind === 'berry' ? WARM_L : -1;
    if (bi >= 0) addLight(bi, (it.x - camX) * FX_SCALE, it.y * FX_SCALE, 1);
  }
  if (lv) scanBlocks(lv, Math.floor(camX / TILE), camX);

  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < lightN; i++) {
    const b = glowBucket(LIGHT_B[i]);
    const a = b.a * LIGHTS[i * 3 + 2];
    if (a <= 0) continue;
    ctx.globalAlpha = clamp(a, 0, 1);
    ctx.drawImage(b.c, Math.round(LIGHTS[i * 3] - b.dw / 2), Math.round(LIGHTS[i * 3 + 1] - b.dw / 2),
      b.dw, b.dw);
  }
  // R47 asserts a frame ends balanced; every later pass inherits a clean lightmap ctx.
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  return lightN;
}

export function setAmbient(css) {
  // pixels.parseColor is the validator (no canvas, no readback); rgbToHex forces alpha 1, so a
  // translucent colour can never leave last frame's lightmap bleeding through the base fill.
  const col = parseColor(css);
  if (col === null) console.warn(`[composite] setAmbient ignored for ${String(css)}`);
  else ambientCss = rgbToHex(col.r, col.g, col.b);
  return ambientCss;
}

// One blit, half-res -> logical, `'multiply'`. Smoothing goes back to the caller's flag (it owns
// the surface); alpha/op stay at this pass's contract so nothing can leak into the next pass.
export function applyLightmap(sceneCtx) {
  const lm = lightmapLayer();
  const s = layout();
  const sm = sceneCtx.imageSmoothingEnabled;
  sceneCtx.imageSmoothingEnabled = true;   // §4: this upscale is the compositor's bilinear step
  sceneCtx.globalCompositeOperation = 'multiply';
  sceneCtx.globalAlpha = 1;
  sceneCtx.drawImage(lm.c, 0, 0, lm.w, lm.h, 0, 0, s.sceneW, s.sceneH);
  sceneCtx.imageSmoothingEnabled = sm;
  sceneCtx.globalAlpha = 1;
  sceneCtx.globalCompositeOperation = 'source-over';
}
 
// ---------------------------------------------------------------- bloom (§7)
//
// The bloom ACCUMULATOR, never the scene. §7's chain has no threshold, so a bright-but-large area
// (the sky, which S-07 draws behind the world) would bloom wholesale. The fix is structural, not a
// runtime blur-op: this buffer is only ever filled from (b) the ≤ MAX_LIGHTS sources the frame's
// drawLightmap already gathered and (c) baked emissive masks of on-screen entities. Neither can hold
// sky; the `clearRect` below is what keeps the lightmap's ambient base fill — the whole screen —
// out of bloom. So `drawLightmap` must run first in the frame: LIGHTS/LIGHT_B/lightN are that
// gather, and re-walking `level.tiles` here would double a per-frame scan for no new information.
//
// Geometry: lightmap is 0.5 of logical, bloom is 0.25 (64x60, bloomHalf 32x30), so every coordinate
// and footprint below is a lightmap value times FX_SCALE again. Smoothing on those two buffers is
// the whole blur; §7 forbids escalating to a blur-op, a shadow-cast, or a second blur mechanism.
const BLOOM_SCALE = FX_SCALE * FX_SCALE;
// Per-'lighter'-pass gain of the energy boost. 0.5 is a 2.25x total gain, which measured (S-06 probe
// b3/b4, one 1-1 frame with 6 lights + 3 masks) leaves 27 clipped px of 403 inked px and a peak
// energy of 243.7/255 — cores clip, the falloff keeps its shape. A 1.0 gain is a 4x total, i.e. that
// same peak clipping ~1.6x over, which is §7's "looks muddy" failure mode. 0.5 keeps applyBloom's
// ceiling a ceiling rather than a whitener.
const BLOOM_GAIN = 0.5;
// Keys that own a baked `<key>:emissive` mask. atlas.js exposes no enumeration API, so this is the
// `grep -n "emissive" src/sprites.js` list verbatim as of 2026-11-18 — FIVE keys, one per `register`
// call that passes an `emissive` opt: :831 pumpkin, :836 gate, :837 fruit, :838 berry, :847 fx.spark.
// A stale entry is self-policing: atlas.emissive counts it in `missing` (the suite asserts 0).
export const EMISSIVE_KEYS = Object.freeze(['pumpkin', 'gate', 'fruit', 'berry', 'fx.spark']);
const EMISSIVE_SET = new Set(EMISSIVE_KEYS);
const FRUIT_K = EMISSIVE_KEYS.indexOf('fruit'), BERRY_K = EMISSIVE_KEYS.indexOf('berry');
// The emissive cap is MAX_LIGHTS again, and the cull margins are the widest mask extents in the set
// (gate is 2 tiles wide and its art runs 103 logical px above its origin).
const EM_CULL_X = 64, EM_CULL_UP = 112, EM_CULL_DOWN = 64;
let bloomAlpha = 0, emitN = 0;

let bloomLay = null, halfLay = null;
function bloomLayer() {
  const want = layout().layers.bloom;
  if (bloomLay === null || bloomLay.w !== want.w || bloomLay.h !== want.h) {
    const L = layers();                       // layers() is what turns smoothing ON for both
    bloomLay = L.bloom; halfLay = L.bloomHalf;
  }
  return bloomLay;
}

// `atlas.drawRec` floors its own destination from the anchor, so these stay fractional: passing
// screen px here (not bloom px) is what keeps the mask registered on its own art at 0.25 scale.
function emitMask(ctx, ki, frame, sx, sy) {
  if (emitN >= MAX_LIGHTS) return;
  if (sx < -EM_CULL_X || sx > VIEW_W + EM_CULL_X || sy < -EM_CULL_UP || sy > VIEW_H + EM_CULL_DOWN) return;
  emitN++;
  emissive(ctx, EMISSIVE_KEYS[ki], frame, sx * BLOOM_SCALE, sy * BLOOM_SCALE);
}

// Returns the emissive mask count; the bucket count is metrics().lights (this frame's gather). `baked`
// is §7's signature slot and stays unread for the same reason drawLightmap's does: the baked ambient
// IS the sky art, and sky is exactly what must never reach this buffer.
export function buildBloom(g, baked) {
  const bl = bloomLayer(), hc = halfLay.ctx, ctx = bl.ctx;
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
  ctx.clearRect(0, 0, bl.w, bl.h);
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < lightN; i++) {
    const bk = glowBucket(LIGHT_B[i]);
    const a = bk.a * LIGHTS[i * 3 + 2];
    if (a <= 0) continue;
    ctx.globalAlpha = clamp(a, 0, 1);
    const dw = bk.dw * FX_SCALE;
    ctx.drawImage(bk.c, LIGHTS[i * 3] * FX_SCALE - dw / 2, LIGHTS[i * 3 + 1] * FX_SCALE - dw / 2, dw, dw);
  }
  ctx.globalAlpha = 1;
  emitN = 0;
  const camX = g.cam.x, items = g.items, enemies = g.enemies;
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    // fruit/berry only: `pop`/`shard`/`popup` share the list and draw art that owns no mask.
    if (it.kind === 'fruit') emitMask(ctx, FRUIT_K, Math.floor(it.t * 8) % 4, it.x - camX, it.y);
    else if (it.kind === 'berry') emitMask(ctx, BERRY_K, 0, it.x - camX, it.y);
  }
  for (let i = 0; i < enemies.length; i++) {
    const e = enemies[i];
    const key = e.type === 'boss' ? 'boss' : 'turnip';
    if (!EMISSIVE_SET.has(key)) continue;
    emitMask(ctx, EMISSIVE_KEYS.indexOf(key), e.frame | 0, e.x - camX, e.y);
  }
  // Energy boost (self-composite ×2, still 'lighter'), then the mip blur. The up-pass is 'copy'
  // because the blur REPLACES the sharp accumulator — 'source-over' would re-add it and the boost
  // would run away. `bloomHalf` is cleared so the down-pass cannot inherit the last frame's halo.
  ctx.globalAlpha = BLOOM_GAIN;
  ctx.drawImage(bl.c, 0, 0);
  ctx.drawImage(bl.c, 0, 0);
  ctx.globalAlpha = 1;
  hc.globalCompositeOperation = 'source-over';
  hc.globalAlpha = 1;
  hc.imageSmoothingEnabled = true;
  hc.clearRect(0, 0, halfLay.w, halfLay.h);
  hc.drawImage(bl.c, 0, 0, bl.w, bl.h, 0, 0, halfLay.w, halfLay.h);
  ctx.imageSmoothingEnabled = true;
  ctx.globalCompositeOperation = 'copy';
  ctx.drawImage(halfLay.c, 0, 0, halfLay.w, halfLay.h, 0, 0, bl.w, bl.h);
  // R47's balanced-frame rule: every later pass inherits a clean bloom ctx.
  ctx.globalCompositeOperation = 'source-over';
  return emitN;
}

// One blit, quarter-res -> logical, `'lighter'`, and the ONLY place the §7 ceiling is applied:
// Math.min here means a caller (or a later slice) cannot ask for more than BLOOM_MAX_ALPHA.
export function applyBloom(sceneCtx, alpha) {
  const bl = bloomLayer();
  const s = layout();
  const sm = sceneCtx.imageSmoothingEnabled;
  const a = Math.min(BLOOM_MAX_ALPHA, alpha === undefined ? BLOOM_MAX_ALPHA : alpha);
  bloomAlpha = a;
  sceneCtx.imageSmoothingEnabled = true;
  sceneCtx.globalCompositeOperation = 'lighter';
  sceneCtx.globalAlpha = a;
  sceneCtx.drawImage(bl.c, 0, 0, bl.w, bl.h, 0, 0, s.sceneW, s.sceneH);
  sceneCtx.imageSmoothingEnabled = sm;
  sceneCtx.globalAlpha = 1;
  sceneCtx.globalCompositeOperation = 'source-over';
  return a;
}

// bloomAlpha is the ceiling-clamped alpha applyBloom LAST used (0 before the first call), so a
// probe can read back what the composite actually asked for instead of trusting its own argument.
export function metrics() {
  return { allocations, bytes: layout().bytes, config: cfg,
           glowBuckets: glowBakes, lights: lightN, emissives: emitN, bloomAlpha: bloomAlpha };
}
