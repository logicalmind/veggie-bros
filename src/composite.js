// composite.js — HD-2D compositor buffers: DPR sizing math + layer table.
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

import { VIEW_W, VIEW_H, FX_SCALE } from './config.js';
import { makeLayer } from './pixels.js';

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

export function metrics() {
  return { allocations, bytes: layout().bytes, config: cfg };
}
