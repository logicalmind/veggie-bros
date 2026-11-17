// tools/verify.mjs — headless regression harness for Veggie Bros.
//
// Stubs just enough DOM/canvas/audio to import and drive the REAL src/main.js
// (including its fixed-timestep loop), then exposes one named check per queue
// entry so `node tools/verify.mjs [R07 R08 ...]` proves a fix flipped FAIL -> PASS.
//
// Conventions (docs/REVIEW-2026-11-15.md §5):
//   - synthetic frame time starts at performance.now(), steps by exactly 1000/60
//   - window/document listeners are captured so checks can dispatch real events
//   - `export` was added to `const G` in src/main.js so loop checks can read state
//   - a check throws to FAIL; the runner catches it and prints one line per check

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

// ---------------------------------------------------------------------------
// check registry
// ---------------------------------------------------------------------------

const registry = [];
function check(id, fn) {
  registry.push({ id, fn });
}

class Fail extends Error {}
function assert(cond, why) {
  if (!cond) throw new Fail(why);
}
function eq(actual, expected, what) {
  if (!Object.is(actual, expected)) throw new Fail(`${what}: expected ${expected}, got ${actual}`);
}
function near(actual, expected, tol, what) {
  if (!(Math.abs(actual - expected) <= tol)) throw new Fail(`${what}: expected ${expected} +-${tol}, got ${actual}`);
}

// ---------------------------------------------------------------------------
// DOM / canvas / window stubs (§5 reference stub, extended)
// ---------------------------------------------------------------------------

let rafCb = null;
let rafSeq = 0;
// rAF is captured (not consumed) so a frame that throws cannot brick the harness:
// R26 asserts the throwing frame re-armed the loop itself, via rafSeq.
globalThis.requestAnimationFrame = (cb) => { rafCb = cb; rafSeq++; return rafSeq; };

// audio.js's music scheduler must be ticked by hand, never by a real timer.
let musicTick = null;
globalThis.setInterval = (fn) => { musicTick = fn; return 1; };
globalThis.clearInterval = () => { musicTick = null; };

const mkCtx = (rec) => new Proxy({}, {
  get(t, k) {
    if (k in t) return t[k];
    if (k === 'fillRect') return (x, y, w, h) => {
      if (!rec) return;
      const seq = rec.seq++;
      rec.rects.push([x, y, w, h, String(t.fillStyle), Number(t.globalAlpha), seq]);
      const color = String(t.fillStyle);
      if (rec.inkRects) {
        for (let px = Math.floor(x); px < Math.ceil(x + w); px++) {
          for (let py = Math.floor(y); py < Math.ceil(y + h); py++) rec.ink(px, py, color, seq);
        }
      }
    };
    if (k === 'fillText') return (s, x, y) => {
      if (!rec) return;
      const seq = rec.seq++;
      rec.text.push(String(s));
      if (!rec.glyphInk) return;
      const size = parseFloat(String(t.font)) || 24;
      const ink = size * 0.602; // §6: Menlo's 24px advance is 14.45px = 0.602 em
      const color = String(t.fillStyle);
      const bx = Number.isFinite(x) ? x : 0;
      const by = Number.isFinite(y) ? y : 0;
      for (let px = Math.ceil(bx); px < Math.floor(bx + ink); px++) {
        for (let py = Math.ceil(by + size * 0.1); py < Math.floor(by + size * 0.47); py++) rec.ink(px, py, color, seq);
      }
    };
    if (k === 'drawImage') return (img, sx, sy, sw, sh, dx, dy, dw, dh) => {
      if (!rec) return;
      const seq = rec.seq++;
      rec.blits.push({ sx, sy, sw, sh, dx, dy, dw, dh, seq });
      const src = img && img._rec;
      if (!src || !src.pixels) return;
      for (let j = 0; j < sh; j++) {
        for (let i = 0; i < sw; i++) {
          const srcKey = Math.floor(sx + i) + ',' + Math.floor(sy + j);
          const color = src.pixels.get(srcKey);
          if (color === undefined) continue;
          const u = Math.floor((i + 0.5) * (dw / sw));
          const v = Math.floor((j + 0.5) * (dh / sh));
          rec.ink(Math.floor(dx) + u, Math.floor(dy) + v, color, seq);
        }
      }
    };
    if (k === 'scale') return (sx, sy) => { if (rec) rec.scaleCalls.push([sx, sy]); };
    if (k === 'translate') return (tx, ty) => { if (rec) rec.translateCalls.push([tx, ty]); };
    if (k === 'measureText') return (s) => ({ width: String(s).length * 14.45 });
    return () => {};
  },
  set(t, k, v) { t[k] = v; return true; },
});

function mkRecorder() {
  const r = {
    rects: [], text: [], blits: [], pixels: new Map(), textInk: [], scaleCalls: [], translateCalls: [],
    seq: 0, glyphInk: true, inkRects: false,
    ink(x, y, color, seq) {
      const key = x + ',' + y;
      this.pixels.set(key, color);
      this.textInk.push({ x, y, color, seq });
    },
    reset() {
      this.rects.length = 0; this.text.length = 0; this.blits.length = 0;
      this.scaleCalls.length = 0; this.translateCalls.length = 0;
      this.pixels.clear(); this.textInk.length = 0; this.seq = 0;
    },
    rowsOf(x0, x1, y0, y1) {
      const rows = new Set();
      for (const key of this.pixels.keys()) {
        const [cx, cy] = key.split(',').map(Number);
        if (cx >= x0 && cx < x1 && cy >= y0 && cy < y1) rows.add(cy);
      }
      return [...rows].sort((a, b) => a - b);
    },
    colsOf(x0, x1, y0, y1) {
      return this.colsWhere(x0, x1, y0, y1, () => true);
    },
    colsWhere(x0, x1, y0, y1, ok) {
      const cols = new Set();
      for (const [key, color] of this.pixels) {
        if (!ok(color)) continue;
        const [cx, cy] = key.split(',').map(Number);
        if (cx >= x0 && cx < x1 && cy >= y0 && cy < y1) cols.add(cx);
      }
      return [...cols].sort((a, b) => a - b);
    },
    rowsWhere(x0, x1, y0, y1, ok) {
      const rows = new Set();
      for (const [key, color] of this.pixels) {
        if (!ok(color)) continue;
        const [cx, cy] = key.split(',').map(Number);
        if (cx >= x0 && cx < x1 && cy >= y0 && cy < y1) rows.add(cy);
      }
      return [...rows].sort((a, b) => a - b);
    },
  };
  return r;
}

const rec = mkRecorder();
const els = new Map();
const docL = {};
const winL = {};

const dispatchErrors = [];
function mkEl(id) {
  const l = {};
  const el = {
    id, style: {}, width: 0, height: 0, _l: l,
    addEventListener: (t, f) => { (l[t] ||= []).push(f); },
    removeEventListener() {},
    getContext: () => mkCtx(el._rec || null),
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 56, height: 56 }),
    blur() {}, focus() {},
  };
  el.dispatch = (type, ev) => {
    for (const f of (l[type] || [])) {
      try { f(Object.assign({ type, target: el, preventDefault() {}, stopPropagation() {} }, ev)); }
      catch (err) { dispatchErrors.push(`#${id} ${type}: ${err.message}`); }
    }
    return (l[type] || []).length;
  };
  el.click = () => el.dispatch('click');
  return el;
}
// #game's context is created ONCE here and handed to main.js at import time, so
// every frame of the real loop records into the shared `rec` (§5 gotcha 6).
const gameCtx = mkCtx(rec);
const gameEl = mkEl('game');
gameEl.getContext = () => gameCtx;
els.set('game', gameEl);

function mkOffscreen() {
  const el = mkEl('offscreen');
  el._rec = mkRecorder();
  return el;
}

let createElementCount = 0;
globalThis.document = {
  getElementById: (id) => { if (!els.has(id)) els.set(id, mkEl(id)); return els.get(id); },
  createElement: () => { createElementCount++; return mkOffscreen(); },
  addEventListener: (t, f) => { (docL[t] ||= []).push(f); },
  removeEventListener() {},
  hidden: false,
};

// matchMedia: query results are harness-controlled and `change`-able (R15).
const mediaState = { pointer: 'fine', anyPointer: 'fine' };
const mediaQueries = new Map();
function mediaMatches(q) {
  if (q.includes('any-pointer')) return mediaState.anyPointer === 'coarse';
  if (q.includes('pointer')) return mediaState.pointer === 'coarse';
  return false;
}
globalThis.matchMedia = (q) => {
  if (!mediaQueries.has(q)) {
    const mql = {
      media: q, _l: {},
      get matches() { return mediaMatches(q); },
      addEventListener: (t, f) => { (mql._l[t] ||= []).push(f); },
      removeEventListener() {},
      addListener: (f) => { (mql._l.change ||= []).push(f); },
    };
    mediaQueries.set(q, mql);
  }
  return mediaQueries.get(q);
};
function setPointer(next) {
  Object.assign(mediaState, next);
  const q = '(any-pointer: coarse)';
  if (mediaQueries.has(q)) for (const f of (mediaQueries.get(q)._l.change || [])) f({ matches: mediaMatches(q) });
}

function listenerCount(target, type) { return ((target === 'window' ? winL : docL)[type] || []).length; }
function dispatch(target, type, ev) {
  const map = target === 'window' ? winL : docL;
  for (const f of (map[type] || [])) f(Object.assign({ type, preventDefault() {}, stopPropagation() {} }, ev));
  return (map[type] || []).length;
}
function keyEvent(k, code, mods = {}) {
  return Object.assign({ key: k, code: code || '', repeat: false, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false }, mods);
}
function key(k, code, mods) { return dispatch('window', 'keydown', keyEvent(k, code, mods)); }
function keyUp(k, code, mods) { return dispatch('window', 'keyup', keyEvent(k, code, mods)); }

// console.error capture (R26)
const consoleLog = [];
const realConsoleError = console.error;
console.error = (...args) => { consoleLog.push(args.map(String).join(' ')); };

globalThis.window = {
  addEventListener: (t, f) => { (winL[t] ||= []).push(f); },
  removeEventListener() {},
  matchMedia: (q) => globalThis.matchMedia(q),
};
globalThis.innerWidth = 1280;
globalThis.innerHeight = 800;

// ---------------------------------------------------------------------------
// imports — order matters: pure modules, audio singleton (spied), then main
// ---------------------------------------------------------------------------

const C = await import('../src/config.js');
const { LEVELS } = await import('../src/levels.js');
const { parseLevel, isSolid } = await import('../src/level.js');
const { hurtPlayer, killPlayer, makePlayer, updatePlayer } = await import('../src/player.js');
const { makeBoss, makeTurnip, updateBoss, updateTurnip } = await import('../src/enemy.js');
const { makeBerry, makeFruit, makePopup, updateItems } = await import('../src/items.js');
const { CAMERA_FOLLOW_X, updateCamera } = await import('../src/camera.js');
const spritesModule = await import('../src/sprites.js');
const { drawBerry, drawBoss, drawHero, drawPixelText, drawTurnip } = spritesModule;
// R45 renders whole scenes into a mock context to prove nothing is drawn at a checkpoint.
const { render: renderScene } = await import('../src/render.js');
const { audio } = await import('../src/audio.js');
const inputMod = await import('../src/input.js');
const { input, setupTouch } = inputMod;

// audio spy: same singleton main.js calls as methods.
const audioCalls = [];
for (const name of ['init', 'sfx', 'musicStart', 'musicStop', 'toggleMute']) {
  const orig = audio[name].bind(audio);
  audio[name] = (...a) => { audioCalls.push(name === 'sfx' ? 'sfx:' + a[0] : name); return orig(...a); };
}
const resetAudioSpy = () => { audioCalls.length = 0; };
const sfx = (name) => audioCalls.filter((c) => c === 'sfx:' + name).length;

const { G } = await import('../src/main.js');

// ---------------------------------------------------------------------------
// frame driver
// ---------------------------------------------------------------------------

let t = performance.now();
let frameError = null;
let lastFrameRescheduled = false;
const stepMs = 1000 / 60;
function step() {
  const cb = rafCb;
  if (!cb) throw new Fail('the rAF loop never started (main.js never called requestAnimationFrame)');
  const seqBefore = rafSeq;
  t += stepMs;
  frameError = null;
  rec.reset();   // keep the recorder to the current frame: checks read it after step()
  try {
    cb(t);
  } catch (err) {
    frameError = err;
  }
  lastFrameRescheduled = rafSeq > seqBefore;
  return frameError;
}
function steps(n) {
  for (let i = 0; i < n; i++) step();
}

function clearInput() {
  for (const k of ['left', 'right', 'run', 'jump', 'jumpPressed', 'start', 'pausePressed', 'mutePressed', 'restartPressed']) {
    input[k] = false;
  }
}
function resetInput() {
  if (typeof inputMod.resetInput === 'function') inputMod.resetInput();
  else clearInput();
}
const held = () => ['left', 'right', 'run', 'jump'];
const oneShots = () => ['jumpPressed', 'start', 'pausePressed', 'mutePressed', 'restartPressed'];
const heldFlags = () => held().map((k) => [k, !!input[k]]);

function toTitle() {
  clearInput();
  G.state = 'TITLE';
  G.level = null;
  G.player = null;
  G.enemies = [];
  G.items = [];
  G.cam = { x: 0 };
  G.clearT = 0;
  G.bannerT = 0;
  G.dyingT = 0;
  G.winT = 0;
  G.overT = 0;
  G.gateScored = false;
  G.checkpointX = 0;
  G.checkpointIndex = -1;
  G.levelIndex = 0;
  // The HUD's MUTED badge is part of the frame the pixel checks count, so it belongs to the reset.
  // Without it R24 (which sets `G.muted = true` to measure the worst-case HUD layout) leaks the badge
  // into every check that runs after it: measured 2026-11-17, `R19`'s pass line printed `draw #1153 vs
  // #1154` in canonical order and `#1208 vs #1209` in a shuffled run, and `R45`'s printed rect count
  // moved 1425 → 1370, the 55-rect difference being exactly one 5-character `drawPixelText` run. Both
  // assertions are RELATIVE, so they passed in every order — but their published figures were not
  // reproducible, which is what the WORKFLOW_STATE write-up claimed. Reset here and both are.
  G.muted = false;
  audio.musicStop();
  clearInput();
}
function newGame() {
  toTitle();
  input.start = true;
  step();
  if (G.state !== 'PLAYING') throw new Fail(`could not start a game (state=${G.state}${frameError ? ', ' + frameError.message : ''})`);
}

// ---------------------------------------------------------------------------
// synthetic levels + geometry helpers
// ---------------------------------------------------------------------------

function emptyMap(cols) {
  return Array.from({ length: C.ROWS }, () => new Array(cols).fill('.'));
}
function toDef(rows, label = 'test') {
  return { label, name: 'Synthetic', map: rows.map((r) => r.join('')) };
}
function put(grid, ch, ty, tx) {
  if (ty >= 0 && ty < C.ROWS && tx >= 0 && tx < grid[0].length) grid[ty][tx] = ch;
}
function fillRow(grid, ty, ch, tx0 = 0, tx1 = grid[0].length) {
  for (let tx = tx0; tx < tx1; tx++) grid[ty][tx] = ch;
}
function groundRows(grid, tx0 = 0, tx1 = grid[0].length, ch = 'X') {
  fillRow(grid, C.ROWS - 2, ch, tx0, tx1);
  fillRow(grid, C.ROWS - 1, ch, tx0, tx1);
}
function synth(def) {
  return parseLevel(def);
}
function installLevel(level, opts = {}) {
  G.level = level;
  G.enemies = level.enemies.map(makeTurnip);
  if (level.boss) G.enemies.push(makeBoss(level.boss));
  G.items = level.fruits.map((f) => makeFruit(f.x, f.y));
  G.player = makePlayer(level.playerSpawn.x, level.playerSpawn.y);
  if (opts.player) G.player = opts.player;
  G.cam = { x: opts.camX || 0 };
  G.bannerT = 0;
  G.gateScored = false;
  // Checkpoint state is per-level too: an installed level starts unbounded, and a level object
  // installed twice must not carry the flags banked by the first install.
  G.checkpointX = 0;
  G.checkpointIndex = -1;
  for (const cp of level.checkpoints) cp.taken = false;
  G.dyingT = 0;
  G.clearT = 0;
  G.state = 'PLAYING';
  return G.player;
}

// A flat ground level (rows 13-14 solid), big enough for contact sweeps.
// parseLevel demands a G-or-F, so a far-right gate is added unless `gate: false`.
function flatLevel({ cols = 40, turnip = null, boss = null, gate = [C.ROWS - 3, 38], pits = [], spawn = [C.ROWS - 3, 2] } = {}) {
  const grid = emptyMap(cols);
  groundRows(grid);
  for (const [a, b] of pits) for (let tx = a; tx < b; tx++) { grid[C.ROWS - 2][tx] = '.'; grid[C.ROWS - 1][tx] = '.'; }
  put(grid, 'H', spawn[0], spawn[1]);
  if (turnip) put(grid, 'T', turnip[0], turnip[1]);
  if (boss) put(grid, 'F', boss[0], boss[1]);
  if (gate) put(grid, 'G', gate[0], gate[1]);
  return synth(toDef(grid, 'flat'));
}

// A flat run carrying one flagpost, for the checkpoint checks: nothing else in the level bounds
// the hero on the left, so whatever stops it is the checkpoint itself.
function flagLevel({ cols = 120, flag = [C.ROWS - 3, 40], gate = [C.ROWS - 3, 118] } = {}) {
  const grid = emptyMap(cols);
  groundRows(grid);
  put(grid, 'H', C.ROWS - 3, 2);
  put(grid, 'K', flag[0], flag[1]);
  if (gate) put(grid, 'G', gate[0], gate[1]);
  return synth(toDef(grid, 'flag'));
}

function mkInput(over = {}) {
  return Object.assign({ left: false, right: false, run: false, jump: false, jumpPressed: false }, over);
}
function bigPlayer(p) {
  p.big = true;
  p.h = C.PLAYER_BIG_H;
  p.y -= C.PLAYER_BIG_H - C.PLAYER_SMALL_H;
  return p;
}

const GROUND_TOP = (C.ROWS - 2) * C.TILE; // 208 — standing surface of the shipped ground

// Would a grounded hero of height `h` fit at x on the shipped standing surface — box clear of
// solids and solid tile under its feet?
function heroFits(level, x, h = C.PLAYER_SMALL_H) {
  if (x < 0 || x + C.PLAYER_W > level.widthPx) return false;
  const y = GROUND_TOP - h;
  for (let ty = Math.floor(y / C.TILE); ty <= Math.floor((y + h - 0.001) / C.TILE); ty++) {
    for (let tx = Math.floor(x / C.TILE); tx <= Math.floor((x + C.PLAYER_W - 0.001) / C.TILE); tx++) {
      if (isSolid(level.tiles[ty][tx])) return false;
    }
  }
  const foot = Math.floor((x + C.PLAYER_W / 2) / C.TILE);
  return isSolid(level.tiles[C.ROWS - 2][foot]);
}

// The FARTHEST x walking in direction `dir` from `fromX` that still passes heroFits(), stopping at
// the first wall, block or pit — or null if `fromX` itself is not standable. Shipped maps put
// pipes and bonus blocks right beside flagposts, so a scenario that runs on real maps has to find
// its own footing instead of assuming one, and a teleport may never hop over an obstacle it could
// only ever walk past.
function walkableFar(level, fromX, dir, h = C.PLAYER_SMALL_H) {
  if (!heroFits(level, fromX, h)) return null;
  let far = fromX;
  for (let i = 1; i <= 24; i++) {
    const x = fromX + dir * i * 8;
    if (!heroFits(level, x, h)) break;
    far = x;
  }
  return far;
}

// ---------------------------------------------------------------------------
// canvas / element observation helpers
// ---------------------------------------------------------------------------

function setGameCanvas() {
  const game = els.get('game');
  if (!game) throw new Fail('#game element is missing — main.js never ran');
  return rec;
}
function gameCanvasW() {
  const game = els.get('game');
  if (!game) throw new Fail('#game element is missing');
  return parseFloat(String(game.style.width));
}

// Runs the loop until `watch` returns a truthy payload, or n frames pass.
function until(n, watch) {
  for (let i = 0; i < n; i++) {
    step();
    const hit = watch(i);
    if (hit) return { at: i, ...hit };
  }
  return null;
}

// ---------------------------------------------------------------------------
// level metrics (corrected standing-surface metric — RESUME.md:45)
// ---------------------------------------------------------------------------

const LEGEND = ['.', 'X', 'S', 'B', 'P', 'Q', 'U', '=', '|', 'H', 'T', 'F', 'C', 'G', 'K'];

// surfaceAt[tx] = row of the lowest solid tile with a non-solid tile above it
// (the surface the player stands ON). null => no standing surface: a gap, or a
// fully-solid boundary wall. Measuring the *bottom* of the 2-row ground instead
// is what produced the false "5-tile rise" the old checker reported.
function levelMeta(def) {
  const rows = def.map;
  const cols = rows[0].length;
  const wall = [];
  for (let tx = 0; tx < cols; tx++) {
    let solid = 0;
    for (let ty = 0; ty < C.ROWS; ty++) if (isSolid(rows[ty][tx])) solid++;
    wall[tx] = solid === C.ROWS;
  }
  const surfaceAt = [];
  for (let tx = 0; tx < cols; tx++) {
    // A fully-solid column is a boundary wall: it has no standing surface, and
    // it is not a gap either (RESUME.md:45 — the corrected checker).
    if (wall[tx]) { surfaceAt[tx] = null; continue; }
    let found = null;
    for (let ty = C.ROWS - 1; ty >= 0; ty--) {
      if (!isSolid(rows[ty][tx])) continue;
      const above = ty > 0 ? rows[ty - 1][tx] : '.';
      if (!isSolid(above)) { found = ty; break; }
    }
    surfaceAt[tx] = found;
  }
  const gapCols = [];
  let run = null;
  for (let tx = 0; tx < cols; tx++) {
    if (surfaceAt[tx] === null && !wall[tx]) {
      run = run || { from: tx, to: tx };
      run.to = tx;
    } else if (run) {
      gapCols.push(run);
      run = null;
    }
  }
  if (run) gapCols.push(run);
  for (const g of gapCols) {
    g.leftSurface = g.from > 0 ? surfaceAt[g.from - 1] : null;
    g.rightSurface = g.to + 1 < cols ? surfaceAt[g.to + 1] : null;
    g.cols = g.to - g.from + 1;
  }
  const rises = [];
  for (let tx = 1; tx < cols; tx++) {
    const a = surfaceAt[tx - 1];
    const b = surfaceAt[tx];
    if (a === null || b === null) continue;
    if (a > b) rises.push({ at: tx, from: a, to: b, tiles: a - b });
  }
  const walls = [];
  for (let tx = 0; tx < cols; tx++) if (wall[tx]) walls.push(tx);
  return { rows, cols, surfaceAt, wall, gapCols, rises, walls };
}

function countChar(def, test) {
  let n = 0;
  for (const row of def.map) for (const ch of row) if (test(ch)) n++;
  return n;
}

// ---------------------------------------------------------------------------
// SMOKE — shipped map data hygiene + standing-surface gap/rise metric
// ---------------------------------------------------------------------------

check('SMOKE', () => {
  const notes = [];
  for (const def of LEVELS) {
    const L = def.label;
    assert(def.map.length === C.ROWS, `${L}: ${def.map.length} rows, expected ${C.ROWS}`);
    const cols = def.map[0].length;
    for (let ty = 0; ty < def.map.length; ty++) {
      assert(def.map[ty].length === cols, `${L}: row ${ty} has length ${def.map[ty].length}, expected ${cols}`);
    }
    eq(countChar(def, (c) => c === 'H'), 1, `${L}: H count`);
    eq(countChar(def, (c) => c === 'G' || c === 'F'), 1, `${L}: G-or-F count`);
    for (let ty = 0; ty < def.map.length; ty++) {
      assert(def.map[ty][cols - 1] !== '.', `${L}: rightmost column is '.' at row ${ty}`);
    }
    for (let ty = 0; ty < def.map.length; ty++) {
      for (let tx = 0; tx < cols; tx++) {
        assert(LEGEND.includes(def.map[ty][tx]), `${L}: character '${def.map[ty][tx]}' outside the legend at ${ty},${tx}`);
      }
    }
    const meta = levelMeta(def);
    assert(meta.surfaceAt.some((s) => s !== null), `${L}: no standing surface anywhere`);
    for (const g of meta.gapCols) {
      assert(g.cols <= 4, `${L}: ${g.cols}-column gap at cols ${g.from}-${g.to} exceeds the 4-column threshold`);
    }
    for (const r of meta.rises) {
      assert(r.tiles <= 4, `${L}: ${r.tiles}-tile rise at col ${r.at} (row ${r.from} -> ${r.to}) exceeds the 4-tile threshold`);
    }
    const maxGap = Math.max(0, ...meta.gapCols.map((g) => g.cols));
    const maxRise = Math.max(0, ...meta.rises.map((r) => r.tiles));
    notes.push(`${L}: ${cols}c gap<=${maxGap} rise<=${maxRise} walls=${meta.walls.length}`);
  }
  return `3 levels clean (${notes.join(', ')})`;
});

// ---------------------------------------------------------------------------
// R01 — pits cannot kill you
// ---------------------------------------------------------------------------

check('R01', () => {
  const meta = levelMeta(LEVELS[0]);
  const pit = meta.gapCols.find((g) => g.cols >= 2) || meta.gapCols[0];
  assert(pit, 'no pit found in 1-1');
  const cx = Math.floor((pit.from + pit.to) / 2);
  const seen = [];
  for (const big of [false, true]) {
    const who = big ? 'big' : 'small';
    newGame();
    const p = G.player;
    if (big) bigPlayer(p);
    p.x = cx * C.TILE + 2;
    p.y = GROUND_TOP - p.h;
    p.vx = 0;
    p.vy = 0;
    p.onGround = true;
    clearInput();
    const hit = until(30, () => {
      if (p.dead) return { dead: true };
      if (p.onGround && p.y + p.h > GROUND_TOP) return { rest: p.y };
      return null;
    });
    if (!hit) return seen.concat(`${who} player over pit col ${cx}: neither dead nor at rest after 30 steps`).join('; ');
    if (hit.rest !== undefined) seen.push(`${who}@col${cx}: rests at y=${hit.rest} (feet ${(hit.rest + p.h).toFixed(0)}) and is not dead — phantom pit floor`);
    else if (!p.deadPit) seen.push(`${who}@col${cx}: dead but deadPit=false`);
    else seen.push(`${who}@col${cx}: ok`);
  }
  // no false positives: standing on real ground for 300 steps
  newGame();
  const p = G.player;
  clearInput();
  steps(300);
  if (p.dead) seen.push(`standing on normal ground for 300 steps killed the player (false positive)`);
  else seen.push(`300 steps on ground: alive, y=${p.y.toFixed(2)}`);
  const bad = seen.filter((s) => !s.includes(': ok') && !s.includes('alive'));
  assert(bad.length === 0, bad[0]);
  return `pit col ${cx} kills small+big; ${seen[seen.length - 1]}`;
});

// ---------------------------------------------------------------------------
// R02 — a legal boss stomp damages you
// ---------------------------------------------------------------------------

function contactLevel(kind) {
  const col = 12;
  return kind === 'boss'
    ? flatLevel({ boss: [C.ROWS - 3, col], gate: false })
    : flatLevel({ turnip: [C.ROWS - 3, col] });
}

// Drops the player onto a stationary target and records how the contact resolved.
// dx = lateral start offset from "directly above"; the player walks toward the
// target, at RUN_MAX when `run` is set. `enemyVx` gives the target a patrol speed.
function dropOnto(level, opts = {}) {
  const { drop = 0, dx = 0, enemyVx = 0, frames = 40, big = false, run = false } = opts;
  clearInput();
  installLevel(level);
  const target = G.enemies[0];
  target.vx = enemyVx;
  const p = G.player;
  if (big) bigPlayer(p);
  p.x = target.x + target.w / 2 - p.w / 2 + dx;
  p.y = target.y - p.h - drop;
  p.vx = 0;
  p.vy = 0;
  if (dx < 0) input.right = true;
  else if (dx > 0) input.left = true;
  input.run = run;
  resetAudioSpy();
  const log = [];
  let prevHp = target.hp;
  let squashed = false;
  let resolvedAt = -1;
  for (let f = 0; f < frames; f++) {
    const prevBottom = p.y + p.h;
    const hurt0 = sfx('hurt');
    step();
    const ev = { f, prevBottom, stomps: 0, hurts: sfx('hurt') - hurt0 };
    if (target.type === 'boss') {
      if (target.hp < prevHp) ev.stomps = 1;
      prevHp = target.hp;
    } else if (!squashed && target.squashed) {
      squashed = true;
      ev.stomps = 1;
    }
    log.push(ev);
    if (p.dead) break;
    if (resolvedAt < 0 && (ev.stomps || ev.hurts)) resolvedAt = f;
    // stop shortly after the first resolution: the stomp bounce returns to the
    // target around frame 10 and a second legal stomp is not what we are counting
    if (resolvedAt >= 0 && f >= resolvedAt + 6) break;
  }
  return { p, target, log };
}

check('R02', () => {
  const bad = [];
  let resolved = 0;
  let tested = 0;
  for (let d = 0; d <= 24.0001; d += 0.5) {
    tested++;
    const { target, log } = dropOnto(contactLevel('boss'), { drop: d });
    const stomps = log.filter((e) => e.stomps > 0);
    const hurts = log.filter((e) => e.hurts > 0);
    if (stomps.length + hurts.length === 0) { bad.push(`drop ${d}px: contact never resolved`); continue; }
    // every 0-24px drop onto the boss top is a legal over-the-top landing: it must
    // resolve as a stomp, not a hurt (guards a degenerate hurt-everything "fix")
    if (stomps.length === 0) bad.push(`drop ${d}px: contact resolved as hurt, expected a legal stomp`);
    resolved++;
    for (const s of stomps) {
      const soon = hurts.filter((h) => h.f > s.f && h.f <= s.f + 5);
      if (soon.length) bad.push(`drop ${d}px: hurtPlayer fired ${soon[0].f - s.f} frame(s) after a legal stomp on the boss`);
    }
    if (stomps.length && hurts.length) bad.push(`drop ${d}px: stomped AND hurt (double resolution)`);
    if (stomps.length > 1 || hurts.length > 1) bad.push(`drop ${d}px: resolved ${stomps.length} stomp(s)/${hurts.length} hurt(s), expected exactly one`);
    if (bad.length >= 3) break;
  }
  assert(bad.length === 0, bad[0]);
  assert(resolved === tested, `only ${resolved}/${tested} drops resolved the contact`);
  return `${tested} drop heights 0-24px: every landing resolves exactly once, zero hurts after a stomp`;
});

// ---------------------------------------------------------------------------
// R03 — walking into an enemy's flank counts as a stomp
// ---------------------------------------------------------------------------

check('R03', () => {
  let lateral = 0;
  let legit = 0;
  let hurtOnly = 0;
  let unresolved = 0;
  let total = 0;
  let firstBad = null;
  for (const enemyVx of [-C.ENEMY_SPEED, C.ENEMY_SPEED]) {
    for (let oi = 0; oi < 15; oi++) {
      const dx = -21 + oi * 3;
      for (let di = 0; di < 12; di++) {
        const drop = di * 2;
        for (const run of [false, true]) {
          total++;
          const { target, log } = dropOnto(contactLevel('turnip'), { drop, dx, enemyVx, run, frames: 40 });
          const stomp = log.find((e) => e.stomps > 0);
          const hurt = log.find((e) => e.hurts > 0);
          if (stomp) {
            if (stomp.prevBottom > target.y + 0.5) {
              lateral++;
              if (!firstBad) {
                firstBad = `dx=${dx} drop=${drop} run=${run}: squashed the turnip with the feet at `
                  + `${stomp.prevBottom.toFixed(2)} vs enemy top ${target.y} (lateral contact, not over-the-top)`;
              }
            } else legit++;
          } else if (hurt) hurtOnly++;
          else unresolved++;
        }
      }
    }
  }
  assert(total === 720, `sweep is ${total} approaches, expected 720`);
  assert(lateral === 0, `${lateral}/${total} approaches scored a FALSE lateral stomp — first: ${firstBad}`);
  const badDrops = [];
  for (let d = 0; d <= 24.0001; d += 0.5) {
    const { log } = dropOnto(contactLevel('turnip'), { drop: d });
    if (!log.some((e) => e.stomps > 0)) badDrops.push(d);
  }
  assert(badDrops.length === 0, `genuine over-the-top stomps stopped working at drop heights ${badDrops.join(', ')}px`);
  return `${total} approaches: 0 lateral squashes, ${legit} legit stomps, ${hurtOnly} hurts, ${unresolved} no-contact; 0-24px drops all stomp`;
});

// ---------------------------------------------------------------------------
// R04 — dying on the gate is a free stage clear
// ---------------------------------------------------------------------------

check('R04', () => {
  const level = flatLevel({ gate: [C.ROWS - 3, 20], turnip: [C.ROWS - 3, 21] });
  newGame();
  // camX = steady-state camera for the player's start x (332-96): the turnip at x=338
  // must be ACTIVE on frame 1, else the gate legitimately fires while the player is
  // still alive (turnip activation needs e.x < camX + VIEW_W + 32) and the scenario
  // tests nothing (found by the R04 worker; see §11)
  installLevel(level, { camX: 236 });
  const p = G.player;
  const lives0 = G.lives;
  p.x = 20 * C.TILE + 12;
  p.y = GROUND_TOP - p.h;
  p.vx = 0;
  p.vy = 0;
  clearInput();
  const gate = G.level.gate;
  until(20, () => (p.dead || G.state !== 'PLAYING' ? { done: true } : null));
  assert(G.state === 'PLAYING', `contact with a lethal turnip inside the gate rect (${gate.x},${gate.y}) left state=${G.state} (expected PLAYING with p.dead=true)`);
  assert(p.dead === true, `expected p.dead=true after the collision, got ${p.dead}`);
  steps(80);
  assert(G.lives < lives0, `lives did not decrement after the death animation (${lives0} -> ${G.lives})`);
  return `death on the gate stays PLAYING+dead, lives ${lives0} -> ${G.lives}`;
});

