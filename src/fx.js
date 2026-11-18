// Particles, impact FX and camera shake — render-only (GRAPHICS_PLAN.md §6).
// Zero DOM/canvas dependency: the pool is plain typed arrays advanced by the `dt` it is
// handed, so it runs under bare Node and the harness can assert on the arrays directly.
// The only randomness is pixels.seeded(frame, salt); there is no wall clock and no
// Math.random, so two identical emitter/update sequences produce bit-identical arrays
// (R50) and `fx.reset()` puts the whole system back to a state that draws nothing.
// Nothing here writes gameplay state (§3/R51): emitters take numbers, and the one piece of
// per-entity data is a WeakMap entry the renderer only reads.

import { VIEW_W, VIEW_H } from './config.js';
import { seeded } from './pixels.js';
import { blit, frameCount } from './atlas.js';

export const MAX_PARTICLES = 96;

// The atlas key for a kind IS its name, so emitters never build a string.
export const KIND = Object.freeze({ DUST: 'fx.dust', SPARK: 'fx.spark', POOF: 'fx.poof', CHIP: 'fx.chip' });

const DUST = 0;
const SPARK = 1;
const POOF = 2;
const CHIP = 3;
const ORDINAL = Object.freeze({ 'fx.dust': DUST, 'fx.spark': SPARK, 'fx.poof': POOF, 'fx.chip': CHIP });
const NKIND = 4;

// Per-kind physics + art table, indexed by the ordinals above. FROZEN, and read-only at
// runtime: the numbers are the whole look, so keeping them here (not scattered through the
// emitters) is what makes "dust reads different from chips" reviewable in one place.
//   gravity  logical px/s^2 applied after drag     drag    per-second velocity damping
//   bounce   restitution against the emit baseline (0 = the particle never lands)
//   life     seconds at the nominal jitter; per-particle life is 0.7..1.3x this
//   w/h      nominal LOGICAL size, used only to centre the blit on the emit point
//   grow     scaleY added over the particle's life;  stretch  speed (px/s) that gives +1
//   twinkle  spark-style hard flicker;  spin         left/right art pick
//   speed0/1 ring-base + ring-jitter speed,  rise  upward bias subtracted from vy
const TAB = Object.freeze([
  Object.freeze({ key: KIND.DUST, gravity: 90, drag: 7.0, bounce: 0.0, life: 0.45,
    w: 3, h: 2, alpha: 0.85, grow: 0.35, stretch: 0, twinkle: false, spin: false,
    speed0: 24, speed1: 34, rise: 26 }),
  Object.freeze({ key: KIND.SPARK, gravity: 300, drag: 1.6, bounce: 0.35, life: 0.40,
    w: 3, h: 3, alpha: 1.0, grow: 0.0, stretch: 620, twinkle: true, spin: true,
    speed0: 70, speed1: 130, rise: 90 }),
  Object.freeze({ key: KIND.POOF, gravity: -60, drag: 3.2, bounce: 0.0, life: 0.55,
    w: 5, h: 5, alpha: 0.8, grow: 1.15, stretch: 0, twinkle: false, spin: false,
    speed0: 20, speed1: 38, rise: 46 }),
  Object.freeze({ key: KIND.CHIP, gravity: 900, drag: 0.35, bounce: 0.45, life: 0.75,
    w: 3, h: 3, alpha: 1.0, grow: 0.0, stretch: 420, twinkle: false, spin: true,
    speed0: 110, speed1: 150, rise: 150 }),
]);

// Shake (§6): peak <= 3 px, linear decay to zero in 0.22 s from any amplitude, integer out.
const SHAKE_MAX = 3;
const SHAKE_DECAY = 0.22;
const SHAKE_RATE = SHAKE_MAX / SHAKE_DECAY;

