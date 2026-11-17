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

// Two-sided follow: the camera closes on its target from either side, so walking left scrolls
// the world back. `minX` is the left floor, and it is a parameter, never a field on `cam`:
// main.js derives it from the last checkpoint reached (main.js:checkpointBounds), and the
// harness installs a bare { x } camera, so state on the camera object would read undefined.
// The floor is clamped under the ceiling, so a checkpoint past the last legal scroll position
// can never produce a range with no valid cam.x inside it.
export function updateCamera(cam, dt, player, levelW, minX = 0) {
  const target = player.x - CAMERA_FOLLOW_X;
  cam.x += (target - cam.x) * Math.min(1, CAMERA_LERP * dt);
  const max = Math.max(0, levelW - VIEW_W);
  const lo = Math.min(Math.max(0, minX), max);
  if (cam.x < lo) cam.x = lo;
  else if (cam.x > max) cam.x = max;
}
