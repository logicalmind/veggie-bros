# Veggie Bros.

8-bit-inspired fruit-and-vegetable side-scrolling platformer in vanilla JS + HTML5 canvas — zero dependencies, no build step, original content.

## Run

No install needed. From the repo root:

```sh
./serve-local.sh      # localhost only -> http://127.0.0.1:8010
./serve-network.sh    # all interfaces  -> play it from a phone on the same Wi-Fi
```

Both take an optional port (`./serve-local.sh 8020`) and default to **8010**. **Never use port 8000** — it is reserved for the splash inference engine, and both scripts refuse it and exit. They also refuse an already-listening port. (`npx serve .` works too. A plain `file://` open does not: the game loads ES modules.)

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

The repo ships its own headless test harness — no test framework, node builtins only. From the repo root:

```sh
node tools/verify.mjs        # 50/50 pass, 0 fail
node tools/verify.mjs R49    # one id on its own
```

`tools/verify.mjs` stubs just enough DOM, canvas and audio to import and drive the real `src/main.js`, fixed-timestep loop included, and registers one named check per historical defect: `SMOKE` (shipped map-data hygiene plus the standing-surface gap/rise metric), `R01`–`R33`, `R36`–`R38` and `R40`–`R52`. `R34`, `R35` and `R39` are reserved ids that were never registered. Any id also runs alone (`node tools/verify.mjs R47`), which is how a check that only passes because an earlier check left ink behind gets caught.

The renderer is measured rather than eyeballed. `R47` counts draw calls per surface on one settled frame; `R48` proves terrain and atlas baking happens per level rather than per frame; `R49` gates art density (≥ 90 distinct colours on a reference frame, per-tile luminance tone bands median ≥ 5 and minimum ≥ 3, per-tile distinct colours median ≥ 6); `R50`–`R52` pin draw-stream determinism, a frozen gameplay snapshot, and screen shake that stays in the renderer instead of moving the camera or the player. For scale, read back from the canvas at device-pixel ratio 3 and downsampled to the logical 256×240 (nearest-neighbour, so no invented colours): the canonical 1-1 frame carries **1245** unique colours on this build, where the pre-upgrade build carried **26**. `R49` bounds density per tile on purpose — no check pins a palette digest, so the art can still change.

## Structure

See [architecture.md](architecture.md) for the module map and design, and its **Deviations** section for the places where the shipped game deliberately differs from the original design.
