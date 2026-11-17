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

## Structure

See [architecture.md](architecture.md) for the module map and design, and its **Deviations** section for the places where the shipped game deliberately differs from the original design.
