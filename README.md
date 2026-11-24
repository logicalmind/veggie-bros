# Veggie Bros.

Fruit-and-vegetable side-scrolling platformer in vanilla JS + HTML5 canvas — zero dependencies, no build step, original content. The art is fully procedural high-resolution 2D (gradients, seeded noise, soft lighting, bloom, multi-depth parallax), painted in code at 4× a 256×240 logical playfield. No image files anywhere.

## Run

No install needed. From the repo root:

```sh
./serve-local.sh      # localhost only -> http://127.0.0.1:8010
./serve-network.sh    # all interfaces  -> play it from a phone on the same Wi-Fi
./stop-server.sh      # stop the server on 8010 (a foreground one stops with Ctrl-C)
```

All three take an optional port (`./serve-local.sh 8020`) and default to **8010**. **Never use port 8000** — it is reserved for the splash inference engine, and all three scripts refuse it and exit. The serve scripts also refuse an already-listening port; `./stop-server.sh` stops by port (either bind address) and refuses to touch a port held by anything other than the dev server it expects. The serve scripts run `tools/serve.py` — the stdlib `http.server` plus `Cache-Control: no-store` — so a standard browser refresh always pulls the files straight from disk (plain `http.server` sends no cache headers, and a reload can otherwise re-serve a stale ES module). (`npx serve .` works too. A plain `file://` open does not: the game loads ES modules.)

## Controls

| Action | Key(s) | Touch button |
| --- | --- | --- |
| Move | ← / → or A / D | ◀ / ▶ (hold) |
| Run (hold) | Shift | B (hold) |
| Jump | Space / Z / W / ↑ | A |
| Start / Confirm | Enter | START |
| Pause | P / Esc | PAUSE |
| Restart level (while paused) | R | — keyboard only |
| Mute | M (works in any screen) | — keyboard only |

Letter keys are matched by both the character they type **and** the physical key position (`e.code`), so AZERTY, Dvorak, Cyrillic and IME-composing keyboards all work. Cmd/Ctrl/Alt chords are ignored — they belong to the browser; Shift is exempt because it is the run key.

The on-screen bar appears on any device with a coarse pointer (`(any-pointer: coarse)`, so a touchscreen laptop gets it too) and is shown or hidden again live when you plug a pointer in or out. Touch players have no keyboard, which is why **START** and **PAUSE** are on-screen buttons — without them the title screen and the pause menu would be unreachable. There is no on-screen Mute or Restart-Level button yet.

## Goal

Collect Sunfruit, stomp Turnip Troopers, and grow with the Mega Berry. Reach the Melon Gate at the end of 1-1 and 1-2, then defeat Bromely the Pineapple King in 1-3. Progress is one-way: a few invisible checkpoints sit along each level, and once you have run past one (from the left) you can no longer travel or scroll back left past it — and if you fall, you come back at the last one you passed instead of at the start of the level. Nothing marks them: no flag, no banner, no sound. The rule to play by is simply that as far as you have got is the place you come back to, and retreating left into one does not claim it.

## Verification

The render pipeline is gated by `tools/hd-verify.mjs` — a browser-side sanity set. With the dev server running, open the game and paste it into the DevTools console (or fetch-and-eval it):

```js
window.__hd = await (0, eval)(await (await fetch('/tools/hd-verify.mjs')).text())
```

(Any paste-and-run form works as long as the text is **evaluated**, not `import`ed: the file is a bare async IIFE with no export, so `import(blobURL)` resolves to an empty module.)

It prints one JSON report and checks the invariants that must hold forever: the scene backing is `SCENE_SCALE` 4 → 1024×960; terrain strip bakes (256×960 HD px) are deterministic across `invalidate()`; the **seam contract** — the same view rendered through two different strip phases (0 and 8) is byte-identical, the property that makes the strip LRU legal; and the live canvas is a real HD frame (≥ 50 distinct colours; a settled 1-1 frame carries ~11–12 k). Expected: `{"ok":true,...,"seam":{"cam140":true,"cam420":true}}`.

The older headless suite `tools/verify.mjs` (54 checks, one per historical defect) is **parked on this branch and currently cannot run** — its digests pin the pre-HD 8-bit atlas byte-for-byte, and `src/sprites.js`, which it imports, no longer exists. It still works on `feature/graphics-upgrade` and `main`. Gameplay itself has no automated coverage here; the state machine, physics and levels are verified by playtest and by the pixel probes recorded in `REALISTIC_STATE.md`.

## Structure

See [architecture.md](architecture.md) for the module map and design, and its **Deviations** section for the places where the shipped game deliberately differs from the original design. Caveat: its file map and line citations describe the pre-HD renderer (`sprites.js`/`atlas.js` no longer exist; their successors are `chars.js` + the HD painter in `terrain.js`/`composite.js`); the gameplay sections still hold. `REALISTIC_STATE.md` is the running log of the HD branch.
