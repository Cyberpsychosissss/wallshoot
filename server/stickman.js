// Stickman / cartoon body geometry on the wall grid (12 cols × 12 rows).
// Each cell is identified by an offset from the player's column anchor (dc)
// and an absolute row index on the wall grid.
//
// 5 posture/action states:
//   stand, crouch, prone     — persistent postures
//   jump, dodge_left/right   — short timed actions (handled via shift)
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
  { rows: [10, 11], cols: [-4, -3], part: "head" },
  { rows: [10, 11], cols: [-2, 2], part: "torso" },
  { rows: [10, 11], cols: [3, 4], part: "limb" },
];

const POSTURES = { stand: STAND, crouch: CROUCH, prone: PRONE };

export const POSTURE_NAMES = Object.keys(POSTURES);

export function bodyCells(posture, rowShift = 0, colShift = 0) {
  const blocks = POSTURES[posture] || STAND;
  const cells = [];
  for (const b of blocks) {
    for (let r = b.rows[0]; r <= b.rows[1]; r++) {
      for (let dc = b.cols[0]; dc <= b.cols[1]; dc++) {
        cells.push({ dc: dc + colShift, row: r + rowShift, part: b.part });
      }
    }
  }
  return cells;
}

// Returns the active shift applied by a timed action (jump/dodge).
export function actionShift(actionType, actionProgress) {
  if (!actionType) return { rowShift: 0, colShift: 0 };
  if (actionType === "jump") {
    // Parabolic lift: peak at progress 0.5
    const lift = -Math.round(Math.sin(actionProgress * Math.PI) * 4);
    return { rowShift: lift, colShift: 0 };
  }
  if (actionType === "dodge_left") {
    // Sideways arc — strong shift at progress 0.5
    const shift = -Math.round(Math.sin(actionProgress * Math.PI) * 3);
    return { rowShift: 0, colShift: shift };
  }
  if (actionType === "dodge_right") {
    const shift = Math.round(Math.sin(actionProgress * Math.PI) * 3);
    return { rowShift: 0, colShift: shift };
  }
  return { rowShift: 0, colShift: 0 };
}

// Returns "head" | "torso" | "limb" | null
export function hitTest(col, row, anchorCol, posture, actionType, actionProgress) {
  const { rowShift, colShift } = actionShift(actionType, actionProgress);
  const cells = bodyCells(posture, rowShift, colShift);
  const dc = col - Math.round(anchorCol);
  for (const c of cells) {
    if (c.dc === dc && c.row === row) return c.part;
  }
  return null;
}
