// One atlas canvas, baked once, queried by string key. It knows nothing about what any
// sprite IS — sprites.js registers matrices, this module packs and blits them (§3.1). No
// import-time work of any kind: importing this module under bare Node (no DOM) is legal.

import { bakeMatrix } from './pixels.js';

const MAX_W = 2048; // wider canvases can hit texture limits on mobile GPUs
const GUTTER = 1;   // transparent px between frames: a nearest-neighbour blit can round
                    // onto it and pick up alpha 0, never its neighbour's colour
const SUFFIX = ':emissive'; // §7: bloom reads the mask, never the scene

let entries = [];        // registration order, so packing is deterministic
let table = new Map();   // key -> { recs, emRecs }
let baked = null;        // the single frozen result of bakeAll
let artScale = 1;        // the scale every frame was baked at
let atlasCanvas = null;  // read by blit; assigned exactly once, by bakeAll
let missing = 0;         // unknown-key blits; the harness asserts this is 0
let totalFrames = 0;

// Anchor convention (the art slice MUST follow it): `anchor: {x, y}` is the LOGICAL offset
// from a draw call's (x, y) to matrix cell 0,0 — blit(ctx,key,f,x,y) puts cell 0,0 at
// (floor(x + anchor.x), floor(y + anchor.y)) and the overhang on the other side. So it is
// exactly the overhang the old sprites.js draw functions used, negated:
//   drawHero   drew from (x, y - 2)      -> anchor { x:  0, y: -2 }
//   drawTurnip drew from (x - 1, y - 1)  -> anchor { x: -1, y: -1 }
//   drawBoss   drew from (x - 2, y - 2)  -> anchor { x: -2, y: -2 }
// Full-tile keys (ground, stone, brick, pipe…) use { x: 0, y: 0 }. bakeAll adds the
// outline pad, which moves the frame canvas's top-left up-left by `pad` art px, so anchors
// written here always speak of the MATRIX, never of the padded canvas.
export function register(entry) {
  if (baked) throw new Error('atlas: register() after bakeAll() for "' + entry.key + '"');
  let slot = -1;
  for (let i = 0; i < entries.length; i++) {
    if (entries[i].key === entry.key) { slot = i; break; }
  }
  if (slot < 0) entries.push(entry);
  else entries[slot] = entry; // re-registration replaces the art but keeps the pack order
  const recs = [];
  const emRecs = [];
  table.set(entry.key, { recs, emRecs });
}

// Bake and pack everything registered so far into ONE canvas. Idempotent: the renderer may
// call it on every level load and get the identical object back (R48 counts these calls).
export function bakeAll(scale) {
  if (baked) return baked;
  const t0 = now();
  artScale = scale > 0 ? scale : 1;

  // Rasterise first, pack second, so the pack order is the registration order and cannot
  // depend on bake cost. Uniform artScale (not the entry's own opts.scale) is what lets
  // blit divide baked px back into logical px.
  const pending = [];
  for (const entry of entries) {
    const t = table.get(entry.key);
    const opts = Object.assign({}, entry.opts, { scale: artScale });
    const anchor = entry.anchor || null;
    for (let f = 0; f < entry.frames.length; f++) {
      const art = bakeMatrix(entry.frames[f], entry.map, opts);
      pending.push({ key: entry.key, frame: f, canvas: art.c, pad: art.pad, anchor, recs: t.recs });
      // The mask canvas carries the same transparent outline pad as the colour canvas, so
      // it needs the SAME anchor: bloom then lands on its art with no offset maths at
      // runtime. Dropping the pad here would sit every glow 1 logical px up-left.
      if (art.emissive) {
        pending.push({ key: entry.key + SUFFIX, frame: f, canvas: art.emissive, pad: art.pad, anchor, recs: t.emRecs });
      }
    }
  }

  let x = GUTTER;
  let y = GUTTER;
  let shelf = 0;
  let usedW = 0;
  let at = 0;
  for (const p of pending) {
    const fw = p.canvas.width;
    const fh = p.canvas.height;
    if (x > GUTTER && x + fw + GUTTER > MAX_W) { x = GUTTER; y += shelf + GUTTER; shelf = 0; }
    pack(p, x, y, fw, fh);
    p.x = x;
    p.y = y;
    x += fw + GUTTER;
    if (x > usedW) usedW = x;
    if (fh + GUTTER > shelf) shelf = fh + GUTTER;
    at += fw * fh;
  }

  const w = Math.max(1, Math.min(MAX_W, usedW));
  const h = Math.max(1, y + shelf);
  atlasCanvas = makeCanvas(w, h);
  const cctx = atlasCanvas.getContext('2d');
  cctx.imageSmoothingEnabled = false;
  for (const p of pending) cctx.drawImage(p.canvas, p.x, p.y);

  const frames = {};
  for (const entry of entries) {
    const t = table.get(entry.key);
    frames[entry.key] = t.recs;
    if (t.emRecs.length > 0) frames[entry.key + SUFFIX] = t.emRecs;
  }
  totalFrames = pending.length;
  baked = { ms: now() - t0, canvas: atlasCanvas, frames };
  return baked;
}