// ---------------------------------------------------------------------------
// R05 — one-shot input flags leak across game states
// ---------------------------------------------------------------------------

const R05_STATES = {
  TITLE: { acts: ['start'] },
  PLAYING: { acts: ['jumpPressed', 'pausePressed', 'mutePressed'] },
  PAUSED: { acts: ['pausePressed', 'restartPressed', 'mutePressed'] },
  DYING: { acts: ['jumpPressed', 'mutePressed'] },
};

function enterState(name) {
  if (name === 'TITLE') { toTitle(); return; }
  newGame();
  if (name === 'PLAYING') return;
  if (name === 'PAUSED') {
    input.pausePressed = true;
    step();
    if (G.state !== 'PAUSED') throw new Fail(`could not reach PAUSED (state=${G.state})`);
    clearInput();
    return;
  }
  killPlayer(G.player, false);
  G.dyingT = 0.4;
}

check('R05', () => {
  const leaks = [];
  const acts = [];
  for (const [state, spec] of Object.entries(R05_STATES)) {
    for (const flag of oneShots()) {
      enterState(state);
      const wantState = G.state;
      const wantIndex = G.levelIndex;
      const wantLevel = G.level;
      clearInput();
      resetAudioSpy();
      input[flag] = true;
      step();
      if (input[flag] !== false) leaks.push(`${state}: ${flag} survived a frame`);
      if (spec.acts.includes(flag)) continue;
      if (G.state !== wantState) acts.push(`${state}: ${flag} changed state to ${G.state}`);
      if (G.levelIndex !== wantIndex || G.level !== wantLevel) acts.push(`${state}: ${flag} reloaded the level`);
      if (sfx('jump') > 0) acts.push(`${state}: ${flag} fired sfx:jump`);
      if (audioCalls.includes('musicStart')) acts.push(`${state}: ${flag} started music`);
    }
  }
  // the recorded symptom: jump pressed while paused fires on the resume frame
  enterState('PAUSED');
  clearInput();
  input.jumpPressed = true;
  step();
  resetAudioSpy();
  input.pausePressed = true;
  step();
  step();
  if (sfx('jump') > 0) acts.push('PAUSED: a jump pressed while paused fired sfx:jump on the resume frame');
  const bad = leaks.concat(acts);
  assert(bad.length === 0, `${bad.length} stale-flag violation(s): ${bad.slice(0, 3).join(' | ')}`);
  return `${Object.keys(R05_STATES).length} states x ${oneShots().length} flags: every one-shot consumed or cleared, no side effects`;
});

// ---------------------------------------------------------------------------
// R06 — window blur latches keys
// ---------------------------------------------------------------------------

check('R06', () => {
  newGame();
  clearInput();
  input.right = true;
  input.run = true;
  input.jump = true;
  step();
  document.hidden = true;
  dispatch('window', 'blur');
  dispatch('document', 'visibilitychange');
  document.hidden = false;
  step();
  const stuck = heldFlags().filter(([, v]) => v).map(([k]) => k);
  assert(stuck.length === 0, `held flags still set one frame after window blur + visibilitychange: ${stuck.join(',')}`);
  resetAudioSpy();
  clearInput();
  key(' ', 'Space');
  step();
  assert(G.player.vy < 0 || sfx('jump') > 0, 'no jump after a blur — a latched input.jump suppresses jumpPressed');
  clearInput();
  return 'blur/visibilitychange clears all four held flags; jump still works afterwards';
});

// ---------------------------------------------------------------------------
// R07 — audio drift, suspended context, mute-before-init
// ---------------------------------------------------------------------------

function fakeParam() {
  return {
    value: 0,
    setValueAtTime(v) { this.value = v; return this; },
    linearRampToValueAtTime(v) { this.value = v; return this; },
    exponentialRampToValueAtTime(v) { this.value = v; return this; },
    cancelScheduledValues() { return this; },
  };
}

let lastFakeCtx = null;
class FakeAudioContext {
  constructor() {
    lastFakeCtx = this;
    this.state = 'suspended';
    this.currentTime = 0;
    this.sampleRate = 44100;
    this.tones = [];
    this.resumeCalls = 0;
    this.gains = [];
    this.destination = { connect() {}, disconnect() {} };
  }
  resume() { this.resumeCalls++; return Promise.resolve(); }
  createGain() {
    const g = { gain: fakeParam(), connect() {}, disconnect() {} };
    this.gains.push(g);
    return g;
  }
  createOscillator() {
    const ctx = this;
    return {
      type: 'square',
      frequency: fakeParam(),
      connect() {},
      disconnect() {},
      start(t0) { ctx.tones.push(t0); },
      stop() {},
    };
  }
  createBiquadFilter() { return { type: 'lowpass', frequency: fakeParam(), connect() {}, disconnect() {} }; }
  createBuffer(_ch, len) { return { getChannelData: () => new Float32Array(len) }; }
  createBufferSource() {
    const ctx = this;
    return { buffer: null, connect() {}, disconnect() {}, start(t0) { ctx.tones.push(t0); }, stop() {} };
  }
}

check('R07', () => {
  const notes = [];
  const EIGHTH = 60 / 132 / 2;
  try {
    globalThis.AudioContext = FakeAudioContext;
    // (c) mute before init, then init must honour it
    audio.musicStop();
    assert(audio.muted === false, 'precondition: audio starts unmuted');
    audio.toggleMute();
    assert(audio.muted === true, 'toggleMute() before init() is a silent no-op (audio.muted still false)');
    notes.push('mute-before-init sticks');
    audio.init();
    assert(lastFakeCtx !== null, 'init() did not construct an AudioContext');
    assert(lastFakeCtx.resumeCalls >= 1, 'init() never calls ctx.resume() when ctx.state === "suspended"');
    const masterGain = lastFakeCtx.gains[0];
    assert(masterGain, 'init() created no master gain node');
    assert(masterGain.gain.value === 0, `the master gain created by init() is ${masterGain.gain.value}, expected 0 while muted`);
    notes.push('suspended ctx resumed');
    notes.push(`init() honours muted (gain ${masterGain.gain.value})`);
    audio.musicStart();
    assert(musicTick !== null, 'musicStart() did not install the scheduler tick');
    notes.push(`musicStart() resume calls=${lastFakeCtx.resumeCalls}`);
    // (a) scheduler drift: one starved tick must not schedule notes in the past
    lastFakeCtx.currentTime = 10;
    musicTick();
    assert(lastFakeCtx.tones.length > 0, 'the scheduler tick scheduled nothing — the fake clock or the tick is wrong');
    lastFakeCtx.currentTime = 12.1;   // tab backgrounded: the 30 ms interval was starved 2.1 s
    lastFakeCtx.tones.length = 0;
    musicTick();
    const past = lastFakeCtx.tones.filter((x) => x < lastFakeCtx.currentTime - 1e-9);
    const earliest = past.length ? Math.min(...past) : 0;
    assert(past.length === 0, `one starved tick scheduled ${past.length} note(s) at t0 < currentTime (earliest ${earliest.toFixed(3)} vs now ${lastFakeCtx.currentTime})`);
    const latest = Math.max(...lastFakeCtx.tones);
    assert(latest <= lastFakeCtx.currentTime + 0.12 + EIGHTH + 1e-6,
      `musicNextTime did not resync: the last tone is ${(latest - lastFakeCtx.currentTime).toFixed(3)}s ahead, expected within one lookahead window`);
    notes.push('drifted scheduler resyncs');
  } finally {
    audio.musicStop();
    delete globalThis.AudioContext;
    clearInput();
  }
  return notes.join('; ');
});

// ---------------------------------------------------------------------------
// R08 — the gate trigger covers only the bottom 16 px of the gate
// ---------------------------------------------------------------------------

check('R08', () => {
  const level = flatLevel({ gate: [C.ROWS - 3, 30] });
  const gate = level.gate;
  const at = (x, y, big) => {
    newGame();
    installLevel(level);
    const p = G.player;
    if (big) bigPlayer(p);
    p.x = x;
    p.y = y;
    p.vx = 0;
    p.vy = 0;
    clearInput();
    step();
    return G.state;
  };
  const arch = at(gate.x + 8, gate.y - 40, true);
  assert(arch === 'LEVEL_CLEAR', `a big player in the arch (x=${gate.x + 8}, y=${gate.y - 40}, rows ${gate.y - 64}..${gate.y}) left state=${arch}, expected LEVEL_CLEAR`);
  const left = at(gate.x - 32, GROUND_TOP - C.PLAYER_SMALL_H, false);
  assert(left === 'PLAYING', `standing on the ground 2 tiles left of the gate gave state=${left}, expected PLAYING`);
  const below = at(gate.x + 8, gate.y + 40, false);
  assert(below === 'PLAYING', `a player at gate.y+40 (below the floor) gave state=${below}, expected PLAYING`);
  return 'arch rows clear the stage; 2 tiles left and gate.y+40 do not';
});

// ---------------------------------------------------------------------------
// R09 — boss speed: hard-coded 60 overrides BOSS_SPEED
// ---------------------------------------------------------------------------

const HOP_SPEED = C.BOSS_HOP_VX ?? C.BOSS_SPEED;

function settledBoss() {
  const level = flatLevel({ boss: [C.ROWS - 3, 12], gate: false });
  const b = makeBoss(level.boss);
  const p = { x: b.x + 20, y: b.y, dead: false, vx: 0 };
  for (let i = 0; i < 8; i++) updateBoss(b, C.STEP, level, 0, p);
  b.hopT = C.BOSS_HOP_COOLDOWN + 0.01;
  b.vy = 0;
  return { b, p, level };
}

check('R09', () => {
  const { b, p, level } = settledBoss();
  b.vx = C.BOSS_SPEED;
  updateBoss(b, C.STEP, level, 0, p);
  near(Math.abs(b.vx), HOP_SPEED, 1e-9, `|b.vx| after a hop (player ${Math.round(p.x - b.x)}px to the right)`);
  const two = settledBoss();
  two.b.vx = -C.BOSS_SPEED;
  // place the player exactly where the boss will be after moveX, so dx is exactly 0
  two.p.x = two.b.x + two.b.vx * C.STEP;
  updateBoss(two.b, C.STEP, two.level, 0, two.p);
  assert(Math.sign(two.b.vx) === -1, `with player.x === boss.x the boss hopped ${two.b.vx > 0 ? 'right' : 'left'} (vx=${two.b.vx}); expected it to keep its previous direction`);
  near(Math.abs(two.b.vx), HOP_SPEED, 1e-9, '|b.vx| on the dx===0 hop');
  return `hop speed ${HOP_SPEED} (BOSS_SPEED ${C.BOSS_SPEED}); dx===0 keeps direction`;
});

// ---------------------------------------------------------------------------
// R10 — touch-only players cannot start, pause, restart, mute, or run
// ---------------------------------------------------------------------------

function rebindTouch(pointer = 'coarse', any = 'coarse') {
  // fresh element registry (main.js keeps its own canvas reference) so repeated
  // setupTouch() calls never stack duplicate listeners on one button
  for (const id of [...els.keys()]) if (id !== 'game') els.delete(id);
  setPointer({ pointer, anyPointer: any });
  setupTouch();
}
function press(id, type = 'pointerdown') {
  const el = els.get(id);
  if (!el) return false;
  el.dispatch(type, { pointerId: 1, isPrimary: true, button: 0 });
  return (el._l[type] || []).length > 0;
}
function bound(id) {
  const el = els.get(id);
  return !!el && ((el._l.pointerdown || []).length > 0 || (el._l.click || []).length > 0);
}

check('R10', () => {
  rebindTouch();
  const bad = [];
  const need = ['#t-start', '#t-left', '#t-right', '#t-jump', '#t-run', '#t-pause'];
  const unbound = need.filter((id) => !bound(id.slice(1)));
  if (unbound.length) bad.push(`no pointer/click handler bound on ${unbound.join(' ')}`);

  toTitle();
  if (press('t-start')) {
    step();
    if (G.state !== 'PLAYING') bad.push(`pointerdown on #t-start left state=${G.state}, expected PLAYING`);
  } else bad.push('pointerdown on #t-start reached no listener (no start control)');

  newGame();
  press('t-right');
  steps(10);
  if (!(G.player.vx > 10)) bad.push(`#t-right did not move the player (vx=${G.player.vx.toFixed(1)})`);
  press('t-right', 'pointerup');
  press('t-left');
  steps(10);
  if (!(G.player.vx < -10)) bad.push(`#t-left did not move the player (vx=${G.player.vx.toFixed(1)})`);
  press('t-left', 'pointerup');

  newGame();
  resetAudioSpy();
  press('t-jump');
  // steps(2), not step(): newGame()'s single step is consumed by the TITLE branch, so
  // the player has had ZERO updatePlayer() calls here; spawn sits flush on the floor
  // and onGround only becomes true on update 2 (Y-pass probe). Real play always has
  // prior updates. (Scenario artifact found by the R10 worker; see §11)
  steps(2);
  if (!(G.player.vy < 0 || sfx('jump') > 0)) bad.push('#t-jump did not produce a jump');
  press('t-jump', 'pointerup');

  // run: a dedicated button, or run-on-hold; either must reach RUN_MAX
  newGame();
  const hasRun = bound('t-run');
  if (hasRun) press('t-run');
  press('t-right');
  let peak = 0;
  for (let i = 0; i < 60; i++) { step(); peak = Math.max(peak, Math.abs(G.player.vx)); }
  press('t-right', 'pointerup');
  if (hasRun) press('t-run', 'pointerup');
  if (!(peak >= C.RUN_MAX - 0.5)) {
    bad.push(`|p.vx| peaked at ${peak.toFixed(1)} in 60 steps (< RUN_MAX ${C.RUN_MAX}) via ${hasRun ? '#t-run + #t-right' : 'direction hold'} — running is mandatory for 1-2/1-3 pits`);
  }

  newGame();
  press('t-pause');
  step();
  if (G.state !== 'PAUSED') bad.push(`pointerdown on #t-pause left state=${G.state}, expected PAUSED`);
  press('t-pause', 'pointerup');
  clearInput();
  assert(bad.length === 0, bad[0]);
  return 'start/left/right/jump/run/pause all bound and driving the loop (|vx| peak ' + peak.toFixed(0) + ')';
});

// ---------------------------------------------------------------------------
// R11 — fit() resolves to scale 1 on every phone
// ---------------------------------------------------------------------------

const VIEWPORTS = [
  { w: 320, h: 568 }, { w: 390, h: 844 }, { w: 844, h: 390 },
  { w: 568, h: 320 }, { w: 744, h: 1133 }, { w: 1440, h: 900 },
];

check('R11', () => {
  const bad = [];
  const seen = [];
  for (const { w, h } of VIEWPORTS) {
    globalThis.innerWidth = w;
    globalThis.innerHeight = h;
    dispatch('window', 'resize');
    const s = gameCanvasW() / C.VIEW_W;
    seen.push(`${w}x${h}=${s}`);
    if (!(s >= 1)) bad.push(`${w}x${h}: scale ${s} < 1`);
    if (s > 4) bad.push(`${w}x${h}: scale ${s} > 4 (clamp lost)`);
    if ((w === 390 && h === 844) || (w === 844 && h === 390)) {
      if (!(s >= 1.5)) bad.push(`${w}x${h}: scale ${s} < 1.5 (phone viewport still gets a ~2mm hero)`);
    }
    if (w === 744 || w === 1440) {
      if (Math.abs(s - Math.round(s)) > 1e-9) bad.push(`${w}x${h}: scale ${s} is fractional on a desktop viewport — integer scales stay preferred there`);
    }
  }
  globalThis.innerWidth = 1280;
  globalThis.innerHeight = 800;
  dispatch('window', 'resize');
  assert(bad.length === 0, bad.join(' | '));
  return `fit() scale ${seen.join(' ')}`;
});

// ---------------------------------------------------------------------------
// R12 — mobile CSS + contextmenu guard (static)
// ---------------------------------------------------------------------------

function htmlSource() {
  try {
    return readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  } catch (err) {
    return '';
  }
}

check('R12', () => {
  const html = htmlSource();
  assert(html.length > 0, 'index.html is not readable next to the repo root');
  const rules = [
    ['touch-action: none', /touch-action\s*:\s*none/],
    ['user-select: none', /(^|[^-])user-select\s*:\s*none/],
    ['-webkit-user-select: none', /-webkit-user-select\s*:\s*none/],
    ['-webkit-touch-callout: none', /-webkit-touch-callout\s*:\s*none/],
    ['-webkit-tap-highlight-color: transparent', /-webkit-tap-highlight-color\s*:\s*transparent/],
    ['viewport-fit=cover', /viewport-fit\s*=\s*cover/],
    ['padding-bottom: env(safe-area-inset-bottom)', /padding[^;]*env\(\s*safe-area-inset-bottom/],
  ];
  const missing = rules.filter(([, re]) => !re.test(html)).map(([name]) => `css '${name}'`);
  if (listenerCount('document', 'contextmenu') === 0) missing.push('a document contextmenu listener');
  assert(missing.length === 0, `missing for mobile: ${missing.join(', ')}`);
  return `${rules.length} CSS rules present + contextmenu listener registered`;
});

// ---------------------------------------------------------------------------
// R13 — e.key letters are dead on non-QWERTY layouts and under IME
// ---------------------------------------------------------------------------

check('R13', () => {
  const probes = [];
  for (const label of ['ф', 'Process']) probes.push(label);
  const bad = [];
  dispatchErrors.length = 0;
  for (const k of probes) {
    const cases = [
      ['right', { k, code: 'KeyD' }, () => input.right],
      ['left', { k, code: 'KeyA' }, () => input.left],
      ['jump', { k, code: 'KeyZ' }, () => input.jump && input.jumpPressed],
      ['mute', { k, code: 'KeyM' }, () => input.mutePressed],
      ['pause', { k, code: 'KeyP' }, () => input.pausePressed],
      ['restart', { k, code: 'KeyR' }, () => input.restartPressed],
    ];
    for (const [name, ev, read] of cases) {
      clearInput();
      key(ev.k, ev.code);
      const got = !!read();
      keyUp(ev.k, ev.code);
      clearInput();
      if (!got) bad.push(`${name} (code ${ev.code}, key '${ev.k}')`);
    }
  }
  assert(dispatchErrors.length === 0, `a key handler threw: ${dispatchErrors.join(' | ')}`);
  assert(bad.length === 0, `keydown driven only by e.code did not set: ${bad.slice(0, 4).join(', ')}${bad.length > 4 ? ` (+${bad.length - 4} more)` : ''}`);
  return 'left/right/jump/mute/pause/restart all driven by e.code alone (Cyrillic + IME keys)';
});

// ---------------------------------------------------------------------------
// R14 — no modifier guard; browser shortcuts also drive the game
// ---------------------------------------------------------------------------

check('R14', () => {
  const bad = [];
  clearInput();
  key('p', 'KeyP', { metaKey: true });
  if (input.pausePressed) bad.push('{key:"p",metaKey:true} set pausePressed — Cmd/Ctrl+P pauses the game and opens Print');
  clearInput();
  key('r', 'KeyR', { ctrlKey: true });
  if (input.restartPressed) bad.push('{key:"r",ctrlKey:true} set restartPressed — Cmd/Ctrl+R feeds the game on the way to a reload');
  clearInput();
  key('a', 'KeyA', { metaKey: true });
  if (input.left) bad.push('{key:"a",metaKey:true} set input.left — Cmd+A selects the page and walks Poppy');
  clearInput();
  key('p', 'KeyP');
  if (!input.pausePressed) bad.push('a plain {key:"p"} no longer sets pausePressed (regression)');
  clearInput();
  key('d', 'KeyD');
  if (!input.right) bad.push('a plain {code:"KeyD"} no longer sets input.right (regression)');
  clearInput();

  // #t-start must not be reachable by Tab/Enter: one click + Enter == one startGame()
  rebindTouch();
  toTitle();
  resetAudioSpy();
  const handlers = els.get('t-start') ? els.get('t-start').click() : 0;
  step();
  const fromClick = audioCalls.filter((c) => c === 'musicStart').length;
  key('Enter', 'Enter');
  step();
  const fromEnter = audioCalls.filter((c) => c === 'musicStart').length - fromClick;
  if (handlers === 0) bad.push('#t-start has no click handler, so the Enter-activation double-start cannot be tested (R10 not landed)');
  else if (fromClick !== 1) bad.push(`a synthetic click on #t-start produced ${fromClick} startGame() calls, expected exactly 1`);
  else if (fromEnter !== 0) bad.push('an Enter keydown after a #t-start click started a SECOND game (Enter still activates the focused button — needs PREVENT_KEYS + tabindex="-1")');
  clearInput();
  assert(bad.length === 0, bad[0]);
  return 'modifiers ignored, plain keys work, one click + Enter = one startGame()';
});

// ---------------------------------------------------------------------------
// R15 — pointer: coarse excludes touchscreen laptops, and is read once
// ---------------------------------------------------------------------------

check('R15', () => {
  rebindTouch('fine', 'coarse');
  const bar = document.getElementById('touch');
  assert(bar, '#touch element is missing');
  const shown = () => /flex|block|grid|inline/.test(String(bar.style.display));
  assert(shown(), `a touchscreen laptop (primary fine, any coarse) got no control bar: #touch style.display=${JSON.stringify(bar.style.display)} — setupTouch tests (pointer: coarse), not (any-pointer: coarse)`);
  const before = String(bar.style.display);
  setPointer({ pointer: 'coarse', anyPointer: 'coarse' });
  assert(shown(), `the bar disappeared after the input device changed to coarse-only (display=${String(bar.style.display)}): no matchMedia change listener`);
  assert(String(bar.style.display) === before, `the bar's display changed on a media change (${before} -> ${String(bar.style.display)})`);
  setPointer({ pointer: 'fine', anyPointer: 'fine' });
  return `#touch shown for any-pointer:coarse (display=${before}) and kept across a media change`;
});

// ---------------------------------------------------------------------------
// R16 — text renderer: every glyph is too wide for its cell
// ---------------------------------------------------------------------------

// The harness cannot model a real browser font, so it measures what the renderer
// actually puts on the destination surface: each drawn/blitted rect is rasterised
// into an ink grid. Glyph identity comes from rendering single characters alone.
const TEXT_PITCH = 6; // renderer contract: drawPixelText lays glyphs out at 6*scale

function inkColumns(r) {
  const cols = new Set();
  for (const k of r.pixels.keys()) cols.add(Number(k.split(',')[0]));
  return [...cols].sort((a, b) => a - b);
}

function renderTextToBuffer(text, scale) {
  const buf = mkOffscreen();
  buf._rec.inkRects = true; // post-R16 text is pure fillRect; without ink recording the ink model would be blind to it (same flag as spriteRecorder()). Pre-R16 code still fails on the createElement assert, so this cannot un-red the check.
  const ctx = mkCtx(buf._rec);
  const before = createElementCount;
  const claimed = drawPixelText(ctx, text, 4, 4, '#1a1a1a', scale);
  return { r: buf._rec, claimed, made: createElementCount - before, x0: 4, y0: 4 };
}

check('R16', () => {
  const bad = [];
  let created = 0;
  for (const text of ['SCORE 000000', 'VEGGIE BROS.']) {
    for (const scale of [1, 2, 3]) {
      const { r, claimed, made, x0, y0 } = renderTextToBuffer(text, scale);
      created += made;
      const pitch = TEXT_PITCH * scale;
      const box = { x0, x1: x0 + text.length * pitch, y0, y1: y0 + 12 * scale };
      const cols = inkColumns(r);
      // (a) no ink outside the layout box => no glyph bleeds into a neighbour cell
      const outside = cols.filter((c) => c < box.x0 || c >= box.x1);
      if (outside.length) bad.push(`'${text}' @${scale}: ink in ${outside.length} column(s) outside the layout box (${outside[0]}..${outside[outside.length - 1]} vs ${box.x0}..${box.x1})`);
      for (const [x, y] of r.rects.map((q) => [q[0], q[1]])) {
        if (x < box.x0 - 0.5 || x > box.x1) bad.push(`'${text}' @${scale}: a draw at x=${x} lands outside the ${text.length}-glyph box`);
        if (y < box.y0 - 0.5 || y > box.y1) bad.push(`'${text}' @${scale}: a draw at y=${y} lands below the glyph cell height`);
      }
      // (b) every non-space glyph must ink its own cell; spaces must stay clean
      const empty = [];
      const dirty = [];
      for (let i = 0; i < text.length; i++) {
        const cx0 = x0 + i * pitch;
        const has = cols.some((c) => c >= cx0 && c < cx0 + pitch);
        if (text[i] === ' ') { if (has) dirty.push(i); } else if (!has) empty.push(i);
      }
      if (empty.length) bad.push(`'${text}' @${scale}: ${empty.length} glyph cell(s) have no ink (indices ${empty.slice(0, 4).join(',')})`);
      if (dirty.length) bad.push(`'${text}' @${scale}: space cell(s) ${dirty.join(',')} contain ink`);
      // (c) the stride the ink actually uses must equal what textW() reports
      const starts = [];
      for (let i = 0; i < text.length; i++) {
        if (text[i] === ' ') continue;
        const cx0 = x0 + i * pitch;
        const hit = cols.find((c) => c >= cx0 && c < cx0 + pitch);
        if (hit !== undefined) starts.push({ i, hit });
      }
      const strides = new Set();
      for (let a = 1; a < starts.length; a++) if (starts[a].i === starts[a - 1].i + 1) strides.add(starts[a].hit - starts[a - 1].hit);
      const stride = strides.size === 1 ? [...strides][0] : pitch;
      const want = text.length * stride;
      if (claimed !== want) bad.push(`'${text}' @${scale}: textW()='${claimed}' but the ink stride is ${stride} x ${text.length} glyphs = ${want}`);
      if (claimed !== text.length * pitch) bad.push(`'${text}' @${scale}: textW()='${claimed}' disagrees with the ${pitch}px pitch the glyphs sit on`);
      const span = cols.length ? cols[cols.length - 1] - cols[0] + 1 : 0;
      if (span > claimed) bad.push(`'${text}' @${scale}: measured ink span ${span}px exceeds textW()='${claimed}'`);
    }
  }
  createElementCount = 0;
  // (d) zero offscreen canvases for text
  assert(created === 0, `${created} document.createElement('canvas') call(s) while drawing text — the offscreen text cache is still there (R16 replaces it with an authored bitmap font)`);
  assert(bad.length === 0, bad[0]);
  return 'ink stays inside each glyph cell, every cell inked, textW matches the measured stride, zero text canvases';
});

// ---------------------------------------------------------------------------
// sprite/render geometry helpers
// ---------------------------------------------------------------------------

function spriteRecorder() {
  const r = mkRecorder();
  r.inkRects = true;
  return r;
}
function drawInto(fn, ...args) {
  const r = spriteRecorder();
  fn(mkCtx(r), ...args);
  return r;
}
const allRows = (r) => r.rowsOf(-1e9, 1e9, -1e9, 1e9);

// Runs n real frames with the recorder armed (step() clears it each frame, so the
// checks below inspect the LAST frame).
function renderFrames(n, opts = {}) {
  setGameCanvas();
  rec.inkRects = !!opts.ink;
  for (let i = 0; i < n; i++) step();
  rec.inkRects = false;
  return rec;
}

// ---------------------------------------------------------------------------
// R17 — running hero has a transparent slit
// ---------------------------------------------------------------------------

check('R17', () => {
  const bad = [];
  for (const big of [false, true]) {
    const who = `hero ${big ? 'big' : 'small'}`;
    const rows = (frame) => allRows(drawInto(drawHero, 40, 100, 1, big, 'run', frame));
    const f0 = rows(0);
    const f1 = rows(1);
    const want = f0.map((y) => y - 1);
    const missing = want.filter((y) => !f1.includes(y));
    const extra = f1.filter((y) => !want.includes(y));
    if (missing.length) bad.push(`${who}: on the bob frame row ${missing[0] - 100} of the sprite is empty (torso bottom vs leg top) — a transparent slit flashing at 5 Hz`);
    if (extra.length) bad.push(`${who}: on the bob frame row ${extra[0] - 100} moved by the wrong amount (bob only shifts rows by -1)`);
    const gaps = [];
    for (const set of [f0, f1]) {
      for (let i = 1; i < set.length; i++) if (set[i] !== set[i - 1] + 1) gaps.push(set[i - 1] - 100);
    }
    if (gaps.length) bad.push(`${who}: empty row(s) inside the sprite body at row ${[...new Set(gaps)].join(', ')}`);
  }
  assert(bad.length === 0, bad[0]);
  return 'run frames 0/1 differ by exactly the -1 bob and every body row is inked';
});

// ---------------------------------------------------------------------------
// R18 — score popups are white on sky/stone
// ---------------------------------------------------------------------------

check('R18', () => {
  installLevel(flatLevel());
  const p = G.player;
  const it = makePopup(p.x + 40, p.y - 8, '+100'); // clear of the player sprite: with inkRects on the zone must hold popup ink only
  G.items.push(it);
  renderFrames(1);
  const y0 = Math.floor(it.y - 20 * (it.t / 0.6)) - 2;
  const y1 = y0 + 14;
  const x0 = Math.floor(it.x - G.cam.x) - 4;
  const x1 = x0 + 6 * it.text.length + 8;
  const ink = rec.rects.filter((q) => q[1] >= y0 && q[1] < y1 && q[0] >= x0 && q[0] < x1 && q[3] === 1 && q[2] <= 6); // 1-row runs ≤ pitch: text ink; sky/ground/player rects cannot match
  assert(ink.length > 0, `no ink was drawn where the '+100' popup should be (x ${x0}..${x1}, y ${y0}..${y1}) — the popup is not rendering at all`);
  const first = ink[0];
  const whites = ink.filter((q) => q[4] === C.PALETTE.white).length;
  assert(first[4] !== C.PALETTE.white,
    `the popup's first inked rect is PALETTE.white (${whites}/${ink.length} white runs over sky ${C.PALETTE.sky} / stone ${C.PALETTE.stone}) — draw it in INK or draw an INK backing pass first`);
  return `popup ink leads with ${first[4]} (${whites} white of ${ink.length} runs)`;
});

// ---------------------------------------------------------------------------
// R19 — LEVEL_CLEAR flash erases the text and the HUD
// ---------------------------------------------------------------------------

check('R19', () => {
  newGame();
  G.level.gate = { x: 100, y: 192, row: 12 };
  G.state = 'LEVEL_CLEAR';
  G.clearT = 1.39 - C.STEP;   // update() adds one STEP before the frame renders
  G.bannerT = 0;
  renderFrames(1);
  assert(G.state === 'LEVEL_CLEAR', `the level advanced out of LEVEL_CLEAR before the frame could render (clearT=${G.clearT})`);
  const flash = rec.rects.find((q) => q[4] === C.PALETTE.white && q[2] >= C.VIEW_W && q[3] >= C.VIEW_H);
  assert(flash, 'no full-screen white flash rect was drawn at clearT=1.39');
  const bad = [];
  if (!(flash[5] <= 0.9)) bad.push(`the flash alpha is ${flash[5].toFixed(2)} (> 0.9 clamp) — the last frames are a pure white screen`);
  const stage = rec.rects.filter((q) => q[4] === C.PALETTE.black && q[1] >= 90 && q[1] < 120 && q[3] === 2 && q[2] >= 2 && q[2] <= 12); // scale-2 text runs (post-R16: overlay text is fillRect runs, not fillText)
  const plus = rec.rects.filter((q) => q[4] === C.PALETTE.black && q[1] >= 120 && q[1] < 150 && q[3] === 1 && q[2] >= 1 && q[2] <= 6); // scale-1 text runs
  assert(stage.length > 0 && plus.length > 0, `STAGE CLEAR/+1000 text runs not found (stage ${stage.length}, plus ${plus.length} rects)`);
  const firstText = Math.min(stage[0][6], plus[0][6]); // rects carry seq at index 6
  if (flash[6] > firstText) bad.push(`the flash (draw #${flash[6]}) is issued AFTER 'STAGE CLEAR'/'+1000' (draw #${firstText}) — draw the flash first so the text sits on top of the fade`);
  const hud = rec.rects.filter((q) => q[4] === C.PALETTE.black && q[1] < 30 && q[3] === 1 && q[2] >= 1 && q[2] <= 6);
  if (hud.length && hud.every((q) => q[6] < flash[6]) && flash[5] > 0.9) bad.push('the HUD is drawn under a full-strength flash');
  assert(bad.length === 0, bad.join(' | '));
  return `flash alpha ${flash[5].toFixed(2)} (clamped) and drawn before the overlay text (draw #${flash[6]} vs #${firstText})`;
});

// ---------------------------------------------------------------------------
// R21 — sprite art sits inside the floor; boss art bobs out of phase
// ---------------------------------------------------------------------------

check('R21', () => {
  const bad = [];
  const targets = [
    { name: 'turnip', fn: drawTurnip, h: 12, args: (frame) => [40, 60, frame, 1] },
    { name: 'boss', fn: drawBoss, h: 28, args: (frame) => [40, 60, frame, 1, false] },
  ];
  for (const spec of targets) {
    for (const frame of [0, 1]) {
      const rows = allRows(drawInto(spec.fn, ...spec.args(frame))).map((y) => y - 60);
      const below = rows.filter((r) => r >= spec.h);
      if (below.length) bad.push(`${spec.name} frame ${frame}: art rows ${below[0]}..${below[below.length - 1]} are below the ${spec.h}px hitbox (every row must satisfy 0 <= row < ${spec.h})`);
    }
    const f0 = new Set(allRows(drawInto(spec.fn, ...spec.args(0))).map((y) => y - 60));
    const f1 = new Set(allRows(drawInto(spec.fn, ...spec.args(1))).map((y) => y - 60));
    const moved = [...f0, ...f1].filter((r) => (f0.has(r) ? !f1.has(r) : true)).filter((r) => f0.has(r) !== f1.has(r));
    const inside = [...new Set(moved)].filter((r) => r >= 0 && r < spec.h).sort((a, b) => a - b);
    if (inside.length) bad.push(`${spec.name}: the bob shifts rows ${inside.join(',')} inside the hitbox — only rows above the hitbox top may bob (moveY holds the box still)`);
  }
  assert(bad.length === 0, bad[0]);
  return 'turnip and boss art rows stay inside the hitbox and the bob only moves the crown rows';
});

// ---------------------------------------------------------------------------
// R22 — berry hitbox is 14x14 around ~10px of art
// ---------------------------------------------------------------------------

function inkBounds(r) {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const key of r.pixels.keys()) {
    const [cx, cy] = key.split(',').map(Number);
    if (cx < minX) minX = cx;
    if (cx > maxX) maxX = cx;
    if (cy < minY) minY = cy;
    if (cy > maxY) maxY = cy;
  }
  return { minX, maxX, minY, maxY };
}