// Squash-and-stretch (§5.6). Slots are pre-allocated and round-robined, so a `hit()` in a
// brick-break loop allocates nothing; `owner === entity` is how a recycled slot says "not
// yours any more", which is also why no entity is ever written to.
const SQUASH_SLOTS = 12;
const SQUASH_RELAX = 0.18;
const IMPULSE = Object.freeze({
  land: Object.freeze({ kx: 0.15, ky: -0.13, dur: SQUASH_RELAX }),
  stomp: Object.freeze({ kx: 0.22, ky: -0.2, dur: 0.16 }),
  hurt: Object.freeze({ kx: -0.1, ky: 0.12, dur: 0.16 }),
  hop: Object.freeze({ kx: -0.08, ky: 0.14, dur: 0.16 }),
  jump: Object.freeze({ kx: -0.1, ky: 0.18, dur: 0.14 }),
});

const RUN_DUST = 2;      // dust() is called on alternate run frames
const SPARKLE_N = 3;
const POOF_N = 5;
const BURST_MAX = 24;    // per-call clamp; the pool cap still decides what actually lands
const CULL_PAD = 10;     // generous half-size + overhang, so nothing pops at the edge
const TAU = Math.PI * 2;

// ---- pool (allocated once by init(); struct-of-arrays, live particles packed in [0,live))
let px = null;   // logical world px
let py = null;
let vx = null;
let vy = null;
let gy = null;   // bounce baseline, i.e. the surface the emitter was told about
let life = null; // seconds remaining
let life0 = null;// seconds at spawn, so fade/progress needs no division by a constant
let kind = null; // Int16 ordinal into TAB
let seed = null; // per-particle salt: twinkle phase + spin coin
let live = 0;
let peak = 0;
let emitted = 0;
let dropped = 0;
let shakeFrames = 0;

let frame = 0;      // the only clock: update() ticks, and every RNG draw is keyed on it
let emitSalt = 0;   // bumps per emitter call so two bursts in one frame cannot share noise
let shakeAmp = 0;   // live amplitude; 0 <=> idle
let shakeOff = 0;   // integer offset for THIS frame, cached so repeated reads agree

let squash = null;            // SQUASH_SLOTS records, created once
let squashAt = 0;             // round-robin cursor
// entity -> squash slot. Keys stay collectable, so a dead enemy costs nothing; the slot ring
// below is the only strong ref and it holds 12 entities at most.
const squashOwner = new WeakMap();
const scratchSquash = { sx: 1, sy: 1 };
const scratchOpts = { flipX: false, scaleX: 1, scaleY: 1, alpha: 1 };
const damp = new Float32Array(NKIND);   // per-update drag constants: 4 divides, not 96
const drawFrames = new Int32Array(NKIND); // this frame's atlas frame counts, refreshed once

// Deterministic noise. `frame << 6` wraps through ToInt32 after ~33 M ticks (~6 days at
// 60 fps); the wrap is arithmetic, not float rounding, so it is still reproducible.
function rnd(i, salt) {
  return seeded((frame << 6) + emitSalt, (salt << 8) + (i & 255));
}

export function init() {
  if (px === null) {
    px = new Float32Array(MAX_PARTICLES);
    py = new Float32Array(MAX_PARTICLES);
    vx = new Float32Array(MAX_PARTICLES);
    vy = new Float32Array(MAX_PARTICLES);
    gy = new Float32Array(MAX_PARTICLES);
    life = new Float32Array(MAX_PARTICLES);
    life0 = new Float32Array(MAX_PARTICLES);
    kind = new Int16Array(MAX_PARTICLES);
    seed = new Int16Array(MAX_PARTICLES);
    squash = new Array(SQUASH_SLOTS);
    for (let i = 0; i < SQUASH_SLOTS; i++) {
      squash[i] = { owner: null, t: SQUASH_RELAX, dur: SQUASH_RELAX, kx: 0, ky: 0 };
    }
  }
  reset();
}

// Empty the pool, zero shake, squash and the frame/emitter counters. Called by
// newGame()/loadLevel() so a harness-driven restart cannot inherit a tail (R50).
// The arrays are zeroed, not just abandoned below `live`: kill() keeps the tail canonical and
// reset() is the other half of that contract, so `Array.from(px)` after a restart is identical
// for two runs that reached the same restart state. Cumulative counters (peak/emitted/dropped/
// shakeFrames) survive on purpose — they describe the run and no draw stream reads them.
export function reset() {
  live = 0;
  frame = 0;
  emitSalt = 0;
  shakeAmp = 0;
  shakeOff = 0;
  if (px === null) return;
  px.fill(0); py.fill(0);
  vx.fill(0); vy.fill(0);
  gy.fill(0);
  life.fill(0); life0.fill(0);
  kind.fill(0); seed.fill(0);
  for (let i = 0; i < SQUASH_SLOTS; i++) {
    const s = squash[i];
    s.owner = null;
    s.t = s.dur;
  }
}

