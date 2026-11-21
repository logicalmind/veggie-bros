import { PALETTE, SCENE_SCALE as HD, VIEW_H, VIEW_W } from './config.js';
import { applyBloom, applyLightmap, buildBloom, drawLightmap, layers, setAmbient } from './composite.js';
import { draw as drawFx, shakeOffset } from './fx.js';
import { parseLevel } from './level.js';
import { LEVELS } from './levels.js';
import { ambientFor, bakeLevel, parallaxFor, retileColumn as terrainRetile, visibleStrips } from './terrain.js';
import { colorToCss } from './pixels.js';
import { banner, hud, overlay, popup, title } from './ui.js';
import { drawBerry, drawFruit, drawGate, drawShard } from './props.js';
import { drawBoss, drawHero, drawTurnip } from './chars.js';

const P = PALETTE;
// squashed turnip corpse: the flattened sprite is a turnipBody band this tall, with a
// turnipTip root strip CORPSE_TIP_H rows tall along its bottom edge
const CORPSE_H = 4;
const CORPSE_TIP_H = 1;
// width of the sprite's root column, centred inside the band (sprites draw at x - 1)
const CORPSE_TIP_W = 2;

// The three shipped levels' terrain themes, in level order — the same mapping
// /tmp/vb-w2-logic.mjs sweeps, and the only three names terrain.js's THEMES table carries.
const THEME_NAMES = ['fields', 'canyon', 'palace'];
// One bake PLAN per level, keyed on the level object identity plus the theme: loadLevel()
// re-parses the level, so a restart re-plans and terrain's own bundle/strip cache re-blits
// instead of re-baking (R48). A plan allocates no canvas — strips, ambient and parallax
// appear on first sight inside the three accessors below — so `bakeLevel` runs once per
// level and never inside a steady frame.
let bakedFor = null;
function worldFor(g) {
  const theme = THEME_NAMES[g.levelIndex] || 'fields';
  if (bakedFor && bakedFor.level === g.level && bakedFor.theme === theme) return bakedFor.baked;
  const baked = bakeLevel(g.level, theme);
  // §7's `multiply` base is the LEVEL's aerial-fog tint (`_theme.fog`, an `{r,g,b,a}` object —
  // terrain.js's `mix()` carries `a`), converted through `colorToCss`, the one stringifier that
  // cannot emit `rgba(...,NaN)` from it. Once per level, next to the bake it keys on. A baked
  // plan with no `_theme` leaves composite's own default in place rather than guessing a colour.
  const fog = baked._theme && baked._theme.fog;
  if (fog) setAmbient(colorToCss(fog));
  bakedFor = { level: g.level, theme, baked };
  return baked;
}

// R-6: a head-bump mutates the plan's level tiles in place (main.js); without this the
// plan's frozen strip keys would serve the pre-punch art for that column forever.
// Re-key the affected strips — the next visibleStrips() re-bakes them once. No-op before
// the first render, or after loadLevel() replaced the level object, in which case
// worldFor() re-plans from the fresh parse anyway.
export function retileColumn(g, tx) {
  if (bakedFor && bakedFor.level === g.level) terrainRetile(bakedFor.baked, tx);
}

// The whole background in 1 + 3 + (4..6) blits: baked sky wash, the three parallax depths,
// then the level's terrain strips. Called under render()'s single HD scene transform, so
// every destination below is in LOGICAL px. `o` is fx's ONE signed shake int, applied as
// (o, -o) to the destination coordinates — the jolt stays arithmetic.
function drawWorld(ctx, baked, camX, o, oy) {
  // The ambient ramp is screen-aligned by terrain's contract, so it takes no shake: a
  // shifted full-view blit would leave a transparent row along one edge of the frame.
  ctx.drawImage(ambientFor(baked, camX).canvas, 0, 0, VIEW_W, VIEW_H);
  // Parallax is queried with the TRUE camera (its depth factors are scroll, not shake) and
  // shifted by the whole offset, so the jolt moves the frame rigidly.
  const layers = parallaxFor(baked, camX);
  for (let i = 0; i < layers.length; i++) {
    const L = layers[i];
    ctx.globalAlpha = L.alpha;
    // The layer canvases are HD-scale: dest is their logical size, (VIEW_W + period) wide.
    ctx.drawImage(L.canvas, L.dx + o, oy, L.canvas.width / HD, L.canvas.height / HD);
  }
  ctx.globalAlpha = 1;
  // Strips. The coverage query takes the shake-shifted camera (camX - o) so the 1-3 px the
  // view gains at the trailing edge is painted too, and `dx` is then already relative to
  // that camera — no extra dest offset. The dest is the FULL strip width: a 63-px dest
  // leaves a 1-px uncovered column at every boundary and fakes seam gaps (the seam probe's
  // control measured maxD 233 that way).
  const strips = visibleStrips(baked, camX - o);
  for (let i = 0; i < strips.length; i++) {
    ctx.drawImage(strips[i].canvas, strips[i].dx, oy, baked.stripW, VIEW_H);
  }
}

