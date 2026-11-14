# Veggie Bros.

8-bit-inspired fruit-and-vegetable side-scrolling platformer in vanilla JS + HTML5 canvas — zero dependencies, no build step, original content.

## Run

No install needed. From the repo root:

```sh
python3 -m http.server 8000
```

Then open <http://localhost:8000>. (Alternative: `npx serve .` — a plain `file://` open won't work, since the game uses ES modules.)

## Controls

| Action | Key(s) |
| --- | --- |
| Move | ← / → or A / D |
| Run (hold) | Shift |
| Jump | Space / Z / W / ↑ |
| Start / Confirm | Enter |
| Pause | P / Esc |
| Restart level (while paused) | R |
| Mute | M |

Touch buttons appear automatically on small/touch screens.

## Goal

Collect Sunfruit, stomp Turnip Troopers, and grow with the Mega Berry. Reach the Melon Gate at the end of 1-1 and 1-2, then defeat Bromely the Pineapple King in 1-3.

## Structure

See [architecture.md](architecture.md) for the module map and design.