check('R22', () => {
  const level = flatLevel({ cols: 30, gate: false, boss: [C.ROWS - 3, 28] });
  const bad = [];
  // (1) at rest on the floor, the art's last row must be the row above the ground
  const berry = makeBerry(6 * C.TILE, 40);
  const items = [berry];
  for (let i = 0; i < 90; i++) updateItems(items, C.STEP, level);
  assert(items.length === 1 && berry.onGround, 'the test berry never came to rest on the floor');
  const art = inkBounds(drawInto(drawBerry, berry.x, berry.y, 0));
  const floorRow = GROUND_TOP - 1;
  if (art.maxY !== floorRow) {
    bad.push(`a resting berry's art bottom row is ${art.maxY} but the hitbox bottom sits on row ${floorRow} (art rows ${art.minY - berry.y}..${art.maxY - berry.y} of a ${(GROUND_TOP - berry.y)}px box) — it looks like it floats`);
  }
  // (2) the pickup rect must equal the art bounds, not the physics box
  const tryPickup = (clearance) => {
    installLevel(level);
    clearInput();
    const b = makeBerry(6 * C.TILE, GROUND_TOP - 40);
    G.items.push(b);
    for (let i = 0; i < 45; i++) step();          // let it fall and come to rest
    if (!b.onGround) throw new Fail('the berry did not settle in the real loop');
    const a = inkBounds(drawInto(drawBerry, b.x, b.y, 0));
    const h = a.maxY - a.minY + 1;
    const p = G.player;
    p.x = b.x;
    p.y = a.minY - clearance - p.h;
    p.vx = 0;
    p.vy = 0;
    step();
    return { got: G.items.includes(b), h, a };
  };
  const above = tryPickup(1); // got === true means the berry is STILL in items (not collected)
  if (!above.got) bad.push(`the berry was collected with the player's feet 1px ABOVE the art's top row (art ${above.a.minY}..${above.a.maxY}, ${above.h}px tall) — the pickup rect is bigger than the art`);
  const centre = tryPickup(-(above.h >> 1)); // negative clearance puts the feet INSIDE the art, at its middle row
  if (centre.got) bad.push('the berry was NOT collected when the player overlaps the middle of its art — the pickup was over-shrunk');
  // (3) behaviour must survive: walks, bounces, despawns at BERRY_LIFE
  const walker = [makeBerry(4 * C.TILE, GROUND_TOP - 10)];
  const x0 = walker[0].x;
  let prevVx = walker[0].vx;
  let reversed = false;
  for (let i = 0; i < 600; i++) {
    updateItems(walker, C.STEP, level);
    if (walker.length && Math.sign(walker[0].vx) !== Math.sign(prevVx)) reversed = true;
    if (walker.length) prevVx = walker[0].vx;
  }
  if (!(Math.abs(walker[0].x - x0) > 8)) bad.push(`the berry did not walk (dx=${(walker[0].x - x0).toFixed(1)} in 10s)`);
  if (!reversed) bad.push('the berry never bounced off a wall');
  const clock = [makeBerry(4 * C.TILE, GROUND_TOP - 10)];
  for (let i = 0; i < Math.ceil((C.BERRY_LIFE + 1) * 60); i++) updateItems(clock, C.STEP, level);
  if (clock.length !== 0) bad.push(`the berry was still alive past BERRY_LIFE (${C.BERRY_LIFE}s)`);
  assert(bad.length === 0, bad[0]);
  return `berry art bottom row == hitbox bottom (${floorRow}), pickup matches the art, walks/bounces/despawns`;
});

// ---------------------------------------------------------------------------
// R23 — squashed turnip renders through a fractional transform
// ---------------------------------------------------------------------------

check('R23', () => {
  installLevel(flatLevel({ turnip: [C.ROWS - 3, 12] }));
  const e = G.enemies[0];
  e.active = true;
  e.squashed = true;
  e.squashT = 0.1;
  e.y = 100;               // airborne corpse: nothing else inks the band around it
  e.vy = 0;
  const screenX = Math.floor(e.x - Math.floor(G.cam.x));
  renderFrames(1, { ink: true });
  const isCorpse = (c) => c === C.PALETTE.turnipBody || c === C.PALETTE.turnipTip;
  const rows = rec.rowsWhere(screenX - 2, screenX + e.w + 2, 92, 122, isCorpse);
  const frac = rec.scaleCalls.filter(([, sy]) => !Number.isInteger(sy));
  if (frac.length) {
    assert(false, `scale(${frac[0][0]}, ${frac[0][1].toFixed(4)}) is applied while drawing the squashed turnip — fillRect antialiases the fractional geometry into ${rows.length} blurry rows (${rows.join(',')}); draw the 12x4 corpse directly or re-derive integer rows`);
  }
  assert(rows.length === 4, `the squashed corpse occupies ${rows.length} rows (${rows.join(',')}), expected exactly 4 integer rows`);
  assert(rows.every((y) => Number.isInteger(y)), `non-integer corpse rows: ${rows.join(',')}`);
  return `no fractional transform; corpse occupies 4 integer rows (${rows.join(',')})`;
});

// ---------------------------------------------------------------------------
// R24 — HUD rects must not overlap (worst realistic case)
// ---------------------------------------------------------------------------

check('R24', () => {
  newGame();
  G.score = 999900;
  G.fruitCount = 99;
  G.lives = 9;
  G.muted = true;
  G.bannerT = 0;
  renderFrames(1, { ink: true });
  // The renderer's own width contract: drawPixelText returns the textW it laid the
  // string out with, so the zones below are derived from the same metric.
  const scratch = mkOffscreen();
  const w = (s) => drawPixelText(mkCtx(scratch._rec), s, 0, 0, C.PALETTE.black, 1);
  const score = 'SCORE ' + String(G.score).padStart(6, '0');
  const fruit = 'x' + String(G.fruitCount).padStart(2, '0');
  const world = 'WORLD ' + G.level.label;
  const livesText = 'x' + G.lives;
  const wm = w('MUTED');
  const livesX = C.VIEW_W - 8 - (12 + 1 + w(livesText)) - (G.muted ? wm + 4 : 0);
  const bands = [
    {
      y0: 0, y1: 18, zones: [
        { name: 'score', x0: 8, x1: 8 + w(score) },
        { name: 'world', x0: (C.VIEW_W - w(world)) / 2, x1: (C.VIEW_W + w(world)) / 2 },
        { name: 'lives icon', x0: livesX, x1: livesX + 12 },
        { name: 'lives text', x0: livesX + 13, x1: livesX + 13 + w(livesText) },
        { name: 'MUTED', x0: C.VIEW_W - 8 - wm, x1: C.VIEW_W - 8 },
      ],
    },
    {
      y0: 18, y1: 36, zones: [
        { name: 'fruit icon', x0: 8, x1: 16 },
        { name: 'fruit text', x0: 18, x1: 18 + w(fruit) },
      ],
    },
  ];
  const isHudInk = (c) => c === C.PALETTE.black;
  const bad = [];
  let minGap = Infinity;
  for (const band of bands) {
    const zs = band.zones;
    for (let i = 0; i < zs.length; i++) {
      for (let j = i + 1; j < zs.length; j++) {
        const gap = Math.min(zs[i].x1, zs[j].x1) - Math.max(zs[i].x0, zs[j].x0);
        if (gap > 0) bad.push(`HUD rects overlap by ${gap}px: ${zs[i].name} [${zs[i].x0},${zs[i].x1}) vs ${zs[j].name} [${zs[j].x0},${zs[j].x1})`);
        else minGap = Math.min(minGap, -gap);
      }
    }
    for (const z of zs) {
      const cols = rec.colsWhere(Math.floor(z.x0), Math.ceil(z.x1), band.y0, band.y1, isHudInk);
      if (!cols.length) bad.push(`'${z.name}' has no ink inside its layout rect [${z.x0},${z.x1}) x [${band.y0},${band.y1}) — the HUD moved away from the widths textW reports`);
    }
    const stray = rec.colsWhere(0, C.VIEW_W, band.y0, band.y1, isHudInk)
      .filter((c) => !zs.some((z2) => c >= Math.floor(z2.x0) - 1 && c < Math.ceil(z2.x1) + 1));
    if (stray.length) bad.push(`HUD ink at x=${stray[0]}..${stray[stray.length - 1]} lies outside every layout rect in the y ${band.y0}..${band.y1} band`);
    const right = Math.max(...zs.map((z) => z.x1));
    if (right > C.VIEW_W - 4) bad.push(`the rightmost HUD rect ends at x=${right}, leaving less than a 4px margin`);
  }
  assert(bad.length === 0, bad[0]);
  return `${bands[0].zones.length + bands[1].zones.length} HUD rects, min gap ${minGap}px, widest right edge ${Math.max(...bands[0].zones.map((z) => z.x1))}`;
});

// ---------------------------------------------------------------------------
// R20 — camera scrolls backwards; nothing is culled behind it
//
// REWRITTEN 2026-11-16 by explicit product decision, which supersedes this entry's original
// "ratchet the camera" fix and its architecture.md "do not restore it" note: the camera now
// follows the hero LEFT, and the only thing that stops it is the last checkpoint reached —
// passed to updateCamera as its minX parameter (main.js:checkpointBounds), never stored on the
// camera object. So this check now asserts the OPPOSITE invariant, with the same teeth, and
// keeps the part of the entry that still stands: entities well behind the camera are not
// simulated. The clause at the end is the consequence of the reversal — because that cull is a
// per-frame test (`enemy.js:63` in updateTurnip, `:92` in updateBoss — re-read from the live file,
// not copied: this cite has drifted once already), walking the camera back left WAKES the turnips it
// froze.
// ---------------------------------------------------------------------------

check('R20', () => {
  const level = flatLevel({ cols: 120, gate: [C.ROWS - 3, 118] });
  const cam = { x: 0 };
  const p = makePlayer(2 * C.TILE, GROUND_TOP - C.PLAYER_SMALL_H);
  for (let i = 0; i < 600; i++) {
    p.x = Math.min(p.x + C.RUN_MAX * C.STEP, level.widthPx - p.w);
    updateCamera(cam, C.STEP, p, level.widthPx);
  }
  const X = cam.x;
  assert(X > 1000, `running right over a 120-column level only scrolled the camera to ${X.toFixed(0)}`);

  // (1) two-sided follow. The bound is a PARAMETER here, not a cam.minX field: the harness (and
  // main.js's own test seam) install a bare { x } camera, so state on that object reads
  // undefined and would poison cam.x with NaN instead of flooring it.
  const FLOOR = 640;
  let back = 0;
  for (let i = 0; i < 120; i++) {
    p.x = Math.max(p.x - C.RUN_MAX * C.STEP, 0);
    updateCamera(cam, C.STEP, p, level.widthPx, FLOOR);
    back = Math.max(back, X - cam.x);
  }
  assert(back > 100, `cam.x only moved back ${back.toFixed(2)}px from ${X.toFixed(2)} over 120 steps walking left — the camera must follow the hero left, not ratchet`);
  for (let i = 0; i < 600; i++) {
    p.x = Math.max(p.x - C.RUN_MAX * C.STEP, 0);
    updateCamera(cam, C.STEP, p, level.widthPx, FLOOR);
    assert(cam.x >= FLOOR, `cam.x fell to ${cam.x.toFixed(2)}, below the checkpoint floor at ${FLOOR}`);
  }
  eq(cam.x, FLOOR, 'the camera settles on its checkpoint floor');

  // (2) no checkpoint reached, no floor: the hero can walk the camera all the way back to the
  // left edge of the world, which is the half of the original bug that was never reachable.
  cam.x = X;
  p.x = level.widthPx - p.w;
  for (let i = 0; i < 900; i++) {
    p.x = Math.max(p.x - C.RUN_MAX * C.STEP, 0);
    updateCamera(cam, C.STEP, p, level.widthPx);
  }
  eq(cam.x, 0, 'an unbounded camera walks all the way back to 0');

  // (3) the behind-camera cull, asserted while the camera is pinned, then the reversal's
  // consequence asserted while it moves.
  installLevel(level);
  G.cam = { x: X };
  G.player.x = X + CAMERA_FOLLOW_X; // the steady-state offset keeps camX pinned at X
  G.player.y = GROUND_TOP - C.PLAYER_SMALL_H;
  G.player.vx = 0;
  const far = makeTurnip({ x: X - 100, y: GROUND_TOP - C.PLAYER_SMALL_H });
  const near = makeTurnip({ x: X - 10, y: GROUND_TOP - C.PLAYER_SMALL_H });
  far.active = true;
  far.vx = -C.ENEMY_SPEED;
  near.active = true;
  near.vx = C.ENEMY_SPEED;
  G.enemies = [far, near];
  clearInput();
  steps(60);
  assert(Math.abs(G.cam.x - X) < 2, `the camera drifted to ${G.cam.x.toFixed(2)} during the cull test`);
  const farX = far.x;
  const movedFar = Math.abs(far.x - (X - 100));
  const movedNear = Math.abs(near.x - (X - 10));
  assert(movedNear > 0.5, `the enemy 10px behind the camera stopped being simulated (moved ${movedNear.toFixed(2)}px)`);
  assert(movedFar === 0, `the enemy ${Math.round(X - far.x)}px behind the camera is still simulated (moved ${movedFar.toFixed(2)}px) — cull entities at e.x + e.w < camX - 32`);

  input.left = true;
  // The hero walks back through the live probe turnip on the way. That contact is not what this
  // clause is about (and a small hero dying here would reload the shipped 1-1 under the check),
  // so it is made invulnerable for the length of the walk; the cull itself does not care.
  G.player.invulnT = 5;
  steps(120);
  clearInput();
  const followed = X - G.cam.x;
  assert(followed > 150, `holding left for 120 real frames only moved the camera ${followed.toFixed(2)}px back from ${X.toFixed(0)} (now ${G.cam.x.toFixed(2)}) — the camera must follow the hero left in the loop, too`);
  const wokeFar = Math.abs(far.x - farX);
  assert(wokeFar > 0.5, `the turnip 100px behind the camera never resumed being simulated as the camera came back over it (moved ${wokeFar.toFixed(2)}px) — CULL_BEHIND is a per-frame test, so a leftward camera must wake it`);
  return `follows left ${followed.toFixed(0)}px (floored at ${FLOOR}, and to 0 when unbounded); camX-100 frozen while pinned, walks ${wokeFar.toFixed(0)}px once the camera returns over it, camX-10 live`;
});

// ---------------------------------------------------------------------------
// R25 — popups, shards and berries freeze outside PLAYING
// ---------------------------------------------------------------------------

check('R25', () => {
  newGame();
  G.level.gate = { x: G.player.x + 24, y: 192, row: 12 };
  G.player.x = G.level.gate.x + 4;
  G.player.y = GROUND_TOP - G.player.h;
  G.player.vx = 0;
  G.player.vy = 0;
  clearInput();
  // onGate awards SCORE.gate directly; this is the +1000 popup addScore() creates
  // for every other award, which the LEVEL_CLEAR freeze is supposed to animate.
  const pop = makePopup(G.player.x, G.player.y - 8, '+' + C.SCORE.gate);
  G.items.push(pop);
  const hit = until(10, () => (G.state === 'LEVEL_CLEAR' ? { done: true } : null));
  assert(hit, `walking into the gate never produced LEVEL_CLEAR (state=${G.state})`);
  assert(G.items.includes(pop), 'the popup vanished on the LEVEL_CLEAR transition');
  const t0 = pop.t;
  steps(20);
  assert(G.state === 'LEVEL_CLEAR', `LEFT LEVEL_CLEAR after 20 steps (state=${G.state}) — the freeze window was not measured`);
  assert(pop.t > t0, `the '+${C.SCORE.gate}' popup's t stayed at ${t0} through LEVEL_CLEAR (state=${G.state}) — updateItems only runs in PLAYING`);
  steps(40);
  assert(G.state === 'LEVEL_CLEAR', `LEFT LEVEL_CLEAR early (state=${G.state})`);
  assert(!G.items.includes(pop), `the popup was still in G.items at t=${pop.t.toFixed(2)} (> POPUP_LIFE 0.6) — it never despawned`);
  return `+1000 popup animated (t=${pop.t.toFixed(2)}) and despawned during LEVEL_CLEAR`;
});

// ---------------------------------------------------------------------------
// R26 — any exception in update/render bricks the game permanently
// ---------------------------------------------------------------------------

check('R26', () => {
  newGame();
  // A render-time throw injected from the harness: drawHud reads G.score, update()
  // does not (nothing is being collected), so a one-shot throwing getter makes
  // render() throw exactly once, on a real frame, with the loop still live.
  let armed = true;
  let scoreValue = G.score;
  const desc = Object.getOwnPropertyDescriptor(G, 'score');
  Object.defineProperty(G, 'score', {
    configurable: true,
    get() {
      if (armed) {
        armed = false;
        throw new Error('injected render failure');
      }
      return scoreValue;
    },
    set(v) { scoreValue = v; },
  });
  const mark = consoleLog.length;
  const err = step();
  const logged = consoleLog.length - mark;
  const rescheduled = lastFrameRescheduled;
  delete G.score;
  if (desc) Object.defineProperty(G, 'score', desc);
  else G.score = scoreValue;
  let laterError = null;
  for (let i = 0; i < 3; i++) laterError = step() || laterError;
  const bad = [];
  if (!rescheduled) bad.push('after render threw, requestAnimationFrame was never called again — the loop stops forever (call it first, wrap the body in try/catch)');
  if (logged !== 1) bad.push(`the render exception was logged ${logged} time(s), expected exactly once per throw`);
  if (err) bad.push(`the frame exception escaped to the caller (${err.message}) instead of being caught and logged inside frame()`);
  if (laterError) bad.push(`frames did not resume cleanly after the throw: ${laterError.message}`);
  assert(bad.length === 0, bad.join(' | '));
  return 'frames continue after a render throw; the error is logged exactly once';
});

// ---------------------------------------------------------------------------
// R27 — G.levelIndex incremented with no bounds check
// ---------------------------------------------------------------------------

check('R27', () => {
  newGame();
  const last = LEVELS.length - 1;
  G.levelIndex = last;                 // the player is clearing the FINAL level
  G.state = 'LEVEL_CLEAR';
  G.clearT = 0;
  G.level.gate = { x: 0, y: 192, row: 12 };
  G.player.y = GROUND_TOP - G.player.h;
  clearInput();
  let thrown = null;
  for (let i = 0; i < 120 && G.state === 'LEVEL_CLEAR' && !thrown; i++) thrown = step();
  assert(!thrown, `clearing the final level threw "${thrown ? thrown.message : ''}" (loadLevel(levelIndex+1) -> parseLevel(undefined)) — the branch must go to WIN instead`);
  assert(G.state === 'WIN', `after clearing the final level state=${G.state} (levelIndex=${G.levelIndex}), expected WIN`);
  assert(G.levelIndex === last, `levelIndex ran off the end (${G.levelIndex} of ${LEVELS.length})`);
  return `LEVEL_CLEAR on ${LEVELS[last].label} -> WIN, no throw`;
});

// A level can only be entered through the state machine; step the loop until the
// requested index is loaded (LEVEL_CLEAR advances one level per 1.4 s).
function loadLevelForCheck(index) {
  if (!G.player) newGame();
  // Entering LEVEL_CLEAR advances levelIndex by one, so to land ON `index` we have to be
  // standing on the level before it. This was `= index`, which made the helper's own exit
  // condition (`levelIndex === index && PLAYING`) unreachable for every index — it lands on
  // index + 1 instead and the helper throws a harness Fail. (Also note the final level can
  // never be reached by clearing a level at all since R27 — index - 1 keeps that out of it.)
  G.levelIndex = Math.max(0, index - 1);
  G.state = 'LEVEL_CLEAR';
  G.clearT = 0;
  G.level = G.level || parseLevel(LEVELS[0]);
  if (!G.level.gate) G.level.gate = { x: -999, y: 192, row: 12 };
  for (let i = 0; i < 120; i++) {
    const err = step();
    if (err) throw new Fail(`loading level ${index} threw: ${err.message}`);
    if (G.levelIndex === index && G.state === 'PLAYING') return;
  }
  throw new Fail(`could not load level ${index} (state=${G.state}, index=${G.levelIndex})`);
}

// ---------------------------------------------------------------------------
// R28 — growth has no headroom check
// ---------------------------------------------------------------------------

check('R28', () => {
  // TILE=16 with a 12px hero quantises headroom to 4 / 20 / 36 px, so the
  // entry's "8 px" case is measured at 4 px — the same class: under GROW_H (14).
  const run = (ceilingRow) => {
    const grid = emptyMap(40);
    groundRows(grid);
    put(grid, 'H', C.ROWS - 3, 4);
    put(grid, 'G', C.ROWS - 3, 38);
    for (let tx = 3; tx <= 6; tx++) grid[ceilingRow][tx] = 'S';
    const level = synth(toDef(grid, 'ceiling'));
    installLevel(level);
    clearInput();
    const p = G.player;
    const headroom = (GROUND_TOP - p.h) - (ceilingRow + 1) * C.TILE;
    const b = makeBerry(p.x, GROUND_TOP - 14);
    G.items.push(b);
    const x0 = p.x;
    step();
    return { p, headroom, grew: p.big, stillThere: G.items.includes(b), dx: p.x - x0 };
  };
  const tight = run(C.ROWS - 4);   // row 11 => 4 px of headroom
  assert(!tight.grew, `the player grew with only ${tight.headroom}px of headroom (h=${tight.p.h}) — the ${C.PLAYER_BIG_H}px box is now buried in the block above`);
  assert(tight.stillThere, 'the berry was consumed anyway; it must stay in G.items so it can be collected later');
  assert(Math.abs(tight.dx) < 0.5, `the player's x shifted by ${tight.dx.toFixed(2)}px on the blocked pickup — growth must not eject the player sideways`);
  const room = run(C.ROWS - 5);   // row 10 => 20 px of headroom
  assert(room.p.big, `the player did not grow with ${room.headroom}px of headroom (h=${room.p.h}) — growth is now broken outright`);
  assert(!room.stillThere, 'the berry stayed in G.items even though there was room to grow');
  return 'growth refused at 4px headroom (berry kept, no sideways eject), works at 20px';
});

// ---------------------------------------------------------------------------
// R29 — anything that falls off the map becomes permanent stage furniture
// ---------------------------------------------------------------------------

check('R29', () => {
  const grid = emptyMap(40);
  groundRows(grid);
  put(grid, 'H', C.ROWS - 3, 2);
  put(grid, 'T', C.ROWS - 3, 12);     // turnip directly over where the gap opens
  put(grid, 'G', C.ROWS - 3, 38);
  const level = synth(toDef(grid, 'furniture'));
  // The 6-column pit (cols 10..15) is opened AFTER parseLevel, on the parsed tiles. R30's
  // load-time grounding clause rejects a 'T' with no solid below — correctly, that is the map
  // typo R30 exists to catch — so a runtime-guard check cannot ask the loader to accept it.
  // The shape being tested is unchanged: a grounded turnip whose floor disappears under it.
  for (let tx = 10; tx < 16; tx++) {
    level.tiles[C.ROWS - 2][tx] = '.';
    level.tiles[C.ROWS - 1][tx] = '.';
  }
  installLevel(level);
  clearInput();
  const enemy = G.enemies[0];
  // The defect is PERMANENCE: it rests there, stays simulated, stays lethal, forever. A single
  // frame of contact is not the defect and must not fail a correct fix — R01's accepted player
  // fix moves the body first (tileAt still reports solid 'X' below the map, so onGround is true
  // for that frame) and then applies the height check in the same frame. So measure how long it
  // sits on the phantom floor while still live in G.enemies: unfixed code rests ~112 of 120
  // steps; any fix that kills it in the crossing frame or the next rests for 0-1. The two
  // asserts below still require it to be gone from G.enemies entirely.
  const REST_GRACE = 30;
  let resting = 0;
  let firstRest = null;
  for (let i = 0; i < 120; i++) {
    step();
    if (enemy.onGround && enemy.y + enemy.h >= C.ROWS * C.TILE && G.enemies.includes(enemy)) {
      resting++;
      if (firstRest === null) firstRest = i;
    }
  }
  if (resting > REST_GRACE) assert(false, `the turnip over the gap came to rest on the phantom floor at y=${enemy.y} (feet ${enemy.y + enemy.h}) from step ${firstRest}, resting there ${resting} of 120 steps while still in G.enemies (${G.enemies.length}) — entities reaching y+h >= ROWS*TILE must die`);
  assert(!G.enemies.includes(enemy), `the turnip that fell in the gap is still in G.enemies (y=${enemy.y})`);
  assert(G.enemies.length === 0, `G.enemies did not shrink (${G.enemies.length})`);
  // a berry over a gap must be dropped too
  installLevel(level);
  clearInput();
  const berry = makeBerry(11 * C.TILE, GROUND_TOP - 14);
  G.items.push(berry);
  for (let i = 0; i < 300; i++) step();
  assert(!G.items.includes(berry), `the berry is still in G.items at y=${berry.y.toFixed(1)} onGround=${berry.onGround} — berries that reach the pit line must be dropped (cosmetic items stay)`);
  // no shipped level loses an enemy at t=0
  for (let i = 0; i < LEVELS.length; i++) {
    newGame();
    if (i > 0) {
      G.levelIndex = i;
      loadLevelForCheck(i);
    }
    const n0 = G.enemies.length;
    clearInput();
    steps(600);
    assert(G.enemies.length === n0, `${LEVELS[i].label}: enemies went ${n0} -> ${G.enemies.length} with nobody touching them (y=${G.enemies.map((e) => e.y.toFixed(0)).join(',')})`);
  }
  return 'turnip and berry over a gap are removed; 17 shipped enemies all survive 10s';
});

// ---------------------------------------------------------------------------
// R30 — parseLevel validates almost nothing that matters
// ---------------------------------------------------------------------------

check('R30', () => {
  const bad = [];
  // 1: a character outside the legend is silently invisible air
  {
    const grid = emptyMap(20);
    groundRows(grid);
    put(grid, 'H', C.ROWS - 3, 2);
    put(grid, 'G', C.ROWS - 3, 18);
    grid[10][5] = '@';
    bad.push(...compact([expectThrow(grid, 'r30a', 10, 5, "an unknown character '@'")]));
  }
  // 2: H with nothing below it
  {
    const grid = emptyMap(20);
    groundRows(grid);
    put(grid, 'G', C.ROWS - 3, 18);
    grid[10][6] = 'H';
    bad.push(...compact([expectThrow(grid, 'r30b', 10, 6, "'H' with no solid tile below")]));
  }
  // 3: T over a gap
  {
    const grid = emptyMap(20);
    groundRows(grid);
    put(grid, 'H', C.ROWS - 3, 2);
    put(grid, 'G', C.ROWS - 3, 18);
    grid[C.ROWS - 3][7] = 'T';
    grid[C.ROWS - 2][7] = '.';
    grid[C.ROWS - 1][7] = '.';
    bad.push(...compact([expectThrow(grid, 'r30c', C.ROWS - 3, 7, "'T' with no solid tile below")]));
  }
  // 4: a marker painted onto a solid tile silently deletes a floor tile
  {
    const grid = emptyMap(20);
    groundRows(grid);
    put(grid, 'H', C.ROWS - 3, 2);
    put(grid, 'G', C.ROWS - 3, 18);
    grid[C.ROWS - 2][8] = 'C';
    bad.push(...compact([expectThrow(grid, 'r30d', C.ROWS - 2, 8, "'C' occupying a solid tile")]));
  }
  assert(bad.length === 0, bad[0]);
  for (const def of LEVELS) {
    let level = null;
    try {
      level = parseLevel(def);
    } catch (err) {
      assert(false, `${def.label} no longer parses under the R30 validation: ${err.message}`);
    }
    assert(level.playerSpawn && level.gate !== undefined, `${def.label}: parse returned an unusable level`);
  }
  return '4 bad maps rejected naming row,col; 3 shipped maps still parse';
});

const compact = (list) => list.filter(Boolean);

function expectThrow(grid, label, atRow, atCol, what) {
  let thrown = null;
  try {
    parseLevel(toDef(grid, label));
  } catch (err) {
    thrown = err;
  }
  if (!thrown) return `a map with ${what} parsed without error (expected an Error naming row ${atRow}, col ${atCol})`;
  const msg = String(thrown.message);
  const pairs = [...msg.matchAll(/(\d+)\s*(?:,|\/|\s)\s*(\d+)/g)].map((m) => [Number(m[1]), Number(m[2])]);
  const named = pairs.some(([r, c]) => r === atRow && c === atCol);
  if (!named) return `a map with ${what} threw "${msg}" — it must name the offending row ${atRow}, col ${atCol}`;
  return null;
}

// ---------------------------------------------------------------------------
// R31 — ledge detection only recognises '.'
// ---------------------------------------------------------------------------

check('R31', () => {
  const grid = emptyMap(30);
  groundRows(grid);
  put(grid, 'H', C.ROWS - 3, 2);
  put(grid, 'T', C.ROWS - 3, 12);
  put(grid, 'G', C.ROWS - 3, 28);
  const level = synth(toDef(grid, 'ledge'));
  // The non-solid, non-'.' tile is injected on the SUPPORTING row (row 13, the row the ledge test
  // probes at e.y + e.h + 1) and AFTER parseLevel. Two repairs: the original put it on the
  // turnip's own body row, where neither `=== '.'` nor `!isSolid()` can see it, so the prescribed
  // fix could not make this check pass; and R30's legend whitelist now rejects ' ' at load time,
  // so the loader must not be asked to build it. R31's fix is in the RUNTIME ledge test, which
  // reads level.tiles through tileAt(), so this still discriminates it.
  level.tiles[C.ROWS - 2][14] = ' ';
  const e = makeTurnip(level.enemies[0]);
  e.active = true;
  e.vx = C.ENEMY_SPEED;
  const x0 = e.x;
  let reversed = false;
  for (let i = 0; i < 240 && !reversed; i++) {
    updateTurnip(e, C.STEP, level, 0, null);
    if (e.vx < 0) reversed = true;
  }
  assert(reversed, `the turnip walked off a row-12 ' ' tile instead of reversing (vx=${e.vx}, x moved ${(e.x - x0).toFixed(1)}px, y=${e.y}) — ledge detection must use isSolid(), not === '.'`);
  assert(e.y === level.enemies[0].y, `the turnip dropped to y=${e.y} — it should never have left the surface`);
  return `turnip reverses at the ' ' tile (moved ${(e.x - x0).toFixed(1)}px then turned)`;
});

// ---------------------------------------------------------------------------
// R32 — hygiene: dead code, magic numbers, duplicated constants
// ---------------------------------------------------------------------------

check('R32', () => {
  const files = ['audio.js', 'camera.js', 'config.js', 'enemy.js', 'input.js', 'items.js', 'level.js', 'levels.js', 'main.js', 'player.js', 'render.js', 'sprites.js'];
  const bad = [];
  for (const f of files) {
    const url = new URL(`../src/${f}`, import.meta.url);
    try {
      execFileSync(process.execPath, ['--input-type=module', '--check'], { input: readFileSync(url), stdio: ['pipe', 'ignore', 'pipe'] });
    } catch (err) {
      bad.push(`${f}: node --check failed: ${String(err.stderr).split('\n')[0]}`);
    }
  }
  for (const f of ['main.js', 'player.js']) {
    const src = readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8').split('\n');
    src.forEach((line, i) => {
      const code = line.split('//')[0];
      const hit = code.match(/\bp\.h\s*=\s*(?:26|14)\b|\bp\.y\s*[-+]=\s*(?:26|14)\b/);
      if (hit) bad.push(`${f}:${i + 1}: bare player-height literal "${hit[0].trim()}" — use PLAYER_BIG_H and the derived grow height from config.js`);
    });
  }
  const cfg = readFileSync(new URL('../src/config.js', import.meta.url), 'utf8');
  assert(/PLAYER_BIG_H/.test(cfg), 'config.js no longer exports PLAYER_BIG_H');
  assert(bad.length === 0, bad[0]);
  return `${files.length} files pass node --check; no bare 26/14 height literals in main.js/player.js`;
});

// ---------------------------------------------------------------------------
// R33 — difficulty pass now that pits are lethal
// ---------------------------------------------------------------------------

