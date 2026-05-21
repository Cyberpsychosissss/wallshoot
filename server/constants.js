export const SUBPATH = process.env.SUBPATH || "";
export const PUBLIC_BASE_URL =
  process.env.PUBLIC_BASE_URL || `http://localhost:${process.env.PORT || 8088}`;

export const TICK_RATE = 30;
export const TICK_INTERVAL_MS = 1000 / TICK_RATE;

export const ROOM_CODE_LEN = 6;
export const ROOM_IDLE_GC_MS = 5 * 60 * 1000;

export const PREP_SECONDS = 5;
export const BULLETS_PER_TURN = 6;
export const INITIAL_HP = 100;
export const DMG_HEAD = 100;
export const DMG_TORSO = 40;
export const DMG_LIMB = 20;

export const WALL_COLS = 12;
export const WALL_ROWS = 12;
export const INITIAL_HOLES_MIN = 3;
export const INITIAL_HOLES_MAX = 5;
export const INITIAL_HOLES_HEAD_ROW_GUARD = 3;

// Splash damage when a bullet hits intact bricks. Center cell + random
// neighbours inside the radius are all broken.
export const SPLASH_RADIUS = 2;            // chebyshev distance
export const SPLASH_BREAK_MIN = 6;
export const SPLASH_BREAK_MAX = 8;

export const REPLAY_BUFFER_TICKS = 45;
export const REPLAY_PLAYBACK_RATE = 0.5;

export const POW_DIFFICULTY_DEFAULT = 18;
export const POW_DIFFICULTY_HARD = 22;
export const POW_CHALLENGE_TTL_MS = 5 * 60 * 1000;

export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const LOGIN_FAIL_LIMIT = 5;
export const LOGIN_LOCK_MS = 15 * 60 * 1000;

export const ACTIVATION_TTL_MS = 24 * 60 * 60 * 1000;

export const RATING_START = 1000;
export const RATING_ROUND_DELTA = 25;
export const RATING_MATCH_DELTA = 50;

export const BO_BEST_OF = 3;
