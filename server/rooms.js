import {
  ROOM_CODE_LEN,
  ROOM_IDLE_GC_MS,
  TICK_INTERVAL_MS,
} from "./constants.js";
import {
  createGame,
  startMatch,
  applyInput,
  resetPlayerInput,
  tick as gameTick,
  serializeForClient,
  getSlowmoPayload,
  clearEvents,
  PHASE,
} from "./game.js";
import { recordMatch } from "./rating.js";
import { now } from "./db.js";

const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/I/1
const GRACE_MS = 30_000;

/** @typedef {{ code: string, sockets: any[], players: any[], game: any|null, status: string, lastActivityAt: number, matchSettled: boolean, lastPhase: string|null, graceTimers: any[] }} Room */

const rooms = new Map();             // code -> Room
const socketToRoom = new Map();      // socket.id -> code (only while connected)
const userToRoom = new Map();        // user.id -> code (persists across reconnects)

function genCode() {
  for (let tries = 0; tries < 100; tries++) {
    let code = "";
    for (let i = 0; i < ROOM_CODE_LEN; i++) {
      code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
    }
    if (!rooms.has(code)) return code;
  }
  throw new Error("room code pool exhausted");
}

function touch(room) {
  room.lastActivityAt = now();
}

function findSlotBySocket(room, socket) {
  return room.sockets.findIndex((s) => s && s.id === socket.id);
}

function findSlotByUser(room, userId) {
  return room.players.findIndex((p) => p && p.userId === userId);
}

function broadcastState(_io, room) {
  for (let i = 0; i < room.sockets.length; i++) {
    const s = room.sockets[i];
    if (!s) continue;
    s.emit("game:state", serializeForClient(room.game, i));
  }
}

function broadcastSlowmo(_io, room) {
  const payload = getSlowmoPayload(room.game);
  if (!payload) return;
  for (let i = 0; i < room.sockets.length; i++) {
    const s = room.sockets[i];
    if (!s) continue;
    s.emit("game:slowmo", { ...payload, viewerIdx: i });
  }
}

function settleMatchOnce(room) {
  if (room.matchSettled) return;
  const result = room.game.matchResult;
  if (!result) return;
  const winnerIdx = result.winnerIdx;
  const winnerId = room.players[winnerIdx].userId;
  const loserId = room.players[1 - winnerIdx].userId;
  const winnerScore = winnerIdx === 0 ? result.scoreA : result.scoreB;
  const loserScore = winnerIdx === 0 ? result.scoreB : result.scoreA;
  try {
    const delta = recordMatch({ winnerId, loserId, winnerScore, loserScore });
    room.matchSettlement = delta;
  } catch (e) {
    console.error("[rooms] recordMatch failed:", e.message);
  }
  room.matchSettled = true;
  for (let i = 0; i < room.sockets.length; i++) {
    const s = room.sockets[i];
    if (!s) continue;
    s.emit("game:match_end", {
      ...result,
      viewerIdx: i,
      settlement: room.matchSettlement,
    });
  }
}

function resumeSlot(socket, room, idx) {
  // Cancel any pending grace timer for this slot
  if (room.graceTimers[idx]) {
    clearTimeout(room.graceTimers[idx]);
    room.graceTimers[idx] = null;
  }
  room.sockets[idx] = socket;
  socketToRoom.set(socket.id, room.code);
  touch(room);

  socket.emit("room:state", {
    code: room.code,
    status: room.status,
    you: idx,
    opponent: room.players[1 - idx] ? { email: room.players[1 - idx].email } : null,
    resumed: true,
  });
  if (room.game) {
    socket.emit("game:state", serializeForClient(room.game, idx));
  }
  const other = room.sockets[1 - idx];
  if (other) other.emit("game:opponent_rejoined", {});
}

function startGraceTimer(io, room, idx) {
  if (room.graceTimers[idx]) clearTimeout(room.graceTimers[idx]);
  room.graceTimers[idx] = setTimeout(() => {
    room.graceTimers[idx] = null;
    if (room.sockets[idx]) return; // already reconnected
    if (room.players[idx]) userToRoom.delete(room.players[idx].userId);
    finalAbandon(io, room);
  }, GRACE_MS);
}

function finalAbandon(_io, room) {
  if (room.status === "abandoned") return;
  if (room.status === "playing" && !room.matchSettled) {
    const survivorIdx = room.sockets.findIndex(Boolean);
    if (survivorIdx >= 0) {
      const s = room.sockets[survivorIdx];
      s.emit("game:opponent_left", {});
    }
  }
  room.status = "abandoned";
}

function leaveSlot(io, socket, code, { explicit }) {
  const room = rooms.get(code);
  if (!room) return;
  const idx = findSlotBySocket(room, socket);
  if (idx < 0) return;

  socketToRoom.delete(socket.id);
  room.sockets[idx] = null;
  if (room.game) resetPlayerInput(room.game, idx);

  if (explicit) {
    if (room.players[idx]) userToRoom.delete(room.players[idx].userId);
    if (room.graceTimers[idx]) {
      clearTimeout(room.graceTimers[idx]);
      room.graceTimers[idx] = null;
    }
    finalAbandon(io, room);
    return;
  }

  // Implicit disconnect — notify the other side and start the grace timer.
  const other = room.sockets[1 - idx];
  if (other) other.emit("game:opponent_disconnected", { grace_ms: GRACE_MS });

  if (room.status === "waiting") {
    // No game in progress — abandon immediately, no grace.
    if (room.players[idx]) userToRoom.delete(room.players[idx].userId);
    finalAbandon(io, room);
    return;
  }
  startGraceTimer(io, room, idx);
}