// Envelope measured from the real updatePlayer, never eyeballed: full-hold jump
// rise and the horizontal range at RUN_MAX, both from a flush take-off.
function measureJump(run) {
  const level = flatLevel({ cols: 60 });
  const p = makePlayer(2 * C.TILE, GROUND_TOP - C.PLAYER_SMALL_H);
  p.onGround = true;
  p.vx = run ? C.RUN_MAX : C.WALK_MAX;   // §6 measures range at speed, with a running start
  const inp = mkInput({ right: true, run, jump: true });
  const x0 = p.x;
  const y0 = p.y;
  let minY = y0;
  let range = 0;
  let leftGround = false;
  for (let i = 0; i < 200; i++) {
    inp.jumpPressed = i === 0;
    updatePlayer(p, C.STEP, inp, level);
    if (!p.onGround) leftGround = true;
    if (p.onGround && leftGround) break;
    if (!p.onGround) {
      minY = Math.min(minY, p.y);
      range = Math.max(range, p.x - x0);
    }
  }
  return { rise: y0 - minY, range };
}

function reachColumns(meta, startCol) {
  const { cols, surfaceAt, wall } = meta;
  const seen = new Set();
  if (startCol < 0 || startCol >= cols || wall[startCol]) return seen;
  seen.add(startCol);
  const queue = [startCol];
  const firstSurface = (from, step) => {
    for (let tx = from; tx >= 0 && tx < cols; tx += step) {
      if (wall[tx]) return null;
      if (surfaceAt[tx] !== null) return tx;
    }
    return null;
  };
  while (queue.length) {
    const tx = queue.shift();
    for (const step of [-1, 1]) {
      const nx = tx + step;
      if (nx < 0 || nx >= cols || wall[nx]) continue;
      const cand = surfaceAt[nx] !== null ? nx : firstSurface(nx, step);
      if (cand === null || seen.has(cand)) continue;
      const rise = surfaceAt[tx] - surfaceAt[cand];
      const jump = Math.abs(cand - tx) - 1;
      if (rise > 4) continue;
      if (jump > 6) continue;
      seen.add(cand);
      queue.push(cand);
    }
  }
  return seen;
}

// Empirical pit-crossing margin: how far BACK from the lip (px) a running,
// full-hold jump can take off and still land on the far ledge. Measured by
// stepping the real updatePlayer, so no take-off/landing frame convention can
// bias it. Returns -1 when the pit cannot be crossed at all.
function pitCross(cols, back) {
  const grid = emptyMap(48);
  groundRows(grid);
  const lipCol = 20;
  for (let tx = lipCol; tx < lipCol + cols; tx++) {
    grid[C.ROWS - 2][tx] = '.';
    grid[C.ROWS - 1][tx] = '.';
  }
  put(grid, 'H', C.ROWS - 3, 2);
  put(grid, 'G', C.ROWS - 3, 46);
  const level = synth(toDef(grid, 'pit'));
  const p = makePlayer(lipCol * C.TILE - C.PLAYER_W - back, GROUND_TOP - C.PLAYER_SMALL_H);
  p.onGround = true;
  p.vx = C.RUN_MAX;
  const inp = mkInput({ right: true, run: true, jump: true });
  for (let i = 0; i < 240; i++) {
    inp.jumpPressed = i === 0;
    updatePlayer(p, C.STEP, inp, level);
    if (p.y + p.h >= C.ROWS * C.TILE) return false;                // dropped into the pit (phantom floor line)
    if (p.onGround && p.x + C.PLAYER_W > (lipCol + cols) * C.TILE) return true;
  }
  return false;
}

const marginCache = new Map();
function pitMargin(cols) {
  if (!marginCache.has(cols)) {
    let best = -1;
    for (let back = 0; back <= 96; back += 1) if (pitCross(cols, back)) best = back;
    marginCache.set(cols, best);
  }
  return marginCache.get(cols);
}

check('R33', () => {
  const RUN = measureJump(true);
  const WALK = measureJump(false);
  const MIN_MARGIN = 8;
  const bad = [];
  const report = [];
  for (const def of LEVELS) {
    const meta = levelMeta(def);
    const pits = [];
    let run = null;
    for (let tx = 0; tx < meta.cols; tx++) {
      const fallable = !isSolid(def.map[C.ROWS - 2][tx]) && !isSolid(def.map[C.ROWS - 1][tx]);
      if (fallable) { run = run || { from: tx, to: tx }; run.to = tx; } else if (run) { pits.push(run); run = null; }
    }
    if (run) pits.push(run);
    const hazards = [
      ...pits.map((p) => ({ kind: 'pit', from: p.from, to: p.to, n: p.to - p.from + 1 })),
      ...meta.gapCols.map((g) => ({ kind: 'gap', from: g.from, to: g.to, n: g.cols })),
      ...meta.rises.map((r) => ({ kind: 'rise', from: r.at - 1, to: r.at, n: r.tiles })),
    ];
    let worst = Infinity;
    let worstWhat = '';
    for (const h of hazards) {
      const margin = h.kind === 'rise' ? RUN.rise - h.n * C.TILE : pitMargin(h.n);
      if (margin < worst) { worst = margin; worstWhat = `${h.kind} ${h.n} @cols ${h.from}-${h.to}`; }
      if (margin < MIN_MARGIN) {
        bad.push(`${def.label} ${h.kind} at cols ${h.from}-${h.to} (${h.n} ${h.kind === 'rise' ? 'tiles' : 'cols'}): margin ${margin.toFixed(1)}px < ${MIN_MARGIN}px`);
      }
    }
    // unreachable cells that contain gameplay objects
    let spawnCol = -1;
    for (let ty = 0; ty < C.ROWS && spawnCol < 0; ty++) spawnCol = def.map[ty].indexOf('H');
    const seen = reachColumns(meta, spawnCol);
    assert(seen.size > 0, `${def.label}: no reachable column from the spawn (spawn col ${spawnCol})`);
    const orphan = [];
    for (let ty = 0; ty < C.ROWS; ty++) {
      for (let tx = 0; tx < meta.cols; tx++) {
        const ch = def.map[ty][tx];
        if (!'CTFGPQB'.includes(ch)) continue;
        let near = false;
        for (let d = -3; d <= 3 && !near; d++) if (seen.has(tx + d)) near = true;
        if (!near) orphan.push(`${ch}@${ty},${tx}`);
      }
    }
    if (orphan.length) bad.push(`${def.label}: ${orphan.length} unreachable gameplay object(s): ${orphan.slice(0, 6).join(' ')}${orphan.length > 6 ? ' ...' : ''}`);
    report.push(`${def.label}: ${pits.length} pits (widest ${Math.max(0, ...pits.map((p) => p.to - p.from + 1))}), ${meta.gapCols.length} gaps, ${meta.rises.length} rises, worst margin ${worst.toFixed(1)}px (${worstWhat}), ${seen.size}/${meta.cols} cols reachable`);
  }
  // the 1-3 door must admit a big player
  const palace = LEVELS.find((l) => l.label === '1-3') || LEVELS[LEVELS.length - 1];
  const rows = palace.map;
  const openA = C.ROWS - 4;   // row 11
  const openB = C.ROWS - 3;   // row 12 — the documented 2-tile door
  let door = -1;
  for (let tx = 1; tx < rows[0].length - 1; tx++) {
    const tall = Array.from({ length: openA }, (_, ty) => ty).every((ty) => isSolid(rows[ty][tx]));
    const open = !isSolid(rows[openA][tx]) && !isSolid(rows[openB][tx]);
    const floor = isSolid(rows[C.ROWS - 2][tx]) && isSolid(rows[C.ROWS - 1][tx]);
    if (tall && open && floor) { door = tx; break; }
  }
  assert(door >= 0, `${palace.label}: no 2-row door column found (rows 0-${openA - 1} solid, ${openA}/${openB} open) — the boss arena is sealed or the door moved`);
  {
    // start on the last solid, clear column before the door (the approach may be
    // short — a pit can sit right in front of it)
    let startCol = door;
    const clear = (tx) => isSolid(rows[C.ROWS - 2][tx]) && isSolid(rows[C.ROWS - 1][tx])
      && !isSolid(rows[openA][tx]) && !isSolid(rows[openB][tx]);
    while (startCol > 1 && clear(startCol - 1)) startCol -= 1;
    const level = synth(palace);
    const p = bigPlayer(makePlayer(startCol * C.TILE, GROUND_TOP - C.PLAYER_SMALL_H));
    const inp = mkInput({ right: true });
    const x0 = p.x;
    let minX = p.x;
    for (let i = 0; i < 1200 && p.x < (door + 3) * C.TILE; i++) {
      updatePlayer(p, C.STEP, inp, level);
      minX = Math.min(minX, p.x);
    }
    if (p.x <= (door + 1) * C.TILE) {
      bad.push(`${palace.label}: a big player (h=${C.PLAYER_BIG_H}) walking right from col ${startCol} got stuck at x=${p.x.toFixed(1)} before clearing the door at col ${door} (${2 * C.TILE}px opening)`);
    } else if (minX < x0 - 1) {
      bad.push(`${palace.label}: the big player was shoved sideways by ${(x0 - minX).toFixed(1)}px at the door (x ${x0.toFixed(1)} -> ${minX.toFixed(1)})`);
    }
  }
  assert(bad.length === 0, `${bad.length} fairness violation(s): ${bad.slice(0, 2).join(' | ')}${bad.length > 2 ? ` (+${bad.length - 2} more)` : ''}`);
  return `jump rise ${RUN.rise.toFixed(1)}px, run range ${RUN.range.toFixed(1)}px (walk ${WALK.range.toFixed(1)}); ${report.join('; ')}; 1-3 door col ${door} admits h=${C.PLAYER_BIG_H}`;
});

// ---------------------------------------------------------------------------
// CAMERA FLOOR CONTRACT — shared by R36 and R44 (read this before "tightening" either)
//
// The left bound reaches the camera in two different shapes, and only one of them is legal:
//   target = clamp(p.x - CAMERA_FOLLOW_X, floor, max)  BEFORE the follow lerp   (correct)
//   cam.x  = floor                                     AFTER the lerp            (the bug)
// The second one was the shipped behaviour and it is the reason the hero's screen position
// jumped 11–19 px the frame it banked a flag: the camera always trails the hero by its steady-state
// follow lag, so when the floor moved forward the camera was sitting exactly `lag` px BELOW it and
// got ASSIGNED to it in one frame. The hero cannot observe that jump — it is clamped to the same
// floor by player.js — so the pop bought nothing the lerp does not already deliver a few frames
// later. See camera.js:31-41 (the same contract, in the shipped file) and architecture.md's
// "Camera follows both ways, floored at the checkpoint" bullet.
//
// What that leaves to assert, and what it costs. The camera may now be under its floor for a short
// window — by at most the follow lag it was already carrying — so a bare `minCam >= floor` sampled
// across a window that includes the convergence frames is no longer a true statement about the
// game. It is replaced by three claims that are, and that a hard clamp does NOT satisfy for free:
//   1. the excursion below the floor is bounded by the lag measured on the frame the floor moved;
//   2. it CONVERGES: the distance to the floor only ever shrinks, and once the camera has arrived it
//      never falls back under it (arriving from above counts, and has to — the camera chases the
//      sliding hero past the floor, then settles back down onto it, which is a backward step that
//      is convergence and not a retreat, and the old wall was structurally incapable of one);
//   3. it comes to REST on the floor: after CAM_SETTLE_FRAMES it is never below it, and it settles
//      exactly on it (`cam.x === floor`, CAM_REST_EPS), which is the float-hygiene half of the job.
// The per-step spike teeth live in assertFollowStep, called by R44 (real crossings, both speeds, and
// the shipped maps) and by R36's shove clause: a pop of the whole lag in one frame cannot hide
// behind a lag-bounded minimum, and it CANNOT hide here — see the proof table on R44.
// ---------------------------------------------------------------------------

// The window after which the camera MUST already be on its floor, in frames. RE-DERIVED 2026-11-16
// from the shipped lerp instead of from the old hand-wave: the exponential closes FOLLOW_RATE = 1/6 of
// the remaining gap per frame, so d px of depth reaches CAM_REST_EPS after log(1e-6/d)/log(5/6) frames
// — and that closed form is a measurement, verified by stepping the real updateCamera from a pinned
// hero at 544: 88 frames from a walk-lag seed (9.167 px), 91 from a run-lag seed (15.833), 101 from
// the deepest seed any trace here has (87.506), 111 from the 544 px shove. Earlier notes published 56
// (the continuous v/L form, wrong for a discrete step: the lag is v dt (1−r)/r = v/12) and 90, which
// had no margin against the 91 it had to cover. [CORRECTED 2026-11-17: the sentence below used to say
// "GAMEPLAY traces top out at 91 frames" while this same comment records 101 for the 87.506 px seed —
// and that seed IS gameplay, it is the deepest shipped one R36 prints (`deepest shipped seed 87.51px`,
// 1-1's col-88 flag approached at RUN_MAX). Re-measured against the real updateCamera: 88 / 91 / 101 /
// 111 frames for depths 9.167 / 15.833 / 87.506 / 544 px. So the gameplay figure this window has to
// cover is 101, and 150 is 101 plus 49 frames (~0.8 s) of margin, which still covers the 111-frame
// non-gameplay shove. Nothing about the window changed, only the arithmetic quoted for it.] Widening
// this further buys nothing; narrowing it under ~110 starts failing on legitimate seeds instead of on
// bugs.
const CAM_SETTLE_FRAMES = 150;
const CAM_REST_EPS = 1e-6;

// How much of the remaining distance to its target the follow closes in one frame, measured off the
// shipped updateCamera the same way measureFollowLag measures the lag — so a lerp constant that moves
// in camera.js moves this too, rather than leaving a stale formula behind. Measured 1/6.
const FOLLOW_RATE = (() => {
  const cam = { x: 0 };
  const p = { x: 4000 };
  updateCamera(cam, C.STEP, p, 400 * C.TILE);
  return cam.x / (p.x - CAMERA_FOLLOW_X);
})();
// The lerp step is an equality on every frame of a legitimate follow (assertFollowStep states it), so
// this factor is not slack for a bug to hide in: measured on the shipped code the worst overshoot
// over all four camera traces in this file is exactly 0 px — every traced frame sits at ratio 1.000 of
// the unscaled allowance, so the bound only ever has to cover float drift (STEP_TOL). [TIGHTENED 2 →
// 1.5, 2026-11-17, measured in throwaway copies: 1.5 keeps all four traces green (43/43, exit 0, md5
// stable) and closes an escape 2.0 left open. The mutant was a PARTIAL clamp, `if (cam.x < lo) cam.x
// += 0.20 * (lo - cam.x);` after the lerp — a wall wearing a lerp's clothes. At 2.0 it passed the whole
// suite because its bank-frame step (5.278 px on the run leg, 3.122 px on the walk leg) is EXACTLY the
// 2.0 bound (15.833/6 × 2), so it survived on STEP_TOL alone. At 1.5 the bound is 3.958 px on the run
// leg and R36 goes red with `… moved 5.278px … could produce at most 3.958px`, and R44's spike clause
// goes red with the walk leg (3.122 px against a 1.833 px run-wide maximum). The offenders, against
// the 1.5 bounds: the re-added hard clamp 8.278 vs 2.750 (walk) and 15.833 vs 3.958 (run), CAM_EPS = 40
// at 3.0x over. Nothing in a legitimate trace is closer than ratio 1.000, i.e. a third of the allowance
// spare; going below ~1.2 starts cutting into that margin for no measured gain, and 1.0 would make the
// clause an exact-equality test on floats. 1.5 also still allows a follow that closes 50% more briskly
// than CAMERA_LERP today without calling it a cut.]
const STEP_FACTOR = 1.5;
const STEP_TOL = 1e-4; // px/frame; CAM_EPS (1e-6) and float drift both live far under this

// The camera's one-frame step is the follow's own step, or it is not a follow. This is the assertion
// that separates the smooth floor from the old wall: the wall ASSIGNS the camera to the floor, which
// is a step of the whole distance the follow could only have covered in six frames.
//
// `frames` is loop-order camera/player state, taken AFTER each step() so the player x is the one the
// camera actually chased, and each floor is what checkpointBounds() handed updateCamera on that same
// frame (main.js reads it at the top of updateState, so it is one arm behind the arming frame — a
// stale-low floor only ever loosens this bound, never tightens it, and the arming frame is the one
// this check is aimed at). Frame 0 is the seed and is not diffed. The bound is two-sided: a follow
// cannot jump PAST its target either, and one that could has the same visible symptom.
function assertFollowStep(what, frames, levelW) {
  const max = Math.max(0, levelW - C.VIEW_W);
  let worst = 0;
  let worstAt = -1;
  let maxStep = 0;
  for (let i = 1; i < frames.length; i++) {
    let target = frames[i].x - CAMERA_FOLLOW_X;
    if (target < frames[i].floor) target = frames[i].floor;
    else if (target > max) target = max;
    const step = frames[i].cam - frames[i - 1].cam;
    maxStep = Math.max(maxStep, Math.abs(step));
    const allowed = Math.abs((target - frames[i - 1].cam) * FOLLOW_RATE) * STEP_FACTOR + STEP_TOL;
    const over = Math.abs(step) - allowed;
    if (over > worst) { worst = over; worstAt = i; }
    assert(over <= 0, `${what}: at frame ${i} the camera moved ${step.toFixed(3)}px in one frame when its target at ${target.toFixed(2)} (hero x ${frames[i].x.toFixed(2)}, floor ${frames[i].floor}) could produce at most ${allowed.toFixed(3)}px — ${(step / ((target - frames[i - 1].cam) * FOLLOW_RATE)).toFixed(1)} frames of follow compressed into one, which is a camera cut, not a follow`);
  }
  return { worst, worstAt, maxStep, rate: FOLLOW_RATE };
}

// The camera's steady-state lag behind a hero moving at a constant `vmax`, measured off the real
// updateCamera on a floor-free level rather than from CAMERA_LERP (which camera.js keeps to
// itself), so it tracks the shipped lerp instead of a formula that can go stale. This is how far
// below `p.x - CAMERA_FOLLOW_X` the camera legitimately runs in normal play, therefore the deepest
// it may ever be under a floor that just moved — and, before the smooth-floor fix, exactly how far
// the camera TELEPORTED forward on the frame a flag banked (measured: 9.17 px walking, 15.83 px
// running, i.e. v/12 rather than the continuous approximation v/10). R44 pins both halves.
function measureFollowLag(vmax, steps = 600) {
  const cam = { x: 0 };
  const p = { x: 0 };
  const w = 400 * C.TILE;
  for (let i = 0; i < steps; i++) {
    p.x = Math.min(p.x + vmax * C.STEP, w - 16);
    updateCamera(cam, C.STEP, p, w);
  }
  return p.x - CAMERA_FOLLOW_X - cam.x;
}

// Asserts what a camera must do when a floor moves forward from underneath it. `lag` is the follow
// lag measured off the shipped lerp — the deepest the camera may be under the floor, and exactly the
// size of the one-frame pop this contract forbids. Pass a bigger `lag` when the camera was FORCED to
// a position, because then its depth under the floor is not lag at all and the other three claims are
// the ones carrying the weight: R36's shove clause passes the whole gap, and its per-step bound is
// carried by assertFollowStep at the call site rather than by anything here.
function assertFloorConvergence(what, trace, floor, lag, settleFrames = CAM_SETTLE_FRAMES) {
  assert(trace.length > settleFrames + 10, `${what}: only ${trace.length} frames of camera trace, the settle window needs ${settleFrames}`);
  let maxUnder = 0;
  let maxStep = 0;
  let maxBack = 0;
  let prevUnder = Infinity; // frame 0 is the seed: the frame the floor moved, nothing has converged yet
  let reached = -1;
  for (let i = 0; i < trace.length; i++) {
    const x = trace[i];
    assert(Number.isFinite(x), `${what}: cam.x became ${x}`);
    assert(x >= 0, `${what}: cam.x went negative (${x}) while converging onto the floor at ${floor}`);
    const under = Math.max(0, floor - x);
    maxUnder = Math.max(maxUnder, under);
    if (i > 0) {
      const d = x - trace[i - 1];
      maxStep = Math.max(maxStep, d);
      maxBack = Math.max(maxBack, -d);
    }
    // Convergence, not oscillation. Until the camera first arrives, its distance to the floor may
    // only shrink; from the frame it arrives, it never leaves. (Arriving from ABOVE counts, and has
    // to: the camera chases the sliding hero past the floor and then settles back down onto it,
    // which is a converging step backwards — the old wall could only ever step forwards.)
    if (reached < 0) {
      if (under <= CAM_REST_EPS) reached = i;
      else assert(under <= prevUnder + CAM_REST_EPS, `${what}: at frame ${i} the camera was ${under.toFixed(4)}px under the floor at ${floor}, having been ${prevUnder.toFixed(4)}px on the previous frame — it is drifting AWAY from its bound instead of converging onto it`);
    } else {
      assert(under <= CAM_REST_EPS, `${what}: cam.x fell back to ${x.toFixed(4)}px, ${under.toFixed(4)}px below the floor at ${floor}, after first arriving at frame ${reached} — the camera oscillates through its own bound`);
    }
    prevUnder = under;
    if (i >= settleFrames) {
      assert(x >= floor - CAM_REST_EPS, `${what}: the camera came to rest at ${x.toFixed(6)}, left of its own checkpoint floor at ${floor}`);
    }
  }
  assert(reached >= 0, `${what}: the camera never arrived at the floor at ${floor} in ${trace.length} frames (ended at ${trace[trace.length - 1].toFixed(4)})`);
  assert(maxUnder <= lag + CAM_REST_EPS, `${what}: the camera dipped ${maxUnder.toFixed(3)}px below the floor at ${floor} — more than the ${lag.toFixed(3)}px of follow lag it carried when the floor moved, so the floor outran the hero instead of the camera easing up to it`);
  return { maxUnder, maxStep, maxBack, reached };
}

// ---------------------------------------------------------------------------
// R36 — the checkpoint is a hard left bound for the hero AND the camera
//
// DISCRIMINATION PROOF (all of these re-run 2026-11-16, messages quoted from the actual FAIL):
// whole src/ at the pre-checkpoint commit → flagLevel() throws `unknown character 'K' at 12,40`.
// src/main.js alone reverted (loader/maps/camera in place, so the bound is never wired up) →
// clause 1: `walking right through the flag at x=640 never armed it (checkpointIndex=-1, hero only
// reached 792.9)` — nothing clamps p.x either, but that is never reached, and it is proven one
// mutation each instead: delete the minX clamp in player.js → clause 2 `the hero walked to
// x=229.17, past the checkpoint at 640`; `lo = 0` in camera.js → clause 2 `the camera scrolled to
// 536.90, left of the checkpoint floor at 544` (R20 fails its own floor clause at the same time).
// The trigger loop disabled → clause 1 again, `…never armed it (checkpointIndex=-1…)`.
// Clause 4 is proved on MAP data alone, since that is what it can break on: 1-2's post moved onto
// the pipe at col 108 → `1-2: the hero has nowhere to walk right after banking the flag at x=1728`;
// one column earlier, at 111 → `1-2: no standable ground within 2 tiles left of the flag at x=1776
// — the hero cannot walk into it`; 1-1's second flag dragged into that map's pipe at col 94 →
// `1-1: the hero has nowhere to walk right after banking the flag at x=1504`. Clauses 1-3 stay
// green in all three, because they run on a level this check builds itself. Clause 4's floor assert
// is deliberately a safety net rather than a proven-separate one: the only mutation that can break
// a camera floor (no floor at all) trips clause 2 first, so it is credited with the real-geometry
// coverage, not with a failure of its own.
//
// CLAUSES 2b AND 4's STEP BOUND (added 2026-11-16) ARE proven-separate, and they are the reason this
// file has any camera-cut teeth on real gameplay at all — until then the only red-on-a-hard-clamp leg
// was clause 3's FORCED cam.x = 0, which its own comment calls "not gameplay". With everything else
// in this check switched off, re-adding the pre-fix `if (cam.x < lo) cam.x = lo;` fails 2b on the
// flagLevel and clause 4 on shipped 1-2, quoted verbatim at each assert. R44 is the same bound on a
// live crossing, both speeds, and is the check the contract comment above points at.
//
// [SUPERSEDED 2026-11-16, FIX PASS 5 — this paragraph read "CLAUSE 1 ALSO OWNS THE CHECKPOINT
// POPUP", and the popup is GONE BY DESIGN: checkpoints are invisible and silent now, so the
// producer it pinned (`G.items.push(makePopup(cp.x, cp.y - TILE, 'CHECKPOINT'));`) no longer exists
// and the FAIL below can never be produced again. The measurement is kept because it is the reason
// the clause existed: nothing in this file asserted the popup was ever pushed (only R41 asserted its
// ABSENCE on a death frame), so deleting the producer outright measured 41/41 pass, exit 0, until
// the clause was added — with it, that same deletion read
//   `FAIL R36 a live left-to-right crossing of an unbanked flag pushed 0 CHECKPOINT popup(s),
//   expected exactly 1 — it is the only on-screen "you resume here" marker, and R41's clause asserts
//   only the death-frame ABSENCE, which no popup at all also satisfies: expected 1, got 0`
// (40/41, that single FAIL). That FAIL is NO LONGER A DEFECT SIGNAL. What needs a guard now is the
// opposite claim — that nothing at all is announced at a post — and `R45` owns it, pixel-wise and
// sound-wise. The same pass deleted this check's `bannerT > 0` and `sfx('power') > 0` asserts.]
//
// CLAUSE 1 NOW OWNS THE CROSSING'S STATE (fix pass 5). What arming has to leave behind is not a
// banner, a fanfare or a popup, it is G.checkpointIndex / G.checkpointX / cp.taken and the two floors
// the game derives from that pair: clause 1 pins the state, clause 1b holds both floors on it, and
// clauses 2/2b/3/3b (seeded by this same crossing) are its shape-and-depth legs. Measured against
// src/main.js: a trigger loop that never arms is red on cross()'s `never armed it`; deleting the bound
// write is red on clause 1's `raises the left bound`; deleting BOTH marking writes is red on four
// checks (R36/R40/R41/R45). Clause 1b re-runs the identical crossing afterwards, and this check's PASS
// line is byte-identical to the one it printed before 1b existed — 8.99px of lag, floor crossed back
// over on frame 6, deepest shipped seed 87.51px, largest shipped step 39.47px, worst screen x 80 — so
// the probe demonstrably did not soften the camera clauses it sits in front of.
// ---------------------------------------------------------------------------

