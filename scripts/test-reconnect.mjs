// Reconnection smoke test: two clients in a room, one drops, then comes back,
// verify the opponent sees disconnect + rejoined events and the game pauses
// while disconnected.
//
// Pre-req: two activated accounts in the DB (one used as alice, one as bob).
// Set ALICE_EMAIL/ALICE_PW/BOB_EMAIL/BOB_PW env vars.

import { createHash } from "node:crypto";
import { io } from "socket.io-client";

const BASE = process.env.WALLSHOOT_URL || "http://172.17.0.1:8088";

function solve(challenge, difficulty) {
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
  }
}

async function getPow() {
  const r = await fetch(`${BASE}/api/pow/challenge`, {method:"POST",headers:{"Content-Type":"application/json"},body:"{}"});
  const ch = await r.json();
  return { id: ch.id, nonce: solve(ch.challenge, ch.difficulty) };
}

async function login(email, password) {
  const r = await fetch(`${BASE}/api/login`, {
    method:"POST", headers:{"Content-Type":"application/json"},
    body: JSON.stringify({email, password, pow: await getPow()})
  });
  const setCookie = r.headers.get("set-cookie") || "";
  const cookie = setCookie.split(";")[0];
  const body = await r.json();
  if (!body.ok) throw new Error(`login ${email}: ${JSON.stringify(body)}`);
  return { cookie, user: body.user };
}

function connect(cookie, label) {
  return new Promise((resolve, reject) => {
    const sock = io(BASE, {
      path: "/socket.io",
      transports: ["websocket"],
      extraHeaders: { cookie },
      reconnection: false,
    });
    sock.on("connect", () => { console.log(`[${label}] connected ${sock.id}`); resolve(sock); });
    sock.on("connect_error", reject);
  });
}

(async () => {
  const aliceEmail = process.env.ALICE_EMAIL;
  const alicePw = process.env.ALICE_PW;
  const bobEmail = process.env.BOB_EMAIL;
  const bobPw = process.env.BOB_PW;
  if (!aliceEmail || !alicePw || !bobEmail || !bobPw) {
    console.error("Set ALICE_EMAIL/PW + BOB_EMAIL/PW env vars first.");
    process.exit(2);
  }
  const alice = await login(aliceEmail, alicePw);
  const bob = await login(bobEmail, bobPw);

  let a = await connect(alice.cookie, "alice");
  const b = await connect(bob.cookie, "bob");

  let aState = null, bState = null;
  a.on("game:state", (s) => { aState = s; });
  b.on("game:state", (s) => { bState = s; });
  a.on("game:opponent_disconnected", (p) => console.log("[alice] opponent_disconnected", p));
  a.on("game:opponent_rejoined", () => console.log("[alice] opponent_rejoined"));
  a.on("game:opponent_left", () => console.log("[alice] opponent_left"));
  b.on("game:opponent_disconnected", (p) => console.log("[bob] opponent_disconnected", p));
  b.on("game:opponent_rejoined", () => console.log("[bob] opponent_rejoined"));
  b.on("room:state", (s) => { if (s.resumed) console.log("[bob] resumed:", s); });

  const created = await new Promise((res) => a.emit("room:create", {}, res));
  console.log("created:", created);
  const joined = await new Promise((res) => b.emit("room:join", { code: created.code }, res));
  console.log("joined:", joined);

  await new Promise((r) => setTimeout(r, 1000));
  console.log("after join — state phase:", aState?.phase, "tick:", aState?.tick);

  const tickBeforeDisconnect = aState?.tick || 0;
  console.log("--- bob disconnecting ---");
  b.disconnect();
  await new Promise((r) => setTimeout(r, 2000));
  console.log("after bob disconnect — alice last tick:", aState?.tick, "(should NOT have advanced much)");
  if (aState?.tick > tickBeforeDisconnect + 5) {
    console.error("FAIL: game did not pause while bob disconnected");
  } else {
    console.log("OK: game paused while bob disconnected");
  }

  console.log("--- bob reconnecting ---");
  const b2 = await connect(bob.cookie, "bob-reconnect");
  await new Promise((r) => setTimeout(r, 1500));
  const tickAfterReconnect = aState?.tick || 0;
  console.log("after bob reconnect — alice last tick:", tickAfterReconnect);
  await new Promise((r) => setTimeout(r, 2000));
  if ((aState?.tick || 0) > tickAfterReconnect) {
    console.log("OK: game resumed after reconnect");
  } else {
    console.error("FAIL: game did not resume");
  }

  // Test grace timeout: alice drops and doesn't come back
  console.log("--- alice dropping without reconnecting (waiting for grace timeout) ---");
  a.disconnect();
  // Wait > 30s
  await new Promise((r) => setTimeout(r, 32000));
  console.log("--- done. Should have seen opponent_left from bob's side ---");
  b2.disconnect();
  process.exit(0);
})().catch((e) => { console.error("ERR:", e); process.exit(1); });
