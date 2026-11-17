import { VIEW_W } from './config.js';

// The camera's one state: how far the world has scrolled. main.js builds G.cam and reuses
// this on every loadLevel() so there is one definition of "fresh camera".
export function makeCamera() {
  return { x: 0 };
}

// How far ahead of the hero the camera sits, in px, and how fast it closes on that target,
// in lerp units per second. CAMERA_FOLLOW_X is also the offset main.js subtracts from the
// checkpoint to get the camera's left floor, which is what keeps a hero pinned at a flag
// centred on screen instead of jammed against its left edge — so it is exported.
export const CAMERA_FOLLOW_X = 96;
const CAMERA_LERP = 10;

// Exponential follow stalls forever at sub-representable distances: `cam.x + step === cam.x`.
// Collapsing that last sliver is float hygiene, not smoothing — 1e-6 px is nine orders of
// magnitude below a pixel, so it cannot erase a visible step and cannot stand in for a "snap if
// far away" threshold. It is what lets the two-sided follow land EXACTLY on its floor/ceiling
// (R20 asserts `cam.x === FLOOR` and `=== 0`), which the old hard clamp got for free by
// assigning the bound outright.
const CAM_EPS = 1e-6;

// Two-sided follow: the camera closes on its target from either side, so walking left scrolls
// the world back. `minX` is the left floor, and it is a parameter, never a field on `cam`:
// main.js derives it from the last checkpoint reached (main.js:checkpointBounds), and the
// harness installs a bare { x } camera, so state on the camera object would read undefined.
// The floor is clamped under the ceiling, so a checkpoint past the last legal scroll position
// can never produce a range with no valid cam.x inside it.
//
// WHAT `minX` ACTUALLY PROTECTS, because it is easy to read the line below as gameplay-enforced and
// it is not (measured 2026-11-17): passing `0` at the call site — i.e. deleting the checkpoint floor
// outright — leaves the whole suite GREEN (`R36`/`R44`/`R45` still print "rests exactly on 544",
// because every one of them judges a camera that has already been carried to 544 by the follow). It is
// an EQUIVALENT MUTANT in every reachable state, and here is why, exactly: main.js clamps the HERO to
// the same bound (`updatePlayer`'s minX, player.js:135-138, from the same checkpointBounds() pair), so a
// playable state always has `p.x >= checkpointX`, hence `target = p.x - CAMERA_FOLLOW_X >= checkpointX -
// CAMERA_FOLLOW_X = lo`. Measured over the whole suite to make sure that is not hand-waving: 22,335
// updateCamera frames, `lo > 0` on 4,446 of them, and `target < lo` with a non-zero `lo` on 350 — all
// 350 inside R20 clause 1, which drives the follow with a hand-parked player at x=0 against FLOOR=640.
// That is precisely the state player.js's clamp exists to make un-buildable, and it is the branch's only
// customer. (`target < lo` with `lo === 0` is routine, 3,366 frames: that is the world's left edge,
// which is the same clamp doing its ordinary job.)
//
// The suite deliberately does NOT get a new scenario for this. An assertion that shoves `cam.x` under
// `lo` and then measures its recovery is the one thing that CANNOT tell `minX` from `minX = 0`: with
// the hero pinned on the post, `target` is 544 either way, so the camera converges on the same number
// at the same rate and both builds print the same "rests exactly on 544". R36 already runs exactly that
// shove (forced to 0, floor 544) and passes on both. Anything tighter would have to assert a property
// the shipped code does not have — e.g. that `cam.x` never sits below `lo`, which is precisely the wall
// this function was rewritten to stop being, and R44 exists to keep it that way. So the guarantee is
// documented here rather than tested: `minX` is a guard for unreachable states, not a gameplay bound,
// and a change to it must be argued from `checkpointBounds()`/`player.js` being unchanged, not from a
// green suite.
//
// The bounds are applied to the TARGET, before the lerp, never to `cam.x` after it. That is the
// whole difference between a bound and a wall. Clamping the result meant that whenever the floor
// moved forward — a checkpoint banking while the hero ran right — the camera, which always trails
// the hero by its steady-state follow lag (the discrete step settles at v·dt·(1−r)/r where r =
// CAMERA_LERP·dt, i.e. v/12 at 60 fps: MEASURED 9.17 px walking, 15.83 px running, not the continuous
// v/CAMERA_LERP approximation of 11 and 19), was sitting `lag` px BELOW the new floor and got assigned
// to it outright: a one-frame 9–16 px teleport, which is exactly the jerk this replaces. The hero is
// clamped to the same floor
// (player.js:135-138), so `target` can never legitimately sit below it; the only reason `cam.x`
// is under the floor is that lag, i.e. it is already converging upward. Letting the lerp carry it
// there costs the guarantee nothing and removes the pop.
//
// `lo` is a floor the camera is pulled UP to over a few frames; only values that no legal follow
// can produce are still assigned outright, so a shoved or NaN-poisoned camera cannot run away.
//
// `cam.x`'s safety clamps are a recovery ONLY for a NaN that arrives in `cam.x` itself. `lo` is built
// out of `minX`, so a NaN `minX` makes `lo` NaN, the floor comparison silently drops out, and putting
// the camera "back inside the range" writes NaN to it permanently. Not reachable from main.js —
// checkpointBounds() hands over Math.max(0, G.checkpointX) - CAMERA_FOLLOW_X, which is NaN only if
// G.checkpointX is, and the only writers of that are 0 and map-authored cp.x — and deliberately not
// hardened here: the guard would have to invent a floor, which is a worse failure than the one it
// hides. The guarantee this function actually makes is about a finite [minX, levelW] pair.
export function updateCamera(cam, dt, player, levelW, minX = 0) {
  const max = Math.max(0, levelW - VIEW_W);
  const lo = Math.min(Math.max(0, minX), max);
  let target = player.x - CAMERA_FOLLOW_X;
  if (target < lo) target = lo;
  else if (target > max) target = max;
  cam.x += (target - cam.x) * Math.min(1, CAMERA_LERP * dt);
  // Safety clamps for states the follow cannot generate: a lerp that never overshoots a target
  // inside [lo, max] can neither go negative nor pass max, so either of those — or a NaN in cam.x —
  // means `cam.x` arrived from outside. Put it back inside the range rather than trusting it. (A NaN
  // in `minX` is the one case this cannot fix: `lo` is NaN then, so the assignment re-poisons the
  // camera — see the note above the function.)
  if (!(cam.x >= 0)) cam.x = lo; // also catches a NaN cam.x, which fails every >= comparison
  else if (cam.x > max) cam.x = max;
  if (Math.abs(target - cam.x) < CAM_EPS) cam.x = target;
}