check('R36', () => {
  const level = flagLevel();
  installLevel(level);
  const cp = level.checkpoints[0];
  const FLOOR = cp.x - CAMERA_FOLLOW_X;

  // THE CROSSING, factored out because clause 1b runs it three times over (arm → measure the floors
  // on a clean install → re-arm so clauses 2+ get the state they were written against). installLevel()
  // resets cp.taken and the G.checkpoint* pair, so every run starts from nothing banked, and with a
  // fixed timestep the runs are bit-identical: R36's pass line is byte-for-byte the line this check
  // printed before clause 1b existed (WORKFLOW_STATE.md, FIX PASS 5), which is how "the probe did not
  // soften the camera clauses" is verified rather than asserted.
  const cross = () => {
    installLevel(level);
    const hero = G.player;
    clearInput();
    hero.x = cp.x - 60;
    hero.y = GROUND_TOP - hero.h;
    hero.vx = 0;
    hero.vy = 0;
    input.right = true;
    const res = until(120, () => (G.checkpointIndex === 0 ? { x: hero.x, cam: G.cam.x } : null));
    input.right = false;
    assert(res, `walking right through the flag at x=${cp.x} never armed it (checkpointIndex=${G.checkpointIndex}, hero only reached ${(hero.x).toFixed(1)})`);
    return { p: hero, x: res.x, cam: res.cam };
  };

  // (1) a plain walking pass arms the flag: no jump, no frame-perfect placement, just walking
  // right into the band at the row the shipped maps put it on.
  let armed = cross();
  let p = armed.p;
  // THE STATE THE CROSSING LEAVES BEHIND, which is the whole product now that nothing is announced:
  // which slot armed, that the bound moved to THAT post, that the post reports itself banked, and that
  // the hero was past the post when it armed (a band-overlap arm would not be). The reach of these is
  // MEASURED, because the arming block has two writes that mark a post and each covers the other:
  // deleting `cp.taken = true;` alone measures 43/43 (the re-mark loop below marks the crossed post
  // anyway) and deleting the re-mark loop alone measures 43/43 too (the direct write covers it) — those
  // two are equivalent mutants, not coverage gaps. Delete BOTH and this clause is one of four that go
  // red (here, R40 clause 2, R41, R45). Deleting `G.checkpointX = Math.max(…)` is red right here
  // (`arming a flag raises the left bound to that flag: expected 640, got 0`), and a trigger loop that
  // never arms is red on the `never armed it` message in cross() above.
  eq(G.checkpointIndex, 0, `the crossing armed the wrong slot (checkpointIndex=${G.checkpointIndex})`);
  eq(G.checkpointX, cp.x, 'arming a flag raises the left bound to that flag');
  eq(cp.taken, true, 'the flag reports itself banked once crossed');
  assert(armed.x > cp.x, `the flag armed while the hero was still at x=${armed.x.toFixed(2)}, not past the post at ${cp.x} — the trigger is a crossing, not a band overlap`);

  // (1b) AND THAT STATE HAS TO BE LIVE: both floors derived from G.checkpointX have to hold on the
  // armed post, which is the only thing the player can actually feel. The hero is pinned ON the post
  // and the camera comes to rest EXACTLY on the floor the post derives. Its own install + the
  // identical crossing, then a third identical crossing to hand clauses 2/2b/3/3b the state they were
  // written against: a probe that settled the SHARED state first would have left clause 2's trace
  // seeded on its own floor, i.e. a convergence clause that could no longer fail.
  const probe = cross();
  input.left = true;
  for (let i = 0; i < 240; i++) step();
  input.left = false;
  eq(probe.p.x, cp.x, `holding left for 240 frames after arming left the hero at x=${probe.p.x.toFixed(2)} instead of on the post at ${cp.x} — the armed bound does not clamp the hero`);
  eq(G.cam.x, FLOOR, `the armed post never gave the camera its floor (cam.x=${G.cam.x} against the floor ${FLOOR} derived from G.checkpointX=${G.checkpointX})`);
  armed = cross();
  p = armed.p;

  // (2) hold left, forever: the hero cannot get past the flag, the camera cannot come to rest past
  // its floor, and the hero is held where the player can actually see it.
  //
  // REPLACED ASSERTION (was: `assert(minCam >= FLOOR)` + a clause 3 requiring the floor to be
  // recovered "within the frame"). Both pinned the floor as a WALL the camera is assigned to. That
  // wall is the bug: the camera trails the hero by its follow lag, so when a flag banks the floor
  // moves forward from under it and the assignment teleports the camera 9–16 px in one frame — the
  // jerk. The trace is seeded with the camera's position on the banking frame, which is already
  // `lag` px short of the new floor, and assertFloorConvergence states what is then true: the
  // excursion below the floor is bounded by that lag, the approach is monotone, and it comes to
  // REST on the floor. R44 carries the per-step spike teeth this clause deliberately does not.
  input.left = true;
  const LAG_WALK = measureFollowLag(C.WALK_MAX);
  const LAG_RUN = measureFollowLag(C.RUN_MAX);
  const trace = [armed.cam];
  let minX = Infinity;
  let minScreen = Infinity;
  for (let i = 0; i < 240; i++) {
    step();
    minX = Math.min(minX, p.x);
    trace.push(G.cam.x);
    minScreen = Math.min(minScreen, p.x - Math.floor(G.cam.x));
  }
  input.left = false;
  assert(minX >= cp.x, `the hero walked to x=${minX.toFixed(2)}, past the checkpoint at ${cp.x} — updatePlayer must clamp accepted x to the bound`);
  eq(p.x, cp.x, 'the hero is pinned exactly on the flag');
  const conv = assertFloorConvergence('checkpoint floor (hero pinned after a walk-right bank)', trace, FLOOR, LAG_WALK);
  near(G.cam.x, FLOOR, 1e-6, 'the camera settles on its checkpoint floor');
  assert(minScreen > 60, `a hero pinned at a checkpoint was pushed to screen x=${minScreen.toFixed(1)} — the floor must keep it centred on the CAMERA_FOLLOW_X lead (${CAMERA_FOLLOW_X}), not jammed at the edge`);
  assert(p.x - Math.floor(G.cam.x) + p.w < C.VIEW_W, 'the pinned hero is not fully inside the view');

  // (2b) THE SAME SHOVE, SEEDED BY PLAY. Clause 3 forces cam.x = 0 and is credited with that in its
  // own comment: it proves the recovery is a convey, not a cut, on a state the game cannot generate.
  // It is also the ONLY thing in this file's camera work that was ever red on the old hard clamp,
  // which is the wrong thing to be red on. So the identical depth is reached the way play reaches
  // it — the hero leaves the flag at RUN_MAX and turns back, so the camera parks exactly one run lag
  // under a floor it cannot cross — and the same trace is then judged by assertFollowStep, which
  // states the bound the follow could actually produce. Re-adding `if (cam.x < lo) cam.x = lo;` turns
  // frame 1 of THIS trace into a 15.833 px assignment against a 5.278 px bound (as printed when
  // STEP_FACTOR was 2; at today's 1.5 the same FAIL reads 3.958 px), measured, and it is
  // the first R36 clause to go red.
  G.cam.x = FLOOR - LAG_RUN;
  const turn = [{ cam: G.cam.x, x: p.x, floor: FLOOR }];
  let turnMinScreen = Infinity;
  let turnMaxScreen = -Infinity;
  input.right = true;
  input.run = true;
  let turnArmed = 0;
  for (let i = 0; i < 240 && turnArmed < 90; i++) {
    if (Math.abs(p.x - cp.x) < 2) {
      input.right = false;
      input.left = true;
      turnArmed++;
    }
    step();
    turn.push({ cam: G.cam.x, x: p.x, floor: FLOOR });
    const sx = p.x - Math.floor(G.cam.x);
    turnMinScreen = Math.min(turnMinScreen, sx);
    turnMaxScreen = Math.max(turnMaxScreen, sx);
  }
  input.right = false;
  input.left = false;
  assert(turnArmed >= 90, `the hero never completed its turn-around sweep at the flag (${turnArmed}/90 pinned frames) — this clause needs the camera parked under its floor for a full second`);
  assertFollowStep('flagLevel turn-around at RUN_MAX (camera seeded one run lag under the floor, by play)', turn, level.widthPx);
  assert(turnMinScreen > 60 && turnMaxScreen + p.w < C.VIEW_W, `the turn-around sweep put the hero at screen x ${turnMinScreen.toFixed(1)}…${turnMaxScreen.toFixed(1)} — it must stay well inside the view on every frame`);

  // (3) a camera shoved back to the start of the level — a state no follow can generate, so this is
  // the safety-clamp case and not gameplay — still has to be CONVEYED to the floor, not cut to it.
  // The first frame may not arrive: closing the whole gap at once is exactly the visible pop.
  G.cam.x = 0;
  step();
  assert(G.cam.x > 0 && G.cam.x < FLOOR, `a camera forced to 0 was put at ${G.cam.x.toFixed(2)} by one step (floor ${FLOOR}) — it must start moving toward the floor, not land on it: covering the gap in one frame is what the player sees as a camera cut`);
  const shove = [G.cam.x];
  let onScreenAt = -1;
  for (let i = 1; i < 240; i++) {
    step();
    shove.push(G.cam.x);
    const sx = p.x - G.cam.x;
    if (onScreenAt < 0 && sx >= 0 && sx + p.w < C.VIEW_W) onScreenAt = i;
  }
  // `lag` is the whole gap here: a FORCED camera position is not follow lag, so its depth under the
  // floor carries no information — the convergence shape, the rest state and the step bound below do.
  // The default settle window is enough even for this 544 px seed (it needs ~111 frames of the 150;
  // the deepest GAMEPLAY seed here needs 101 — 87.506 px, the deepest shipped one — see
  // CAM_SETTLE_FRAMES, whose note carried 91 until 2026-11-17 and was corrected to the measured 101).
  const rec = assertFloorConvergence('shoved camera (forced to 0)', shove, FLOOR, FLOOR, CAM_SETTLE_FRAMES);
  // The lerp's biggest possible step across this gap is its FIRST one — (floor − 0) · FOLLOW_RATE =
  // 90.667 px — because the remaining distance only ever shrinks; measured maxStep here is 75.556 px
  // (the first step is the seed and is not diffed). Every later frame must do strictly better, so a
  // step larger than the first one's budget is a cut. This replaces `rec.maxStep < FLOOR / 2`, i.e.
  // 272 px, which would have let a 250 px single-frame jump through and was only ever red on the
  // mutation that also trips the assert above it — a bound with no teeth of its own.
  assert(rec.maxStep <= FLOOR * FOLLOW_RATE * STEP_FACTOR + STEP_TOL, `a camera forced to 0 closed ${rec.maxStep.toFixed(1)}px of the ${FLOOR}px gap in one frame — the follow's largest possible step over this gap is ${(FLOOR * FOLLOW_RATE).toFixed(1)}px (its first), so anything past ${(FLOOR * FOLLOW_RATE * STEP_FACTOR).toFixed(1)}px is a cut, not a recovery`);
  assert(onScreenAt >= 0, `${shove.length} frames after the camera was forced to 0 the hero pinned at x=${cp.x} was still offscreen (cam.x=${G.cam.x.toFixed(2)})`);
  near(shove[shove.length - 1], FLOOR, CAM_REST_EPS, 'the shoved camera ends up exactly on the floor');

  // (3b) and the excursion that IS reachable in play — the camera sitting under its floor by the
  // follow lag — must never put the hero out of the view, on any frame, at either edge. This is the
  // guarantee the deleted `minCam >= FLOOR` was reaching for; it is stated about the hero, which is
  // what the player looks at, instead of about a bound the camera is allowed to be under briefly.
  G.cam.x = FLOOR - LAG_WALK;
  const lagTrace = [G.cam.x];
  let lagWorstScreen = -Infinity;
  let lagBestScreen = Infinity;
  for (let i = 0; i < 240; i++) {
    step();
    lagTrace.push(G.cam.x);
    const sx = p.x - Math.floor(G.cam.x);
    lagWorstScreen = Math.max(lagWorstScreen, sx);
    lagBestScreen = Math.min(lagBestScreen, sx);
  }
  assertFloorConvergence('camera under its floor by exactly one follow lag', lagTrace, FLOOR, LAG_WALK);
  assert(lagBestScreen >= 0 && lagWorstScreen + p.w < C.VIEW_W, `a camera lagging its own floor by the follow lag (${LAG_WALK.toFixed(2)}px) put the pinned hero at screen x ${lagBestScreen.toFixed(1)}…${lagWorstScreen.toFixed(1)} — it must stay inside [0, ${C.VIEW_W}) on every frame`);

  // (4) the same bound asserted on the SHIPPED maps. A flagpost is map data, so an edit to
  // src/levels.js can move one anywhere on its own — onto a ledge the hero cannot walk to, or into
  // a corner the camera floor cannot hold — and clauses 1-3 would never notice, because they run on
  // a level this check builds itself. Here every shipped flag is armed by WALKING right into it
  // (which also proves the post is reachable on foot), the hero runs a few steps further along the
  // run-up ground it then has to come back down, and runs back into the bound at speed; it must stay
  // bounded, on screen, and in its own view throughout, and its camera must never take a step the
  // shipped follow could not have produced.
  //
  // THE SEED, and why its budget is measured rather than assumed. assertFloorConvergence's `lag`
  // budget used to be the run lag alone, on the premise that the trace starts on the frame the flag
  // banked with the camera exactly one follow lag under the new floor. That premise is false twice
  // over: the post arms on BOX contact, so the hero is up to PLAYER_W short of post.x when the floor
  // moves, and the trace is then seeded at the harness's own run-up teleport, which moves the hero
  // 32-200 px without moving the camera at all. Measured deepest dip per shipped flag: 14.445 (1-1
  // f0) / 20.366 (1-1 f1) / 19.007 (1-2 f0) / 87.506 (1-2 f1) / 37.024 (1-3 f0) / 13.835 (1-3 f1)
  // against a 15.833 budget — four false failures, all of them the seed frame, with the frames after
  // it only ever getting shallower (87.506 → 52.959 → 24.243 → 0.425 on 1-2 f1): the product was
  // converging the whole time. CHOSEN FIX: charge each trace its own seed, `max(LAG_RUN, floorX -
  // trace[0])`. LAG_RUN stays the floor of the budget, so a trace seeded at or near the floor is still
  // held to one lag, and the claim becomes "the floor may never outrun the camera deeper than the
  // state the trace started in" — which is what the assert was always reaching for. NOT chosen, and
  // why: dropping the teleport and walking the run-up instead. That was measured, and the reason
  // usually given for the teleport does NOT survive measurement — with 1-2's post moved onto the pipe
  // at col 108, the `nowhere to walk right after banking` assert fires in BOTH variants (`up=null`,
  // because walkableFar() reads the pipe, not the hero), so the geometry teeth are not what the
  // teleport buys. What it buys is that every shipped flag gets an identical full-speed retreat: the
  // run-ups are 32-200 px, and a hero that has to walk one of them starts the retreat at walking pace
  // on the short ones, which is a different clause than "runs back into the bound at RUN_MAX". The
  // frame-0 dip is also NOT excluded from the max — the same carve-out would let clause 3's 544 px
  // seed walk through a "never below the floor" assert.
  const shipped = [];
  let worstScreen = Infinity;
  let deepestSeed = 0;
  let worstLerp = 0;
  for (const def of LEVELS) {
    const level = synth(def);
    for (const [ci, post] of level.checkpoints.entries()) {
      installLevel(level);
      const p = G.player;
      const floorX = post.x - CAMERA_FOLLOW_X;
      clearInput();
      // the maps post a turnip within a screen of their flags; contact is not what this clause
      // measures (R37 does the dying, and makes the same allowance for the same reason)
      p.invulnT = 120;
      const from = walkableFar(level, post.x - 24, -1);
      assert(from !== null, `${def.label}: no standable ground within 2 tiles left of the flag at x=${post.x} — the hero cannot walk into it`);
      p.x = from;
      p.y = GROUND_TOP - p.h;
      p.vx = 0;
      p.vy = 0;
      input.right = true;
      input.run = true;
      const armed = until(240, () => (G.checkpointIndex === ci ? { x: p.x } : null));
      input.right = false;
      assert(armed, `${def.label}: walking right from x=${from.toFixed(1)} never armed the flag at x=${post.x} (checkpointIndex=${G.checkpointIndex}, hero reached ${p.x.toFixed(1)}) — the post is behind something unreachable`);
      // run-up along ground that is actually continuous, so the retreat is a run and not a fall
      const up = walkableFar(level, post.x + 8, 1);
      assert(up !== null && up > post.x, `${def.label}: the hero has nowhere to walk right after banking the flag at x=${post.x}`);
      p.x = up;
      p.vx = 0;
      p.vy = 0;
      input.run = true;
      input.left = true;
      const frames = [{ cam: G.cam.x, x: p.x, floor: Math.max(0, G.checkpointX - CAMERA_FOLLOW_X) }];
      let minX = Infinity;
      let minScreen = Infinity;
      for (let i = 0; i < 240; i++) {
        step();
        minX = Math.min(minX, p.x);
        frames.push({ cam: G.cam.x, x: p.x, floor: Math.max(0, G.checkpointX - CAMERA_FOLLOW_X) });
        minScreen = Math.min(minScreen, p.x - Math.floor(G.cam.x));
      }
      input.left = false;
      const trace = frames.map((f) => f.cam);
      const seed = Math.max(0, floorX - trace[0]);
      deepestSeed = Math.max(deepestSeed, seed);
      worstScreen = Math.min(worstScreen, minScreen);
      assert(minX >= post.x, `${def.label} flag ${ci}: the hero walked to x=${minX.toFixed(2)}, past that map's own checkpoint at ${post.x}`);
      // same smooth-floor contract as clause 2, asserted per shipped map: the hero runs LEFT into the
      // bound at RUN_MAX, so the trace is seeded with the camera under the floor the bank just raised
      // (by `seed`, measured above) and it has to be carried onto it and stay there.
      assertFloorConvergence(`${def.label} flag ${ci} camera floor`, trace, floorX, Math.max(LAG_RUN, seed));
      // and every one of those frames has to be the follow's own step. This is the leg of R36 with
      // teeth on the old wall: measured on a copy with every other camera-cut clause in this file
      // switched off, re-adding `if (cam.x < lo) cam.x = lo;` fails here on shipped geometry —
      // `FAIL R36 1-2 flag 0 camera follow step: at frame 1 the camera moved 19.007px in one frame
      // when its target at 1167.78 (hero x 1263.78, floor 1136) could produce at most 16.928px` (the
      // wall's assignment is 1.12x over the bound on that flag; 1-1's two posts are shallower seeds and
      // pass, which is why this leg is the last line of defence and not the first).
      const lerp = assertFollowStep(`${def.label} flag ${ci} camera follow step`, frames, level.widthPx);
      worstLerp = Math.max(worstLerp, lerp.maxStep);
      assert(minScreen > 60, `${def.label} flag ${ci}: a hero pinned at a shipped checkpoint was driven to screen x=${minScreen.toFixed(1)} — it must stay well inside the view`);
      assert(p.x - Math.floor(G.cam.x) + p.w < C.VIEW_W, `${def.label} flag ${ci}: the pinned hero is not fully inside the view`);
      shipped.push(`${def.label}@${post.x}`);
    }
  }
  return `flag armed by walking (x=${cp.x}); hero pinned at ${p.x.toFixed(0)} with screen x >= ${minScreen.toFixed(0)}, camera floored at ${FLOOR} and carried onto it from ${conv.maxUnder.toFixed(2)}px of lag (crosses back over its own floor on frame ${conv.reached}, exact by the settle window) (deepest shipped seed ${deepestSeed.toFixed(2)}px); same on all ${shipped.length} shipped flags (${shipped.join(' ')}), every frame within ${STEP_FACTOR}x the follow's own step (largest shipped step ${worstLerp.toFixed(2)}px), worst screen x ${worstScreen.toFixed(0)}`;
});

// ---------------------------------------------------------------------------
// R44 — the frame a running hero banks a flag must not cost the camera a step
//
// WHY THIS EXISTS. R36 pins the floor contract as a SHAPE (bounded excursion, monotone approach, rest
// on the bound), and every one of those claims is a statement about a minimum or an endpoint. A hard
// clamp — `if (cam.x < lo) cam.x = lo;` after the lerp, the behaviour shipped until 2026-11-16 — makes
// all four of them TRUE: it never lets the camera under the floor at all, its approach is monotone by
// construction, and it lands exactly on the bound. What it does instead is take the whole recovery in
// ONE FRAME, and nothing in the suite measured a per-frame camera delta on a real crossing, so for
// most of this pass the only leg of the contract with teeth was R36 clause 3, which FORCES cam.x to 0
// — a state its own comment calls "not gameplay". R44 is the missing leg: a hero at WALK_MAX and at
// RUN_MAX crossing a live flagpost in the real loop, with the camera step itself asserted, frame by
// frame, against the step the shipped follow could actually produce (assertFollowStep), plus the
// symptom the player reported stated directly: the banking frame may not be a spike relative to its
// neighbours.
//
// DISCRIMINATION PROOF (measured 2026-11-16, four throwaway copies of the tree under the session
// temp; the repo was never mutated. Full table in WORKFLOW_STATE.md, FIX PASS 4):
//   unmodified tree              -> PASS. 42/42, exit 0. The bank window peaks at exactly the hero's
//                                    own per-frame advance — 1.833 px walking, 3.167 px running — i.e.
//                                    ratio 1.00 against everywhere else in the run, and
//                                    assertFollowStep's worst overshoot over all 1079 traced frames is
//                                    0.000 px.
//   `if (cam.x < lo) cam.x = lo;` re-added after the lerp (the pre-fix behaviour) -> **R44 FAILS**,
//     40/42, exit 1:
//     `FAIL R44 WALK_MAX: in the 31-frame window that starts on the frame the flag at x=640 banked
//     (frame 336), the camera stepped 8.278px in one frame (frame 337, from cam 535.722 to 544.000
//     with its floor at 544) while the largest step anywhere else in the run was 1.833px — a
//     checkpoint banking under a running hero teleported the camera its whole 9.17px follow lag in 1
//     frame(s) after the crossing, which is the jerk the smooth floor replaced (the hero's screen x on
//     that frame: 98.7 of 256)`
//     RUN_MAX fails identically on the same mutation with 15.444 px against 3.167 (measured with the
//     WALK leg removed: `FAIL R44 RUN_MAX: … the camera stepped 15.444px in one frame (frame 200,
//     from cam 528.556 to 544.000 …)`, also 40/42). And with the spike-ratio assert switched OFF
//     entirely the check STILL fails, on the follow-step clause: `FAIL R44 WALK_MAX live bank at
//     x=640: at frame 337 the camera moved 8.278px in one frame when its target at 546.72 (hero x
//     642.72, floor 544) could produce at most 3.667px — 4.5 frames of follow compressed into one,
//     which is a camera cut, not a follow` (40/42), so the result does not rest on one tuned ratio.
//     R36 goes red on the same mutation at the SAME time, and now fails on real play first: `FAIL R36
//     flagLevel turn-around at RUN_MAX (camera seeded one run lag under the floor, by play): at frame
//     1 the camera moved 15.833px in one frame when its target at 544.00 (hero x 640.00, floor 544)
//     could produce at most 5.278px …` — clause 2b, before the synthetic forced-0 shove that used to
//     be the only camera-cut teeth in the file.
//   CAM_EPS = 40 (a 40px snap radius — strictly worse than the bug being fixed: it deletes the follow
//     lag outright, so the camera stops easing at all) -> **R44 FAILS**, 40/42, exit 1, on the very
//     first frame the follow has anything to close, long before the flag:
//     `FAIL R44 WALK_MAX live bank at x=640: at frame 39 the camera moved 0.389px in one frame when
//     its target at 0.39 (hero x 96.39, floor 0) could produce at most 0.130px — 6.0 frames of follow
//     compressed into one, which is a camera cut, not a follow`
//     (the same mutation makes R36 fail too, and there the pop is a big one: `FAIL R36 1-1 flag 0
//     camera follow step: at frame 1 the camera moved 38.389px … could produce at most 12.796px`).
//   [The `could produce at most N px` figures quoted in this table (3.667, 5.278, 12.796) were printed
//   at STEP_FACTOR = 2, which is what the tree said on 2026-11-16. They are left as measured. Re-run at
//   1.5 the same mutations fail the same clause on the same frame with the same step, against a bound
//   that has moved: measured `FAIL R36 flagLevel turn-around at RUN_MAX …: at frame 1 the camera moved
//   15.833px in one frame when its target at 544.00 (hero x 640.00, floor 544) could produce at most
//   3.958px — 6.0 frames of follow compressed into one`, 41/43, and `FAIL R44 WALK_MAX: … the camera
//   stepped 8.278px in one frame … while the largest step anywhere else in the run was 1.833px`, 41/43;
//   CAM_EPS = 40 measures `… could produce at most 9.597px` there now (was 12.796). So the wall is
//   still caught twice over, by both R36 and R44.]
//
// WHAT THE BOUND IS, and why it is not a magic number. STEP_FACTOR is applied to the shipped follow's
// own step for that frame (FOLLOW_RATE · (target − cam), both measured off updateCamera), so the
// legitimate worst case sits at 1/STEP_FACTOR of the allowance — measured 0.000 px of overshoot and
// ratio 1.000 on every frame of all four traces — while the wall sits over it and the snap sits 3.0x
// over it. The spike clause is relative for the same reason: SPIKE × the largest step elsewhere in the
// run, where the shipped code's ratio is EXACTLY 1.00 on both legs (the bank window peaks at 1.833 px
// walking / 3.167 px running, the same figures as everywhere else in the run) and the wall's is 4.52
// (walk) / 4.88 (run).
//
// BOTH FACTORS WERE 2 AND ARE NOW 1.5 (2026-11-17, measured in throwaway copies). At 2.0 the spike
// clause's detection floor was 2 × 1.833 = 3.667 px walking and 2 × 3.167 = 6.333 px running, and a
// PARTIAL clamp — `if (cam.x < lo) cam.x += 0.20 * (lo - cam.x);` after the lerp, a wall wearing a
// lerp's clothes — stepped only 3.122 px / 5.622 px there: under both floors, so it passed the whole
// suite. At 1.5 the floors are 2.750 / 4.750 and the same mutant is red twice over, on the spike clause
// (`FAIL R44 WALK_MAX: … the camera stepped 3.122px in one frame … while the largest step anywhere else
// in the run was 1.833px …`, and on the RUN leg 5.622 against 3.167) and on the follow-step clause
// (`FAIL R36 flagLevel turn-around at RUN_MAX …: at frame 1 the camera moved 5.278px … could produce at
// most 3.958px …`). Margin check, the part that matters: the shipped traces did not move at all — still
// ratio 1.000, i.e. a third of the allowance unused — while the escape sits at 1.70/1.77. Nothing
// legitimate is anywhere near 1.5, so the tightening buys the mutant without making a clause brittle;
// no clause here was tuned down to a measured figure. The clean tree at 1.5 is 43/43, exit 0, md5
// stable across runs.
// ---------------------------------------------------------------------------

check('R44', () => {
  const SPIKE = 1.5;  // bank-window step, as a multiple of the largest step anywhere else in the run.
                      // Was 2; tightened 2026-11-17 because at 2.0 a 20%-per-frame partial clamp on the
                      // floor deficit slipped the whole suite — see the "BOTH FACTORS" note above R44.
  const MIN_RUN = 30; // frames of full-speed running required before the flag may bank
  const lines = [];

  for (const [speed, run] of [['WALK_MAX', false], ['RUN_MAX', true]]) {
    const vmax = C[speed];
    const lag = measureFollowLag(vmax);
    const level = flagLevel({ cols: 120, flag: [C.ROWS - 3, 40] });
    installLevel(level);
    const p = G.player;
    const cp = level.checkpoints[0];
    const FLOOR = cp.x - CAMERA_FOLLOW_X;
    clearInput();
    p.x = 2 * C.TILE;
    p.y = GROUND_TOP - p.h;
    p.vx = 0;
    p.vy = 0;
    p.invulnT = 120;
    input.right = true;
    input.run = run;

    // (1) run into an UNBANKED flag in the real loop until it banks, then keep running for AFTER more
    // frames, tracing camera + hero + the floor the loop actually handed updateCamera. Nothing is
    // teleported and the camera is never touched: this is the crossing a player performs, and the
    // flag is live.
    //
    // AND WHY THE TRACE DOES NOT STOP AT THE FLAG. main.js reads checkpointBounds() at the TOP of
    // updateState, before updatePlayer can arm anything, so the frame on which a post arms is still
    // running on the PREVIOUS frame's floor: the measured bank frame here steps 3.167px, exactly like
    // every other frame, and the wall's assignment lands on the frame after it (cam 528.556 -> 544.000
    // = 15.444px, measured on the same mutation). A check that stops at the crossing frame — which is
    // what this one did until it was measured — is blind to the exact bug it exists to catch.
    const AFTER = 30; // frames of running to give the new floor time to arrive (a lag needs ~15)
    const frames = [{ cam: G.cam.x, x: p.x, floor: Math.max(0, G.checkpointX - CAMERA_FOLLOW_X) }];
    let bank = -1;
    for (let i = 0; i < 400; i++) {
      step();
      frames.push({ cam: G.cam.x, x: p.x, floor: Math.max(0, G.checkpointX - CAMERA_FOLLOW_X) });
      if (bank < 0 && G.checkpointIndex === 0) bank = frames.length - 1;
      if (bank >= 0 && frames.length > bank + AFTER) break;
    }
    assert(bank > MIN_RUN, `${speed}: the flag at x=${cp.x} banked at frame ${bank} — the scenario needs the hero already at full speed, so it must run for at least ${MIN_RUN} frames first (hero reached x=${p.x.toFixed(1)})`);
    assert(frames.length > bank + AFTER, `${speed}: only ${frames.length} frames of trace after banking at ${bank}; the floor-change window needs ${AFTER}`);
    const d = frames.slice(1).map((f, j) => f.cam - frames[j].cam); // d[i] is the step onto frame i+1
    const at = (i) => d[i - 1];

    // (2) THE BANK WINDOW: the frame the post arms and the AFTER frames it takes the new floor to
    // arrive. No frame in it may step further than SPIKE times the largest step anywhere else in the
    // run — the hero is at full speed on both sides, so the legitimate answer is 1.00, and a
    // checkpoint that teleports the camera is the only way to get more. Measured on the shipped code:
    // the window's worst step IS the hero's own per-frame advance (1.833 / 3.167 px), i.e. ratio 1.00.
    const winLo = bank;
    const winHi = frames.length - 1;
    let spike = 0;
    let spikeAt = -1;
    let quiet = 0;
    let quietHero = 0;
    for (let i = 1; i < frames.length; i++) {
      const s = Math.abs(at(i));
      if (i >= winLo && i <= winHi) {
        if (s > spike) { spike = s; spikeAt = i; }
      } else {
        quiet = Math.max(quiet, s);
        quietHero = Math.max(quietHero, frames[i].x - frames[i - 1].x);
      }
    }
    const bankStep = at(bank);
    const heroStep = frames[bank].x - frames[bank - 1].x;
    assert(heroStep > vmax * C.STEP * 0.95, `${speed}: the hero was moving ${heroStep.toFixed(3)}px/frame on the bank frame, not the ${(vmax * C.STEP).toFixed(3)}px of ${speed} — the scenario degenerated (hero x=${frames[bank].x.toFixed(1)})`);
    assert(quietHero > vmax * C.STEP * 0.95, `${speed}: nothing to compare against — the hero never reached ${speed} outside the bank window (max hero step ${quietHero.toFixed(3)}px/frame)`);
    assert(spike > 0, `${speed}: the camera never moved in ${frames.length} frames, so the spike comparison below could not fail`);
    assert(spike <= quiet * SPIKE + STEP_TOL, `${speed}: in the ${AFTER + 1}-frame window that starts on the frame the flag at x=${cp.x} banked (frame ${bank}), the camera stepped ${spike.toFixed(3)}px in one frame (frame ${spikeAt}, from cam ${frames[spikeAt - 1].cam.toFixed(3)} to ${frames[spikeAt].cam.toFixed(3)} with its floor at ${FLOOR}) while the largest step anywhere else in the run was ${quiet.toFixed(3)}px — a checkpoint banking under a running hero teleported the camera its whole ${lag.toFixed(2)}px follow lag in ${(spikeAt - bank)} frame(s) after the crossing, which is the jerk the smooth floor replaced (the hero's screen x on that frame: ${(frames[spikeAt].x - Math.floor(frames[spikeAt].cam)).toFixed(1)} of ${C.VIEW_W})`);

    // (3) and every one of those frames, plus all the others, against the follow's own step: no frame
    // may move the camera further than the lerp could have carried it, in either direction.
    const follow = assertFollowStep(`${speed} live bank at x=${cp.x}`, frames, level.widthPx);

    // (4) the excursion the bank leaves behind, and the hero's own visibility. On the bank frame the
    // camera sits exactly `lag − (hero x − cp.x)` under the floor — measured 15.444 px at RUN_MAX
    // (15.833 − 0.389) and 8.278 px at WALK_MAX (9.167 − 0.889) — because the post arms on BOX
    // contact, so the hero is a hair past the post when the floor moves and the target the lag was
    // measured against is that much ahead of it. On the shipped maps that deficit grows to a whole
    // PLAYER_W (1-1 flag 0 seeds 14.445 px and flag 1 20.366 px against a 15.833 lag), which is
    // harness geometry, not camera slack. Both terms are measured, not assumed.
    const boxDeficit = Math.max(0, cp.x - frames[bank].x);
    let maxUnder = 0;
    let minScreen = Infinity;
    let maxScreen = -Infinity;
    for (let i = bank; i < frames.length; i++) {
      maxUnder = Math.max(maxUnder, FLOOR - frames[i].cam);
      const sx = frames[i].x - Math.floor(frames[i].cam);
      minScreen = Math.min(minScreen, sx);
      maxScreen = Math.max(maxScreen, sx);
    }
    assert(maxUnder <= lag + boxDeficit + CAM_REST_EPS, `${speed}: after banking, the camera sat ${maxUnder.toFixed(3)}px under the floor at ${FLOOR} — more than the ${lag.toFixed(3)}px of ${speed} lag it was carrying plus the ${boxDeficit.toFixed(3)}px the hero's box was short of the post, so the bound outran the camera instead of the camera easing up to it`);
    assert(minScreen >= 0 && maxScreen + p.w < C.VIEW_W, `${speed}: the crossing put the hero at screen x ${minScreen.toFixed(1)}…${maxScreen.toFixed(1)} — it must stay inside [0, ${C.VIEW_W}) on every frame`);

    // (5) the half the clamp got "for free" and this check still requires: with the hero still running
    // the camera is well clear of the floor, run it back into the bound and require the SAME rest
    // state — monotone approach, never back below the floor, and exactly on it, from the follow and
    // not from an assignment.
    let runUp = 0;
    while (p.x < cp.x + 250 && runUp < 600) { step(); runUp++; }
    assert(p.x >= cp.x + 200, `${speed}: the hero never ran clear of the flag (${runUp} frames, x=${p.x.toFixed(1)}, target ${cp.x + 250}) — the run back needs the camera above its floor first`);
    clearInput();
    input.left = true;
    input.run = run;
    const back = [{ cam: G.cam.x, x: p.x, floor: FLOOR }];
    let minBackX = Infinity;
    for (let i = 0; i < 240; i++) {
      step();
      back.push({ cam: G.cam.x, x: p.x, floor: FLOOR });
      minBackX = Math.min(minBackX, p.x);
    }
    input.left = false;
    input.run = false;
    assert(minBackX >= cp.x, `${speed}: the run back put the hero at x=${minBackX.toFixed(2)}, through the checkpoint at ${cp.x}`);
    const backFollow = assertFollowStep(`${speed} run back onto the floor`, back, level.widthPx);
    assertFloorConvergence(`${speed} run back onto the checkpoint floor`, back.map((f) => f.cam), FLOOR, lag);
    eq(G.cam.x, FLOOR, `${speed}: the camera does not come to rest EXACTLY on its floor — the follow must collapse the last sub-representable sliver (CAM_EPS), which the old wall got by assigning the bound outright`);
    const restScreen = p.x - Math.floor(G.cam.x);
    assert(restScreen > 60 && restScreen + p.w < C.VIEW_W, `${speed}: at rest on the floor the hero sat at screen x=${restScreen.toFixed(1)} — the ${CAMERA_FOLLOW_X}px lead is what keeps it centred`);
    lines.push(`${speed}: bank frame ${bank} steps ${bankStep.toFixed(3)}px and the ${AFTER}-frame window after it peaks at ${spike.toFixed(3)}px (frame ${spikeAt}) against ${quiet.toFixed(3)}px everywhere else, lag ${lag.toFixed(2)}, deepest ${maxUnder.toFixed(2)}px under; ${frames.length}+${back.length} frames all within ${STEP_FACTOR}x the follow's own step (largest ${follow.maxStep.toFixed(2)}px / ${backFollow.maxStep.toFixed(2)}px back); rests exactly on ${FLOOR}`);
  }
  return lines.join(' | ');
});

// ---------------------------------------------------------------------------
// R37 — death puts the hero back at the flag it banked, not at the level start
//
// DISCRIMINATION PROOF: FAILs on the pre-change tree — `parseLevel` builds no `checkpoints` and no
// shipped map carries a `K`, so `G.level.checkpoints.length` throws on the first line. With
// everything else in place but ONLY src/main.js reverted (no trigger loop either) it fails earlier
// still, at the arming clause: `walking through 1-1's flag 0 at x=880 never armed it
// (checkpointIndex=-1, hero at 948.0, state=PLAYING)`. The mutation this check is actually aimed at
// is the respawn alone — keep the trigger loop and reduce respawnAtCheckpoint to a plain
// `loadLevel(G.levelIndex)` — and then it FAILs on the substance, on the FIRST respawn assert:
// `the hero respawned at x=34.0 — that is the level start, not the checkpoint at 880`. (The
// `eq(q.x, cp.x)` assert below it states the same fact and is not what fires.) Looping the scenario
// over every index is what makes the second flag — the one a player has actually earned — a tested
// case rather than an assumed one: the `respawn` mutation above fails it at flag 0, and a respawn
// hard-wired to the first slot (`const index = 0;`) fails only there — `the banked flag survives the
// level rebuild: expected 1, got 0`. The final scenario (no flag banked) is the guard that the old
// full-restart path is still byte-for-byte the behaviour.
//
// The prevX assert is proven on its own, and it needs its own proof because nothing else can see
// it: delete `p.prevX = p.x;` from respawnAtCheckpoint — the line whose own comment states the
// contract — and R40 and R41 both stay green, because the respawned hero's own post is behind the
// scan window and prevX is refreshed by the very next updatePlayer call (see the inline note on the
// assert below: it is state hygiene, not a live defect). This check is the one that goes red, at
// flag 0: `the respawn left p.prevX at 34 — the crossing test reads it as the last accepted x, so it
// has to be the checkpoint: expected 880, got 34` (34 is the H spawn the rebuild started from).
// ---------------------------------------------------------------------------

