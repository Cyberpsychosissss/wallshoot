// Stickman body geometry on the wall grid (12 cols × 12 rows).
// Each cell is identified by an offset from the player's column anchor (dc)
// and an absolute row index on the wall grid.
//
// The same logic exists in client/render.js — keep both in sync.

const STAND = [
  { rows: [0, 1], cols: [-1, 1], part: "head" },
  { rows: [2, 6], cols: [-1, 1], part: "torso" },
  { rows: [7, 11], cols: [-1, 1], part: "limb" },
];

const CROUCH = [
  { rows: [3, 4], cols: [-1, 1], part: "head" },
  { rows: [5, 8], cols: [-1, 1], part: "torso" },
  { rows: [9, 11], cols: [-1, 1], part: "limb" },
];

const PRONE = [
  // lying flat at the bottom: head far-left, limbs far-right
  { rows: [10, 11], cols: [-4, -3], part: "head" },
  { rows: [10, 11], cols: [-2, 2], part: "torso" },
  { rows: [10, 11], cols: [3, 4], part: "limb" },
];

const POSTURES = { stand: STAND, crouch: CROUCH, prone: PRONE };

export const POSTURE_NAMES = Object.keys(POSTURES);

export function bodyCells(posture) {
  const blocks = POSTURES[posture] || STAND;
  const cells = [];
  for (const b of blocks) {
    for (let r = b.rows[0]; r <= b.rows[1]; r++) {
      for (let dc = b.cols[0]; dc <= b.cols[1]; dc++) {
        cells.push({ dc, row: r, part: b.part });
      }
    }
  }
  return cells;
}

const cacheByPosture = new Map();
function bodyCellsCached(posture) {
  if (!cacheByPosture.has(posture)) {
    cacheByPosture.set(posture, bodyCells(posture));
  }
  return cacheByPosture.get(posture);
}

// Returns "head" | "torso" | "limb" | null
export function hitTest(col, row, anchorCol, posture) {
  const cells = bodyCellsCached(posture);
  const dc = col - Math.round(anchorCol);
  for (const c of cells) {
    if (c.dc === dc && c.row === row) return c.part;
  }
  return null;
}
