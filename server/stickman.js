// Stickman body geometry on the wall grid.
// Each cell is identified by an offset from the player's column anchor (dc)
// and an absolute row index on the wall grid.
//
// The same logic exists in client/render/stickman-geom.js — keep both in sync.

const STAND = [
  // head: rows 1-3, cols [-1, 1]
  { rows: [1, 3], cols: [-1, 1], part: "head" },
  // torso: rows 4-12, cols [-1, 1]
  { rows: [4, 12], cols: [-1, 1], part: "torso" },
  // limbs: rows 13-22, cols [-1, 1]
  { rows: [13, 22], cols: [-1, 1], part: "limb" },
];

const CROUCH = [
  { rows: [7, 9], cols: [-1, 1], part: "head" },
  { rows: [10, 15], cols: [-1, 1], part: "torso" },
  { rows: [16, 22], cols: [-1, 1], part: "limb" },
];

const PRONE = [
  // lying flat near the floor: head far-left, limbs far-right
  { rows: [20, 21], cols: [-4, -3], part: "head" },
  { rows: [20, 21], cols: [-2, 2], part: "torso" },
  { rows: [20, 21], cols: [3, 4], part: "limb" },
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