check('R37', () => {
  // Driven on the SHIPPED 1-1, not a synthetic map: resolving a death calls loadLevel(), which
  // re-parses LEVELS[G.levelIndex] — a hand-installed level would be replaced under the check.
  newGame();
  const n = G.level.checkpoints.length;
  assert(n >= 2, `${G.level.label} ships with ${n} checkpoints, so the respawn has nothing to aim at`);
  const lines = [];

  // Every bankable flag, in map order. index >= 1 is the case the feature exists for: it is the
  // only one that proves the level rebuild re-seats the hero somewhere other than its own first
  // flag, and that the flags behind the bound come back taken.
  for (let index = 0; index < n; index++) {
    newGame();
    const cp = G.level.checkpoints[index];
    const p = G.player;
    const lives0 = G.lives;
    clearInput();

    // arm it by walking into it from the nearest standable ground on its left (invulnerable: 1-1
    // posts a turnip right here, and being mauled mid-scenario is not what this measures). Each
    // flag starts from its own footing because 1-1 has a pit between the two — walking the whole
    // level would be a jump test, not a respawn test.
    p.invulnT = 60;
    const from = walkableFar(G.level, cp.x - 24, -1);
    assert(from !== null, `${G.level.label}: no standable ground within 2 tiles left of the flag at x=${cp.x}`);
    p.x = from;
    p.y = GROUND_TOP - p.h;
    p.vx = 0;
    p.vy = 0;
    input.right = true;
    input.run = true;
    const armed = until(240, () => (G.checkpointIndex === index ? { done: true } : null));
    input.right = false;
    input.run = false;
    assert(armed, `walking through ${G.level.label}'s flag ${index} at x=${cp.x} never armed it (checkpointIndex=${G.checkpointIndex}, hero at ${p.x.toFixed(1)}, state=${G.state})`);

    // die well to the right of it, then let the 1.2 s death window run out
    p.x = cp.x + 160;
    p.y = GROUND_TOP - p.h;
    p.vx = 0;
    p.vy = 0;
    G.dyingT = 0;
    killPlayer(p, true);
    const respawned = until(150, () => (G.player !== p ? { at: G.player.x } : null));
    assert(respawned, `flag ${index}: the death never resolved (state=${G.state}, dyingT=${G.dyingT.toFixed(2)})`);
    const q = G.player;
    assert(G.state === 'PLAYING', `flag ${index}: respawn left state=${G.state}`);
    eq(G.lives, lives0 - 1, 'a life is still the cost of dying');
    assert(q.x > G.level.playerSpawn.x + 100, `the hero respawned at x=${q.x.toFixed(1)} — that is the level start, not the checkpoint at ${cp.x}`);
    eq(q.x, cp.x, `flag ${index}: the hero comes back on the flag it banked`);
    eq(q.y, (cp.row + 1) * C.TILE - q.h, 'feet on the flagpost standing surface');
    // STATE HYGIENE / defence-in-depth, the same class as `G.dyingT = 0` in loadLevel: `prevX` is
    // the field main.js's crossing test reads as "the last ACCEPTED x", and after a respawn the only
    // true value for it is the checkpoint, not the H spawn the rebuild started from.
    //
    // [CORRECTED 2026-11-16 — this comment used to justify the assert with a counterfactual that
    // cannot occur: "…so the hero's first step rightward re-reads as a crossing of its own post". It
    // cannot: the trigger scan starts at `G.checkpointIndex + 1` (main.js:464), respawnAtCheckpoint
    // re-imposes the index before the hero ticks again (main.js:161), so the hero's own post is
    // behind the scan window for as
    // long as it is banked; and updatePlayer rewrites `p.prevX` on the next call it makes
    // (player.js:180, `p.prevX = xBeforeStep;`), so a stale seed never survives a single frame. Both
    // citations were re-read from the live file rather than copied from the punch-list.]
    //
    // So the honest claim is: nothing shipped can observe an unseeded prevX today, which is exactly
    // why it is asserted rather than commented. It is a latent lie — a scan that started at 0, or a
    // respawn that stopped re-imposing the index, would make it load-bearing — and R40/R41 both stay
    // green without it (proof in the header), so this is the only clause that would notice.
    eq(q.prevX, cp.x, `flag ${index}: the respawn left p.prevX at ${q.prevX} — the crossing test reads it as the last accepted x, so it has to be the checkpoint`);
    const ty0 = Math.floor(q.y / C.TILE);
    const ty1 = Math.floor((q.y + q.h - 0.001) / C.TILE);
    for (let ty = ty0; ty <= ty1; ty++) {
      for (let tx = Math.floor(q.x / C.TILE); tx <= Math.floor((q.x + q.w - 0.001) / C.TILE); tx++) {
        assert(!isSolid(G.level.tiles[ty][tx]), `the respawn buried the hero in a solid tile at ${tx},${ty}`);
      }
    }
    eq(G.cam.x, cp.x - CAMERA_FOLLOW_X, `flag ${index}: the camera comes back on the checkpoint floor, not at 0`);
    eq(G.checkpointIndex, index, 'the banked flag survives the level rebuild');
    eq(G.checkpointX, cp.x, 'the left bound survives the level rebuild');
    eq(G.level.checkpoints[index].taken, true, 'the flagpost is still drawn as banked after the reload');
    // the flags behind the bound are re-marked by the rebuild, the ones ahead are not
    for (let j = 0; j < n; j++) {
      const want = j <= index;
      eq(G.level.checkpoints[j].taken, want, `flag ${j} after respawning on flag ${index} (every post at or behind the bound is taken, nothing ahead of it)`);
    }
    lines.push(`died right of flag ${index} (${cp.x}) → back at ${q.x.toFixed(0)}, cam ${(cp.x - CAMERA_FOLLOW_X).toFixed(0)}`);
  }

  // no flag banked: exactly the old behaviour — full restart at the H spawn, camera at 0
  newGame();
  const p2 = G.player;
  clearInput();
  p2.y = GROUND_TOP - p2.h;
  G.dyingT = 0;
  killPlayer(p2, true);
  const back = until(150, () => (G.player !== p2 ? { done: true } : null));
  assert(back, 'dying with no checkpoint banked never resolved');
  eq(G.player.x, G.level.playerSpawn.x, 'an unbanked level still restarts at the H spawn');
  eq(G.player.y, G.level.playerSpawn.y, 'spawn y unchanged for the no-checkpoint path');
  eq(G.cam.x, 0, 'the camera still restarts at 0 with nothing banked');
  eq(G.checkpointIndex, -1, 'nothing is banked after a cold restart');
  eq(G.checkpointX, 0, 'the left bound is the map edge again');
  return `${G.level.label}: ${lines.join('; ')}; no flag → H spawn ${G.level.playerSpawn.x}`;
});

// ---------------------------------------------------------------------------
// R38 — shipped flagposts (map data): two per level, on solid ground, clear air in the trigger
//       band, before the exit, and spaced roughly two screens apart
//
// WHAT THIS CHECK IS ABOUT SINCE FIX PASS 5: `K` is invisible authoring data. The post sprite and
// the arrival feedback are deleted (`R45` fails if any draw or announcement at a post comes back),
// so nothing here may be justified by what the art inks. The band it keeps demanding is justified
// by config.js's CHECKPOINT_TRIGGER_* constants, which still drive real gameplay: main.js arms a
// post on a left-to-right crossing of that box, and respawnAtCheckpoint() puts the hero back INSIDE
// it, so the box and its jump-in approach have to stay flyable whatever is drawn there.
//
// [SUPERSEDED 2026-11-16, FIX PASS 5 — the two lines above used to end "…before the exit; and a
// banked flag must not be drawn identically to a live one", and the DISCRIMINATION PROOF below used
// to read "The art clause fails if drawCheckpoint ignores `taken`, which is the only thing telling
// the player a flag is already spent." There is no art clause any more: `drawCheckpoint` is deleted
// from src/sprites.js, so this check importing it threw `fn is not a function` the moment the sprite
// went, and the banked-vs-live colour compare went with it. That coverage is GONE, deliberately, and
// is NOT replaced: a state that cannot be seen cannot be colour-checked, and `cp.taken` is now proved
// as state by R36 clause 1 / R37 / R40 / R45 instead. Everything else in this header is live.]
//
// DISCRIMINATION PROOF: FAILs on the pre-change tree — no level carries a `K`, so
// `level.checkpoints` is undefined and `cps.length` throws on the first level (with the loader
// field added but the maps untouched it fails the same way with `0 checkpoints, expected 2`).
// PASSes with two grounded flags per map. The clearance clause asks the full 4-row trigger band over
// the post AND the two columns either side — 4 rows because CHECKPOINT_TRIGGER_TOP is 4 tiles, and
// two columns either side because that is where a respawn's first jump actually arcs, R43 measuring
// the respawn that starts inside this exact box — and each mutation below was re-run against it:
// 1-2's post one column early (111) → `1-2: the flag at col 111 has | in the walk-up column 109,9`;
// 1-2's post one column early (111) → `1-2: the flag at col 111 has | in the walk-up column 109,9`;
// 1-1's second flag at 94, against its pipe → `1-1: the flag at col 94 is walled in by | at 95,10`;
// 1-2's post buried in the pipe at 108 → `1-2: the flag at col 108 is walled in by | at 108,9`; a
// solid planted at col 110 row 9 → `1-2: the flag at col 112 has X in the walk-up column 110,9`,
// and at row 10 → `…has X in the walk-up column 110,10` (both of those PASSED this check before the
// band was restored to full height, which is the hole this clause closes); ground dug out under a
// post → `level 1-2: 'K' at 12,112 has no solid tile below` (the loader gets there first:
// `NEEDS_GROUND` covers `K`); 1-2's two posts dragged to cols 21/91 → `the two flags are 70 columns
// apart, expected roughly two screens (24..48)`. And the exception table cannot rot: with the post
// at col 105 nothing passes over its tile, so the audit FAILs `the R38 clearance exception for 1-2
// (114,9) 'P' was consulted 0 time(s), expected exactly 1` — that is the ONE direction it can fire;
// the `2 times` side is unreachable by a map edit, as the note at the audit itself records.
//
// THE ONE RULE THIS CHECK CHANGED, recorded because nothing here is committed and an auditor
// otherwise cannot recover it. SUPERSEDED (fix pass 2026-11-16) — reconstructed, not quoted:
// the previous clause is unrecoverable from git, so this is the best reconstruction from
// WORKFLOW_STATE.md ("it used to demand an empty 5-wide × 4-tall box around every flagpost") plus
// the neighbouring clauses that were never touched. WORDING IS APPROXIMATE, THE SHAPE IS NOT: it
// was exactly today's band clause (post ±2 columns × the 4 rows cp.row-3…cp.row, required clear)
// with NO exception list, i.e. today's clause minus `CLEARANCE_EXCEPTIONS` below.
// What it rejected on shipped 1-2 data: the pipe at 108-109, the authored bonus block at (114,9)
// and the `=` ledge from col 120 — so no cell in the 110-115 window could pass it, which is why
// the earlier pass narrowed it to "full band over ±1, walking height at ±2". That narrowing is
// what opened the head-height hole: a solid at (110,9) or (110,10) passed both this check and
// R36, and either one clips a respawn's first jump at y≈160 — the exact defect class that makes
// 1-2's route hard. The band is therefore back at full height over ±2 and the shipped obstruction
// it would reject is handled by name, below, rather than by loosening the band a second time.
// ---------------------------------------------------------------------------

// The clearance band's ONLY exceptions, one entry per shipped tile. Explicit and auditable on
// purpose: it names level + col + row + the character that must be there, so a NEW obstruction
// anywhere — same row, one column over, or this cell holding a different character — FAILs loudly
// instead of being accommodated. This is not a region waiver and must not grow casually: adding
// an entry is a statement that a shipped tile now obstructs a flagpost's jump-in.
const CLEARANCE_EXCEPTIONS = [
  {
    level: '1-2', col: 114, row: 9, ch: 'P', hits: 0,
    why: 'the authored bonus block two columns right of 1-2\'s col-112 post. It bounds the '
       + 'clearing take-off strip on the left and is pre-existing terrain this change must not '
       + 'move; `R43` measures the respawn it sits beside (21/180 run+jump timings clear the '
       + 'pit), so it is known-hard-but-playable rather than unknown.',
  },
];

// THE BAND R38 SWEEPS, DERIVED RATHER THAN WRITTEN OUT (2026-11-17). main.js builds the trigger box as
// `{ x: cp.x, y: cp.y - CHECKPOINT_TRIGGER_TOP, w: CHECKPOINT_TRIGGER_W, h: TOP + BOTTOM }`
// (main.js:466-471), and `cp.y` is the TOP of the post's own tile, so in tile rows the box the game
// actually arms on is `cp.row - TOP/TILE + 1 … cp.row + BOTTOM/TILE - 1` — rows 9..12 as shipped — and
// in columns `tx … tx + W/TILE - 1`. Rows are therefore read off the three product constants here, once;
// they were written as the literal `cp.row - 3 … cp.row` in the loop below, and that is a hole with a
// measurement behind it: narrowing the loop to `cp.row - 3 … cp.row - 1` measured 43/43, i.e. a solid
// planted in the POST'S OWN ROW inside the band stopped being checked by anything (throwaway copy,
// `1-2`'s col-112 post with 'X' planted at (114,12): clean tree FAILs `1-2: the flag at col 112 has X in
// the walk-up column 114,12`, same map with the narrowed loop PASSes R38 — R43 is red in that run for a
// different reason, so the band clause was the only thing that went quiet). Same story for the width:
// the ground sweep written as `d = -2 … 2` was reduced to `d = 0` and measured 43/43.
//
// So the two numbers come from here, and the loops that use them are audited against what they ACTUALLY
// walked — the sweptAirRows / sweptAirCols / sweptGroundCols sets, collected inside the loops and
// compared after them: an audit derived from the same constant as the loop would be tautological, so the
// thing it catches is a hand-edited loop bound, which is the mutation class that was silent. The width
// is not a trigger property — the outer ring is where a respawn's first jump arcs (R43 measures that arc) — so it
// gets its own named constant, with the one relation to the product that IS load-bearing asserted: the
// ring must reach at least as far each way as the trigger box is wide, i.e. it can never become narrower
// than the box the game arms on.
const CLEARANCE_BAND_COLS = 2;
const CHECKPOINT_BAND_ROW_OFFSETS = (() => {
  const offs = [];
  for (let o = -C.CHECKPOINT_TRIGGER_TOP / C.TILE + 1; o <= C.CHECKPOINT_TRIGGER_BOTTOM / C.TILE - 1; o++) offs.push(o);
  return offs;
})();
const CHECKPOINT_BAND_COL_OFFSETS = [];
for (let d = -CLEARANCE_BAND_COLS; d <= CLEARANCE_BAND_COLS; d++) CHECKPOINT_BAND_COL_OFFSETS.push(d);

check('R38', () => {
  for (const e of CLEARANCE_EXCEPTIONS) e.hits = 0;
  const bad = [];
  const sweptAirRows = new Set();
  const sweptAirCols = new Set();
  const sweptGroundCols = new Set();
  for (const def of LEVELS) {
    const level = parseLevel(def);
    const cps = level.checkpoints;
    if (cps.length !== 2) {
      bad.push(`${def.label}: ${cps.length} checkpoints, expected 2`);
      continue;
    }
    const exitX = level.gate ? level.gate.x : level.boss ? level.boss.x : Infinity;
    let prev = -Infinity;
    for (const cp of cps) {
      const tx = cp.x / C.TILE;
      if (cp.x <= prev) bad.push(`${def.label}: level.checkpoints is not sorted by ascending x`);
      prev = cp.x;
      if (cp.x >= exitX) bad.push(`${def.label}: the flag at col ${tx} sits at or past the level exit ${exitX}`);
      if (level.tiles[cp.row][tx] !== '.') bad.push(`${def.label}: the flag tile at ${tx},${cp.row} was not cleared to '.'`);
      // continuous solid ground for the whole width of the band under and beside the post...
      for (const d of CHECKPOINT_BAND_COL_OFFSETS) {
        sweptGroundCols.add(d);
        if (!isSolid(level.tiles[cp.row + 1][tx + d]) || !isSolid(level.tiles[cp.row + 2][tx + d])) {
          bad.push(`${def.label}: the flag at col ${tx} stands over a pit (col ${tx + d} row ${cp.row + 1})`);
        }
      }
      // ...and clear air through the WHOLE trigger band over the post and TWO columns either side.
      // The band is config.js's CHECKPOINT_TRIGGER_TOP/BOTTOM box (CHECKPOINT_BAND_ROW_OFFSETS above:
      // rows cp.row-3…cp.row, because TOP is 4 tiles and BOTTOM the tile under cp.y that the hero stands
      // on), NOT anything about art — the post is invisible now, and the box is real because main.js arms
      // on a crossing of it and respawnAtCheckpoint() drops the hero inside it. Full band height out to
      // ±2 columns, not just walking height, because that outer ring is exactly where a respawn's first
      // jump arcs. A solid at (post±2, cp.row-3/-2) head-bumps the jump at y≈160 and drops the hero into
      // the pit ahead of the post — the failure that makes a respawn hard rather than merely tight. The
      // one shipped tile the band would reject is named in CLEARANCE_EXCEPTIONS above; nothing else is
      // waived. Row `cp.row` itself is in here on purpose: it is the row the respawned hero's own box
      // occupies, and it is the row a hand-narrowed loop used to skip (see the DERIVED note above).
      for (const d of CHECKPOINT_BAND_COL_OFFSETS) {
        sweptAirCols.add(d);
        for (const off of CHECKPOINT_BAND_ROW_OFFSETS) {
          const ty = cp.row + off;
          sweptAirRows.add(off);
          const ch = level.tiles[ty][tx + d];
          if (!isSolid(ch)) continue;
          const exc = CLEARANCE_EXCEPTIONS.find((e) => e.level === def.label && e.col === tx + d && e.row === ty);
          if (exc) {
            if (ch !== exc.ch) bad.push(`${def.label}: the clearance exception for ${tx + d},${ty} expects '${exc.ch}' and found '${ch}' — fix the map or the entry, and say why`);
            exc.hits++;
            continue;
          }
          const where = Math.abs(d) === 2 ? `has ${ch} in the walk-up column ${tx + d},${ty}` : `is walled in by ${ch} at ${tx + d},${ty}`;
          bad.push(`${def.label}: the flag at col ${tx} ${where}`);
        }
      }
    }
    const gap = (cps[1].x - cps[0].x) / C.TILE;
    if (gap < 24 || gap > 48) bad.push(`${def.label}: the two flags are ${gap} columns apart, expected roughly two screens (24..48)`);
  }
  assert(bad.length === 0, bad[0]);
  // [ORDER MATTERS, 2026-11-17: the clearance-exception audit moved BELOW the band pins and the swept-set
  // audits that follow. It used to run first, and that made any width pin placed after it unreachable in
  // practice — narrowing the ring to ±1 stops consulting the (114,9) exception, so the `hits === 0`
  // message printed and the width claim was never the thing measured (measured, before the move:
  // `CLEARANCE_BAND_COLS = 1` → `…consulted 0 time(s)…`, 42/43). Re-measured after the move, that
  // mutation now fails on the width assert. The exception audit's own documented proof (1-2's post moved
  // to col 105 → `…was consulted 0 time(s)…`) survives the move unchanged: that mutation leaves every
  // pin above it satisfied, so the audit is still the message that prints.]

  // THE BAND THIS CHECK CLEARS IS THE BAND THE GAME TRIGGERS ON — asserted, not implied. Until fix
  // pass 5 that coupling was proved by the post art, which was inked to exactly the trigger box (see
  // the superseded note in this check's header). With the art deleted, "4 rows of air over the post"
  // in the clause above is a bare literal with nothing tying it to gameplay, so the constants that
  // generate main.js's real box are pinned here instead: widen or shrink CHECKPOINT_TRIGGER_* and
  // this goes red until the band above is re-derived from it, which is the only way a respawn ends up
  // jumping into a tile this check never looked at.
  const rowsTop = C.CHECKPOINT_TRIGGER_TOP / C.TILE;
  const rowsBottom = C.CHECKPOINT_TRIGGER_BOTTOM / C.TILE;
  eq(rowsTop, 4, `R38 clears rows cp.row-3…cp.row over every post, but CHECKPOINT_TRIGGER_TOP is ${C.CHECKPOINT_TRIGGER_TOP}px (${rowsTop} tiles) — this check is clearing air main.js does not trigger on`);
  eq(rowsBottom, 1, `R38 treats the tile under cp.y as the surface the hero stands on inside the band, but CHECKPOINT_TRIGGER_BOTTOM is ${C.CHECKPOINT_TRIGGER_BOTTOM}px (${rowsBottom} tiles) — the trigger now reaches below the ground this check requires`);
  eq(C.CHECKPOINT_TRIGGER_W, C.TILE * 2, `R38 clears the post's own column plus one either side, and the trigger starts at cp.x and is ${C.CHECKPOINT_TRIGGER_W}px wide (${C.CHECKPOINT_TRIGGER_W / C.TILE} tiles) — if that stops being 2 tiles, the x-extent cleared here is not the x-extent that arms`);
  // THE ROW SET THE SWEEP IS SUPPOSED TO PRODUCE, pinned as a set and not just as two counts. The two
  // `eq`s above pin the constants; they cannot see the DERIVATION drift (a `+ 1` becoming a `+ 2` keeps
  // TOP at 4 and quietly moves the band off the hero's own row). This is the reachable half of that
  // pair: any change to the constants or to how the offsets are read off them lands here, and the fix
  // is to re-derive the band and re-measure, not to edit this literal.
  eq(CHECKPOINT_BAND_ROW_OFFSETS.join(','), '-3,-2,-1,0', `the trigger band R38 clears is rows ${CHECKPOINT_BAND_ROW_OFFSETS.map((o) => 'cp.row' + (o < 0 ? o : '+' + o)).join('…')} over each post, derived from CHECKPOINT_TRIGGER_TOP=${C.CHECKPOINT_TRIGGER_TOP} BOTTOM=${C.CHECKPOINT_TRIGGER_BOTTOM} — it was supposed to be cp.row-3…cp.row, the four rows a standing hero's own box occupies over the post`);
  // The swept ring must never be narrower than the box the game arms on. Reachable, and re-measured
  // 2026-11-17 after the exception audit moved below it: `CLEARANCE_BAND_COLS = 1` → `FAIL R38 R38
  // sweeps ±1 column(s) around each post (16px each way) but main.js's trigger box is 32px wide from
  // cp.x …` (42/43). Before the move that mutation printed the exception audit instead and this line
  // was never reached — the same unreachable-guard defect this pass deleted `rowsTop + rowsBottom >= 2`
  // for, caught here by actually running the mutation the comment claimed it caught.
  assert(CLEARANCE_BAND_COLS * C.TILE >= C.CHECKPOINT_TRIGGER_W, `R38 sweeps ±${CLEARANCE_BAND_COLS} column(s) around each post (${CLEARANCE_BAND_COLS * C.TILE}px each way) but main.js's trigger box is ${C.CHECKPOINT_TRIGGER_W}px wide from cp.x — the swept ring is now narrower than the box that arms a checkpoint, so a tile inside the trigger can be solid and unlooked-at`);
  // AND THE LOOPS ARE HELD TO WHAT THEY CLAIM. Both sweeps above used to carry their extent as literals
  // (`d = -2…2`, `ty = cp.row-3…cp.row`), and a literal narrowed by hand changed nothing anyone could
  // see: measured 43/43 for `d = 0`, and 43/43 for `… <= cp.row - 1` with a solid planted in the post's
  // own row inside the band. These three compares are what make those edits red. They record what each
  // loop ACTUALLY iterated — the ground sweep and the air sweep separately, because a width pin shared
  // between them is blind to narrowing one of the two (measured: air loop pinned to column 0 alone,
  // ground loop still ±2, and a shared set stayed green) — so they fire on a narrowed or shifted loop
  // rather than on a constant someone re-derived on purpose, which is the pair above's job.
  const sortedSet = (s) => [...s].sort((a, b) => a - b).join(',');
  const wantRows = CHECKPOINT_BAND_ROW_OFFSETS.join(',');
  const wantCols = CHECKPOINT_BAND_COL_OFFSETS.join(',');
  eq(sortedSet(sweptAirRows), wantRows, `the AIR sweep of the clearance band walked rows ${sortedSet(sweptAirRows)} around each post, but CHECKPOINT_TRIGGER_TOP/BOTTOM make the trigger box rows ${wantRows} — every one of them must be looked at, over the post's column and both walk-up columns (the row that dropped out is the one the respawned hero's own box sits in)`);
  eq(sortedSet(sweptAirCols), wantCols, `the AIR sweep of the clearance band walked columns ${sortedSet(sweptAirCols)} around each post, but the ring is ±${CLEARANCE_BAND_COLS} — the outer column is where a respawn's first jump arcs (R43 measures it), and the trigger box main.js arms on is ${C.CHECKPOINT_TRIGGER_W / C.TILE} tiles wide from the post's own column`);
  eq(sortedSet(sweptGroundCols), wantCols, `the GROUND-under-post sweep walked columns ${sortedSet(sweptGroundCols)}, but the same ±${CLEARANCE_BAND_COLS} ring applies: digging out under the post's shoulder (measured at 1-1's col-91 post, ground removed at col 93) has to be visible to this check, and a sweep narrowed to the post's own column alone measured 43/43 while it stood`);
  // The whitelist is only auditable if it stays exactly as true as it reads, so an entry that is
  // never consulted is an error rather than dead weight: it means a flagpost moved and this tile is
  // no longer the reason the band passes, and someone has to say so.
  //
  // HOW FAR THIS AUDIT ACTUALLY REACHES — measured 2026-11-16, because the wording above used to
  // imply both directions were tested and only one is. The DEAD-WEIGHT direction (`hits === 0`) is
  // real: 1-2's post at col 105 → `the R38 clearance exception for 1-2 (114,9) 'P' was consulted 0
  // time(s), expected exactly 1`. The DOUBLE-CONSULT direction (`hits === 2`) is UNREACHABLE through
  // any map edit: for two posts to consult this single tile they would both have to sit within ±2
  // columns of 114, and this same check asserts 2 checkpoints per map 24..48 columns apart, so any
  // pair that could share it is already illegal. Measured with 1-2's posts at cols 112 AND 113: R38
  // dies at `assert(bad.length === 0, bad[0])` above with `1-2: the two flags are 1 columns
  // apart, expected roughly two screens (24..48)` and this loop is never reached — `R43` goes red in
  // the same run as well (unpinned `1-2@113`), but that does not make this loop reachable. So this
  // clause is credited with the 0 side only — the 2 side is caught upstream, by a different message —
  // and the relocation class it guards is now also caught by R43's hazard pins. (It also stopped being
  // the message a band-width edit produces, on 2026-11-17, when it moved below the band pins: see the
  // ORDER MATTERS note above.)
  for (const e of CLEARANCE_EXCEPTIONS) {
    assert(e.hits === 1, `the R38 clearance exception for ${e.level} (${e.col},${e.row}) '${e.ch}' was consulted ${e.hits} time(s), expected exactly 1 — delete it if no flagpost's clearance band passes over it any more, or say why two posts now share it`);
  }
  // [REMOVED 2026-11-17: `assert(rowsTop + rowsBottom >= 2, …)` here was unreachable — the two `eq`s
  // above pin 4 and 1, so the sum is 5 on every path that reaches it, and a degenerate pair (BOTTOM = 0)
  // fails at the `eq` first. Measured: CHECKPOINT_TRIGGER_BOTTOM = 0 → `expected 1, got 0` at the
  // `eq(rowsBottom, …)` line, never here. Non-degeneracy is therefore credited to those pins, which is
  // where it is actually caught, rather than kept as decoration behind them.]
  return `3 maps x 2 grounded flags (${LEVELS.map((d) => parseLevel(d).checkpoints.map((c) => c.x / C.TILE).join('/')).join(', ')}); ${CHECKPOINT_BAND_ROW_OFFSETS.length}-row x post±${CLEARANCE_BAND_COLS}-col clearance band held to CHECKPOINT_TRIGGER_* (${C.CHECKPOINT_TRIGGER_W}x${CHECKPOINT_BAND_ROW_OFFSETS.length * C.TILE}px), swept set audited (${sweptAirRows.size}x${sweptAirCols.size} air, ${sweptGroundCols.size} ground), nothing drawn at a post to compare`;
});

// ---------------------------------------------------------------------------
// R40 — a flagpost arms only on a FORWARD crossing: retreating into one is free
//
// Arming on trigger-band overlap alone let a hero walking LEFT into an unbanked flag arm it: the
// left authority jumped out in front of it mid-retreat and stopped it dead, an invisible wall that
// appeared from behind with the camera floor popping right to match. The fix is a prev-frame
// crossing test on p.prevX — the p.prevBottom idiom the stomps above already use.
//
// DISCRIMINATION PROOF: delete the `if (!(p.prevX <= cp.x && p.x > cp.x)) continue;` guard from
// main.js's trigger loop (arming on trigger-band overlap again, exactly the pre-fix behaviour) and
// clause 1 FAILs `the hero walked LEFT through an unbanked flag and armed it (checkpointIndex=0,
// hero at x=640.0) — only a left-to-right crossing may bank a checkpoint: expected -1, got 0` — the
// hero pinned at 640.0 is the invisible wall this clause exists to forbid. Keep the crossing test
// but drop the band gate with it and clause 3 FAILs instead: `jumping over an unbanked flag banked
// it — the trigger is a crossing of the post, not a volume to be inside: expected -1, got 0`.
//
// [FIX PASS 5] Clause 2's `assert(sfx('power') > 0, 'the forward crossing made no checkpoint sound')`
// was this check's only evidence that an arming HAPPENED had ever been audio; the fanfare is deleted,
// so clause 2 now reads the bound and both floors that follow from the state. Both NOT-armed clauses
// (1 and 3) already read `checkpointIndex`/`checkpointX`/`cp.taken`, so nothing here needed
// repointing beyond that one assert — and this check now makes no audio claim of either sign at all.
// ---------------------------------------------------------------------------

check('R40', () => {
  const level = flagLevel();

  // (1) walk LEFT into an unbanked flag: it must stay unbanked, and it must not stop the hero.
  installLevel(level);
  const cp = level.checkpoints[0];
  const p = G.player;
  clearInput();
  p.x = cp.x + 90;
  p.y = GROUND_TOP - p.h;
  p.vx = 0;
  p.vy = 0;
  input.left = true;
  input.run = true;
  let minX = Infinity;
  for (let i = 0; i < 240; i++) {
    step();
    minX = Math.min(minX, p.x);
  }
  input.left = false;
  eq(G.checkpointIndex, -1, `the hero walked LEFT through an unbanked flag and armed it (checkpointIndex=${G.checkpointIndex}, hero at x=${p.x.toFixed(1)}) — only a left-to-right crossing may bank a checkpoint`);
  assert(minX < cp.x - 120, `the retreat only reached x=${minX.toFixed(1)}, nowhere past the flag at ${cp.x} — the scenario never walked through the band`);
  eq(G.checkpointX, 0, 'retreating into a flag raised the left bound anyway');
  eq(cp.taken, false, 'a flag entered from the right reports itself banked although nothing crossed it forward');
  assert(G.cam.x < 1, `the camera floor moved under a flag that was never banked (cam.x=${G.cam.x.toFixed(2)})`);

  // (2) walking RIGHT across that same flag arms it.
  resetAudioSpy();
  input.right = true;
  const armed = until(240, () => (G.checkpointIndex === 0 ? { x: p.x } : null));
  input.right = false;
  input.run = false;
  assert(armed, `walking right across the flag at x=${cp.x} never armed it (hero at ${p.x.toFixed(1)})`);
  assert(p.x > cp.x, `the flag armed while the hero was still at x=${p.x.toFixed(1)}, left of the post at ${cp.x}`);
  // THE FORWARD CROSSING IS PROVED BY THE STATE IT WRITES. This clause used to prove it with
  // `assert(sfx('power') > 0, 'the forward crossing made no checkpoint sound')`, and that was the
  // only thing separating "it armed" from "nothing happened at all" here beyond the clauses above:
  // fix pass 5 deleted the fanfare, so the claim now has to be the bound itself — the slot that
  // armed, the bound it raised, the post's own flag, and the floor both of those have to produce.
  // ("Is the arrival silent?" is a question with a fixed answer now, and R45 asserts it at zero.)
  eq(G.checkpointIndex, 0, `the forward crossing armed slot ${G.checkpointIndex}, not the slot of the post it crossed`);
  eq(G.checkpointX, cp.x, 'the forward crossing did not raise the left bound to the post it crossed');
  eq(cp.taken, true, 'the post crossed forward does not report itself banked');
  input.left = true;
  input.run = true;
  for (let i = 0; i < 120; i++) step();
  input.left = false;
  input.run = false;
  eq(p.x, cp.x, `running back left after arming left the hero at x=${p.x.toFixed(2)} instead of pinned on the post at ${cp.x} — the state above never became the hero's floor`);
  near(G.cam.x, cp.x - CAMERA_FOLLOW_X, CAM_REST_EPS, `the post armed above did not give the camera its floor (cam.x=${G.cam.x.toFixed(4)} against ${cp.x - CAMERA_FOLLOW_X})`);

  // (3) jumping over it leaves it unbanked and free to pass. 52 px of run-up at run speed puts the
  // arc's apex exactly over the post, so the crossing frame is above the trigger band.
  installLevel(level);
  const q = G.player;
  clearInput();
  q.x = cp.x - 52;
  q.y = GROUND_TOP - q.h;
  q.vx = C.RUN_MAX;
  q.vy = 0;
  input.right = true;
  input.run = true;
  input.jumpPressed = true;
  input.jump = true;
  let airborne = false;
  const landed = until(180, () => {
    if (!q.onGround) airborne = true;
    return airborne && q.onGround ? { x: q.x } : null;
  });
  input.jump = false;
  input.right = false;
  input.run = false;
  assert(landed, `the jump-over never landed (y=${q.y.toFixed(1)}, vy=${q.vy.toFixed(1)})`);
  assert(landed.x > cp.x + C.PLAYER_W, `the jump-over landed at x=${landed.x.toFixed(1)}, still left of the post at ${cp.x} — the scenario never crossed it`);
  eq(G.checkpointIndex, -1, 'jumping over an unbanked flag banked it — the trigger is a crossing of the post, not a volume to be inside');
  eq(cp.taken, false, 'a flag jumped over is marked taken');
  // ...and it is still free to pass: walking back left through the post must arm nothing.
  input.left = true;
  const back = until(240, () => (q.x < cp.x - 60 ? { x: q.x } : null));
  input.left = false;
  assert(back, `the hero could not walk back left through the flag it jumped (stuck at x=${q.x.toFixed(1)}) — an unbanked flag must not be a wall`);
  eq(G.checkpointIndex, -1, 'walking back left through a jumped-over flag armed it');
  return `retreat (to x=${minX.toFixed(0)}) and jump-over (landed x=${landed.x.toFixed(0)}) both stayed unbanked; only the rightward crossing armed x=${cp.x}`;
});

