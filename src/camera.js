import { VIEW_W } from './config.js';

export function makeCamera() {
  return { x: 0 };
}

export function updateCamera(cam, dt, player, levelW) {
  const target = player.x - 96;
  const rate = target > cam.x ? 10 : 14;
  // One-way ratchet: the world only ever scrolls forward, so cleared ground stays cleared.
  cam.x = Math.max(cam.x, cam.x + (target - cam.x) * Math.min(1, rate * dt));
  const max = Math.max(0, levelW - VIEW_W);
  if (cam.x < 0) cam.x = 0;
  else if (cam.x > max) cam.x = max;
}
