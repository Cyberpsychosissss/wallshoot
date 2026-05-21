import argon2 from "argon2";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { db, now } from "./db.js";
import { issueChallenge, verifyChallenge, recordPowFailure } from "./pow.js";
import { sendVerificationCode } from "./mailer.js";
import {
  LOGIN_FAIL_LIMIT,
  LOGIN_LOCK_MS,
  SESSION_TTL_MS,
} from "./constants.js";

const REG_CODE_TTL_MS = 10 * 60 * 1000;
const REG_CODE_RESEND_COOLDOWN_MS = 60 * 1000;
const REG_CODE_MAX_ATTEMPTS = 5;
const regCodes = new Map(); // emailLc → { code, expiresAt, attempts, lastSentAt }

function genCode() {
  // 6 digits, leading zeros possible
  return String(Math.floor(Math.random() * 1_000_000)).padStart(6, "0");
}
setInterval(() => {
  const t = Date.now();
  for (const [k, v] of regCodes) if (v.expiresAt < t) regCodes.delete(k);
}, 60_000).unref();

const ARGON_OPTS = {
  type: argon2.argon2id,
  memoryCost: 64 * 1024,
  timeCost: 3,
  parallelism: 2,
  hashLength: 32,
};

const FAKE_HASH = await argon2.hash("anti-timing-canary-string", ARGON_OPTS);

const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/;

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}

function clientIp(req) {
  const xff = req.headers["x-forwarded-for"];
  if (typeof xff === "string" && xff.length) return xff.split(",")[0].trim();
  return req.ip || req.socket?.remoteAddress || "unknown";
}

function createSession(userId) {
  const id = randomBytes(32).toString("hex");
  const csrf = randomBytes(24).toString("hex");
  const t = now();
  db.prepare(
    "INSERT INTO sessions (id, user_id, csrf_token, created_at, expires_at) VALUES (?, ?, ?, ?, ?)",
  ).run(id, userId, csrf, t, t + SESSION_TTL_MS);
  return { id, csrf };
}

function getSession(sessionId) {
  if (!sessionId) return null;
  const row = db
    .prepare("SELECT * FROM sessions WHERE id = ?")
    .get(sessionId);
  if (!row) return null;
  if (row.expires_at < now()) {
    db.prepare("DELETE FROM sessions WHERE id = ?").run(sessionId);
    return null;
  }
  return row;
}

function getUser(userId) {
  return db.prepare("SELECT * FROM users WHERE id = ?").get(userId);
}

function setSessionCookie(res, sessionId) {
  const maxAge = Math.floor(SESSION_TTL_MS / 1000);
  const parts = [
    `wallshoot_sid=${encodeURIComponent(sessionId)}`,
    "Path=/",
    `Max-Age=${maxAge}`,
    "HttpOnly",
    "SameSite=Lax",
  ];
  if (process.env.NODE_ENV === "production") parts.push("Secure");
  res.setHeader("Set-Cookie", parts.join("; "));
}

function clearSessionCookie(res) {
  res.setHeader(
    "Set-Cookie",
    "wallshoot_sid=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax",
  );
}

function safeEqual(a, b) {
  const A = Buffer.from(a || "", "utf8");
  const B = Buffer.from(b || "", "utf8");
  if (A.length !== B.length) return false;
  return timingSafeEqual(A, B);
}

function requireSession(req) {
  const cookies = parseCookies(req.headers.cookie);
  const sid = cookies.wallshoot_sid;
  const sess = getSession(sid);
  if (!sess) return null;
  const user = getUser(sess.user_id);
  if (!user) return null;
  return { session: sess, user };
}

function requireCsrf(req, csrfToken) {
  const provided = req.headers["x-csrf-token"];
  return typeof provided === "string" && safeEqual(provided, csrfToken);
}