function ensure() {
  if (px === null) init();
}

// Refuse the newest, never recycle the oldest: with swap-with-last compaction the pool is
// not age-ordered, so "oldest" would be a scan, and a stomp burst must not be able to erase
// a hero's own landing puff by arriving one particle later.
function spawn(ko, x, y, velx, vely, seconds, baseY, saltBase) {
  if (live >= MAX_PARTICLES) {
    dropped += 1;
    return;
  }
  const i = live++;
  const r = rnd(i, saltBase);
  px[i] = x;
  py[i] = y;
  vx[i] = velx;
  vy[i] = vely;
  gy[i] = baseY;
  life0[i] = seconds * (0.7 + 0.6 * r);
  life[i] = life0[i];
  kind[i] = ko;
  seed[i] = (emitSalt * 31 + i * 7 + ko) & 0x7fff;
  if (live > peak) peak = live;
  emitted += 1;
}

// Swap-with-last: the live set stays packed in [0,live), so neither update() nor draw()
// ever tests a dead slot. The caller must NOT advance its cursor — the particle swapped
// into `i` has not been integrated this tick.
// The vacated tail is then ZEROED. Nothing reads past `live`, but R50's contract is that
// equal input sequences give bit-identical ARRAYS, and a harness dumping all 96 slots would
// otherwise see the previous run's corpses there. Nine stores per death, no allocation.
function kill(i) {
  const last = --live;
  if (i !== last) {
    px[i] = px[last]; py[i] = py[last];
    vx[i] = vx[last]; vy[i] = vy[last];
    gy[i] = gy[last];
    life[i] = life[last]; life0[i] = life0[last];
    kind[i] = kind[last]; seed[i] = seed[last];
  }
  px[last] = 0; py[last] = 0;
  vx[last] = 0; vy[last] = 0;
  gy[last] = 0;
  life[last] = 0; life0[last] = 0;
  kind[last] = 0; seed[last] = 0;
}

// Ground-contact dust. `dir` is the hero's facing: dust trails BEHIND, so vx is -dir.
export function dust(x, y, dir) {
  ensure();
  emitSalt += 1;
  const t = TAB[DUST];
  for (let i = 0; i < RUN_DUST; i++) {
    const side = dir < 0 ? 1 : (dir > 0 ? -1 : (rnd(i, 8) < 0.5 ? 1 : -1));
    spawn(DUST, x - (t.w >> 1), y - t.h,
      side * (t.speed0 + t.speed1 * rnd(i, 0)),
      -(t.rise * 0.35 + t.rise * rnd(i, 1)),
      t.life, y, 40 + i);
  }
}

// Landing puff + the shake that sells it. `power` is normalised impact (|vy| / MAX_FALL),
// clamped here so a caller that forgets to normalise still cannot exceed the 3 px cap.
export function landing(x, y, power) {
  ensure();
  const p = power > 0 ? (power < 1 ? power : 1) : 0;
  emitSalt += 1;
  const t = TAB[DUST];
  const n = 3 + ((5 * p) | 0);
  for (let i = 0; i < n; i++) {
    const side = (i & 1) === 0 ? 1 : -1;
    const spread = 0.45 + 0.55 * p;
    spawn(DUST, x - (t.w >> 1), y - t.h,
      side * (t.speed0 + t.speed1 * (0.5 + rnd(i, 0))) * spread,
      -(t.rise * 0.5 + t.rise * (0.5 + p) * rnd(i, 1)),
      t.life * (0.8 + 0.4 * p), y, 60 + i);
  }
  shake(1 + 2 * p);
}

