// tools/hd-verify.mjs — HD render sanity set (R-1).
//
// Browser-side. Run it in the game page (DevTools console, or fetch/eval):
//
//   await (await fetch('/tools/hd-verify.mjs')).text() and eval, or paste.
//
// It imports the page's own module instances (same URLs the game uses, so the same
// cache), bakes level 1 fresh, and checks the HD invariants that must hold forever:
//   a) the scene backing is SCENE_SCALE 4 -> 1024x960 (k === 1, scene is the final image)
//   b) strip bakes are 256x960 HD px and deterministic across invalidate()
//   c) the seam contract: the same view rendered through two different strip phases
//      (0 and 8) is pixel-identical — this is the property that makes the LRU legal
//   d) the live canvas is a real HD frame (>= 50 distinct colors on a grid sample)
// It prints one JSON report.
(async () => {
  const out = { ok: true };
  const fail = (k, v) => { out.ok = false; out[k] = v; };

  const C = await import('/src/composite.js');
  const T = await import('/src/terrain.js');
  const { parseLevel } = await import('/src/level.js');
  const { LEVELS } = await import('/src/levels.js');
  const level = parseLevel(LEVELS[0]);

  // a) scene backing
  out.sceneScale = C.SCENE_SCALE;
  if (C.SCENE_SCALE !== 4) fail('sceneScale', C.SCENE_SCALE);
  const lay = C.layout();
  out.scene = [lay.layers.scene.w, lay.layers.scene.h];
  if (lay.layers.scene.w !== 1024 || lay.layers.scene.h !== 960) fail('sceneDims', out.scene);

  // Pixel hash: OffscreenCanvas has no toDataURL in WebKit, so determinism is proven
  // by hashing the RGBA bytes (FNV-1a).
  function hashCanvas(c) {
    const t = new OffscreenCanvas(c.width, c.height);
    const tc = t.getContext('2d');
    tc.drawImage(c, 0, 0);
    const d = tc.getImageData(0, 0, c.width, c.height).data;
    let h = 0x811c9dc5;
    for (let i = 0; i < d.length; i += 4) {
      h ^= d[i]; h = Math.imul(h, 0x01000193);
      h ^= d[i + 1]; h = Math.imul(h, 0x01000193);
      h ^= d[i + 2]; h = Math.imul(h, 0x01000193);
      h ^= d[i + 3]; h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0).toString(16);
  }

  // b) strip bakes: HD size + determinism across invalidate
  const baked = T.bakeLevel(level, 'fields');
  const s0 = T.visibleStrips(baked, 140);
  out.stripCanvas = [s0[0].canvas.width, s0[0].canvas.height];
  if (s0[0].canvas.width !== 256 || s0[0].canvas.height !== 960) fail('stripCanvas', out.stripCanvas);
  const h1 = hashCanvas(s0[0].canvas);
  T.invalidate();
  const h2 = hashCanvas(T.visibleStrips(T.bakeLevel(level, 'fields'), 140)[0].canvas);
  out.determinism = h1 === h2;
  out.stripHash = h1;
  if (!out.determinism) fail('determinism', { h1, h2 });

  // c) seam probe: two strip phases, same view, must be byte-identical
  function renderView(bk, camX) {
    const c = new OffscreenCanvas(256, 240);
    const ctx = c.getContext('2d');
    ctx.drawImage(T.ambientFor(bk, camX).canvas, 0, 0, 256, 240);
    for (const L of T.parallaxFor(bk, camX)) {
      ctx.globalAlpha = L.alpha;
      ctx.drawImage(L.canvas, L.dx, 0, L.canvas.width / C.SCENE_SCALE, L.canvas.height / C.SCENE_SCALE);
    }
    ctx.globalAlpha = 1;
    for (const s of T.visibleStrips(bk, camX)) ctx.drawImage(s.canvas, s.dx, 0, bk.stripW, 240);
    return hashCanvas(c);
  }
  const b0 = T.bakeLevel(level, 'fields');
  const b8 = T.bakeLevel(level, 'fields', { stripPhase: 8 });
  out.seam = {
    cam140: renderView(b0, 140) === renderView(b8, 140),
    cam420: renderView(b0, 420) === renderView(b8, 420),
  };
  if (!out.seam.cam140 || !out.seam.cam420) fail('seam', out.seam);

  // d) live canvas is a real HD frame
  const cv = document.querySelector('#game');
  if (cv && cv.width) {
    const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
    const seen = new Set();
    for (let i = 0; i < d.length; i += 16) seen.add((d[i] << 16) | (d[i + 1] << 8) | d[i + 2]);
    out.distinctColors = seen.size;
    if (seen.size < 50) fail('renderSmoke', seen.size);
  } else {
    out.renderSmoke = 'no canvas';
  }

  console.log('HD-VERIFY', JSON.stringify(out, null, 1));
  return out;
})();
