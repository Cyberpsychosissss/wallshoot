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

// Splash: irregular round crater around the impact point. Inner ring is
// guaranteed to break; outer ring breaks with probability that decays with
// euclidean distance — so the result reads as a fuzzy circle, not a square.
export function breakArea(wall, centerCol, centerRow) {
  const broken = [];
  if (breakCell(wall, centerCol, centerRow)) broken.push({ col: centerCol, row: centerRow });
  const radius = SPLASH_RADIUS;
  for (let dr = -radius; dr <= radius; dr++) {
    for (let dc = -radius; dc <= radius; dc++) {
      if (dr === 0 && dc === 0) continue;
      const dist = Math.sqrt(dr * dr + dc * dc);
      if (dist > radius + 0.4) continue;
      const r = centerRow + dr, c = centerCol + dc;
      if (r < 0 || r >= WALL_ROWS || c < 0 || c >= WALL_COLS) continue;
      if (wall[r * WALL_COLS + c] !== 0) continue;
      // Probability: inner (dist ≤ 1.1) always breaks; mid ring high prob;
      // outer ring sparse.
      let p;
      if (dist <= 1.1) p = 1.0;
      else if (dist <= 1.6) p = 0.85;
      else if (dist <= 2.1) p = 0.55;
      else p = 0.25;
      if (Math.random() < p && breakCell(wall, c, r)) {
        broken.push({ col: c, row: r });
      }
    }
  }
  // Cap to MAX (rare; usually probabilities self-limit).
  if (broken.length > SPLASH_BREAK_MAX) {
    // Drop the farthest excess cells
    broken.sort((a, b) => {
      const da = (a.col - centerCol) ** 2 + (a.row - centerRow) ** 2;
      const db = (b.col - centerCol) ** 2 + (b.row - centerRow) ** 2;
      return da - db;
    });
    const dropped = broken.splice(SPLASH_BREAK_MAX);
    for (const d of dropped) wall[d.row * WALL_COLS + d.col] = 0; // restore
  }
  // Ensure minimum spread for visual punch
  if (broken.length < SPLASH_BREAK_MIN) {
    const ringCandidates = [];
    for (let dr = -radius; dr <= radius; dr++) {
      for (let dc = -radius; dc <= radius; dc++) {
        if (dr === 0 && dc === 0) continue;
        const dist = Math.sqrt(dr * dr + dc * dc);
        if (dist > radius + 0.5) continue;
        const r = centerRow + dr, c = centerCol + dc;
        if (r < 0 || r >= WALL_ROWS || c < 0 || c >= WALL_COLS) continue;
        if (wall[r * WALL_COLS + c] === 0) ringCandidates.push({ c, r, dist });
      }
    }
    ringCandidates.sort((a, b) => a.dist - b.dist);
    for (const cand of ringCandidates) {
      if (broken.length >= SPLASH_BREAK_MIN) break;
      if (breakCell(wall, cand.c, cand.r)) broken.push({ col: cand.c, row: cand.r });
    }
  }
  return broken;
}

export function wallToBase64(wall) {
  return Buffer.from(wall).toString("base64");
}
