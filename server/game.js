import {
  TICK_INTERVAL_MS,
  TICK_RATE,
  WALL_COLS,
  WALL_ROWS,
  AIM_MIN_COL,
  AIM_MAX_COL,
  AIM_MIN_ROW,
  AIM_MAX_ROW,
  JUMP_DURATION_MS,
  DODGE_DURATION_MS,
} from "./constants.js";
import { settings } from "./settings.js";
import { createWall, seedInitialHoles, wallToBase64, breakArea } from "./wall.js";
import { hitTest, POSTURE_NAMES } from "./stickman.js";
import { createBuffer, pushFrame, snapshot, clearBuffer } from "./replay.js";

const PHASE = {
  WAITING: "waiting",
  PREP: "prep",
  BATTLE: "battle",
  SLOWMO: "slowmo",
  ROUND_END: "round_end",
  MATCH_END: "match_end",
};

const SLOWMO_MS = 1500;
const ROUND_END_MS = 2500;

function clamp(v, a, b) {
  return v < a ? a : v > b ? b : v;
}

// Initialise the game state for a brand-new room with two players.
export function createGame({ playerAId, playerBId }) {
  const state = {
    phase: PHASE.WAITING,
    tick: 0,
    phaseStartedAt: 0,
    playerAId,
    playerBId,
    // round-scoped:
    round: 0,
    scoreA: 0,
    scoreB: 0,
    // who is the current shooter — index 0 or 1 referring to [A, B]
    shooterIdx: 0,
    // per-player live state
    players: [
      { id: playerAId, hp: settings.INITIAL_HP, posture: "stand", anchorCol: 6, moveDir: 0, ammo: 0, aim: { col: 6, row: 6 }, aimDir: { col: 0, row: 0 }, action: null, actionStart: 0, actionDuration: 0 },
      { id: playerBId, hp: settings.INITIAL_HP, posture: "stand", anchorCol: 6, moveDir: 0, ammo: 0, aim: { col: 6, row: 6 }, aimDir: { col: 0, row: 0 }, action: null, actionStart: 0, actionDuration: 0 },
    ],
    wall: createWall(),
    events: [], // transient events emitted this tick (sounds, hit flashes)
    replay: createBuffer(),
    slowmoPayload: null,
    roundResult: null, // { winnerIdx, partHit, ... }
    matchResult: null,
    lastHitAt: 0,
    bothReady: true,
  };
  return state;
}

export function startMatch(state) {
  state.round = 1;
  state.scoreA = 0;
  state.scoreB = 0;
  state.shooterIdx = 0; // A starts as shooter; alternates each round
  startRound(state);
}

function startRound(state) {
  state.players[0].hp = settings.INITIAL_HP;
  state.players[1].hp = settings.INITIAL_HP;
  state.players[0].posture = "stand";
  state.players[1].posture = "stand";
  state.players[0].anchorCol = 6;
  state.players[1].anchorCol = 6;
  state.players[0].aim = { col: 6, row: 6 };
  state.players[1].aim = { col: 6, row: 6 };
  state.players[0].aimDir = { col: 0, row: 0 };
  state.players[1].aimDir = { col: 0, row: 0 };
  state.players[0].action = null;
  state.players[1].action = null;
  state.players[state.shooterIdx].ammo = settings.BULLETS_PER_TURN;
  state.players[1 - state.shooterIdx].ammo = 0;
  state.wall = createWall();
  seedInitialHoles(state.wall);
  state.events.push({ t: "round_start", round: state.round });
  clearBuffer(state.replay);
  setPhase(state, PHASE.PREP);
}

function setPhase(state, phase) {
  state.phase = phase;
  state.phaseStartedAt = state.tick;
}

function phaseElapsedMs(state) {
  return (state.tick - state.phaseStartedAt) * TICK_INTERVAL_MS;
}

// Zero out a player's continuous input state — used when their socket drops
// so they don't keep drifting / firing while the game is paused.
export function resetPlayerInput(state, playerIdx) {
  if (!state) return;
  const p = state.players[playerIdx];
  if (!p) return;
  p.moveDir = 0;
  if (p.aimDir) { p.aimDir.col = 0; p.aimDir.row = 0; }
  p.action = null;
}