// Generic radial burst. `kind` is a KIND value ('fx.spark' for a stomp / boss hit,
// 'fx.chip' for the brick-break shards that augment main.js makeShards).
export function burst(x, y, n, kindName) {
  ensure();
  emitSalt += 1;
  // Own-property lookup only: ORDINAL is frozen but still inherits Object.prototype, and
  // burst(x, y, 4, 'constructor') must read as "unknown kind", not as a thrown TAB index.
  const has = typeof kindName === 'string' && Object.prototype.hasOwnProperty.call(ORDINAL, kindName);
  const ko = has ? ORDINAL[kindName] : SPARK;
  const k = TAB[ko];
  const c = n > 0 ? (n < BURST_MAX ? n : BURST_MAX) : 1;
  for (let i = 0; i < c; i++) {
    // Even angular spacing + a jitter: pure jitter clumps, pure spacing looks mechanical.
    const a = (i / c) * TAU + rnd(i, 2) * 0.8;
    const sp = k.speed0 + k.speed1 * rnd(i, 3);
    spawn(ko, x - (k.w >> 1), y - (k.h >> 1),
      Math.cos(a) * sp,
      Math.sin(a) * sp * 0.85 - k.rise,
      k.life, y, 80 + ko * 8);
  }
}

// Berry pickup: three slow sparks that sizzle along the ground rather than explode.
export function sparkle(x, y) {
  ensure();
  emitSalt += 1;
  const t = TAB[SPARK];
  for (let i = 0; i < SPARKLE_N; i++) {
    const j = i - (SPARKLE_N >> 1);
    spawn(SPARK, x - (t.w >> 1), y - (t.h >> 1),
      j * 14 + (rnd(i, 0) * 2 - 1) * 20,
      -(18 + 34 * rnd(i, 1)),
      t.life * (0.9 + 0.5 * rnd(i, 2)),
      y + 4, 100 + i); // the sizzle line sits below the berry centre, not on it
  }
}

// Death / boss-down poof: puffs that rise, expand and thin out.
export function poof(x, y) {
  ensure();
  emitSalt += 1;
  const t = TAB[POOF];
  for (let i = 0; i < POOF_N; i++) {
    spawn(POOF, x - (t.w >> 1), y - (t.h >> 1),
      (rnd(i, 0) * 2 - 1) * (t.speed0 + t.speed1),
      -(t.rise * 0.6 + t.rise * rnd(i, 1)),
      t.life, y, 120 + i);
  }
}

// Peak semantics: a second impact while still shaking takes the larger amplitude, it never
// sums, so two coincident shakes cannot blow past the 3 px / 0.25 s envelope.
export function shake(amount) {
  ensure();
  if (amount > shakeAmp) shakeAmp = amount < SHAKE_MAX ? amount : SHAKE_MAX;
}

// Integer offset for the world composite ONLY — never cam.x, never the HUD (R52). Cached by
// update() so two reads in one frame cannot disagree, and exactly 0 whenever nothing shook.
export function shakeOffset() {
  return shakeOff;
}

// Squash-and-stretch impulse. Accepts the frozen IMPULSE names; anything else reads as the
// landing shape, because a caller passing a stray number still wants a visible reaction.
export function hit(entity, kindName) {
  ensure();
  if (entity === null || (typeof entity !== 'object' && typeof entity !== 'function')) return;
  const imp = typeof kindName === 'string' && Object.prototype.hasOwnProperty.call(IMPULSE, kindName)
    ? IMPULSE[kindName] : IMPULSE.land;
  const slot = squash[squashAt];
  squashAt = (squashAt + 1) % SQUASH_SLOTS;
  slot.owner = entity;
  slot.t = 0;
  slot.dur = imp.dur;
  slot.kx = imp.kx;
  slot.ky = imp.ky;
  squashOwner.set(entity, slot);
}

// SCRATCH — read sx/sy immediately, never retain the object. Never touches `entity`.
export function getSquash(entity) {
  const s = scratchSquash;
  let slot = undefined;
  if (entity !== null && (typeof entity === 'object' || typeof entity === 'function')) {
    slot = squashOwner.get(entity);
  }
  if (slot === undefined || slot.owner !== entity || slot.t >= slot.dur) {
    s.sx = 1; s.sy = 1;
    return s;
  }
  const u = slot.t / slot.dur;
  const a = (1 - u) * (1 - u); // fast release, then settle: a linear relax reads like a slide
  s.sx = 1 + slot.kx * a;
  s.sy = 1 + slot.ky * a;
  return s;
}