// ---------------------------------------------------------------------------
// R41 — a fatal hit inside an unbanked flag's band still banks it
//
// The trigger loop sits ABOVE the `if (p.dead) return;` short-circuit, for the same reason the gate
// test writes its own !p.dead rather than trusting that return: a hero killed at the post has
// reached it, and losing the respawn it just earned is the worse of the two outcomes. The scenario
// makes the fatal contact and the forward crossing the SAME frame, so only that ordering can bank
// the flag — and it composes with R40: a rightward crossing is still required.
//
// DISCRIMINATION PROOF: move the trigger loop back below `if (p.dead) return;` in src/main.js and
// this FAILs `a fatal hit inside the band of an unbanked flag skipped the checkpoint
// (checkpointIndex=-1) — the trigger loop must run before the dead-return short-circuit`.
//
// [SUPERSEDED 2026-11-16, FIX PASS 5 — everything this header said about SILENCE. It was three
// paragraphs, and the quoted measurements are kept because they are the record of how far the
// feedback asserts were trusted; the CLAIMS are not true of this file any more, because the
// feedback itself is gone from src/main.js (fanfare, 'CHECKPOINT' popup, banner re-raise, and the
// `if (!p.dead)` guard that gated them). What was recorded:
//   1. "Take the `if (!p.dead)` guard off the trigger's feedback and the fanfare assert FAILs
//      `banking a flag on the frame the hero dies still played the fanfare (1 × audio.sfx('power'))
//      under the death cry: expected 0, got 1` — the only red check in the run." Measured, then.
//   2. "[CORRECTED 2026-11-16 — the paragraph this pass first shipped here was FALSE.]": deleting
//      `G.items.push(makePopup(cp.x, cp.y - TILE, 'CHECKPOINT'));` from main.js left the suite at
//      41/41, because this check's popup clause asserted an ABSENCE and a producer that no longer
//      exists satisfies it vacuously; the smallest mutation that could fire it was compound (guard
//      removed AND the `audio.sfx('power')` line deleted with it) → `FAIL R41 banking a flag on the
//      frame the hero dies still pushed 1 CHECKPOINT popup(s) that loadLevel() discards moments
//      later: expected 0, got 1`. That is precisely why both absence asserts were deleted rather
//      than left behind: after fix pass 5 the producer is gone ON PURPOSE, on every frame, so an
//      absence assert here can never be red again. R45 is the check that can still go red on noise.
//   3. "The LIVE crossing keeps all of the feedback — R36 clause 1 asserts the sound, the banner AND
//      the popup, R40 clause 2 the sound." No longer true anywhere: R36 clause 1 and R40 clause 2
//      read state now (checkpointIndex / checkpointX / cp.taken / both floors), and this check reads
//      the bank through the respawn it buys. R41 has no audio or popup asserts left, and never needs
//      one again: the ordering it exists to prove is a state question.]
// ---------------------------------------------------------------------------

check('R41', () => {
  // Shipped 1-1 again: resolving the death calls loadLevel(), which would replace a synthetic map.
  newGame();
  const cp = G.level.checkpoints[0];
  const p = G.player;
  clearInput();
  // One frozen turnip parked 12 px right of the post, and the hero starts one step left of the
  // post at full run speed: the frame its left edge passes the post is the frame its right edge
  // reaches the turnip, so "killed" and "crossed" are the same frame. The map's own turnips are
  // removed so nothing else can land the hit first, and vx = 0 keeps the geometry exact.
  const foe = makeTurnip({ x: cp.x + C.PLAYER_W, y: GROUND_TOP - C.PLAYER_SMALL_H });
  foe.vx = 0;
  foe.active = true;
  G.enemies = [foe];
  resetAudioSpy();
  p.invulnT = 0;
  p.big = false;
  p.h = C.PLAYER_SMALL_H;
  p.x = cp.x - 1;
  p.y = GROUND_TOP - p.h;
  p.vx = C.RUN_MAX;
  p.vy = 0;
  input.right = true;
  input.run = true;
  step();
  input.right = false;
  input.run = false;
  assert(p.dead, `the scenario never died (x=${p.x.toFixed(2)}, invulnT=${p.invulnT.toFixed(2)}) — the check has nothing to bank`);
  assert(p.x > cp.x, `the hero died without crossing the post (x=${p.x.toFixed(2)} <= ${cp.x}) — the scenario geometry broke, not the trigger`);
  assert(G.checkpointIndex === 0, `a fatal hit inside the band of an unbanked flag skipped the checkpoint (crossed to x=${p.x.toFixed(2)}, checkpointIndex=${G.checkpointIndex}) — the trigger loop must run before the dead-return short-circuit`);
  eq(G.checkpointX, cp.x, 'the flag banked on the fatal frame did not raise the bound');
  eq(cp.taken, true, 'the post banked on the fatal frame does not report itself banked');
  // THE SILENCE CLAUSES THAT USED TO SIT HERE WERE DELETED BY FIX PASS 5, and the reason is worth
  // keeping: they read `eq(sfx('power'), 0, …)` and `eq(ghosts.length, 0, …)` on the death frame,
  // which were teeth while some crossings made noise and this frame had to stay quiet. Once the
  // trigger's whole feedback block went away there is no producer on ANY frame, so both asserts
  // became claims about a thing that cannot happen — unfailable forever, which is the vacuity this
  // file refuses rather than a guarantee. "Nothing at a checkpoint is announced" is now asserted
  // where it can still fail: `R45`, live crossing, zero popups, zero `power`, banner untouched.
  //
  // What this check owns — and what stays load-bearing without any audio in it — is that the bank
  // happened (above) and that it SURVIVED the level rebuild the death handler performs, since
  // surviving it is the entire point of banking on a fatal frame. So the respawn itself is read as
  // state: hero on the post, bound still the post, the rebuilt level marking that post taken, and
  // the camera on the floor that post derives.
  const respawned = until(150, () => (G.player !== p ? { at: G.player.x } : null));
  assert(respawned, `the death never resolved (state=${G.state}, dyingT=${G.dyingT.toFixed(2)})`);
  eq(G.player.x, cp.x, 'a hero killed on the crossing frame respawned somewhere other than that flag');
  eq(G.checkpointIndex, 0, 'the post banked on the fatal frame did not survive the respawn rebuild (checkpointIndex=' + G.checkpointIndex + ')');
  eq(G.checkpointX, cp.x, 'the respawn dropped the bound the fatal frame earned');
  eq(G.level.checkpoints[0].taken, true, 'the rebuilt level leaves the post the hero respawned ON unbanked — the scan would treat a post behind the hero as one it may still arm');
  eq(G.cam.x, cp.x - CAMERA_FOLLOW_X, `the respawn did not put the camera on that flag's floor (cam.x=${G.cam.x} against ${cp.x - CAMERA_FOLLOW_X}) — the hero could scroll left of the post it earned`);
  return `killed on the crossing frame at x=${cp.x} → banked there and respawned there (x=${G.player.x}, cam=${G.cam.x}), bound and taken mark intact through the level rebuild`;
});

// ---------------------------------------------------------------------------
// R42 — the checkpoint respawn: grace, no stage-intro banner, and a bogus index cannot throw
//
// The flagpost cells were never authored as safe ground (1-1's second flag has a turnip patrol
// walking towards it), so the respawn grants the same INVULN_TIME a hit already grants — and ONLY
// there: the classic x=34 restart must stay exactly as it was, banner included. loadLevel() raises
// the WORLD x-y intro banner, which on a respawn reads as "stage restarted", so the checkpoint
// path takes it back. And the respawn's index lookup is bounded: an index the rebuilt level does
// not have falls back to the plain restart instead of throwing on cp.x inside the death handler.
//
// DISCRIMINATION PROOF: drop `p.invulnT = INVULN_TIME;` from respawnAtCheckpoint → clause 1 FAILs
// `a checkpoint respawn granted no invulnerability (invulnT=0.00) — the flagpost cells are not safe
// ground`. Drop `G.bannerT = 0;` → clause 1 FAILs `a checkpoint respawn shows the 1-1 stage-intro
// banner (bannerT=1.50) — loadLevel() raised it inside the respawn and respawnAtCheckpoint() must take
// it back: on a resume the player did not ask for, that reads as "level restarted": expected 0, got
// 1.5` (wording and figures re-measured after fix pass 5; the paragraph below records why the line is
// still load-bearing). Widen the
// index guard back to `if (index < 0) return;` → the last clause FAILs `the respawn threw:
// TypeError: Cannot read properties of undefined (reading 'row'): expected 0, got 1`, i.e. the
// throw happens inside the death handler and the frame is lost. R37's unchanged second scenario is
// what pins the no-checkpoint path to the old behaviour. The last clause pins the death CLOCK:
// `loadLevel()` zeroes `G.dyingT`, and delete that line and this is the only thing in the suite
// that notices — `a level load inherited the death clock — the next kill would resolve on that same
// frame and skip the death arc: expected 0, got 9`. No shipped kill path can hand over a stale
// clock today, which is exactly why the clause poisons it by hand rather than waiting for one.
//
// THE CHECKPOINT-RESPAWN `bannerT === 0` AFTER FIX PASS 5 — kept, and it is NOT the trivially-true
// leftover it looks like. The checkpoint trigger's `G.bannerT = 1` re-raise is gone from src/main.js,
// so the honest question was whether this half of the clause still proves anything. It does, for a
// reason that has nothing to do with the trigger: `respawnAtCheckpoint()` calls `loadLevel()` FIRST,
// and loadLevel() raises the WORLD x-y banner to 1.5, so `G.bannerT = 0` at the end of the respawn is
// the only thing standing between a resume and a stage-intro card. Re-measured after the removal, in
// a throwaway copy: dropping that line fails clause 1, alone in the run (42/43), with
//   `FAIL R42 a checkpoint respawn shows the 1-1 stage-intro banner (bannerT=1.50) — loadLevel() raised
//   it inside the respawn and respawnAtCheckpoint() must take it back: on a resume the player did not
//   ask for, that reads as "level restarted": expected 0, got 1.5`
// Kept as a two-way guard: it fails the same way if anyone re-introduces a banner on the respawn path.
// The 1.5 baselines beside it (fresh entry, no-flag restart) are what stop it being satisfiable by
// muting banners everywhere.
// ---------------------------------------------------------------------------

check('R42', () => {
  newGame();
  const cp = G.level.checkpoints[0];
  const p = G.player;
  clearInput();
  assert(G.bannerT > 0, `entering ${G.level.label} fresh showed no intro banner (bannerT=${G.bannerT.toFixed(2)}) — that half of the clause is the baseline`);

  // bank the flag, then die past it
  p.invulnT = 60;
  const from = walkableFar(G.level, cp.x - 24, -1);
  assert(from !== null, 'no standable ground left of 1-1 flag 0');
  p.x = from;
  p.y = GROUND_TOP - p.h;
  p.vx = 0;
  p.vy = 0;
  input.right = true;
  input.run = true;
  const armed = until(240, () => (G.checkpointIndex === 0 ? { x: p.x } : null));
  input.right = false;
  input.run = false;
  assert(armed, 'walking into 1-1 flag 0 never armed it');
  p.x = cp.x + 160;
  p.y = GROUND_TOP - p.h;
  G.dyingT = 0;
  killPlayer(p, true);
  const respawned = until(150, () => (G.player !== p ? { at: G.player.x } : null));
  assert(respawned, 'the death never resolved');
  const q = G.player;
  eq(q.x, cp.x, 'the respawn is not on the flag, so the rest of this check is measuring the wrong hero');
  assert(q.invulnT > 0, `a checkpoint respawn granted no invulnerability (invulnT=${q.invulnT.toFixed(2)}) — the flagpost cells are not safe ground`);
  near(q.invulnT, C.INVULN_TIME, 1e-9, 'the respawn grace is not the INVULN_TIME a hit already grants (it must come from the same constant)');
  // NOT vacuous after the trigger's banner re-raise was deleted: the respawn calls loadLevel(), which
  // raises this banner to 1.5, so what this pins is `G.bannerT = 0` at the end of
  // respawnAtCheckpoint() — see the header for the re-measured mutation (drop that line, got 1.50).
  // The 1.5 baselines in the clauses below are what stop it being satisfied by muting banners at large.
  eq(G.bannerT, 0, `a checkpoint respawn shows the ${G.level.label} stage-intro banner (bannerT=${G.bannerT.toFixed(2)}) — loadLevel() raised it inside the respawn and respawnAtCheckpoint() must take it back: on a resume the player did not ask for, that reads as "level restarted"`);

  // the grace holds: a turnip parked on the respawn cannot touch it while it lasts...
  const foe = makeTurnip({ x: q.x + 2, y: GROUND_TOP - 12 });
  foe.vx = 0;
  foe.active = true;
  G.enemies = [foe];
  steps(45);
  assert(!q.dead, 'a turnip standing on the respawn point killed the hero inside its respawn grace');
  // ...but it is a grace, not immortality: the same turnip gets the hero when it runs out.
  const got = until(200, () => (q.dead ? { t: q.invulnT } : null));
  assert(got, `the respawn grace never expired — the parked turnip never landed a hit (invulnT=${q.invulnT.toFixed(2)})`);
  clearInput();
  toTitle();

  // the path that must not change: no flag banked → the classic restart, banner and no grace
  newGame();
  const p2 = G.player;
  clearInput();
  p2.y = GROUND_TOP - p2.h;
  G.dyingT = 0;
  killPlayer(p2, true);
  const back = until(150, () => (G.player !== p2 ? { done: true } : null));
  assert(back, 'dying with no checkpoint banked never resolved');
  eq(G.player.x, G.level.playerSpawn.x, 'the no-checkpoint restart moved off the H spawn');
  eq(G.player.invulnT, 0, 'the no-checkpoint restart granted the checkpoint respawn grace');
  assert(G.bannerT > 0, `the no-checkpoint restart lost its stage-intro banner (bannerT=${G.bannerT.toFixed(2)})`);

  // a checkpoint index the rebuilt level does not have must not throw inside the death handler
  newGame();
  const cp2 = G.level.checkpoints[0];
  const p3 = G.player;
  clearInput();
  p3.invulnT = 60;
  p3.x = cp2.x;
  p3.y = GROUND_TOP - p3.h;
  G.checkpointIndex = G.level.checkpoints.length + 5; // a slot that cannot exist after the reload
  G.checkpointX = cp2.x;
  G.dyingT = 0;
  const errsBefore = consoleLog.length;
  killPlayer(p3, true);
  const third = until(150, () => (G.player !== p3 ? { done: true } : null));
  assert(third, 'a death with an out-of-range checkpoint index never resolved');
  eq(consoleLog.length - errsBefore, 0, `the respawn threw: ${consoleLog.slice(errsBefore)[0] || ''}`);
  eq(G.state, 'PLAYING', 'an out-of-range checkpoint index left the game in an odd state');
  eq(G.player.x, G.level.playerSpawn.x, 'an out-of-range checkpoint index did not fall back to the plain restart');
  eq(G.checkpointIndex, -1, 'the fallback restart left a stale checkpoint index behind');
  eq(G.checkpointX, 0, 'the fallback restart left a stale left bound behind');

  // Clock hygiene on the same path: loading a level clears the death timer. No shipped kill path
  // can hand it a stale value today (every one of them zeroes it), so this is the only way the
  // reset in loadLevel() is worth more than a comment — poison the clock, load a level through the
  // pause-restart, and the fresh level must not inherit it.
  G.dyingT = 9;
  G.state = 'PAUSED';
  input.restartPressed = true;
  step();
  clearInput();
  eq(G.state, 'PLAYING', 'the pause-restart that was supposed to reload the level did not resume play');
  eq(G.dyingT, 0, 'a level load inherited the death clock — the next kill would resolve on that same frame and skip the death arc');
  return `respawn grace ${C.INVULN_TIME}s + no intro banner; no-flag restart unchanged; bogus index → plain restart, no throw; level load clears dyingT`;
});

// ---------------------------------------------------------------------------
// R43 — every shipped flagpost respawn has a live route forward (DYNAMIC fairness)
//
// R36 proves a shipped flagpost can be walked INTO and R38 proves nothing solid stands in its
// trigger band; neither proves the route OFF it. That is the property that justified moving 1-2's
// second post back from col 117 to col 112, and until now it was carried by prose only — a map
// edit that parked a post somewhere its own respawn cannot get out of would have kept every other
// check green. This check respawns the hero on each of the 6 shipped posts and asks, per post,
// whether at least one run+jump timing gets past the hazard that post actually faces.
//
// Protocol, deliberately the same one R33's pitCross/measureJump use: the real updatePlayer, the
// hero stood on the post's own tile, right + run held, ONE full-hold jump pressed at take-off
// frame f, for 180 values of f, 400 frames of horizon each. A timing "clears" if the hero ends up
// grounded with its right edge past the hazard's far column; falling through it is fatal ("deaths"),
// anything else that ends the horizon alive is "short".
//
// Which hazard: the first thing in a grounded hero's path ahead of the post — a pit, or a wall in
// the walking band (a pipe, a staircase). That is the anti-soft-lock half, and it covers posts that
// stand below a staircase they have to climb. On top of that, a post that faces a pit WITHIN ONE
// SCREEN (the pit's lip is within VIEW_W px, so the player can see it from the respawn) must be
// able to cross THAT PIT with a single committed run+jump: that is the col-112 property, and the
// near-pit test is what makes the difference between a hard respawn and an impossible one. Posts
// further than a screen from their nearest pit are not measured on it — long routes are R33's
// reachability job, and one jump cannot cross a pit 29 columns away (1-1's flag 1 stands behind a
// pipe, and 180/180 of its timings clear the pipe, which is the honest answer).
//
// WHAT A COUNT HERE DOES NOT MEAN — two reporting defects fixed 2026-11-16, both of which had
// already caused a wrong conclusion upstream, so they are written next to the code and not only in
// the changelog:
//
//  1. A count on a NO-DEATH-ROUTE row is NOT a fairness margin. The rule above measures the FIRST
//     wall-or-pit in the grounded path, and that first wall can be a CLIMBABLE STAIRCASE: 1-2's
//     col-77 post faces stone steps at cols 80-88, which offer no death route whatsoever — 0 of 180
//     timings die, all 172 non-clears end their horizon GROUNDED on the steps at x≈1300-1316 (cols
//     81-82), and mashing jump — i.e. how anyone actually plays it — carries the hero from col 77 to
//     col 146 and off the screen alive. Its "8/180" is an artifact of one committed jump inside a
//     400-frame horizon; the 400 frames, not the level, are what stop the other 172. Publishing that
//     figure as if it were commensurable with the genuine 21/180 pit margin next to it made a
//     harmless staircase read as a near-failure.
//
//     REMEDY CHOSEN, stated because "skip the wall rows" was the other option and it would have
//     silently dropped coverage: no row is skipped. Every row now prints `deaths` and `short` beside
//     `clears` and is TAGGED. `clears > 0` is asserted as a SURVIVAL property only where the hazard
//     actually kills some timings; on a NO-DEATH-ROUTE row the asserts are deliberately weaker and
//     differently named — `deaths === 0` (this row is not a survival test, and if terrain ever makes
//     it one, that is a NEW fairness question and the check says so in as many words) plus
//     `clears > 0` read as PROGRESS ONLY ("the respawn is not a dead end": a post the hero can never
//     leave is unplayable even when nothing kills it). All 6 posts are still measured and asserted.
//
//  2. A green count is only comparable to a previously-quoted green count if it is the SAME hazard.
//     The hazard is derived from the map, so authored terrain can move it while the printed number
//     stands still: filling 1-2's pit at cols 120-125 left this check reporting 21/180 while it had
//     silently re-aimed at the pit at cols 132-135 (a different hazard, window f91-111 instead of
//     f19-39), and in the same run R33's published inventory re-baselined itself — `7 pits (widest 6)
//     … worst margin 11.0px @cols 120-125` → `6 pits (widest 4) … worst margin 19.8px @cols 23-24` —
//     because R33 prints what it finds, it does not assert it. RESPAWN_HAZARDS and PIT_INVENTORY
//     below pin the measured identity, so a terrain edit turns the suite RED with expected and found
//     side by side instead of re-baselining quietly. Deliberate terrain work is expected to update
//     both tables, re-measure the margins, and republish them — the FAIL says exactly that.
//
//     The VIEW_W cutoff is UNCHANGED, deliberately. Widening it to ~380px would make 1-2's col-77
//     post's real kill hazard — the pit at cols 100-102, ~368px away — the measured one, and this
//     protocol would then assert a FALSE failure: one jump from a standing respawn cannot cross a
//     staircase and then a pit. That pit is therefore recorded as OUT OF SCOPE for this check
//     (R33's reachability sweep covers it), not measured wrongly.
//
//     AND WHAT THE PINS DO NOT PIN: they pin WHICH hazard, never its count. Measured with the reviewer
//     option "lift the row-9 `=` platform to row 8" done literally (cols 120-125, row 9 → row 8):
//     every pin stayed GREEN while this check's margin for 1-2@112 moved **21/180 → 13/180 (window
//     f24-36)**; that run went red in `SMOKE` and `R33` instead, for the unrelated reason that a
//     row-8 platform standing on ground is a 5-tile rise (`rise at cols 119-120 (5 tiles): margin
//     3.8px < 8px`). Freezing counts was rejected on purpose — the rule forbids the impossible, not
//     the tight, and a physics tweak would then require re-baselining numbers that are not claims about
//     terrain. So: identity is machine-checked, the MARGINS ARE NOT. Whenever authored terrain changes,
//     re-measure and republish them by hand (the inventory FAIL says exactly that).
//
// DISCRIMINATION PROOFS (each in its own throwaway copy under the session temp; quoted from the
// actual FAIL, 2026-11-16):
//   - the flag to col 105 (15 columns from the pit's lip, inside the screen window) → `1-2: the flag
//     at col 105 respawns the hero with NO route across the pit 120-125 ahead of it (0 of 180
//     run+jump timings get across; 180 fell in, 0 stopped short) — the flagpost is playable only if
//     its own respawn can leave it, and R36/R38 cannot see this`, while R36 clause 4 still PASSes it
//     (the post is walkable — precisely the gap this check exists to fill).
//   - **[CORRECTED 2026-11-16: this bullet used to read "moving the post the other way, to col 117,
//     still PASSES at 15/180, and it must: this check forbids the impossible, not the tight." That
//     was true of the pre-pin check and is FALSE now — which is the point of pinning.]** Re-measured
//     with the pins in: col 117 still MEASURES 15/180 across pit 120-125 (the playability claim is
//     unchanged — 117 was playable, just worse than 112), but the check now FAILs, twice:
//     `1-2@117: this shipped flagpost has no pinned hazard in RESPAWN_HAZARDS … it measures pit
//     120-125 (15/180, 165 deaths)` plus `the R38 clearance exception for 1-2 (114,9) 'P' was
//     consulted 0 time(s)`. A margin measured on an unpinned post is not a margin anyone can quote,
//     so relocating a post is now a deliberate act: re-measure, re-pin, republish.
//   - 1-2's pit at cols 120-125 filled with `X` (authored terrain edited, no flagpost moved at all)
//     → R43 alone goes red, on the inventory pin, BEFORE it can print a comparable number:
//     `1-2: the pit inventory R43 measures on has changed — pinned [12-14 38-41 70-72 100-102
//     120-125 132-135 160-161] (7 pits, widest 6), found [12-14 38-41 70-72 100-102 132-135 160-161]
//     (6 pits, widest 4) …`. Before the pins this exact edit kept the run at 41/41 while the check
//     quietly re-aimed at cols 132-135 and printed the identical 21/180 — re-verified against the
//     pre-pin harness, which really does print `1-2@112 pit 132-135 21/180 (f91-111)` and 41/41.
//   - a lone `X` at 1-3 (60,12) — a re-aim that touches no pit at all, so the inventory pin is
//     silent → R43 alone goes red, on the identity pin: `1-3: the flag at col 42 is now measured on
//     wall 60-60, but this check publishes its margin as pit 64-66 …`.
//   - 1-2's col-77 post moved to col 90 (a post MOVES, the pin has no row for it) → R36, R38 and R43
//     all go red, R43 with `1-2@90: this shipped flagpost has no pinned hazard in RESPAWN_HAZARDS …
//     it measures pit 100-102 (27/180, 153 deaths)`. R36/R38 catch this particular cell for their own
//     reasons; the pin is what stops a relocation that they happen to find comfortable.
//
// ORDER, chosen deliberately and asserted by the col-105 row above: a post that is PINNED but
// re-aimed fails immediately (its count would be a false statement), while a post that is simply
// UNPINNED is still measured and still held to the survival rule first, with the missing pin reported
// after the loop. Otherwise a relocation would pre-empt the substantive FAIL whose text is quoted in
// `docs/REVIEW-2026-11-15.md` and this file.
// ---------------------------------------------------------------------------

// The two hazard predicates, defined once: "no ground left at all in this column" and "something
// standing in the walking band (rows 11-12)". Both R43 clauses read these, so the pinned inventory
// below is the same notion of "pit" the measurements are made on.
const noGroundAt = (def, tx) => !isSolid(def.map[C.ROWS - 2][tx]) && !isSolid(def.map[C.ROWS - 1][tx]);
const wallAt = (def, tx) => isSolid(def.map[C.ROWS - 3][tx]) || isSolid(def.map[C.ROWS - 4][tx]);

// Every no-ground run in the map, as `from-to` strings, left to right.
function pitRuns(def) {
  const cols = def.map[0].length;
  const runs = [];
  for (let tx = 0; tx < cols; tx++) {
    if (!noGroundAt(def, tx)) continue;
    let to = tx;
    while (to + 1 < cols && noGroundAt(def, to + 1)) to++;
    runs.push(`${tx}-${to}`);
    tx = to;
  }
  return runs;
}

// WHICH HAZARD IS MEASURED, pinned per shipped respawn, together with whether it offers a death
// route (`lethal`). This is not a cached measurement to be tidied away: it is the assertion that the
// number this check publishes is about the hazard everyone thinks it is about. `wall 80-88` is 1-2's
// climbable stone staircase and is lethal: false for the reason given in the header — its count must
// never be quoted as a fairness margin.
const RESPAWN_HAZARDS = {
  '1-1@55': { asked: 'pit 58-59', lethal: true },
  '1-1@91': { asked: 'wall 95-96', lethal: false },
  '1-2@77': { asked: 'wall 80-88', lethal: false },
  '1-2@112': { asked: 'pit 120-125', lethal: true },
  '1-3@42': { asked: 'pit 64-66', lethal: true },
  '1-3@76': { asked: 'wall 80-81', lethal: false },
};

// THE AUTHORED-TERRAIN FINGERPRINT: every pit in every shipped map, same `noGroundAt` notion the
// measurements use. R33 reports an inventory but cannot fail on one, so without this a map edit just
// republishes itself. A deliberate terrain change updates this line and the margins above together.
const PIT_INVENTORY = {
  '1-1': '58-59 70-72 84-86 120-122',
  '1-2': '12-14 38-41 70-72 100-102 120-125 132-135 160-161',
  '1-3': '10-12 36-39 64-66 110-112',
};

const pitWidth = (r) => Number(r.split('-')[1]) - Number(r.split('-')[0]) + 1;
const inventoryShape = (list) => `${list.length} pits, widest ${list.reduce((a, r) => Math.max(a, pitWidth(r)), 0)}`;

// The first obstruction in a grounded hero's path right of `fromCol`: a pit (both ground rows air)
// or a wall standing in the walking band (rows 11-12). `kind` narrows the search to one class.
function nextHazardAhead(def, fromCol, kind = 'any') {
  const cols = def.map[0].length;
  const fall = (tx) => noGroundAt(def, tx);
  const wall = (tx) => wallAt(def, tx);
  for (let tx = fromCol + 1; tx < cols; tx++) {
    const hit = (kind === 'pit' && fall(tx)) || (kind === 'wall' && wall(tx))
      || (kind === 'any' && (fall(tx) || wall(tx)));
    if (!hit) continue;
    const isPit = fall(tx);
    let to = tx;
    while (to + 1 < cols && (isPit ? fall(to + 1) : wall(to + 1))) to++;
    return { kind: isPit ? 'pit' : 'wall', from: tx, to };
  }
  return null;
}

// How many of `frames` take-off timings clear `hazard` from a standing respawn at column
// `spawnCol`, one committed run+jump each. `deaths` is the only fatal outcome; `short` is everything
// else that ended the horizon alive (stopped at a wall, still climbing, or simply out of frames).
function respawnClears(def, spawnCol, hazard, { run = true, frames = 180, horizon = 400 } = {}) {
  const level = parseLevel(def);
  const target = (hazard.to + 1) * C.TILE;
  const p0 = spawnCol * C.TILE;
  let clears = 0, deaths = 0, short = 0, lo = Infinity, hi = -Infinity;
  for (let f0 = 0; f0 < frames; f0++) {
    const p = makePlayer(p0, (C.ROWS - 3 + 1) * C.TILE - C.PLAYER_SMALL_H);
    p.onGround = true;
    const inp = mkInput({ right: true, run, jump: true });
    let out = null;
    for (let i = 0; i < horizon; i++) {
      inp.jumpPressed = i === f0;
      updatePlayer(p, C.STEP, inp, level, p0);
      if (p.y + p.h >= C.ROWS * C.TILE) { out = 'dead'; break; }          // the pit claim wins the race
      if (p.onGround && p.x + C.PLAYER_W > target) { out = 'clear'; break; }
    }
    if (out === 'dead') deaths++;
    else if (out === 'clear') { clears++; lo = Math.min(lo, f0); hi = Math.max(hi, f0); }
    else short++;
  }
  return { clears, deaths, short, window: clears ? `f${lo}-${hi}` : 'none' };
}

check('R43', () => {
  // (0) AUTHORED-TERRAIN FINGERPRINT first: if the pits themselves moved, nothing measured downstream
  // is comparable to anything published, and the pass line would just look familiar.
  const invBad = [];
  for (const def of LEVELS) {
    const want = PIT_INVENTORY[def.label];
    const runs = pitRuns(def);
    const got = runs.join(' ');
    if (!want) {
      invBad.push(`${def.label}: R43 has no pinned pit inventory for this map (found ${inventoryShape(runs)}: [${got}]) — a new shipped map must have its own pin, its own RESPAWN_HAZARDS rows, and its own re-measured margins`);
      continue;
    }
    if (got === want) continue;
    invBad.push(`${def.label}: the pit inventory R43 measures on has changed — pinned [${want}] (${inventoryShape(want.split(' '))}), found [${got}] (${inventoryShape(runs)}). Terrain is AUTHORED data and this check's published margins are statements about these exact pits: if the edit was deliberate, update PIT_INVENTORY and RESPAWN_HAZARDS here together, re-measure every margin and republish them in WORKFLOW_STATE.md; if it was not, the terrain is the bug. R33 prints whatever it finds without failing, which is exactly why this pin cannot live there`);
  }
  assert(invBad.length === 0, invBad[0]);

  const lines = [];
  const seen = new Set();
  // Pin bookkeeping (a post with no pin, or a pin nothing matches any more) is COLLECTED and reported
  // after the loop, deliberately: the survival assert below is the substantive one, its FAIL text is
  // quoted in docs/WORKFLOW_STATE, and a post moved into an unmeasurable cell must still produce THAT
  // message first. A re-aim on a POST THAT IS PINNED stays fail-fast above it — a count measured
  // against the wrong hazard is a false statement, not a bookkeeping detail.
  const pinBad = [];
  for (const def of LEVELS) {
    const level = parseLevel(def);
    for (const cp of level.checkpoints) {
      const col = cp.x / C.TILE;
      const key = `${def.label}@${col}`;
      seen.add(key);
      assert(heroFits(level, cp.x), `${def.label}: the hero does not fit at the flag at x=${cp.x} (col ${col}) — there is no respawn here to measure`);
      const first = nextHazardAhead(def, col);
      assert(first, `${def.label}: nothing at all lies ahead of the flag at col ${col} — the scenario has no hazard to clear`);
      let measured = respawnClears(def, col, first);
      let asked = `${first.kind} ${first.from}-${first.to}`;
      // the stronger half: a pit the player can see from the respawn has to be crossable from it
      const pit = first.kind === 'pit' ? first : nextHazardAhead(def, col, 'pit');
      if (pit && (pit.from - col) * C.TILE <= C.VIEW_W) {
        measured = respawnClears(def, col, pit);
        asked = `pit ${pit.from}-${pit.to}`;
      }
      const want = RESPAWN_HAZARDS[key];
      // An unpinned post is still measured and still held to the survival rule, classified by what the
      // measurement says the hazard does; the missing pin is reported at the end.
      if (!want) pinBad.push(`${key}: this shipped flagpost has no pinned hazard in RESPAWN_HAZARDS, so nothing here can tell a re-aimed measurement from a real one — it measures ${asked} (${measured.clears}/180, ${measured.deaths} deaths). Add the pin on purpose and say what the number means`);
      else assert(asked === want.asked, `${def.label}: the flag at col ${col} is now measured on ${asked}, but this check publishes its margin as ${want.asked}. The hazard under a shipped respawn moved, so the count printed here is NOT the number WORKFLOW_STATE.md quotes (window and margin included) — re-measure, update RESPAWN_HAZARDS, and republish the margin in the same change`);
      const lethal = want ? want.lethal : measured.deaths > 0;
      if (lethal) {
        if (want) assert(measured.deaths > 0, `${def.label}: the flag at col ${col} faces ${asked}, pinned as a hazard that KILLS some timings and therefore as a survival margin, but 0 of 180 timings die on it now (${measured.clears} clear, ${measured.short} short) — the route under this respawn changed; re-measure and re-pin it`);
        assert(measured.clears > 0,
          `${def.label}: the flag at col ${col} respawns the hero with NO route across the ${asked} ahead of it (0 of 180 run+jump timings get across; ${measured.deaths} fell in, ${measured.short} stopped short) — the flagpost is playable only if its own respawn can leave it, and R36/R38 cannot see this`);
      } else {
        // NOT a fairness margin. The only thing asserted here that could be called a difficulty
        // number is `clears`, and it is labelled NO-DEATH-ROUTE in the pass line for that reason.
        if (want) assert(measured.deaths === 0, `${def.label}: the flag at col ${col} now dies on ${measured.deaths} of 180 timings at the ${asked} ahead of it, which is pinned here as a no-death-route obstruction (a climbable wall, not a kill zone). That makes it a SURVIVAL question it was never measured as: re-measure it, re-pin RESPAWN_HAZARDS with lethal: true, and republish the margin`);
        assert(measured.clears > 0,
          `${def.label}: the flag at col ${col} respawns the hero with NO way forward past the ${asked} ahead of it (0 of 180 run+jump timings get across; ${measured.deaths} died, ${measured.short} stayed grounded short of it) — this row is NOT a fairness margin (nothing here kills), it is a dead-end test: a post the hero can never leave is unplayable even though it is safe`);
      }
      lines.push(`${key} ${asked} ${lethal ? 'SURVIVAL' : 'NO-DEATH-ROUTE'} clears=${measured.clears}/180 deaths=${measured.deaths} short=${measured.short} (${measured.window})`);
    }
  }
  assert(pinBad.length === 0, pinBad[0]);
  // The tables must not rot in the other direction either: a post that disappears leaves R38 red, and
  // a post that MOVES leaves an orphaned pin here. Same class as R38's clearance-exception audit.
  const orphans = Object.keys(RESPAWN_HAZARDS).filter((k) => !seen.has(k));
  assert(orphans.length === 0, `RESPAWN_HAZARDS pins respawns that are not in the shipped maps any more: ${orphans.join(', ')} — the post moved or went away (R38 is the one that should already be red); delete or move the pin in the same change and re-measure`);
  const shape = LEVELS.map((d) => `${PIT_INVENTORY[d.label].split(' ').length}`).join('+');
  return `6 respawns can leave their flag: ${lines.join(', ')}; pits pinned at ${shape} (widest ${LEVELS.map((d) => Math.max(...pitRuns(d).map((r) => r.split('-')[1] - r.split('-')[0] + 1))).join('/')}), hazard identity pinned per post; NO-DEATH-ROUTE rows have 0 deaths — their clears is progress inside the 400-frame horizon, NOT a fairness margin`;
});