export function applyInput(state, playerIdx, input) {
  if (state.phase === PHASE.MATCH_END) return;
  const p = state.players[playerIdx];
  if (!p) return;
  const isShooter = playerIdx === state.shooterIdx;

  if (isShooter) {
    if (state.phase !== PHASE.BATTLE) return;
    if (typeof input.aim_dx === "number") {
      p.aimDir.col = clamp(input.aim_dx, -1, 1);
    }
    if (typeof input.aim_dy === "number") {
      p.aimDir.row = clamp(input.aim_dy, -1, 1);
    }
    if (typeof input.aim_col === "number") {
      p.aim.col = clamp(input.aim_col, AIM_MIN_COL, AIM_MAX_COL);
    }
    if (typeof input.aim_row === "number") {
      p.aim.row = clamp(input.aim_row, AIM_MIN_ROW, AIM_MAX_ROW);
    }
    if (input.fire === true) {
      doFire(state);
    }
  } else {
    // hider — can move during prep AND battle
    if (state.phase !== PHASE.PREP && state.phase !== PHASE.BATTLE) return;
    if (typeof input.move === "number") {
      p.moveDir = clamp(input.move, -1, 1);
    }
    if (typeof input.posture === "string" && POSTURE_NAMES.includes(input.posture) && !p.action) {
      p.posture = input.posture;
    }
    if (typeof input.action === "string" && !p.action) {
      let dur = 0;
      if (input.action === "jump") dur = JUMP_DURATION_MS;
      else if (input.action === "dodge_left" || input.action === "dodge_right") dur = DODGE_DURATION_MS;
      if (dur > 0) {
        p.action = input.action;
        p.actionStart = state.tick * TICK_INTERVAL_MS;
        p.actionDuration = dur;
        state.events.push({ t: "action_start", playerIdx, action: input.action });
      }
    }
  }
}

function doFire(state) {
  const shooter = state.players[state.shooterIdx];
  if (shooter.ammo <= 0) return;
  const hider = state.players[1 - state.shooterIdx];
  const col = Math.round(shooter.aim.col);
  const row = Math.round(shooter.aim.row);
  shooter.ammo -= 1;
  // Aim outside the wall grid — bullet flies into the air (or past the wall
  // entirely). No damage, no break.
  if (col < 0 || col >= WALL_COLS || row < 0 || row >= WALL_ROWS) {
    state.events.push({ t: "miss_air", col, row });
    if (shooter.ammo === 0) swapShooter(state);
    return;
  }
  const cellIdx = row * WALL_COLS + col;
  const cellState = state.wall[cellIdx];
  if (cellState === 0) {
    // Intact wall — splash-break a chunk of bricks around the impact.
    const broken = breakArea(state.wall, col, row);
    state.events.push({ t: "wall_break", col, row, broken });
  } else {
    // Already a hole — bullet passes through; check hider hitbox at this cell.
    const part = hitTest(col, row, hider.anchorCol, hider.posture, hider.action, actionProgress(hider, state));
    if (part) {
      const dmg = part === "head" ? settings.DMG_HEAD : part === "torso" ? settings.DMG_TORSO : settings.DMG_LIMB;
      hider.hp = Math.max(0, hider.hp - dmg);
      state.events.push({ t: "hit", col, row, part, victimIdx: 1 - state.shooterIdx, dmg });
      state.lastHitAt = state.tick;
      if (hider.hp <= 0) {
        endRound(state, state.shooterIdx, part, col, row);
        return;
      }
    } else {
      state.events.push({ t: "miss_through_hole", col, row });
    }
  }
  if (shooter.ammo === 0) {
    swapShooter(state);
  }
}

function swapShooter(state) {
  state.shooterIdx = 1 - state.shooterIdx;
  state.players[state.shooterIdx].ammo = settings.BULLETS_PER_TURN;
  state.players[1 - state.shooterIdx].ammo = 0;
  state.events.push({ t: "swap", new_shooter_idx: state.shooterIdx });
}

function endRound(state, winnerIdx, partHit, col, row) {
  state.roundResult = { winnerIdx, partHit, col, row };
  state.slowmoPayload = {
    frames: snapshot(state.replay),
    finalCol: col,
    finalRow: row,
    winnerIdx,
    partHit,
  };
  setPhase(state, PHASE.SLOWMO);
}

function finishSlowmo(state) {
  const { winnerIdx } = state.roundResult;
  if (winnerIdx === 0) state.scoreA += 1;
  else state.scoreB += 1;
  state.events.push({ t: "round_end", winnerIdx, scoreA: state.scoreA, scoreB: state.scoreB });
  const needed = Math.ceil(settings.BO_BEST_OF / 2);
  if (state.scoreA >= needed || state.scoreB >= needed) {
    state.matchResult = {
      winnerIdx: state.scoreA > state.scoreB ? 0 : 1,
      scoreA: state.scoreA,
      scoreB: state.scoreB,
    };
    setPhase(state, PHASE.MATCH_END);
  } else {
    setPhase(state, PHASE.ROUND_END);
  }
}

function startNextRound(state) {
  state.round += 1;
  state.shooterIdx = 1 - state.shooterIdx;
  state.roundResult = null;
  state.slowmoPayload = null;
  startRound(state);
}

