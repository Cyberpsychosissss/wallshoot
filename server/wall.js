import {
  WALL_COLS,
  WALL_ROWS,
  INITIAL_HOLES_MIN,
  INITIAL_HOLES_MAX,
  INITIAL_HOLES_HEAD_ROW_GUARD,
} from "./constants.js";

export function createWall() {
  // 0 = intact, 1 = hole
  return new Uint8Array(WALL_COLS * WALL_ROWS);
}

function randInt(a, b) {
  return a + Math.floor(Math.random() * (b - a + 1));
}

export function seedInitialHoles(wall) {
  const count = randInt(INITIAL_HOLES_MIN, INITIAL_HOLES_MAX);
  let placed = 0;
  let tries = 0;
  while (placed < count && tries < 200) {
    tries++;
    const col = randInt(0, WALL_COLS - 1);
    const row = randInt(INITIAL_HOLES_HEAD_ROW_GUARD, WALL_ROWS - 1);
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
  const i = row * WALL_COLS + col;
  if (wall[i] === 1) return false;
  wall[i] = 1;
  return true;
}

export function wallToBase64(wall) {
  return Buffer.from(wall).toString("base64");
}
