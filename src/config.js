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

export const SOLID = "XSBPQU=|";

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