export function registerRoomHandlers(io) {
  io.on("connection", (socket) => {
    const user = socket.data.user;
    socket.emit("welcome", { user });

    // Auto-resume: if this user is already in an active room, attach this socket
    // to the appropriate slot and cancel any pending grace timer.
    const existingCode = userToRoom.get(user.id);
    if (existingCode) {
      const room = rooms.get(existingCode);
      if (room && room.status !== "abandoned") {
        const idx = findSlotByUser(room, user.id);
        if (idx >= 0) {
          resumeSlot(socket, room, idx);
        } else {
          userToRoom.delete(user.id);
        }
      } else {
        userToRoom.delete(user.id);
      }
    }

    socket.on("room:create", (_, cb) => {
      // Prevent creating a new room while still in another
      if (userToRoom.has(user.id)) {
        return cb?.({ ok: false, error: "already_in_room" });
      }
      const code = genCode();
      const room = {
        code,
        sockets: [socket, null],
        players: [{ userId: user.id, email: user.email }, null],
        game: null,
        status: "waiting",
        lastActivityAt: now(),
        matchSettled: false,
        matchSettlement: null,
        lastPhase: null,
        graceTimers: [null, null],
      };
      rooms.set(code, room);
      socketToRoom.set(socket.id, code);
      userToRoom.set(user.id, code);
      socket.emit("room:state", { code, status: "waiting", you: 0 });
      cb?.({ ok: true, code });
    });

    socket.on("room:join", ({ code } = {}, cb) => {
      if (typeof code !== "string") return cb?.({ ok: false, error: "bad_code" });
      const room = rooms.get(code.toUpperCase());
      if (!room) return cb?.({ ok: false, error: "not_found" });
      if (room.status !== "waiting") return cb?.({ ok: false, error: "full" });
      if (room.players[0]?.userId === user.id) return cb?.({ ok: false, error: "same_user" });
      if (userToRoom.has(user.id)) return cb?.({ ok: false, error: "already_in_room" });

      room.sockets[1] = socket;
      room.players[1] = { userId: user.id, email: user.email };
      room.status = "playing";
      socketToRoom.set(socket.id, room.code);
      userToRoom.set(user.id, room.code);
      touch(room);

      room.game = createGame({ playerAId: room.players[0].userId, playerBId: room.players[1].userId });
      startMatch(room.game);
      room.lastPhase = PHASE.PREP;

      for (let i = 0; i < 2; i++) {
        const s = room.sockets[i];
        if (!s) continue;
        s.emit("room:state", {
          code: room.code,
          status: "playing",
          you: i,
          opponent: { email: room.players[1 - i].email },
        });
      }
      cb?.({ ok: true, code: room.code });
    });

    socket.on("room:leave", () => {
      const code = socketToRoom.get(socket.id);
      if (code) leaveSlot(io, socket, code, { explicit: true });
    });

    socket.on("game:input", (input) => {
      const code = socketToRoom.get(socket.id);
      if (!code) return;
      const room = rooms.get(code);
      if (!room || !room.game || room.status !== "playing") return;
      const idx = findSlotBySocket(room, socket);
      if (idx < 0) return;
      applyInput(room.game, idx, input || {});
      touch(room);
    });

    socket.on("disconnect", () => {
      const code = socketToRoom.get(socket.id);
      if (code) leaveSlot(io, socket, code, { explicit: false });
    });
  });

  setInterval(() => tickAll(io), TICK_INTERVAL_MS);
  setInterval(() => gcRooms(), 60_000).unref();
}

function tickAll(io) {
  for (const room of rooms.values()) {
    if (room.status !== "playing" || !room.game) continue;
    // Freeze the game while either side is disconnected — both slots must be
    // connected for the tick to advance.
    if (!room.sockets[0] || !room.sockets[1]) continue;

    gameTick(room.game);
    broadcastState(io, room);
    if (room.lastPhase !== room.game.phase) {
      if (room.game.phase === PHASE.SLOWMO) broadcastSlowmo(io, room);
      if (room.game.phase === PHASE.MATCH_END) settleMatchOnce(room);
      room.lastPhase = room.game.phase;
    }
    clearEvents(room.game);
  }
}

function gcRooms() {
  const t = now();
  for (const [code, room] of rooms) {
    if (room.status === "abandoned" && room.sockets.every((s) => !s)) {
      // Clean any lingering userToRoom mappings for this room
      for (const p of room.players) if (p) userToRoom.delete(p.userId);
      rooms.delete(code);
      continue;
    }
    if (room.status === "waiting" && t - room.lastActivityAt > ROOM_IDLE_GC_MS) {
      const s = room.sockets[0];
      if (s) s.emit("room:expired", {});
      if (room.players[0]) userToRoom.delete(room.players[0].userId);
      rooms.delete(code);
    }
  }
}
