import { createHash, randomBytes } from "node:crypto";
import { db, now } from "./db.js";
import {
  POW_DIFFICULTY_DEFAULT,
  POW_DIFFICULTY_HARD,
  POW_CHALLENGE_TTL_MS,
} from "./constants.js";

const challenges = new Map();

function sweep() {
  const t = now();
  for (const [id, ch] of challenges) {
    if (ch.expires_at < t) challenges.delete(id);
  }
}
setInterval(sweep, 60_000).unref();

function difficultyForIp(ip) {
  const row = db
    .prepare("SELECT count, last_at FROM pow_failures WHERE ip = ?")
    .get(ip);
  if (!row) return POW_DIFFICULTY_DEFAULT;
  if (now() - row.last_at > 60 * 60 * 1000) return POW_DIFFICULTY_DEFAULT;
  return row.count >= 5 ? POW_DIFFICULTY_HARD : POW_DIFFICULTY_DEFAULT;
}

export function issueChallenge(ip) {
  const id = randomBytes(8).toString("hex");
  const challenge = randomBytes(16).toString("hex");
  const difficulty = difficultyForIp(ip);
  const expires_at = now() + POW_CHALLENGE_TTL_MS;
  challenges.set(id, { challenge, difficulty, expires_at, ip });
  return { id, challenge, difficulty };
}

function hasLeadingZeroBits(hexHash, bits) {
  let need = bits;
  for (let i = 0; i < hexHash.length && need > 0; i++) {
    const nibble = parseInt(hexHash[i], 16);
    if (need >= 4) {
      if (nibble !== 0) return false;
      need -= 4;
    } else {
      const mask = 0xf << (4 - need);
      return (nibble & mask) === 0;
    }
  }
  return need <= 0;
}

export function verifyChallenge({ id, nonce }, ip) {
  if (!id || typeof nonce !== "string") return false;
  const ch = challenges.get(id);
  if (!ch) return false;
  if (ch.expires_at < now()) {
    challenges.delete(id);
    return false;
  }
  if (ch.ip !== ip) return false;
  const hash = createHash("sha256")
    .update(ch.challenge + nonce)
    .digest("hex");
  const ok = hasLeadingZeroBits(hash, ch.difficulty);
  challenges.delete(id);
  return ok;
}

export function recordPowFailure(ip) {
  const t = now();
  const row = db.prepare("SELECT count FROM pow_failures WHERE ip = ?").get(ip);
  if (row) {
    db.prepare(
      "UPDATE pow_failures SET count = count + 1, last_at = ? WHERE ip = ?",
    ).run(t, ip);
  } else {
    db.prepare(
      "INSERT INTO pow_failures (ip, count, last_at) VALUES (?, 1, ?)",
    ).run(ip, t);
  }
}
