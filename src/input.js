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
  bind("t-left", () => { input.left = true; }, () => { input.left = false; });
  bind("t-right", () => { input.right = true; }, () => { input.right = false; });
  bind("t-jump", () => {
    if (!input.jump) input.jumpPressed = true;
    input.jump = true;
  }, () => { input.jump = false; });
}
