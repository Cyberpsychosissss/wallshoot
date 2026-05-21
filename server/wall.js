import {
  WALL_COLS,
  WALL_ROWS,
  SPLASH_RADIUS,
  SPLASH_BREAK_MIN,
  SPLASH_BREAK_MAX,
} from "./constants.js";
import { settings } from "./settings.js";

export function createWall() {
  // 0 = intact brick, 1 = broken hole.
  return new Uint8Array(WALL_COLS * WALL_ROWS);
}

function randInt(a, b) {
  return a + Math.floor(Math.random() * (b - a + 1));
}

export function seedInitialHoles(wall) {
  const lo = Math.min(settings.INITIAL_HOLES_MIN, settings.INITIAL_HOLES_MAX);
  const hi = Math.max(settings.INITIAL_HOLES_MIN, settings.INITIAL_HOLES_MAX);
  const count = randInt(lo, hi);
  let placed = 0;
  let tries = 0;
  while (placed < count && tries < 200) {
    tries++;
    const col = randInt(0, WALL_COLS - 1);
    const row = randInt(settings.INITIAL_HOLES_HEAD_ROW_GUARD, WALL_ROWS - 1);
    const idx = row * WALL_COLS + col;
    if (wall[idx] === 1) continue;
    wall[idx] = 1;
    placed++;
  }
}

export function cellAt(wall, col, row) {
  if (col < 0 || col >= WALL_COLS || row < 0 || row >= WALL_ROWS) return null;
  return wall[row * WALL_COLS + col];
}

export function breakCell(wall, col, row) {
  if (col < 0 || col >= WALL_COLS || row < 0 || row >= WALL_ROWS) return false;
  if (row < 0 || row >= WALL_ROWS) return false;
  const i = row * WALL_COLS + col;
  if (wall[i] === 1) return false;
  wall[i] = 1;
  return true;
}

// Splash: breaks the center cell + a random subset of nearby cells, returning
// a list of {col, row} for cells that actually flipped from intact → hole.
export function breakArea(wall, centerCol, centerRow) {
  const broken = [];
  // Always break center if intact and not in sky.
  if (breakCell(wall, centerCol, centerRow)) broken.push({ col: centerCol, row: centerRow });
  // Gather candidate neighbours within chebyshev radius.
  const candidates = [];
  for (let dr = -SPLASH_RADIUS; dr <= SPLASH_RADIUS; dr++) {
    for (let dc = -SPLASH_RADIUS; dc <= SPLASH_RADIUS; dc++) {
      if (dr === 0 && dc === 0) continue;
      const r = centerRow + dr, c = centerCol + dc;
      if (r < 0 || r >= WALL_ROWS) continue;
      if (c < 0 || c >= WALL_COLS) continue;
      if (wall[r * WALL_COLS + c] !== 0) continue; // skip holes / sky
      candidates.push({ col: c, row: r });
    }
  }
  // Shuffle (Fisher-Yates) and take a random count between MIN-1 and MAX-1
  // (the center cell already counts towards the total).
  for (let i = candidates.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
  }
  const targetExtra = randInt(SPLASH_BREAK_MIN - 1, SPLASH_BREAK_MAX - 1);
  const extras = Math.min(targetExtra, candidates.length);
  for (let i = 0; i < extras; i++) {
    const { col, row } = candidates[i];
    if (breakCell(wall, col, row)) broken.push({ col, row });
  }
  return broken;
}

export function wallToBase64(wall) {
  return Buffer.from(wall).toString("base64");
}