export function registerAuthRoutes(app) {
  app.post("/api/pow/challenge", (req, res) => {
    const ch = issueChallenge(clientIp(req));
    res.json(ch);
  });

  app.post("/api/register/send-code", async (req, res) => {
    const { email, pow } = req.body || {};
    const ip = clientIp(req);
    if (typeof email !== "string" || !EMAIL_RE.test(email)) {
      return res.status(400).json({ error: "invalid_email" });
    }
    if (!pow || !verifyChallenge(pow, ip)) {
      recordPowFailure(ip);
      return res.status(400).json({ error: "invalid_pow" });
    }
    const email_lc = email.toLowerCase();
    const existing = db
      .prepare("SELECT id, activated FROM users WHERE email_lc = ?")
      .get(email_lc);
    if (existing && existing.activated) {
      return res.status(409).json({ error: "email_taken" });
    }
    const t = now();
    const prev = regCodes.get(email_lc);
    if (prev && t - prev.lastSentAt < REG_CODE_RESEND_COOLDOWN_MS) {
      const wait = Math.ceil((REG_CODE_RESEND_COOLDOWN_MS - (t - prev.lastSentAt)) / 1000);
      return res.status(429).json({ error: "resend_cooldown", retry_after_seconds: wait });
    }
    const code = genCode();
    regCodes.set(email_lc, {
      code,
      expiresAt: t + REG_CODE_TTL_MS,
      attempts: 0,
      lastSentAt: t,
    });
    try {
      await sendVerificationCode({
        to: email,
        code,
        ttlMinutes: Math.floor(REG_CODE_TTL_MS / 60000),
      });
    } catch (e) {
      console.error("[auth] sendVerificationCode failed:", e.message);
      regCodes.delete(email_lc);
      return res.status(502).json({ error: "mail_failed" });
    }
    res.json({ ok: true, ttl_seconds: Math.floor(REG_CODE_TTL_MS / 1000) });
  });

  app.post("/api/register/verify", async (req, res) => {
    const { email, code, password, pow } = req.body || {};
    const ip = clientIp(req);
    if (typeof email !== "string" || !EMAIL_RE.test(email)) {
      return res.status(400).json({ error: "invalid_email" });
    }
    if (typeof code !== "string" || !/^\d{6}$/.test(code)) {
      return res.status(400).json({ error: "invalid_code" });
    }
    if (typeof password !== "string" || password.length < 8 || password.length > 200) {
      return res.status(400).json({ error: "invalid_password" });
    }
    if (!pow || !verifyChallenge(pow, ip)) {
      recordPowFailure(ip);
      return res.status(400).json({ error: "invalid_pow" });
    }
    const email_lc = email.toLowerCase();
    const entry = regCodes.get(email_lc);
    if (!entry) return res.status(400).json({ error: "code_not_found" });
    if (entry.expiresAt < now()) {
      regCodes.delete(email_lc);
      return res.status(400).json({ error: "code_expired" });
    }
    if (entry.attempts >= REG_CODE_MAX_ATTEMPTS) {
      regCodes.delete(email_lc);
      return res.status(429).json({ error: "code_too_many_attempts" });
    }
    if (!safeEqual(code, entry.code)) {
      entry.attempts += 1;
      return res.status(400).json({ error: "code_wrong", attempts_left: REG_CODE_MAX_ATTEMPTS - entry.attempts });
    }
    // Code matched — consume it
    regCodes.delete(email_lc);

    const existing = db
      .prepare("SELECT id, activated FROM users WHERE email_lc = ?")
      .get(email_lc);
    if (existing && existing.activated) {
      return res.status(409).json({ error: "email_taken" });
    }
    const password_hash = await argon2.hash(password, ARGON_OPTS);
    const t = now();
    if (existing) {
      db.prepare(
        "UPDATE users SET password_hash=?, activated=1, activation_token=NULL, activation_expires=NULL WHERE id=?",
      ).run(password_hash, existing.id);
    } else {
      db.prepare(
        `INSERT INTO users (email, email_lc, password_hash, activated, created_at)
         VALUES (?, ?, ?, 1, ?)`,
      ).run(email, email_lc, password_hash, t);
    }
    // Auto-login the newly created account
    const user = db.prepare("SELECT * FROM users WHERE email_lc = ?").get(email_lc);
    const sess = createSession(user.id);
    setSessionCookie(res, sess.id);
    res.json({
      ok: true,
      csrf: sess.csrf,
      user: { id: user.id, email: user.email, rating: user.rating, wins: user.wins, losses: user.losses },
    });
  });

  app.post("/api/login", async (req, res) => {
    const { email, password, pow } = req.body || {};
    const ip = clientIp(req);
    if (typeof email !== "string" || typeof password !== "string") {
      return res.status(400).json({ error: "invalid_input" });
    }
    if (!pow || !verifyChallenge(pow, ip)) {
      recordPowFailure(ip);
      return res.status(400).json({ error: "invalid_pow" });
    }
    const email_lc = email.toLowerCase();
    const user = db
      .prepare("SELECT * FROM users WHERE email_lc = ?")
      .get(email_lc);
    const t = now();
    if (!user) {
      await argon2.verify(FAKE_HASH, password).catch(() => {});
      return res.status(401).json({ error: "bad_credentials" });
    }
    if (user.locked_until > t) {
      return res.status(429).json({ error: "locked", retry_after: user.locked_until - t });
    }
    if (!user.activated) {
      return res.status(403).json({ error: "not_activated" });
    }
    const ok = await argon2.verify(user.password_hash, password).catch(() => false);
    if (!ok) {
      const newCount = user.failed_login_count + 1;
      if (newCount >= LOGIN_FAIL_LIMIT) {
        db.prepare(
          "UPDATE users SET failed_login_count=0, locked_until=? WHERE id=?",
        ).run(t + LOGIN_LOCK_MS, user.id);
      } else {
        db.prepare(
          "UPDATE users SET failed_login_count=? WHERE id=?",
        ).run(newCount, user.id);
      }
      return res.status(401).json({ error: "bad_credentials" });
    }
    db.prepare("UPDATE users SET failed_login_count=0, locked_until=0 WHERE id=?").run(user.id);
    const sess = createSession(user.id);
    setSessionCookie(res, sess.id);
    res.json({
      ok: true,
      csrf: sess.csrf,
      user: { id: user.id, email: user.email, rating: user.rating, wins: user.wins, losses: user.losses },
    });
  });

  app.post("/api/logout", (req, res) => {
    const cookies = parseCookies(req.headers.cookie);
    const sid = cookies.wallshoot_sid;
    if (sid) db.prepare("DELETE FROM sessions WHERE id = ?").run(sid);
    clearSessionCookie(res);
    res.json({ ok: true });
  });

  app.get("/api/me", (req, res) => {
    const ctx = requireSession(req);
    if (!ctx) return res.json({ user: null });
    const u = ctx.user;
    res.json({
      user: { id: u.id, email: u.email, rating: u.rating, wins: u.wins, losses: u.losses },
      csrf: ctx.session.csrf_token,
    });
  });

  app.post("/api/change-password", async (req, res) => {
    const ctx = requireSession(req);
    if (!ctx) return res.status(401).json({ error: "unauth" });
    if (!requireCsrf(req, ctx.session.csrf_token)) {
      return res.status(403).json({ error: "csrf" });
    }
    const { old_password, new_password, pow } = req.body || {};
    const ip = clientIp(req);
    if (typeof old_password !== "string" || typeof new_password !== "string") {
      return res.status(400).json({ error: "invalid_input" });
    }
    if (new_password.length < 8 || new_password.length > 200) {
      return res.status(400).json({ error: "invalid_password" });
    }
    if (old_password === new_password) {
      return res.status(400).json({ error: "same_password" });
    }
    if (!pow || !verifyChallenge(pow, ip)) {
      recordPowFailure(ip);
      return res.status(400).json({ error: "invalid_pow" });
    }
    const ok = await argon2.verify(ctx.user.password_hash, old_password).catch(() => false);
    if (!ok) {
      return res.status(401).json({ error: "bad_old_password" });
    }
    const newHash = await argon2.hash(new_password, ARGON_OPTS);
    db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(newHash, ctx.user.id);
    // Kill every session except the current one so the user stays signed in
    // here but other devices are logged out.
    db.prepare("DELETE FROM sessions WHERE user_id = ? AND id != ?").run(ctx.user.id, ctx.session.id);
    res.json({ ok: true });
  });

  app.get("/api/history", (req, res) => {
    const ctx = requireSession(req);
    if (!ctx) return res.status(401).json({ error: "unauth" });
    const rows = db
      .prepare(
        `SELECT m.id, m.winner_id, m.loser_id, m.winner_score, m.loser_score,
                m.winner_rating_after, m.loser_rating_after, m.created_at,
                wu.email AS winner_email, lu.email AS loser_email
         FROM matches m
         JOIN users wu ON wu.id = m.winner_id
         JOIN users lu ON lu.id = m.loser_id
         WHERE m.winner_id = ? OR m.loser_id = ?
         ORDER BY m.created_at DESC
         LIMIT 20`,
      )
      .all(ctx.user.id, ctx.user.id);
    res.json({ matches: rows });
  });
}

export function authSocketMiddleware(socket, next) {
  const cookies = parseCookies(socket.handshake.headers.cookie);
  const sid = cookies.wallshoot_sid;
  const sess = getSession(sid);
  if (!sess) return next(new Error("unauthenticated"));
  const user = getUser(sess.user_id);
  if (!user || !user.activated) return next(new Error("unauthenticated"));
  socket.data.user = {
    id: user.id,
    email: user.email,
    rating: user.rating,
    wins: user.wins,
    losses: user.losses,
  };
  socket.data.csrf = sess.csrf_token;
  next();
}