function actionProgress(p, state) {
  if (!p.action) return 0;
  const elapsed = state.tick * TICK_INTERVAL_MS - p.actionStart;
  return Math.max(0, Math.min(1, elapsed / p.actionDuration));
}

export function tick(state) {
  state.tick += 1;

  // Expire actions
  for (let i = 0; i < 2; i++) {
    const p = state.players[i];
    if (p.action) {
      const elapsed = state.tick * TICK_INTERVAL_MS - p.actionStart;
      if (elapsed >= p.actionDuration) {
        p.action = null;
        p.actionStart = 0;
        p.actionDuration = 0;
      }
    }
  }

  // Hider drift movement
  for (let i = 0; i < 2; i++) {
    if (i === state.shooterIdx) continue;
    const p = state.players[i];
    if (state.phase === PHASE.PREP || state.phase === PHASE.BATTLE) {
      const speed = 4.0 / TICK_RATE; // 4 cells per second
      p.anchorCol = clamp(p.anchorCol + p.moveDir * speed, 1, WALL_COLS - 2);
    }
  }

  // Shooter aim drift (button-driven)
  if (state.phase === PHASE.BATTLE) {
    const sh = state.players[state.shooterIdx];
    const aimSpeed = 8.0 / TICK_RATE; // ~8 cells per second
    sh.aim.col = clamp(sh.aim.col + sh.aimDir.col * aimSpeed, AIM_MIN_COL, AIM_MAX_COL);
    sh.aim.row = clamp(sh.aim.row + sh.aimDir.row * aimSpeed, AIM_MIN_ROW, AIM_MAX_ROW);
  }

  switch (state.phase) {
    case PHASE.PREP: {
      if (phaseElapsedMs(state) >= settings.PREP_SECONDS * 1000) {
        setPhase(state, PHASE.BATTLE);
      }
      break;
    }
    case PHASE.BATTLE: {
      // Record frame into replay buffer
      pushFrame(state.replay, captureFrame(state));
      break;
    }
    case PHASE.SLOWMO: {
      if (phaseElapsedMs(state) >= SLOWMO_MS) {
        finishSlowmo(state);
      }
      break;
    }
    case PHASE.ROUND_END: {
      if (phaseElapsedMs(state) >= ROUND_END_MS) {
        startNextRound(state);
      }
      break;
    }
  }
}

function captureFrame(state) {
  return {
    tick: state.tick,
    shooterIdx: state.shooterIdx,
    players: [
      {
        anchorCol: state.players[0].anchorCol,
        posture: state.players[0].posture,
        hp: state.players[0].hp,
        ammo: state.players[0].ammo,
        aim: { ...state.players[0].aim },
      },
      {
        anchorCol: state.players[1].anchorCol,
        posture: state.players[1].posture,
        hp: state.players[1].hp,
        ammo: state.players[1].ammo,
        aim: { ...state.players[1].aim },
      },
    ],
  };
}

export function serializeForClient(state, viewerIdx) {
  const isShooterView = viewerIdx === state.shooterIdx;
  return {
    phase: state.phase,
    tick: state.tick,
    round: state.round,
    scoreA: state.scoreA,
    scoreB: state.scoreB,
    shooterIdx: state.shooterIdx,
    viewerIdx,
    isShooterView,
    timer: phaseRemainingSeconds(state),
    players: [
      {
        hp: state.players[0].hp,
        ammo: state.players[0].ammo,
        anchorCol: state.players[0].anchorCol,
        posture: state.players[0].posture,
        aim: state.players[0].aim,
        action: state.players[0].action,
        actionProgress: actionProgress(state.players[0], state),
      },
      {
        hp: state.players[1].hp,
        ammo: state.players[1].ammo,
        anchorCol: state.players[1].anchorCol,
        posture: state.players[1].posture,
        aim: state.players[1].aim,
        action: state.players[1].action,
        actionProgress: actionProgress(state.players[1], state),
      },
    ],
    wall: wallToBase64(state.wall),
    wallCols: WALL_COLS,
    wallRows: WALL_ROWS,
    events: state.events,
    roundResult: state.roundResult,
    matchResult: state.matchResult,
  };
}

function phaseRemainingSeconds(state) {
  let total = 0;
  if (state.phase === PHASE.PREP) total = settings.PREP_SECONDS;
  else if (state.phase === PHASE.SLOWMO) total = SLOWMO_MS / 1000;
  else if (state.phase === PHASE.ROUND_END) total = ROUND_END_MS / 1000;
  else return null;
  const elapsed = phaseElapsedMs(state) / 1000;
  return Math.max(0, total - elapsed);
}

export function getSlowmoPayload(state) {
  return state.slowmoPayload;
}

export function clearEvents(state) {
  state.events = [];
}

export { PHASE };