// ---------------------------------------------------------------------------
// R45 — a checkpoint is INVISIBLE and SILENT (a guard on a removal, which is the kind of test
//       nobody writes until the feature comes back)
//
// Fix pass 5 deleted the flagpost art (sprites.js drawCheckpoint), the render loop that drew it, and
// main.js's whole arrival-feedback block (audio.sfx('power'), the 'CHECKPOINT' popup, the banner
// re-raise, and the `if (!p.dead)` guard that gated them) — while deleting NONE of the checkpoint
// LOGIC: arming on a left-to-right crossing, the hero's left clamp, the camera floor and the respawn
// all still read level.checkpoints. A removal like that takes its own assertions with it, so both
// halves of the new contract are pinned here, each with its own mutation proof below:
//
//  (1) NOTHING IS DRAWN AT A POST, over a state space that is written down instead of assumed. Levels
//      are rendered through src/render.js's own render() into the mock context and the draw streams are
//      diffed — every fillRect / fillText / drawImage, in issue order, with colour, alpha and sequence
//      number — for EVERY shipped LEVELS definition x four camera positions (three putting the level's
//      first post on screen centred / at the left edge / at the right edge, one with no post on screen
//      at all) x four checkpoint states (unarmed, all-taken-but-unarmed, armed on post 0, armed on the
//      last post). Per (level, camera): each state's frame must equal the SAME state's frame with
//      `level.checkpoints` emptied, AND the armed frame must equal the unarmed frame with the array
//      intact — that second comparison is the one this check did not have, and it is what makes "the
//      marker appears after you bank" undrawable. On top of the differentials there is an ABSOLUTE
//      probe: each post's trigger band (the CHECKPOINT_TRIGGER_* box R38 holds clear, cols post±2 x
//      rows cp.row-3…cp.row) must ink exactly what the same box inks on that map stripped of every
//      checkpoint and every solid above the ground line, in three states (unarmed / armed / armed with
//      the hero pinned on the post), and one pair per level x camera with the intro BANNER up (the
//      banner is drawn from `level.label` at y=60, outside the probe's band, so it needs its own pair).
//      Total today: 138 comparisons, 1138 fillRects in the reference frame.
//
//  MEASURED SENSITIVITY FLOOR, and what still escapes (2026-11-17, throwaway copies of this tree with
//      markers injected into src/render.js; the repo was never mutated). This replaces the previous
//      sentence, which claimed a post that draws anything "anywhere in the frame, taken or not, cannot
//      survive it, at any camera position". That was false as measured: the old clause rendered ONE
//      level (1-1, via newGame()), ONE camera offset, ONE frame, with G.checkpointIndex = -1, and only
//      cancelled code that reads level.checkpoints — and an auditor's three marker variants walked
//      through it at 43/43. What the rewritten clause catches, with the FAIL line each produced:
//        - the deleted flagpost draw restored            → `FAIL R45 1-1 @cam 760 (post centred)
//          state=unarmed: a checkpoint changed the frame — fillRect #495: with checkpoints
//          [120,192,4,16,"#f08c1e",null,495], without them [1880,128,2,80,"#e8e0c0",null,495]`
//        - a SINGLE 1×1 fillRect at the post (P.red, cp.x+8/cp.y+8) → same clause, `fillRect #495:
//          with checkpoints [128,200,1,1,"#e8434f",null,495], …` — the 1×1 sensitivity the old clause
//          had is kept, and the harness paints a canary pixel of its own at the end of the clause to
//          prove the probe is still wired to a pixel.
//        - a marker gated on `g.checkpointIndex >= 0` (appears only after you bank; coordinates from
//          nowhere, placed where no probe box is) → `FAIL R45 1-1 @cam 760 (post centred) arming:
//          raising the left authority (checkpointIndex -1 → 0, checkpointX 0 → 880) changed the frame —
//          fillRect #495: unarmed [1880,128,2,80,"#e8e0c0",null,495], armed
//          [4,120,6,6,"#ffd23e",null,495]` — the old clause could not see this one; it never armed the
//          state, and no `level.checkpoints` differential can: the coordinates here come from nowhere.
//        - a marker gated on `level.label === '1-3'` (a level the old clause never rendered) →
//          `FAIL R45 1-3 @cam 552 (post centred) state=unarmed: a checkpoint changed the frame —
//          fillRect #502: with checkpoints [120,168,4,8,"#f08c1e",null,502], …`
//        - a marker whose coordinates come from the authored MAP STRINGS rather than from
//          level.checkpoints → `FAIL R45 1-1 @cam 760 probe=unarmed/parked: the col-55 post's trigger
//          band (cols 53…57, rows 9…12) holds ink the bare world does not produce — with the level's
//          posts present: 120,184=#b35c0a, on the same map stripped of them: 120,184=#9be3f5` — neither
//          differential can see this one (it draws in both arms of both), the absolute probe can.
//        - a marker that only paints while the hero stands in the post's tile → caught by the probe's
//          pinned state: `FAIL R45 1-1 @cam 760 probe=armed/hero pinned on the post: …
//          126,186=#ffd23e …`.
//        - a "marker" that is not a sprite at all but one extra character in the intro banner string
//          (`WORLD 1-1#1 — STRAWBERRY FIELDS`) → `FAIL R45 1-1 @cam 760 (post centred) banner up: a
//          checkpoint changed the framed banner — fillRect #1138: with checkpoints [35,63,1,1,"#1a1a1a",
//          1,1138], without them [41,63,1,1,"#1a1a1a",1,1138]` — every glyph after the inserted `#1`
//          shifted 6 px. This is why one pair per level and camera renders with the banner live.
//      WHAT STILL ESCAPES, stated because the point of a guarantee is its edges:
//        - A draw that depends on NO checkpoint state and lands OUTSIDE every post's trigger band.
//          Measured: `ctx.fillRect(4, 120, 4, 4)` in an unused palette colour, painted unconditionally
//          on every level — the whole suite stays **43/43**. That is not a hidden checkpoint marker (it
//          is furniture, drawn identically with or without a `K` anywhere in the game), but this check
//          cannot tell the two apart and does not claim to.
//        - Ink in a post's band that exactly matches the colour already there (invisible by definition),
//          ink outside the band (the probe's box is the trigger box, not the whole frame), and any state
//          this check does not render: PAUSED / LEVEL_CLEAR / WIN / GAME_OVER overlays, TITLE, camera
//          positions other than the four above, checkpoint states other than the four above, hero
//          positions other than parked / pinned-on-post-0, banner phases other than the one `bannerT =
//          1.5` pair, levels other than the three shipped, and anything that depends on a LIVE crossing
//          (a draw that happens only on the frame a hero runs through the band at RUN_MAX, or only for
//          the first N frames of a run). Clause 2 covers the audible/pushable half of that one real
//          crossing.
//      render() is a pure function of (ctx, G) in PLAYING — its only wall-clock input is drawTitle's
//      Date.now() blink, which the PLAYING path never reaches — so repeating a render is a determinism
//      test rather than an assumption, and it is run as one on every camera position.
//
//  (2) ARRIVAL IS SILENT, AND IT STILL ARMS. One real left-to-right crossing at RUN_MAX through the
//      real fixed-timestep loop, from a deliberately live, decaying banner: zero items pushed (so zero
//      popups), zero audio.sfx('power') calls, no sfx whose name smells like an arrival, and the
//      banner never rising above where the run started. Then the same crossing's STATE: the slot that
//      armed, the bound, the post's own flag, and both floors holding on the post. Silence with no
//      arming fails; arming with noise fails. Both halves are required — the previous suite proved an
//      arming by its NOISE, so it could not tell "silent but armed" from "nothing at all".
//
// 'power' is not a dead sound: src/main.js still plays it for berries and berry blocks. So "no power
// at the post" is a claim about the checkpoint path, not about a sound nobody can trigger.
//
// DISCRIMINATION PROOFS (each in its own throwaway copy under the session temp; the repo was never
// mutated. Full table, with the pass counts each produced, in WORKFLOW_STATE.md FIX PASS 5):
//   - re-add a drawCheckpoint-style draw at the post in src/render.js (the deleted loop, restored)
//     → clause 1 FAILS, quoting the first fillRect that differs.
//   - re-add the deleted feedback block (`audio.sfx('power')` + the 'CHECKPOINT' popup + `G.bannerT =
//     1`) to main.js's trigger → clause 2 FAILS, on the item count; each effect re-added ALONE is
//     quoted too, because a one-line regression is the likelier one.
//   - keep the crossing silent but stop it arming: deleting the whole arming block → clause 2 FAILS at
//     its own scenario guard (`the hero at RUN_MAX never crossed the post at x=640 (checkpointIndex=-1
//     after 400 frames) — the scenario never performed the arrival it is here to measure`), and arming
//     the slot while deleting only the bound write → clause 2 FAILS on `the silent crossing did not
//     raise the left bound to the post it crossed (checkpointX=0, post 640)`. Either way red: a
//     checkpoint that announces nothing and does nothing is not invisible, it is gone, and this check
//     refuses both.
// ---------------------------------------------------------------------------

check('R45', () => {
  // One frame's draw stream, as data. `scale`/`translate` are captured into the compared string, but
  // only the first three kinds get a per-call diff message, because those are what a re-added sprite
  // changes.
  const stream = (r) => JSON.stringify([r.rects, r.text, r.blits, r.scaleCalls, r.translateCalls]);
  const shot = () => { const r = mkRecorder(); renderScene(mkCtx(r), G); return stream(r); };
  const firstDiff = (a, b, la = 'with checkpoints', lb = 'without them') => {
    const A = JSON.parse(a);
    const B = JSON.parse(b);
    const kinds = ['fillRect', 'fillText', 'drawImage'];
    for (let k = 0; k < 3; k++) {
      for (let i = 0; i < Math.max(A[k].length, B[k].length); i++) {
        const x = JSON.stringify(A[k][i]);
        const y = JSON.stringify(B[k][i]);
        if (x !== y) return `${kinds[k]} #${i}: ${la} ${x === undefined ? '(no such call)' : x}, ${lb} ${y === undefined ? '(no such call)' : y}`;
      }
    }
    return 'the two frames differ outside the draw-call kinds this check models';
  };

  // ---- (1) NOTHING IS DRAWED AT A POST — on every shipped level, at several cameras, armed or not
  //
  // The state space IS the claim, so it is spelled out. For each of the three shipped LEVELS
  // definitions, for each of four camera positions (three that put the level's first post on screen at
  // a different place in the frame, one that puts none of its posts on screen), for each of four
  // checkpoint states:
  //   unarmed      checkpointIndex = -1,  checkpointX = 0,   no post taken
  //   spent        checkpointIndex = -1,  checkpointX = 0,   EVERY post taken   (isolates cp.taken)
  //   armed        checkpointIndex = 0,   checkpointX = post0.x, taken flags derived
  //   banked       checkpointIndex = last, checkpointX = last post, all taken
  // two things are asserted:
  //   (a) the frame equals the frame of the SAME level with `level.checkpoints` emptied — the
  //       differential, which is what catches a draw that reads level.checkpoints or cp.taken; and
  //   (b) the ARMED frame equals the UNARMED frame of the same level with its array intact — the axis
  //       this check did not have before 2026-11-17, and the one that makes a marker gated on
  //       `g.checkpointIndex` ("appears after you bank") impossible to hide, including one whose
  //       coordinates have nothing to do with `level.checkpoints`.
  // Then a third, NON-differential half (the absolute probe below) covers markers that no checkpoint
  // state can make appear or disappear. `render()` is a pure function of (ctx, G) in PLAYING — its only
  // wall-clock input is drawTitle's Date.now() blink, which the PLAYING path never reaches — so
  // repeating a render is a determinism test rather than an assumption, and it is run as one.
  const STATES = [
    { name: 'unarmed', arm: -1, allTaken: false },
    { name: 'spent', arm: -1, allTaken: true },
    { name: 'armed', arm: 0, allTaken: null },
    { name: 'banked', arm: -2, allTaken: true },
  ];
  const setArmState = (level, st) => {
    const idx = st.arm === -2 ? level.checkpoints.length - 1 : st.arm;
    G.checkpointIndex = idx;
    G.checkpointX = idx < 0 ? 0 : level.checkpoints[idx].x;
    for (const c of level.checkpoints) c.taken = st.allTaken === null ? c.x <= G.checkpointX : st.allTaken;
  };
  const NO_POST_SPOT = 'no post on screen';
  const CAM_SPOTS = [
    { name: 'post centred', at: 120 },
    { name: 'post at the left edge', at: 32 },
    { name: 'post at the right edge', at: C.VIEW_W - 48 },
    { name: NO_POST_SPOT, at: null },
  ];

  const diffs = [];
  let nRects = 0;
  let comparisons = 0;
  let firstLevel = null;   // the frame the canary is painted into (1-1, post centred)
  const probeCases = [];
  for (const def of LEVELS) {
    const level = parseLevel(def);
    const cps = level.checkpoints;
    assert(cps.length >= 2, `${def.label} ships ${cps.length} checkpoints — there is nothing here to be invisible about`);
    installLevel(level);
    // A canonical HUD, so the figure this check prints and the stream it diffs do not depend on what
    // the previous check left behind in G.score / G.lives / G.muted.
    G.score = 0; G.lives = C.START_LIVES; G.fruitCount = 0; G.muted = false; G.bannerT = 0;
    const maxCam = Math.max(0, level.widthPx - C.VIEW_W);
    for (const spot of CAM_SPOTS) {
      const camX = spot.at === null ? 0 : Math.min(Math.max(0, cps[0].x - spot.at), maxCam);
      G.cam.x = camX;
      if (spot.at === null) {
        const live = cps.filter((c) => c.x - camX >= 0 && c.x - camX < C.VIEW_W);
        assert(live.length === 0, `the harness meant to render ${def.label} with no post on screen and found ${live.length} inside the view — the "identical to the frame with nothing in it" comparison below would be comparing an empty frame`);
      } else {
        const sx = cps[0].x - camX;
        assert(sx >= 0 && sx < C.VIEW_W, `the harness parked the camera so ${def.label}'s first post lands at screen x=${sx}, outside the ${C.VIEW_W}px view — the diff below would be comparing a frame with nothing in it`);
      }
      for (const st of STATES) {
        setArmState(level, st);
        const where = `${def.label} @cam ${camX} (${spot.name}) state=${st.name}`;
        const authored = shot();
        if (!nRects) { nRects = JSON.parse(authored)[0].length; firstLevel = level; }
        const kept = level.checkpoints;
        level.checkpoints = [];
        const emptied = shot();
        level.checkpoints = kept;
        comparisons++;
        if (emptied !== authored) diffs.push(`${where}: a checkpoint changed the frame — ${firstDiff(authored, emptied)} (${nRects} fillRect calls with the level's ${cps.length} posts, ${JSON.parse(emptied)[0].length} with none)`);
      }
      // (b) arming must be invisible, array and all: same level, same camera, same hero, same taken
      // flags as the arming rules produce — only G.checkpointIndex / G.checkpointX differ.
      setArmState(level, STATES[0]);
      const unarmed = shot();
      eq(shot(), unarmed, `rendering ${def.label}'s PLAYING state twice through src/render.js produced two different draw streams — the harness is not deterministic, so nothing in this check can call anything identical`);
      setArmState(level, STATES[2]);
      const armed = shot();
      comparisons++;
      if (armed !== unarmed) diffs.push(`${def.label} @cam ${camX} (${spot.name}) arming: raising the left authority (checkpointIndex -1 → 0, checkpointX 0 → ${cps[0].x}) changed the frame — ${firstDiff(unarmed, armed, 'unarmed', 'armed')}`);
      // (b2) with the intro banner UP. Every comparison so far renders with `bannerT = 0`, which is the
      // right baseline for diffing terrain, but it means a marker that extended the banner STRING
      // (`'WORLD ' + label + (cp.taken ? ' ✔' : '')`) rather than drawing a sprite would be invisible to
      // all of them. The banner is drawn from `level.label` at y=60 (`render.js:308-314`), i.e. outside
      // the probe's band, so this pair is the only thing that watches it.
      G.bannerT = 1.5;
      setArmState(level, STATES[2]);
      const bannerArmed = shot();
      const keptB = level.checkpoints;
      level.checkpoints = [];
      const bannerEmptied = shot();
      level.checkpoints = keptB;
      comparisons++;
      if (bannerEmptied !== bannerArmed) diffs.push(`${def.label} @cam ${camX} (${spot.name}) banner up: a checkpoint changed the framed banner — ${firstDiff(bannerArmed, bannerEmptied)}`);
      setArmState(level, STATES[0]);
      const bannerUnarmed = shot();
      comparisons++;
      if (bannerArmed !== bannerUnarmed) diffs.push(`${def.label} @cam ${camX} (${spot.name}) banner up + arming: ${firstDiff(bannerUnarmed, bannerArmed, 'unarmed', 'armed')}`);
      G.bannerT = 0;
      probeCases.push({ def, level, camX, spot: spot.name });
    }
  }
  assert(diffs.length === 0, diffs[0]);

  // (c) THE ABSOLUTE PROBE — what a post's own band of screen inks, measured against the same band on a
  // version of that map with every checkpoint and every non-ground tile removed.
  //
  // Why this exists: (a) and (b) are DIFFERENTIALS, so a marker can only be caught by something the
  // test changes. The audit's third surviving variant was a marker whose coordinates came from the map
  // data rather than from `level.checkpoints`, and no amount of checkpoint-state coverage makes such a
  // draw appear in one render and not the other — it is in both, and a diff of a frame against itself
  // cannot see it. So this half asks a non-comparative question instead: the box main.js arms on
  // (`CHECKPOINT_TRIGGER_*`, rows cp.row-3…cp.row over post±2, the same band R38 holds clear of terrain)
  // must contain nothing but the parallax. Ground, fruit, turnips, the hero and the banner are taken out
  // of the probe state (an actor that legitimately inks the post's tile would swallow a marker with it);
  // what is left in the box, on a map with no `K` and no solid above the ground line, is sky, hills,
  // clouds and bushes — and those layers are `(ctx, camX)`-only functions, which is why the same camera
  // on the stripped map is a legitimate reference rather than a different picture.
  //
  // A CANARY closes the loop on this probe's own wiring, because a probe that always returns the same
  // string would pass for exactly the same reason a vacuous diff does: after the comparison, the harness
  // paints one 1×1 fillRect of its own inside the first post's box and requires the probe to notice.
  // That proves the machinery is sensitive to a single pixel at the post (which is the sensitivity floor
  // R45 claims); it does NOT claim anything about a marker the probe's box does not cover — see the
  // MEASURED SENSITIVITY note in the header above this check.
  // What the probe reports per box is the set of `x,y=colour` pairs the frame inked inside it, last
  // write wins (the same overwrite semantics the shared recorder uses), so a marker that paints over
  // sky reads as a difference and a marker painted over by terrain does not hide.
  const bandBoxes = (level) => level.checkpoints.map((cp) => ({
    tx: cp.x / C.TILE,
    x0: cp.x - CLEARANCE_BAND_COLS * C.TILE, x1: cp.x + (CLEARANCE_BAND_COLS + 1) * C.TILE,
    y0: (cp.row + CHECKPOINT_BAND_ROW_OFFSETS[0]) * C.TILE,
    y1: (cp.row + CHECKPOINT_BAND_ROW_OFFSETS[CHECKPOINT_BAND_ROW_OFFSETS.length - 1] + 1) * C.TILE,
  }));
  const fmtBox = (m) => [...m.entries()].sort((p, q) => (p[0] < q[0] ? -1 : 1)).map((e) => e.join('=')).join(';');
  const probeShot = (boxes, camX) => {
    const r = mkRecorder();
    r.glyphInk = false;
    r.inkRects = false;
    const hits = boxes.map(() => new Map());
    r.inkRects = true;
    r.ink = (x, y, color) => {
      for (let i = 0; i < boxes.length; i++) {
        const b = boxes[i];
        if (x >= b.x0 - camX && x < b.x1 - camX && y >= b.y0 && y < b.y1) hits[i].set(x + ',' + y, color);
      }
    };
    const ctx = mkCtx(r);
    renderScene(ctx, G);
    return { ctx, boxReport: (i) => fmtBox(hits[i]) };
  };
  const inkDiff = (a, b) => {
    const A = a.split(';');
    const B = b.split(';');
    for (let i = 0; i < Math.max(A.length, B.length); i++) if (A[i] !== B[i]) return `with the level's posts present: ${A[i] || '(nothing inked there)'}, on the same map stripped of them: ${B[i] || '(nothing inked there)'}`;
    return 'the two boxes differ in ink count only';
  };
  const airCache = new Map();
  const bareState = (camX, pinX) => {
    G.score = 0; G.lives = C.START_LIVES; G.fruitCount = 0; G.muted = false; G.bannerT = 0;
    G.enemies = []; G.items = [];
    G.cam.x = camX;
    // With pinX the hero stands ON the post's tile — the state R36 pins a banked checkpoint in, and the
    // one a marker could hide behind. Without it the hero is parked off the left edge of the view: it is
    // 12 px wide and stands on row 12, i.e. exactly inside the box being probed, so anywhere near the
    // post it becomes part of what the probe has to explain. Both renders of a pair put the hero in the
    // SAME place, so its own ink cancels and only what the post adds is left.
    G.player.x = pinX === null ? camX - 64 : pinX;
    G.player.y = GROUND_TOP - G.player.h;
    G.player.vx = 0; G.player.vy = 0; G.player.invulnT = 0; G.player.animT = 0;
  };
  const probe = (def, level, camX, st) => {
    const boxes = bandBoxes(level);
    const pinX = st.pin ? level.checkpoints[0].x : null;
    installLevel(level);
    level.bumps.length = 0;
    bareState(camX, pinX);
    setArmState(level, STATES[st.arm ? 2 : 0]);
    const mine = probeShot(boxes, camX);
    // The reference is ALWAYS unarmed. It is meant to be "what the bare world inks here", and a
    // checkpoint state is not part of the world: feeding the reference an armed G would let a marker
    // gated on `g.checkpointIndex >= 0` ink the reference too and cancel itself out of the diff.
    const key = camX + '|' + (st.pin ? 'pinned' : 'parked');
    if (!airCache.has(key)) {
      // This map, same width (so the parallax hash lands on the same columns), ground kept, everything
      // else removed: every solid above the ground line, every enemy, every pickup, every `K`. And a
      // label no shipped level has, so a marker gated on `level.label === '1-3'` cannot be inked here
      // and passed off as background either.
      const air = synth({
        label: `${def.label} (bare)`,
        name: `${def.name} bare`,
        map: def.map.map((row, ty) => Array.from(row).map((ch) => (ch === 'H' || ch === 'G' || ch === 'F') ? ch : (ty >= C.ROWS - 2 && isSolid(ch) ? ch : '.')).join('')),
      });
      installLevel(air);
      air.bumps.length = 0;
      bareState(camX, pinX);
      G.checkpointIndex = -1;
      G.checkpointX = 0;
      const bare = probeShot(boxes, camX);
      airCache.set(key, boxes.map((_, i) => bare.boxReport(i)));
    }
    const ref = airCache.get(key);
    for (let i = 0; i < boxes.length; i++) {
      comparisons++;
      if (mine.boxReport(i) !== ref[i]) diffs.push(`${def.label} @cam ${camX} probe=${st.name}: the col-${boxes[i].tx} post's trigger band (cols ${boxes[i].tx - CLEARANCE_BAND_COLS}…${boxes[i].tx + CLEARANCE_BAND_COLS}, rows ${boxes[i].y0 / C.TILE}…${boxes[i].y1 / C.TILE - 1}) holds ink the bare world does not produce — ${inkDiff(mine.boxReport(i), ref[i])}`);
    }
    return mine;
  };
  const PROBE_STATES = [
    { name: 'unarmed/parked', arm: false, pin: false },
    { name: 'armed/parked', arm: true, pin: false },
    { name: 'armed/hero pinned on the post', arm: true, pin: true },
  ];
  let canaryProbe = null;
  for (const c of probeCases) {
    if (c.spot === NO_POST_SPOT) continue; // every box is off-screen there — nothing to probe
    for (const st of PROBE_STATES) {
      const got = probe(c.def, c.level, c.camX, st);
      if (!canaryProbe && c.def.label === LEVELS[0].label && c.spot === CAM_SPOTS[0].name) canaryProbe = { got, camX: c.camX };
    }
  }
  assert(diffs.length === 0, diffs[0]);
  // The CANARY, last: one 1×1 fillRect painted by the harness itself, through the same mock context,
  // inside the first post's box. If the probe cannot see that, its PASS lines mean nothing — which is
  // the same reason the determinism repeat above is a real render and not a comment.
  {
    const box = bandBoxes(firstLevel)[0];
    const before = canaryProbe.got.boxReport(0);
    canaryProbe.got.ctx.fillStyle = C.PALETTE.pumpkin;
    canaryProbe.got.ctx.fillRect(box.x0 - canaryProbe.camX + 4, box.y0 + 4, 1, 1);
    const after = canaryProbe.got.boxReport(0);
    assert(after !== before, `R45's own ink probe did not notice a 1×1 fillRect painted into the col-${box.tx} post's trigger band — the probe sees nothing, so every probe PASS above is worth nothing`);
    assert(after.includes(C.PALETTE.pumpkin), `the canary pixel changed the probe's box but is not in its report (${after.slice(0, 140)}…) — the probe is reporting the wrong region`);
  }

  // ---- (2) a real arrival is silent AND still arms
  const fl = flagLevel({ cols: 120, flag: [C.ROWS - 3, 40] });
  installLevel(fl);
  const post = fl.checkpoints[0];
  const p = G.player;
  clearInput();
  G.items.length = 0;
  // A live banner on purpose. The claim is "the crossing never raises it", and that has to hold from a
  // non-zero, decaying baseline — the state a real level entry leaves — not only from 0, where a
  // re-raise would have to be the only thing in the number.
  G.bannerT = 0.75;
  const banner0 = G.bannerT;
  resetAudioSpy();
  p.x = 2 * C.TILE;
  p.y = GROUND_TOP - p.h;
  p.vx = 0;
  p.vy = 0;
  input.right = true;
  input.run = true;
  let bank = -1;
  let frames = 0;
  let bannerMax = -Infinity;
  let itemsMax = 0;
  const watch = () => {
    frames++;
    bannerMax = Math.max(bannerMax, G.bannerT);
    itemsMax = Math.max(itemsMax, G.items.length);
    if (bank < 0 && G.checkpointIndex === 0) bank = frames;
  };
  while (frames < 400 && bank < 0) { step(); watch(); }
  assert(bank > 20, `the hero at RUN_MAX never crossed the post at x=${post.x} (checkpointIndex=${G.checkpointIndex} after ${frames} frames) — the scenario never performed the arrival it is here to measure`);
  // and keep running a second past the bank: a popup that spawns late is still inside POPUP_LIFE
  // (0.6 s), and a banner re-raise does not have to land on the crossing frame itself.
  for (let i = 0; i < 60; i++) { step(); watch(); }
  input.right = false;
  input.run = false;
  const heard = audioCalls.filter((c) => c.startsWith('sfx:'));
  const noisy = heard.filter((c) => /power|checkpoint|flag|bank|score/i.test(c));

  eq(itemsMax, 0, `the arrival pushed ${itemsMax} item(s) into G.items — a checkpoint pushes nothing at all now. flagLevel has no fruit, no berry and no breakable block, so anything in here is the post's own marker (the deleted 'CHECKPOINT' popup coming back is exactly what this catches)`);
  eq(G.items.filter((it) => it.kind === 'popup').length, 0, `${G.items.filter((it) => it.kind === 'popup').length} popup(s) were still alive at the end of the arrival run`);
  eq(sfx('power'), 0, `the arrival made ${sfx('power')} audio.sfx('power') call(s). That sound is not dead code — main.js still plays it for berries and berry blocks — but a checkpoint may not use it`);
  eq(noisy.length, 0, `the arrival announced itself (${heard.join(', ') || 'no sfx at all'}) — nothing may be heard at a post`);
  assert(bannerMax <= banner0 + 1e-12, `the crossing raised the banner: it peaked at ${bannerMax.toFixed(4)} against ${banner0.toFixed(4)} when the run started, and updateState only ever subtracts ${C.STEP.toFixed(4)} from it per frame, so a rise is a re-raise — checkpoints do not get banners`);
  assert(bannerMax < banner0 - 1e-9, `the banner never decayed across ${frames} frames (peak ${bannerMax.toFixed(4)}, start ${banner0.toFixed(4)}) — updateState never ran, so the assert above proves nothing`);

  // the other half: silent, and still the run's left authority.
  eq(G.checkpointIndex, 0, `the crossing was silent AND did not arm (checkpointIndex=${G.checkpointIndex}) — an invisible checkpoint that never arms is not invisible, it is deleted`);
  eq(G.checkpointX, post.x, `the silent crossing did not raise the left bound to the post it crossed (checkpointX=${G.checkpointX}, post ${post.x})`);
  eq(post.taken, true, 'the silent crossing did not mark the post banked');
  input.left = true;
  input.run = true;
  for (let i = 0; i < 240; i++) step();
  input.left = false;
  input.run = false;
  eq(p.x, post.x, `holding left after a silent bank left the hero at x=${p.x.toFixed(2)} instead of pinned on the post at ${post.x} — the invisible checkpoint stopped clamping the hero`);
  eq(G.cam.x, post.x - CAMERA_FOLLOW_X, `the silent bank did not give the camera its floor (cam.x=${G.cam.x} against ${post.x - CAMERA_FOLLOW_X})`);
  return `nothing drawn at a post: ${comparisons} render comparisons (${LEVELS.length} maps x ${CAM_SPOTS.length} cameras x ${STATES.length} checkpoint states, draw streams identical with the posts present and emptied + armed identical to unarmed; each post's trigger band ink-matched against the same map stripped bare; canary pixel seen) — the 1-1 reference frame is ${nRects} fillRects | RUN_MAX arrival at x=${post.x} over ${frames} frames: ${heard.length} sfx, 0 items, banner ${banner0} → ${G.bannerT.toFixed(2)} (peak ${bannerMax.toFixed(4)}), still armed, hero pinned on ${post.x}, camera floored on ${post.x - CAMERA_FOLLOW_X}`;
});

// MARKER:CHECKS

// ---------------------------------------------------------------------------
// runner
// ---------------------------------------------------------------------------

const orderKey = (id) => (id === 'SMOKE' ? -1 : Number(id.replace(/\D/g, '')));
const ALL_IDS = registry.map((c) => c.id).sort((a, b) => orderKey(a) - orderKey(b));
const args = process.argv.slice(2);
const verbose = args.includes('--verbose');
const showLog = args.includes('--log');
const wanted = args.filter((a) => !a.startsWith('-'));
const unknown = wanted.filter((w) => !ALL_IDS.includes(w));
if (unknown.length) {
  realConsoleError(`unknown check id(s): ${unknown.join(' ')}\nknown: ${ALL_IDS.join(' ')}`);
  process.exit(2);
}
const selected = wanted.length ? ALL_IDS.filter((id) => wanted.includes(id)) : ALL_IDS;

let failed = 0;
for (const id of selected) {
  const { fn } = registry.find((c) => c.id === id);
  consoleLog.length = 0;
  let line;
  try {
    const why = fn();
    line = `PASS ${id} ${typeof why === 'string' ? why : 'ok'}`;
  } catch (err) {
    failed++;
    const msg = err && err.message ? err.message : String(err);
    line = `FAIL ${id} ${msg.replace(/\s+/g, ' ')}`;
    if (verbose && !(err instanceof Fail)) realConsoleError(err && err.stack ? err.stack : String(err));
  }
  process.stdout.write(`${line}\n`);
  if (showLog && consoleLog.length) realConsoleError(`  [console.error x${consoleLog.length}] ${consoleLog[0]}`);
  try { toTitle(); clearInput(); } catch (err) { realConsoleError(`harness reset failed after ${id}: ${err.message}`); }
}
process.stdout.write(`\n${selected.length - failed}/${selected.length} pass, ${failed} fail\n`);
process.exit(failed ? 1 : 0);