// `oy` is the vertical half of the camera shake (fx's offset negated); it defaults to 0 so
// every non-shaking call site and harness path draws exactly where it always did.
function drawItems(ctx, items, camX, oy = 0) {
  for (const it of items) {
    const ix = it.x - camX;
    switch (it.kind) {
      case 'fruit':
        drawFruit(ctx, ix, it.y + oy, Math.floor(it.t * 8) % 4);
        break;
      case 'berry':
        drawBerry(ctx, ix, it.y + oy, 0);
        break;
      case 'pop': {
        const py = it.y - 16 * (it.t / 0.25) + oy;
        if (it.what === 'berry') drawBerry(ctx, ix, py, 0);
        else drawFruit(ctx, ix, py, 0);
        break;
      }
      case 'shard':
        drawShard(ctx, ix, it.y + oy, it.k, it.t);
        break;
      case 'popup': {
        const py = it.y - 20 * (it.t / 0.6) + oy;
        // ui.popup: white with a black rim, top-left anchored exactly where the pixel text
        // used to land, so the popup stays legible over the light sky and stone tiles
        popup(ctx, it.text, ix, py);
        break;
      }
    }
  }
}

function drawEnemies(ctx, enemies, camX, oy = 0) {
  for (const e of enemies) {
    if (!e || e.dead) continue;
    const ex = e.x - camX;
    const facing = Math.sign(e.vx) || -1;
    if (e.type === 'boss') {
      if (e.defeated) {
        // 3-frame flip spin over the 1.5 s defeat window
        const spin = Math.floor(e.defeatT * 8) % 3;
        drawBoss(ctx, ex, e.y + oy, spin, spin & 1 ? -facing : facing, false, e.onGround ? 0.25 : 0);
      } else {
        drawBoss(ctx, ex, e.y + oy, e.frame || 0, facing, e.hurtT > 0, e.onGround ? 0.25 : 0);
      }
    } else {
      const frame = e.frame || 0;
      if (e.squashed) {
        // Corpse: draw the flattened sprite directly — a turnipBody band with the
        // turnipTip root strip on its bottom edge, bottom-anchored at the hitbox floor.
        // Squashing with ctx.scale(1, 4 / 14) instead landed the art on fractional rows
        // (8.29..12.29 of the 14 px-tall art), and fillRect antialiases fractional
        // geometry, so the corpse came out as a faint blurry band.
        const top = e.y + e.h - CORPSE_H + oy;
        ctx.fillStyle = P.turnipBody;
        ctx.fillRect(ex - 1, top, e.w, CORPSE_H);
        ctx.fillStyle = P.turnipTip;
        ctx.fillRect(ex - 1 + (e.w - CORPSE_TIP_W) / 2, top + CORPSE_H - CORPSE_TIP_H, CORPSE_TIP_W, CORPSE_TIP_H);
      } else {
        drawTurnip(ctx, ex, e.y + oy, frame, facing, e.onGround ? 0.22 : 0);
      }
    }
  }
}

function drawPlayer(ctx, player, camX, oy = 0) {
  const p = player;
  if (!p || (p.dead && p.deadPit)) return;
  if (p.invulnT > 0 && Math.floor(p.t * 8) % 2 === 1) return; // blink
  const pose = p.dead ? 'jump' : !p.onGround ? 'jump' : Math.abs(p.vx) > 10 ? 'run' : 'idle';
  const frame = pose === 'run' ? Math.floor(p.t * 10) % 2 : 0;
  drawHero(ctx, p.x - camX, p.y + oy, p.facing, p.big, pose, frame, p.onGround ? 0.24 : 0);
}