function pack(p, sx, sy, sw, sh) {
  const a = p.anchor || {};
  p.recs[p.frame] = {
    key: p.key,
    frame: p.frame,
    sx,
    sy,
    sw,
    sh,
    anchorX: Math.round((a.x || 0) - p.pad),
    anchorY: Math.round((a.y || 0) - p.pad),
    // dest size at scale 1, in LOGICAL px; blit multiplies by the squash/stretch scale
    dw: sw / artScale,
    dh: sh / artScale,
  };
}

function now() {
  return typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
}

function makeCanvas(w, h) {
  const c = typeof OffscreenCanvas === 'function'
    ? new OffscreenCanvas(w, h)
    : document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

export function ready() {
  return baked !== null;
}

export function frameCount(key) {
  const t = table.get(key);
  return t ? t.recs.length : 0;
}

// Frame metadata for callers that must do their own rect maths (§3 ownership table lists
// this alongside blit): a static layer bake, or the harness checking the gutter. Unknown
// key returns null; it never throws and never allocates a new record.
export function getFrame(key, frame) {
  const t = table.get(key);
  if (t === undefined || t.recs.length === 0) return null;
  let f = frame | 0;
  if (f < 0) f = 0;
  else if (f >= t.recs.length) f = t.recs.length - 1;
  return t.recs[f] === undefined ? null : t.recs[f];
}

export function metrics() {
  return {
    frames: totalFrames,
    w: atlasCanvas ? atlasCanvas.width : 0,
    h: atlasCanvas ? atlasCanvas.height : 0,
    ms: baked ? baked.ms : 0,
    missing,
  };
}

// The only runtime sprite call: exactly one drawImage, no allocation, never throws. An
// unknown key draws nothing and counts itself, so a missing sprite is loud in the harness
// (which asserts missing === 0) while R26's "a render throw is survivable" still holds.
export function blit(ctx, key, frame, x, y, opts) {
  const rec = lookup(key, frame);
  if (rec === null) return;
  drawRec(ctx, rec, x, y, opts, opts !== undefined && opts !== null && opts.flipX === true);
}

// Bloom / lightmap input: the same rect maths against the key's emissive mask, so §7 can
// be driven without ever reading pixels back. The mask is reached through the frame's own
// entry — building the `<key>:emissive` string here would put garbage in the hot loop.
export function emissive(ctx, key, frame, x, y, opts) {
  const rec = lookupMask(key, frame);
  if (rec === null) return;
  drawRec(ctx, rec, x, y, opts, false);
}

function drawRec(ctx, rec, x, y, opts, flip) {
  const dx = Math.floor(x + rec.anchorX);
  const dy = Math.floor(y + rec.anchorY);
  const dw = Math.round(rec.dw * (opts !== undefined && opts !== null && opts.scaleX !== undefined ? opts.scaleX : 1));
  const dh = Math.round(rec.dh * (opts !== undefined && opts !== null && opts.scaleY !== undefined ? opts.scaleY : 1));
  if (dw <= 0 || dh <= 0) return;
  const alpha = opts !== undefined && opts !== null && opts.alpha !== undefined ? opts.alpha : 1;
  const held = alpha === 1 ? 1 : ctx.globalAlpha;
  if (alpha !== 1) ctx.globalAlpha = held * alpha;
  if (flip) {
    // drawImage cannot mirror through a negative source rect, so mirror the destination
    // space instead: 3 cheap state calls, still one pixel read.
    ctx.save();
    ctx.translate(dx + dw, dy);
    ctx.scale(-1, 1);
    ctx.drawImage(atlasCanvas, rec.sx, rec.sy, rec.sw, rec.sh, 0, 0, dw, dh);
    ctx.restore();
  } else {
    ctx.drawImage(atlasCanvas, rec.sx, rec.sy, rec.sw, rec.sh, dx, dy, dw, dh);
  }
  if (alpha !== 1) ctx.globalAlpha = held;
}

// Frame index is clamped to the key's last frame, so an animation table that outruns the
// art set still draws instead of blanking.
function lookup(key, frame) {
  const t = table.get(key);
  if (t === undefined || t.recs.length === 0) {
    missing += 1;
    return null;
  }
  let f = frame | 0;
  if (f < 0) f = 0;
  else if (f >= t.recs.length) f = t.recs.length - 1;
  return t.recs[f];
}

function lookupMask(key, frame) {
  const t = table.get(key);
  if (t === undefined || t.emRecs.length === 0) {
    missing += 1;
    return null;
  }
  let f = frame | 0;
  if (f < 0) f = 0;
  else if (f >= t.emRecs.length) f = t.emRecs.length - 1;
  const rec = t.emRecs[f];
  if (rec === undefined) {
    missing += 1;
    return null;
  }
  return rec;
}
