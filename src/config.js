export const TILE = 16;
export const VIEW_W = 256;
export const VIEW_H = 240;
export const ROWS = 15;
export const STEP = 1 / 60;

export const GRAVITY = 2300;
export const MAX_FALL = 420;
export const JUMP_VY = -640;
export const WALK_MAX = 110;
export const RUN_MAX = 190;
export const ACCEL = 800;
export const AIR_ACCEL = 600;
export const FRICTION = 1400;
export const COYOTE = 0.08;
export const JUMP_BUFFER = 0.12;
export const JUMP_CUT_VY = -200;
export const STOMP_BOUNCE = -360;

export const PLAYER_W = 12;
export const PLAYER_SMALL_H = 12;
export const PLAYER_BIG_H = 26;
// The hero grows upward: the feet stay put, so the box gains this much height above the
// old small box. main.js spends it on the grow band, player.js on the shrink back down.
export const GROW_H = PLAYER_BIG_H - PLAYER_SMALL_H;
export const INVULN_TIME = 2.0;
export const START_LIVES = 3;

export const ENEMY_SPEED = 30;
export const BOSS_SPEED = 40;
export const BOSS_HP = 3;
export const BOSS_HOP_COOLDOWN = 1.6;
export const BOSS_HOP_RANGE = 120;
export const BOSS_HOP_VY = -380;

export const BERRY_SPEED = 60;
export const BERRY_LIFE = 15;

export const SCORE = { fruit: 100, stomp: 200, block: 50, berry: 1000, gate: 1000, bossHit: 500, bossDown: 2000 };

// The checkpoint's trigger band, in the same shape as the gate's (main.js GATE_*): it runs
// CHECKPOINT_TRIGGER_TOP above cp.y down to CHECKPOINT_TRIGGER_BOTTOM below it, and
// CHECKPOINT_TRIGGER_W wide from cp.x rightwards. This box IS the whole of a checkpoint as the
// player can perceive it: the marker is invisible (fix pass 5 deleted the flag art and the arrival
// feedback), so nothing here may be justified by "what the art inks" — only by the gameplay these
// three constants drive (main.js's arming band, and the spot the death respawn puts the hero back
// on). cp.y is the TOP of the marker tile (row 12 in every shipped map), so cp.y + 16 is the
// standing surface itself: a walking hero (top 196, bottom 208) overlaps it with 12 px to
// spare on each axis, which is what makes a plain walking pass arm the flag.
export const CHECKPOINT_TRIGGER_W = TILE * 2;
export const CHECKPOINT_TRIGGER_TOP = TILE * 4;
export const CHECKPOINT_TRIGGER_BOTTOM = TILE;

export const SOLID = "XSBPQU=|";

// Graphics-upgrade scales (GRAPHICS_PLAN.md §4). The logical world stays 256x240/TILE 16 —
// these only say how much DETAIL is baked per logical pixel and at what rate the FX buffers
// run. Nothing in player/enemy/items/level/camera reads them.
export const SCENE_SCALE = 4; // scene buffer is logical * 4 (256x240 -> 1024x960); baked art
// canvases use this scale so they land 1:1 under the scene transform (composite.js owns the
// buffers, config.js owns the grid)
export const FX_SCALE = 0.5; // lightmap/fog/bloom run at 128x120: lighting is low-frequency,
// so a quarter of the scene costs 1/16 the fill and still reads smooth when composited up.
// The one FX threshold main.js needs but no gameplay module owns: below this landing power the
// touchdown is a tile seam, not a drop, so a flat walking pass must not spawn a dust puff.
export const LAND_MIN_POWER = 0.15; // main.js compares |vy|/MAX_FALL against it
// Gate-celebration cutscene timeline (seconds, GATE_DANCE): the hero walks to the arch,
// the doorway glow floods the screen, the grown dancer appears on the far side over the
// growth beat, then dances until a fresh key press. DANCE_TEXT_T is the growth end = the
// "press any key" prompt appears = the exit arms (main.js and ui.js share these).
export const DANCE_WALK_T = 1.45;
export const DANCE_GLOW_END = 1.75;
export const DANCE_TEXT_T = 2.15;
// Global multiplier on every camera-shake increment, applied at the fx.shake() entry (the
// landing puff is the only emitter). 1.0 is the 2026-11-19 R54 tuning; halved to 0.5 on
// 2026-11-21 because landings shook too much; quartered to 0.25 the same day because even
// the halved shake still read as jitter (JASON playtest). The offset stays integer and the
// ±1 floor in fx.js keeps any live shake at 1 px, so this shortens the jitter window, not
// the step. At 0.25 only near-terminal landings (power > ~0.90) print one 1-px frame;
// lighter landings land still. 0.2 would silence even a full-power landing.
export const SHAKE_SCALE = 0.25;

export const PALETTE = {
  sky: "#9be3f5",
  skyDark: "#7fd4ec",
  cloud: "#ffffff",
  hillFar: "#a8e08f",
  hillNear: "#6cc760",
  bush: "#3f9e4d",
  dirt: "#d98c4a",
  dirtDark: "#a35f2c",
  grass: "#5fbf4a",
  stone: "#e8e0c0",
  stoneDark: "#a89e78",
  brick: "#e0a45c",
  brickDark: "#9c6428",
  pumpkin: "#f08c1e",
  pumpkinDark: "#b35c0a",
  pumpkinLit: "#ffd23e",
  used: "#b08050",
  usedDark: "#7a5230",
  platform: "#e8c86a",
  platformDark: "#b08830",
  pipe: "#4fc76a",
  pipeDark: "#2f8f47",
  pipeFlesh: "#dff2c8",
  heroBody: "#e8434f",
  heroDark: "#b02531",
  heroSeed: "#ffd23e",
  heroLeaf: "#3f9e4d",
  white: "#ffffff",
  black: "#1a1a1a",
  turnipBody: "#f2e8dc",
  turnipTip: "#c9a86a",
  berryBody: "#4a6cf0",
  berryDark: "#2f4ab0",
  pineapple: "#e8b83e",
  pineappleDark: "#a87820",
  crown: "#ffd23e",
  red: "#e8434f",
};
