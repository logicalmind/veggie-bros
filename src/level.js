import { ROWS, SOLID } from './config.js';

export function isSolid(ch) {
  return SOLID.includes(ch);
}

export function tileAt(level, tx, ty) {
  if (ty < 0) return '.';
  const cols = level.tiles[0].length;
  if (tx < 0 || tx >= cols || ty >= ROWS) return 'X';
  return level.tiles[ty][tx];
}

export function parseLevel(def) {
  const map = def.map;
  if (map.length !== ROWS) {
    throw new Error(`level ${def.label}: expected ${ROWS} rows, got ${map.length}`);
  }
  const cols = map[0].length;
  for (let ty = 0; ty < map.length; ty++) {
    if (map[ty].length !== cols) {
      throw new Error(`level ${def.label}: row ${ty} has length ${map[ty].length}, expected ${cols}`);
    }
  }
  let hCount = 0;
  let gateOrBossCount = 0;
  for (let ty = 0; ty < map.length; ty++) {
    for (let tx = 0; tx < cols; tx++) {
      const ch = map[ty][tx];
      if (ch === 'H') hCount++;
      else if (ch === 'G' || ch === 'F') gateOrBossCount++;
    }
  }
  if (hCount !== 1) {
    throw new Error(`level ${def.label}: expected exactly one H, got ${hCount}`);
  }
  if (gateOrBossCount !== 1) {
    throw new Error(`level ${def.label}: expected exactly one G or F, got ${gateOrBossCount}`);
  }

  const tiles = map.map((row) => row.split(''));
  const level = {
    label: def.label,
    name: def.name,
    widthPx: cols * 16,
    tiles,
    playerSpawn: null,
    enemies: [],
    boss: null,
    fruits: [],
    gate: null,
    bumps: [],
  };

  for (let ty = 0; ty < ROWS; ty++) {
    for (let tx = 0; tx < cols; tx++) {
      const ch = tiles[ty][tx];
      if (ch === 'H') {
        level.playerSpawn = { x: tx * 16 + 2, y: (ty + 1) * 16 - 12 };
        tiles[ty][tx] = '.';
      } else if (ch === 'T') {
        level.enemies.push({ type: 'turnip', x: tx * 16 + 2, y: (ty + 1) * 16 - 12 });
        tiles[ty][tx] = '.';
      } else if (ch === 'F') {
        level.boss = { x: tx * 16 + 4, y: (ty + 1) * 16 - 28 };
        tiles[ty][tx] = '.';
      } else if (ch === 'C') {
        level.fruits.push({ x: tx * 16 + 4, y: ty * 16 + 4 });
        tiles[ty][tx] = '.';
      } else if (ch === 'G') {
        level.gate = { x: tx * 16, y: ty * 16, row: ty };
        tiles[ty][tx] = '.';
      }
    }
  }

  return level;
}