export function update(dt) {
  if (px === null) init();
  const h = dt > 0 ? dt : 0;
  frame += 1;
  for (let k = 0; k < NKIND; k++) damp[k] = 1 / (1 + TAB[k].drag * h);

  let i = 0;
  while (i < live) {
    life[i] -= h;
    if (life[i] <= 0) { kill(i); continue; } // the swapped-in particle gets checked at i
    const ko = kind[i];
    const t = TAB[ko];
    const d = damp[ko];
    let velx = vx[i] * d;
    let vely = (vy[i] + t.gravity * h) * d;
    let y = py[i] + vely * h;
    if (t.bounce > 0 && y > gy[i] && vely > 0) {
      y = gy[i];
      vely = -vely * t.bounce;
      velx *= 0.7; // chips skid, they do not keep their horizontal speed through a bounce
      if (vely > -20) vely = 0;
    }
    vx[i] = velx; vy[i] = vely;
    px[i] += velx * h; py[i] = y;
    i += 1;
  }

  for (let s = 0; s < SQUASH_SLOTS; s++) {
    const slot = squash[s];
    if (slot.t < slot.dur) {
      slot.t += h;
      if (slot.t > slot.dur) slot.t = slot.dur;
    }
  }

  if (shakeAmp > 0) {
    shakeAmp -= SHAKE_RATE * h;
    if (shakeAmp <= 0) { shakeAmp = 0; shakeOff = 0; }
    else {
      let o = Math.round(shakeAmp * (seeded(frame, 7919) * 2 - 1));
      if (o > SHAKE_MAX) o = SHAKE_MAX; else if (o < -SHAKE_MAX) o = -SHAKE_MAX;
      shakeOff = o;
      if (o !== 0) shakeFrames += 1;
    }
  }
}

// One drawImage per live particle, zero fillRect, and off-screen particles cost a compare.
// Destination coords are floored here (not left to blit) so the harness sees integer dest
// rects and a shaken frame cannot smear a particle across two px rows mid-burst.
export function draw(ctx, camX) {
  if (px === null) init();
  const ox = camX === undefined ? 0 : camX;
  for (let k = 0; k < NKIND; k++) {
    const fc = frameCount(TAB[k].key);
    drawFrames[k] = fc > 0 ? fc : 1;
  }
  for (let i = 0; i < live; i++) {
    const ko = kind[i];
    const t = TAB[ko];
    const sx = Math.floor(px[i] - ox);
    const sy = Math.floor(py[i]);
    if (sx < -CULL_PAD || sx > VIEW_W + CULL_PAD || sy < -CULL_PAD || sy > VIEW_H + CULL_PAD) continue;
    const total = life0[i];
    const p = total > 0 ? 1 - life[i] / total : 1; // 0 at spawn -> 1 at death
    const fc = drawFrames[ko];
    let f = (p * fc) | 0;
    if (f >= fc) f = fc - 1;

    let a;
    if (ko === CHIP) a = t.alpha * (p < 0.75 ? 1 : 4 * (1 - p));
    else if (ko === SPARK) a = t.alpha * (1 - p) * (t.twinkle && rnd(i, 300 + (seed[i] & 63)) < 0.22 ? 0.45 : 1);
    else a = t.alpha * (1 - p) * (1 - p * 0.35);

    let sc = 1;
    if (t.grow > 0) sc += t.grow * p;
    if (t.stretch > 0) {
      const sp = vy[i] < 0 ? -vy[i] : vy[i];
      sc += (sp < t.stretch ? sp : t.stretch) / t.stretch * 0.45;
    }

    scratchOpts.alpha = a;
    scratchOpts.scaleY = sc;
    scratchOpts.scaleX = 1;
    scratchOpts.flipX = t.spin && (seed[i] & 1) === 1;
    blit(ctx, t.key, f, sx, sy, scratchOpts);
  }
}

export function metrics() {
  return { live, peak, emitted, dropped, shakeFrames };
}

// True means the system draws nothing and shakeOffset() is 0 — the state the harness
// compares draw streams in.
export function isIdle() {
  return live === 0 && shakeAmp === 0 && shakeOff === 0;
}
