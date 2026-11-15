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
const { updateCamera } = await import('../src/camera.js');
const spritesModule = await import('../src/sprites.js');
const { drawBerry, drawBoss, drawHero, drawPixelText, drawTurnip } = spritesModule;
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
  G.levelIndex = 0;
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

const LEGEND = ['.', 'X', 'S', 'B', 'P', 'Q', 'U', '=', '|', 'H', 'T', 'F', 'C', 'G'];

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
  step();
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
  const it = makePopup(p.x, p.y - 8, '+100');
  G.items.push(it);
  renderFrames(1);
  const y0 = Math.floor(it.y - 20 * (it.t / 0.6)) - 2;
  const y1 = y0 + 14;
  const x0 = Math.floor(it.x - G.cam.x) - 4;
  const x1 = x0 + 6 * it.text.length + 8;
  const ink = rec.textInk.filter((q) => q.y >= y0 && q.y < y1 && q.x >= x0 && q.x < x1);
  assert(ink.length > 0, `no ink was drawn where the '+100' popup should be (x ${x0}..${x1}, y ${y0}..${y1}) — the popup is not rendering at all`);
  const first = ink[0];
  const whites = ink.filter((q) => q.color === C.PALETTE.white).length;
  assert(first.color !== C.PALETTE.white,
    `the popup's first inked pixel is PALETTE.white (${whites}/${ink.length} white pixels over sky ${C.PALETTE.sky} / stone ${C.PALETTE.stone}) — draw it in INK or blit an INK backing pass first`);
  return `popup ink leads with ${first.color} (${whites} white of ${ink.length} pixels)`;
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
  const stage = rec.textInk.filter((q) => q.y >= 90 && q.y < 120);
  const plus = rec.textInk.filter((q) => q.y >= 120 && q.y < 150);
  assert(stage.length > 0 && plus.length > 0, `STAGE CLEAR/+1000 ink not found (stage ${stage.length}, plus ${plus.length} pixels)`);
  const firstText = Math.min(stage[0].seq, plus[0].seq);
  if (flash[6] < firstText) bad.push(`the flash (draw #${flash[6]}) is issued BEFORE 'STAGE CLEAR'/'${"'"}+1000${"'"}' (draw #${firstText}) — expected the flash first, then the text on top`);
  const hud = rec.textInk.filter((q) => q.y < 30);
  if (hud.length && hud.every((q) => q.seq < flash[6]) && flash[5] > 0.9) bad.push('the HUD is drawn under a full-strength flash');
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
  const above = tryPickup(1);
  if (above.got) bad.push(`the berry was collected with the player's feet 1px ABOVE the art's top row (art ${above.a.minY}..${above.a.maxY}, ${above.h}px tall) — the pickup rect is bigger than the art`);
  const centre = tryPickup(above.h - 2);
  if (!centre.got) bad.push('the berry was NOT collected when the player overlaps the middle of its art — the pickup was over-shrunk');
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
  let back = 0;
  for (let i = 0; i < 120; i++) {
    p.x = Math.max(p.x - C.RUN_MAX * C.STEP, 0);
    updateCamera(cam, C.STEP, p, level.widthPx);
    back = Math.max(back, X - cam.x);
  }
  assert(back < 1e-9, `cam.x fell from ${X.toFixed(2)} to ${cam.x.toFixed(2)} (${back.toFixed(2)}px) over 120 steps walking left — the camera must ratchet, not scroll back`);
  // culling: behind-camera enemies stop being simulated, nearby ones keep moving
  installLevel(level);
  G.cam = { x: X };
  G.player.x = X + 96;            // the steady-state offset keeps camX pinned at X
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
  const movedFar = Math.abs(far.x - (X - 100));
  const movedNear = Math.abs(near.x - (X - 10));
  assert(movedNear > 0.5, `the enemy 10px behind the camera stopped being simulated (moved ${movedFar.toFixed(2)}px)`);
  assert(movedFar === 0, `the enemy ${Math.round(X - far.x)}px behind the camera is still simulated (moved ${movedFar.toFixed(2)}px) — cull entities at e.x + e.w < camX - 32`);
  return `cam ratchets at ${X.toFixed(0)}; enemy at camX-100 frozen, camX-10 still walking`;
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
  G.levelIndex = index;
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
  groundRows(grid, 0, 10);
  groundRows(grid, 16, 40);           // 6-column pit between cols 10..15
  put(grid, 'H', C.ROWS - 3, 2);
  put(grid, 'T', C.ROWS - 3, 12);     // turnip directly over the gap
  put(grid, 'G', C.ROWS - 3, 38);
  const level = synth(toDef(grid, 'furniture'));
  installLevel(level);
  clearInput();
  const enemy = G.enemies[0];
  let phantom = null;
  for (let i = 0; i < 120; i++) {
    step();
    if (enemy.onGround && enemy.y + enemy.h >= C.ROWS * C.TILE && phantom === null) phantom = i;
  }
  if (phantom !== null) assert(false, `the turnip over the gap came to rest on the phantom floor at y=${enemy.y} (feet ${enemy.y + enemy.h}) at step ${phantom} and is still in G.enemies (${G.enemies.length}) — entities reaching y+h >= ROWS*TILE must die`);
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
  grid[C.ROWS - 3][14] = ' ';   // non-solid, non-'.' tile in front of the turnip
  const level = synth(toDef(grid, 'ledge'));
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
