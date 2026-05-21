import {
  ROOM_CODE_LEN,
  ROOM_IDLE_GC_MS,
  TICK_INTERVAL_MS,
} from "./constants.js";
import {
  createGame,
  startMatch,
  applyInput,
  tick as gameTick,
  serializeForClient,
  getSlowmoPayload,
  clearEvents,
  PHASE,
} from "./game.js";
import { recordMatch } from "./rating.js";
import { now } from "./db.js";

const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/I/1

/** @typedef {{ code: string, sockets: any[], game: any|null, status: string, lastActivityAt: number, matchSettled: boolean, lastPhase: string|null }} Room */

const rooms = new Map();
// Track which room a socket is currently in, keyed by socket.id
const socketToRoom = new Map();

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

function removeSocketFromRoom(socket) {
  const code = socketToRoom.get(socket.id);
  if (!code) return null;
  socketToRoom.delete(socket.id);
  const room = rooms.get(code);
  if (!room) return null;
  const idx = room.sockets.findIndex((s) => s && s.id === socket.id);
  if (idx >= 0) room.sockets[idx] = null;
  return { room, idx };
}

function broadcastState(io, room) {
  for (let i = 0; i < room.sockets.length; i++) {
    const s = room.sockets[i];
    if (!s) continue;
    s.emit("game:state", serializeForClient(room.game, i));
  }
}

function broadcastSlowmo(io, room) {
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

export function registerRoomHandlers(io) {
  io.on("connection", (socket) => {
    const user = socket.data.user;
    socket.emit("welcome", { user });

    socket.on("room:create", (_, cb) => {
      const code = genCode();
      const room = {
        code,
        sockets: [socket, null],
        players: [
          { userId: user.id, email: user.email },
          null,
        ],
        game: null,
        status: "waiting",
        lastActivityAt: now(),
        matchSettled: false,
        matchSettlement: null,
        lastPhase: null,
      };
      rooms.set(code, room);
      socketToRoom.set(socket.id, code);
      socket.emit("room:state", { code, status: "waiting", you: 0 });
      cb?.({ ok: true, code });
    });

    socket.on("room:join", ({ code } = {}, cb) => {
      if (typeof code !== "string") return cb?.({ ok: false, error: "bad_code" });
      const room = rooms.get(code.toUpperCase());
      if (!room) return cb?.({ ok: false, error: "not_found" });
      if (room.status !== "waiting") return cb?.({ ok: false, error: "full" });
      if (room.players[0]?.userId === user.id) return cb?.({ ok: false, error: "same_user" });
      room.sockets[1] = socket;
      room.players[1] = { userId: user.id, email: user.email };
      room.status = "playing";
      socketToRoom.set(socket.id, code);
      touch(room);
      // Initialise the game and kick off match
      room.game = createGame({ playerAId: room.players[0].userId, playerBId: room.players[1].userId });
      startMatch(room.game);
      room.lastPhase = PHASE.PREP;
      // Notify both players
      for (let i = 0; i < 2; i++) {
        const s = room.sockets[i];
        s.emit("room:state", {
          code,
          status: "playing",
          you: i,
          opponent: { email: room.players[1 - i].email },
        });
      }
      cb?.({ ok: true, code: room.code });
    });

    socket.on("room:leave", () => {
      const rem = removeSocketFromRoom(socket);
      if (rem?.room) endRoomIfAbandoned(io, rem.room);
    });

    socket.on("game:input", (input) => {
      const code = socketToRoom.get(socket.id);
      if (!code) return;
      const room = rooms.get(code);
      if (!room || !room.game || room.status !== "playing") return;
      const idx = room.sockets.findIndex((s) => s && s.id === socket.id);
      if (idx < 0) return;
      applyInput(room.game, idx, input || {});
      touch(room);
    });

    socket.on("disconnect", () => {
      const rem = removeSocketFromRoom(socket);
      if (rem?.room) endRoomIfAbandoned(io, rem.room);
    });
  });

  setInterval(() => tickAll(io), TICK_INTERVAL_MS);
  setInterval(() => gcRooms(), 60_000).unref();
}

function endRoomIfAbandoned(io, room) {
  const aliveCount = room.sockets.filter(Boolean).length;
  if (aliveCount === 0) {
    rooms.delete(room.code);
    return;
  }
  // One side dropped during a live match
  if (room.status === "playing" && !room.matchSettled) {
    const survivorIdx = room.sockets.findIndex(Boolean);
    if (survivorIdx >= 0) {
      const s = room.sockets[survivorIdx];
      s.emit("game:opponent_left", {});
    }
    room.status = "abandoned";
  }
}

function tickAll(io) {
  for (const room of rooms.values()) {
    if (room.status !== "playing" || !room.game) continue;
    gameTick(room.game);
    broadcastState(io, room);
    // Detect transition into SLOWMO to emit replay payload once
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
      rooms.delete(code);
      continue;
    }
    if (room.status === "waiting" && t - room.lastActivityAt > ROOM_IDLE_GC_MS) {
      rooms.delete(code);
      const s = room.sockets[0];
      if (s) s.emit("room:expired", {});
    }
  }
}
