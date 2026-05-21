// Local end-to-end smoke test: register 2 users, both connect, play through
// a full match. Run with: node scripts/test-e2e.mjs
//
// Assumes the server is running locally on port 8088.

import { createHash } from "node:crypto";
import { io } from "socket.io-client";

const BASE = process.env.WALLSHOOT_URL || "http://localhost:8088";

function solvePow(challenge, difficulty) {
  let n = 0;
  while (true) {
    const cand = n.toString(36);
    const h = createHash("sha256").update(challenge + cand).digest("hex");
    let bits = difficulty, ok = true;
    for (let i = 0; i < h.length && bits > 0; i++) {
      const nb = parseInt(h[i], 16);
      if (bits >= 4) { if (nb !== 0) { ok = false; break; } bits -= 4; }
      else { const mask = 0xf << (4 - bits); if ((nb & mask) !== 0) ok = false; break; }
    }
    if (ok) return cand;
    n++;
    if (n > 1e8) throw new Error("gave up");
  }
}

async function getPow() {
  const r = await fetch(`${BASE}/api/pow/challenge`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
  });
  const ch = await r.json();
  return { id: ch.id, nonce: solvePow(ch.challenge, ch.difficulty) };
}

async function registerAndActivate(email, password) {
  const pow = await getPow();
  let res = await fetch(`${BASE}/api/register`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, pow }),
  });
  const body = await res.json();
  if (!body.ok) throw new Error(`register: ${JSON.stringify(body)}`);

  // Activation token is logged in container output; in dev mode we read it
  // from a side-channel. Here we just hit the DB directly via API trick is
  // not possible; instead we expose the token by reading server stdout via
  // docker logs. We grep the most recent token for the given email.
  const { spawnSync } = await import("node:child_process");
  const out = spawnSync("docker", ["logs", "wallshoot"], { encoding: "utf8" });
  const stderr = out.stderr || "";
  const stdout = out.stdout || "";
  const all = stdout + stderr;
  const matches = [...all.matchAll(/token=([a-f0-9]+)/g)];
  if (matches.length === 0) throw new Error("no activation token found in docker logs");
  const token = matches[matches.length - 1][1];
  const ar = await fetch(`${BASE}/api/activate?token=${token}`);
  if (!ar.ok) throw new Error(`activate: ${ar.status}`);
  console.log(`[${email}] registered + activated`);
}

async function login(email, password) {
  const pow = await getPow();
  const r = await fetch(`${BASE}/api/login`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, pow }),
  });
  const setCookie = r.headers.get("set-cookie") || "";
  const cookie = setCookie.split(";")[0];
  const body = await r.json();
  if (!body.ok) throw new Error(`login: ${JSON.stringify(body)}`);
  console.log(`[${email}] logged in, rating=${body.user.rating}`);
  return { cookie, user: body.user };
}

function connectSocket(cookie, label) {
  return new Promise((resolve, reject) => {
    const sock = io(BASE, {
      path: "/socket.io",
      transports: ["websocket"],
      extraHeaders: { cookie },
      reconnection: false,
    });
    sock.on("connect", () => {
      console.log(`[${label}] socket connected (${sock.id})`);
      resolve(sock);
    });
    sock.on("connect_error", reject);
  });
}

function once(sock, event) {
  return new Promise((resolve) => sock.once(event, resolve));
}

(async () => {
  const aliceEmail = `alice+${Date.now()}@example.com`;
  const bobEmail = `bob+${Date.now()}@example.com`;
  await registerAndActivate(aliceEmail, "alicepass123");
  await registerAndActivate(bobEmail, "bobpass123456");
  const alice = await login(aliceEmail, "alicepass123");
  const bob = await login(bobEmail, "bobpass123456");

  const a = await connectSocket(alice.cookie, "alice");
  const b = await connectSocket(bob.cookie, "bob");

  // Track latest state on each side
  let aState = null, bState = null;
  a.on("game:state", (s) => { aState = s; });
  b.on("game:state", (s) => { bState = s; });

  // Alice creates room
  const created = await new Promise((res) => a.emit("room:create", {}, res));
  console.log("alice created room:", created);
  if (!created.ok) throw new Error("create failed");

  // Bob joins
  const joined = await new Promise((res) => b.emit("room:join", { code: created.code }, res));
  console.log("bob joined:", joined);
  if (!joined.ok) throw new Error("join failed");

  // Wait until first game:state arrives on both sides
  for (let i = 0; i < 50 && (!aState || !bState); i++) {
    await new Promise((r) => setTimeout(r, 100));
  }
  if (!aState || !bState) throw new Error("no game:state arrived");
  console.log("first state phase:", aState.phase, "alice viewerIdx:", aState.viewerIdx, "wall len:", Buffer.from(aState.wall, "base64").length);

  // Bob is hider (idx 1), alice is shooter (idx 0)
  // Send some inputs
  b.emit("game:input", { posture: "crouch", move: 1 });
  a.emit("game:input", { aim_col: 5.5, aim_row: 8.5 });

  // Wait until prep ends
  await new Promise((r) => setTimeout(r, 5500));

  // Now in BATTLE — alice fires 6 times to drain ammo
  console.log("firing 6 shots...");
  for (let i = 0; i < 6; i++) {
    a.emit("game:input", { aim_col: 5.5, aim_row: 8.5, fire: true });
    await new Promise((r) => setTimeout(r, 200));
  }

  // Should have swapped roles after 6 shots
  await new Promise((r) => setTimeout(r, 500));
  console.log("after 6 shots, shooterIdx:", aState.shooterIdx, "alice ammo:", aState.players[0].ammo, "bob ammo:", aState.players[1].ammo);

  // Capture state events for a bit
  let endHit = false;
  a.on("game:slowmo", (s) => { console.log("[slowmo]", { winnerIdx: s.winnerIdx, partHit: s.partHit }); });
  a.on("game:match_end", (m) => { console.log("[match end]", m); endHit = true; });

  // Now Bob (new shooter) fires aiming at Alice's head row (1-3 col 6)
  console.log("bob aims at head...");
  for (let i = 0; i < 6 && !endHit; i++) {
    b.emit("game:input", { aim_col: 6, aim_row: 2, fire: true });
    await new Promise((r) => setTimeout(r, 300));
  }

  // Wait for any match end
  await new Promise((r) => setTimeout(r, 5000));

  a.disconnect();
  b.disconnect();
  console.log("done.");
  process.exit(0);
})().catch((e) => { console.error("FAIL:", e); process.exit(1); });
