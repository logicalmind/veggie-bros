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

const PREVENT_KEYS = new Set(["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", " "]);

function onKeyDown(e) {
  if (PREVENT_KEYS.has(e.key)) e.preventDefault();
  const k = e.key.toLowerCase();
  if (e.key === "ArrowLeft" || k === "a") {
    input.left = true;
  } else if (e.key === "ArrowRight" || k === "d") {
    input.right = true;
  } else if (e.key === "Shift") {
    input.run = true;
  } else if (e.key === " " || k === "z" || k === "w" || e.key === "ArrowUp") {
    if (!input.jump) input.jumpPressed = true;
    input.jump = true;
  } else if (e.key === "Enter") {
    if (!e.repeat) input.start = true;
  } else if (k === "p" || e.key === "Escape") {
    if (!e.repeat) input.pausePressed = true;
  } else if (k === "m") {
    if (!e.repeat) input.mutePressed = true;
  } else if (k === "r") {
    if (!e.repeat) input.restartPressed = true;
  }
}

function onKeyUp(e) {
  const k = e.key.toLowerCase();
  if (e.key === "ArrowLeft" || k === "a") {
    input.left = false;
  } else if (e.key === "ArrowRight" || k === "d") {
    input.right = false;
  } else if (e.key === "Shift") {
    input.run = false;
  } else if (e.key === " " || k === "z" || k === "w" || e.key === "ArrowUp") {
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
  const bind = (id, down, up) => {
    const el = document.getElementById(id);
    el.addEventListener("pointerdown", down);
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
  const tap = (id, field) => {
    document.getElementById(id).addEventListener("pointerdown", () => { input[field] = true; });
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