// The title's backdrop is the game's own world: level 1 baked once per process and blitted
// from the SAME bundle the first game start will use (terrain.js keys the bundle on
// `label|theme|phase`), so the title's one-time bake cost is the game's own first-frame
// bake, spent on the menu instead of in it. `G.level` is null in TITLE, so the plan parses
// LEVELS[0] directly; the front page is always the fields theme, whatever level the player
// last reached.
let titleBaked = null;
function titleWorld() {
  if (!titleBaked) titleBaked = bakeLevel(parseLevel(LEVELS[0]), 'fields');
  return titleBaked;
}
export function render(g) {
  // No caller-supplied destination: `render` draws everything — the world, the particles, the
  // lighting and the UI surfaces — into `composite.layers().scene`, and `main.js` owns the ONLY
  // blits that reach the visible canvas (§4's `scene -> upscale -> canvas`). R-4 retired the
  // `hud` layer: the UI now draws on the scene after the FX passes, in the same logical grid.
  const L = layers();
  const sc = L.scene.ctx;
  // The title is unlit and unshaken: the scene gets the world pass alone (no lightmap or bloom
  // over it) and the title UI (scrim, logo, copy, the hero pair) draws on that same unlit scene
  // right after the world, so the front page is one whole-surface-cleared layer.
  if (g.state === 'TITLE') {
    sc.setTransform(HD, 0, 0, HD, 0, 0);
    sc.clearRect(0, 0, VIEW_W, VIEW_H);
    drawWorld(sc, titleWorld(), 0, 0, 0);
    title(sc, Date.now());
    sc.setTransform(1, 0, 0, 1, 0, 0);
    return;
  }
  const level = g.level;
  const camX = Math.floor(g.cam.x);

  // Camera shake enters as arithmetic: fx hands over ONE signed int, and the world is drawn
  // at (o, -o) by shifting the camera it is measured against. The canvas transforms in this
  // file are the HD scale on the scene (below, in the TITLE branch, and on the final UI pass);
  // the FX blits run at identity (R52), and the UI is drawn AFTER them, unshaken.
  const o = shakeOffset();
  const baked = worldFor(g);
  // Everything that can be LIT is drawn into the scene layer, which is a persistent buffer: it is
  // emptied first so the frame cannot inherit last frame's bloom. `main.js` blits it; nothing here
  // touches the visible canvas (§7, R52, §4's pass order). World passes draw in LOGICAL px under
  // the HD transform.
  sc.setTransform(HD, 0, 0, HD, 0, 0);
  sc.clearRect(0, 0, VIEW_W, VIEW_H);
  drawWorld(sc, baked, camX, o, -o);
  // Checkpoints draw NOTHING. `level.checkpoints` stays live gameplay state — the arming band, the
  // hero's left clamp and the camera floor all read it (main.js) — but a banked post is invisible,
  // so there is deliberately no draw call here. `R45` renders a level with and without its
  // checkpoints and requires identical draw streams; the gate below stays world furniture drawn by
  // manual -camX arithmetic, and it sets no canvas transform.
  if (level.gate) drawGate(sc, level.gate.x - (camX - o), level.gate.y - o);
  drawItems(sc, g.items, camX - o, -o);
  drawEnemies(sc, g.enemies, camX - o, -o);
  drawPlayer(sc, g.player, camX - o, -o);
  // Particles sit UNDER the passes (a spark is a light source, not a highlight), and `fx.draw`
  // floors its own destinations and writes no state, so the shake still enters only through
  // the camera it is measured against.
  drawFx(sc, camX - o);
  // §7's fixed order: `drawLightmap` fills the ambient base AND gathers this frame's lights,
  // `buildBloom` reuses that gather (it must run after it, on the same `g`), and each `apply*`
  // is one upscaled blit back into the scene — `multiply` then `lighter`, no other op touches it.
  // Their blits target sceneW x sceneH DEVICE px, so the transform returns to identity first;
  // and they are the scene's only non-1:1 draws (the world passes are 1:1 under the HD
  // transform), so they are the only smoothed ones.
  sc.setTransform(1, 0, 0, 1, 0, 0);
  sc.imageSmoothingEnabled = true;
  drawLightmap(g, baked);
  applyLightmap(sc);
  buildBloom(g, baked);
  applyBloom(sc);
  // The scene → upscale → canvas chain lives in `main.js` now, at `k`, so `R45`'s draw-stream
  // comparisons read the `scene` recorder and the live context takes exactly one blit per frame.

  // HUD, banner and overlay draw on the scene AFTER the FX passes (R-4): the UI is never
  // multiplied, bloomed or shaken, and the HD transform gives its glyphs 4x device rasterization
  // — the retired `hud` layer's one remaining job was sharpness, and scene-resolution text beats
  // it. `ui` owns every string, panel and icon it lays out.
  sc.setTransform(HD, 0, 0, HD, 0, 0);
  if (g.state === 'PLAYING' || g.state === 'PAUSED' || g.state === 'LEVEL_CLEAR') hud(sc, g);
  if (g.state === 'PLAYING' && g.bannerT > 0) banner(sc, g);
  overlay(sc, g, Date.now());
  sc.setTransform(1, 0, 0, 1, 0, 0);
}
