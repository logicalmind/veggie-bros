import { ROWS, SOLID } from './config.js';

const MARKER = 'HTFCG';
const NEEDS_GROUND = 'HTF';
const LEGEND = `${SOLID}${MARKER}.`;

export function isSolid(ch) {
  return SOLID.includes(ch);
}

export function tileAt(level, tx, ty) {
  if (ty < 0) return '.';
  const cols = level.tiles[0].length;
  if (tx < 0 || tx >= cols || ty >= ROWS) return 'X';
  return level.tiles[ty][tx];
}

// Rejects map typos that would otherwise load as silent, invisible bugs: characters outside
// the legend, hangers/enemies/gates left floating, and markers painted onto solid tiles.
// Runs on the raw map strings, before any marker is cleared out of the tile grid.
function validateMap(label, map, cols) {
  const at = (ty, tx) => {
    if (ty < 0) return '.';
    if (tx < 0 || tx >= cols || ty >= ROWS) return 'X';
    return map[ty][tx];
  };
  for (let ty = 0; ty < map.length; ty++) {
    for (let tx = 0; tx < cols; tx++) {
      const ch = map[ty][tx];
      if (!LEGEND.includes(ch)) {
        throw new Error(`level ${label}: unknown character '${ch}' at ${ty},${tx}`);
      }
      if (!MARKER.includes(ch)) continue;
      if (NEEDS_GROUND.includes(ch) && !isSolid(at(ty + 1, tx))) {
        throw new Error(`level ${label}: '${ch}' at ${ty},${tx} has no solid tile below`);
      }
      if (isSolid(at(ty, tx - 1)) && isSolid(at(ty, tx + 1))) {
        throw new Error(`level ${label}: '${ch}' at ${ty},${tx} is embedded in solid tiles`);
      }
    }
  }
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
  validateMap(def.label, map, cols);

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
