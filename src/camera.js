import { VIEW_W } from './config.js';

// The camera's one state: how far the world has scrolled. main.js builds G.cam and reuses
// this on every loadLevel() so there is one definition of "fresh camera".
export function makeCamera() {
  return { x: 0 };
}

// How fast the camera closes on its target, in lerp units per second. There used to be a
// second rate (14) for when the target sat behind the camera, but the ratchet in updateCamera
// discards any backward step, so that branch could never reach cam.x. It is deleted, not tuned.
const CAMERA_LERP = 10;

export function updateCamera(cam, dt, player, levelW) {
  const target = player.x - 96;
  // One-way ratchet: the world only ever scrolls forward, so cleared ground stays cleared.
  cam.x = Math.max(cam.x, cam.x + (target - cam.x) * Math.min(1, CAMERA_LERP * dt));
  const max = Math.max(0, levelW - VIEW_W);
  if (cam.x < 0) cam.x = 0;
  else if (cam.x > max) cam.x = max;
}
