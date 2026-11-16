export const input = {
  left: false,
  right: false,
  run: false,
  jump: false,
  jumpPressed: false,
  start: false,
  pausePressed: false,
  mutePressed: false,
  restartPressed: false,
};

export function consumeJumpPressed() {
  const v = input.jumpPressed;
  input.jumpPressed = false;
  return v;
}

export function consumeStart() {
  const v = input.start;
  input.start = false;
  return v;
}

export function consumePause() {
  const v = input.pausePressed;
  input.pausePressed = false;
  return v;
}

export function consumeMute() {
  const v = input.mutePressed;
  input.mutePressed = false;
  return v;
}

export function consumeRestart() {
  const v = input.restartPressed;
  input.restartPressed = false;
  return v;
}

// Space scrolls the page and activates a focused button; Tab moves focus into the control
// bar, which arms the Enter/Space activation path; Enter activates whatever is focused.
// preventDefault only suppresses the *browser* default, never the game action below, so
// Enter still reaches the start branch. The bar's buttons are tabindex="-1" and blur
// themselves on pointerdown, so by the time Enter is pressed there is nothing to activate.
const PREVENT_KEYS = new Set(["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", " ", "Enter", "Tab"]);

// Cmd/Ctrl/Alt chords belong to the browser, not to the game: Cmd/Ctrl+P was pausing the
// game *and* opening Print, Cmd+M muted on the way to minimising, Cmd+R fed
// restartPressed on the way to a reload, Cmd+A set input.left while selecting the page,
// Cmd+W set jump on the way to closing the tab. Shift is exempt — it is the run key, and
// Shift+Arrow still reports e.key === 'ArrowLeft'.

// e.key is the character the layout *labels* the key with: AZERTY's home row is
// `a z e r t`, so the physical WASD cluster types `a z e r` and `d` never arrives;
// Cyrillic/Greek layouts send `ф`/`α`; during IME composition everything is
// `Process`. e.code is the physical position and is layout-independent, so every
// letter binding tests both and a keydown can never be missed by one of them.
function onKeyDown(e) {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (PREVENT_KEYS.has(e.key)) e.preventDefault();
  const k = e.key.toLowerCase();
  if (e.key === "ArrowLeft" || e.code === "KeyA" || k === "a") {
    input.left = true;
  } else if (e.key === "ArrowRight" || e.code === "KeyD" || k === "d") {
    input.right = true;
  } else if (e.key === "Shift") {
    input.run = true;
  } else if (e.key === " " || e.code === "KeyZ" || e.code === "KeyW" || k === "z" || k === "w" || e.key === "ArrowUp") {
    if (!input.jump) input.jumpPressed = true;
    input.jump = true;
  } else if (e.key === "Enter") {
    if (!e.repeat) input.start = true;
  } else if (k === "p" || e.code === "KeyP" || e.key === "Escape") {
    if (!e.repeat) input.pausePressed = true;
  } else if (k === "m" || e.code === "KeyM") {
    if (!e.repeat) input.mutePressed = true;
  } else if (k === "r" || e.code === "KeyR") {
    if (!e.repeat) input.restartPressed = true;
  }
}

// The release side tests exactly the same compound conditions as onKeyDown, so a
// held flag set by a code-driven keydown is always cleared by its keyup.
// The modifier guard is deliberately NOT mirrored here: a keydown carrying a modifier
// never sets anything, so its keyup can only be releasing a flag that a modifier-free
// keydown set — hold right, then press Cmd and the release arrives as Cmd+ArrowRight.
// Returning early on modifiers there would drop a real release and latch the direction
// until the next blur (resetInput()), while releasing a flag that is already false costs
// nothing: always release on the way up.
function onKeyUp(e) {
  const k = e.key.toLowerCase();
  if (e.key === "ArrowLeft" || e.code === "KeyA" || k === "a") {
    input.left = false;
  } else if (e.key === "ArrowRight" || e.code === "KeyD" || k === "d") {
    input.right = false;
  } else if (e.key === "Shift") {
    input.run = false;
  } else if (e.key === " " || e.code === "KeyZ" || e.code === "KeyW" || k === "z" || k === "w" || e.key === "ArrowUp") {
    input.jump = false;
  }
}

// Which direction field each live touch pointer is holding, so a release can
// clear exactly the direction that pointer pressed and nothing else.
const touchPointers = new Map();

// Losing focus drops every pending keyup, which latched the held flags: alt-tab
// while holding right and Poppy runs into a wall forever. A latched `jump` is
// worse, because onKeyDown only sets jumpPressed when jump was false — jumping
// stopped responding entirely and player.js's jump-cut never applied.
// The one-shot flags belong to main.js's endFrame(), so they are left alone.
export function resetInput() {
  input.left = false;
  input.right = false;
  input.run = false;
  input.jump = false;
  touchPointers.clear();
}

window.addEventListener("blur", resetInput);

// A hidden tab sees no key events at all. Auto-pausing the game itself is R07.
document.addEventListener("visibilitychange", () => {
  if (document.hidden) resetInput();
});

// A long-press on Android fires contextmenu and pops the copy/paste menu over the
// control bar (iOS shows the same menu for text, which -webkit-touch-callout in
// index.html suppresses). Nothing on this page is selectable text, so the menu is
// never wanted — the guard belongs at document level, not per button.
document.addEventListener("contextmenu", (e) => e.preventDefault());

// Mouse and pen pointers get no implicit capture on a hybrid device, so a
// pointerdown on a direction button released somewhere else on the page never
// reaches the button's own pointerup and the direction latches. The window
// handler only releases the pointerId that is actually ending, so a finger
// still held on another button (right + tapping jump) is left alone.
function onPointerRelease(e) {
  const field = touchPointers.get(e.pointerId);
  if (field === undefined) return;
  touchPointers.delete(e.pointerId);
  input[field] = false;
}

window.addEventListener("pointerup", onPointerRelease);
window.addEventListener("pointercancel", onPointerRelease);

export function setupKeyboard() {
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
}

export function setupTouch() {
  if (!window.matchMedia("(pointer: coarse)").matches) return;
  document.getElementById("touch").style.display = "flex";
  // A tapped button keeps focus forever and nothing here styles :focus, so nobody can see
  // which one is focused and the next Tab press activates it — and Enter on top of that
  // could reach the game twice. Every button is tabindex="-1" in the markup; blurring on
  // the way down covers a tap that never leaves the button. blur is optional-chained so
  // an element without it cannot throw in the middle of a pointerdown.
  const onFocusDown = (el, down) => (e) => { el.blur?.(); down(e); };
  const bind = (id, down, up) => {
    const el = document.getElementById(id);
    el.addEventListener("pointerdown", onFocusDown(el, down));
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
  };
  const dir = (id, field) => {
    bind(id,
      (e) => { touchPointers.set(e.pointerId, field); input[field] = true; },
      (e) => { touchPointers.delete(e.pointerId); input[field] = false; });
  };
  // One-shot flags only: endFrame() clears anything main.js did not consume, so a
  // pointerup that never arrives (flicked off the button, cancelled) cannot latch a
  // second start or pause the way a held direction would.
  // click is the keyboard / assistive-tech path. A finger tap ends in a synthetic click
  // too, but by then a frame has already consumed the pointerdown, so counting that
  // trailing click again would start a second game (or pause and instantly un-pause).
  // A pointerdown therefore owns the click that follows it: that one is dropped.
  const tap = (id, field) => {
    const el = document.getElementById(id);
    let ownedByPointer = false;
    el.addEventListener("pointerdown", onFocusDown(el, () => {
      ownedByPointer = true;
      input[field] = true;
    }));
    el.addEventListener("click", () => {
      if (ownedByPointer) { ownedByPointer = false; return; }
      input[field] = true;
    });
    // a cancelled gesture is never followed by a click, so the pointer stops owning one
    el.addEventListener("pointercancel", () => { ownedByPointer = false; });
  };
  dir("t-left", "left");
  dir("t-right", "right");
  dir("t-run", "run"); // run is a hold, so it shares the pointerId bookkeeping above
  tap("t-start", "start");
  tap("t-pause", "pausePressed");
  bind("t-jump", () => {
    if (!input.jump) input.jumpPressed = true;
    input.jump = true;
  }, () => { input.jump = false; });
}
