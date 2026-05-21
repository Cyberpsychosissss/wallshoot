import argon2 from "argon2";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { db, now } from "./db.js";
import { listTunables, setSetting, resetSettings } from "./settings.js";

const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || "")
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

const ARGON_OPTS = {
  type: argon2.argon2id,
  memoryCost: 64 * 1024,
  timeCost: 3,
  parallelism: 2,
  hashLength: 32,
};

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

function safeEqual(a, b) {
  const A = Buffer.from(a || "", "utf8");
  const B = Buffer.from(b || "", "utf8");
  if (A.length !== B.length) return false;
  return timingSafeEqual(A, B);
}

function getSession(sid) {
  if (!sid) return null;
  const row = db.prepare("SELECT * FROM sessions WHERE id = ?").get(sid);
  if (!row) return null;
  if (row.expires_at < now()) return null;
  return row;
}

function getUser(id) {
  return db.prepare("SELECT * FROM users WHERE id = ?").get(id);
}

export function isAdmin(email) {
  return email && ADMIN_EMAILS.includes(email.toLowerCase());
}

function requireAdmin(req, res) {
  const cookies = parseCookies(req.headers.cookie);
  const sess = getSession(cookies.wallshoot_sid);
  if (!sess) {
    res.status(401).json({ error: "unauth" });
    return null;
  }
  const user = getUser(sess.user_id);
  if (!user || !isAdmin(user.email)) {
    res.status(403).json({ error: "forbidden" });
    return null;
  }
  // CSRF for mutating verbs
  if (req.method !== "GET") {
    const provided = req.headers["x-csrf-token"];
    if (typeof provided !== "string" || !safeEqual(provided, sess.csrf_token)) {
      res.status(403).json({ error: "csrf" });
      return null;
    }
  }
  return { session: sess, user };
}

export function registerAdminRoutes(app) {
  app.get("/api/admin/check", (req, res) => {
    const cookies = parseCookies(req.headers.cookie);
    const sess = getSession(cookies.wallshoot_sid);
    if (!sess) return res.json({ is_admin: false });
    const user = getUser(sess.user_id);
    res.json({ is_admin: !!user && isAdmin(user.email) });
  });

  app.get("/api/admin/users", (req, res) => {
    if (!requireAdmin(req, res)) return;
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit) || 50));
    const offset = Math.max(0, parseInt(req.query.offset) || 0);
    const q = (req.query.q || "").toString().trim().toLowerCase();
    const args = [];
    let where = "1=1";
    if (q) {
      where = "email_lc LIKE ?";
      args.push("%" + q + "%");
    }
    const total = db
      .prepare(`SELECT COUNT(*) AS c FROM users WHERE ${where}`)
      .get(...args).c;
    const rows = db
      .prepare(
        `SELECT id, email, activated, rating, wins, losses, locked_until,
                failed_login_count, created_at
         FROM users WHERE ${where}
         ORDER BY id DESC LIMIT ? OFFSET ?`,
      )
      .all(...args, limit, offset);
    res.json({ total, users: rows });
  });

  app.post("/api/admin/users/:id/reset-password", async (req, res) => {
    const ctx = requireAdmin(req, res);
    if (!ctx) return;
    const id = parseInt(req.params.id);
    const user = getUser(id);
    if (!user) return res.status(404).json({ error: "not_found" });
    const tmp = randomBytes(9).toString("base64url");
    const hash = await argon2.hash(tmp, ARGON_OPTS);
    db.prepare(
      "UPDATE users SET password_hash = ?, failed_login_count = 0, locked_until = 0 WHERE id = ?",
    ).run(hash, id);
    db.prepare("DELETE FROM sessions WHERE user_id = ?").run(id);
    res.json({ ok: true, temporary_password: tmp });
  });

  app.post("/api/admin/users/:id/lock", (req, res) => {
    const ctx = requireAdmin(req, res);
    if (!ctx) return;
    const id = parseInt(req.params.id);
    const action = req.body?.action;
    if (action === "lock") {
      const until = now() + 365 * 24 * 60 * 60 * 1000; // 1 year
      db.prepare("UPDATE users SET locked_until = ? WHERE id = ?").run(until, id);
      db.prepare("DELETE FROM sessions WHERE user_id = ?").run(id);
      return res.json({ ok: true, locked_until: until });
    }
    if (action === "unlock") {
      db.prepare("UPDATE users SET locked_until = 0, failed_login_count = 0 WHERE id = ?").run(id);
      return res.json({ ok: true });
    }
    res.status(400).json({ error: "bad_action" });
  });

  app.delete("/api/admin/users/:id", (req, res) => {
    const ctx = requireAdmin(req, res);
    if (!ctx) return;
    const id = parseInt(req.params.id);
    if (id === ctx.user.id) return res.status(400).json({ error: "no_self_delete" });
    const confirm = req.body?.confirm_email;
    const target = getUser(id);
    if (!target) return res.status(404).json({ error: "not_found" });
    if (confirm !== target.email) {
      return res.status(400).json({ error: "confirm_mismatch" });
    }
    db.prepare("DELETE FROM users WHERE id = ?").run(id);
    res.json({ ok: true });
  });

  app.get("/api/admin/settings", (req, res) => {
    if (!requireAdmin(req, res)) return;
    res.json({ settings: listTunables() });
  });

  app.put("/api/admin/settings", (req, res) => {
    if (!requireAdmin(req, res)) return;
    const { key, value } = req.body || {};
    try {
      const stored = setSetting(key, value);
      res.json({ ok: true, key, value: stored });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  app.post("/api/admin/settings/reset", (req, res) => {
    if (!requireAdmin(req, res)) return;
    resetSettings();
    res.json({ ok: true, settings: listTunables() });
  });

  app.get("/api/admin/stats", (req, res) => {
    if (!requireAdmin(req, res)) return;
    const t = now();
    const day = 24 * 60 * 60 * 1000;
    const stats = {
      users_total: db.prepare("SELECT COUNT(*) AS c FROM users").get().c,
      users_activated: db.prepare("SELECT COUNT(*) AS c FROM users WHERE activated = 1").get().c,
      users_new_7d: db
        .prepare("SELECT COUNT(*) AS c FROM users WHERE created_at >= ?")
        .get(t - 7 * day).c,
      matches_total: db.prepare("SELECT COUNT(*) AS c FROM matches").get().c,
      matches_24h: db
        .prepare("SELECT COUNT(*) AS c FROM matches WHERE created_at >= ?")
        .get(t - day).c,
      matches_7d: db
        .prepare("SELECT COUNT(*) AS c FROM matches WHERE created_at >= ?")
        .get(t - 7 * day).c,
      top_ratings: db
        .prepare(
          "SELECT id, email, rating, wins, losses FROM users WHERE activated = 1 ORDER BY rating DESC LIMIT 10",
        )
        .all(),
      most_active: db
        .prepare(
          `SELECT u.id, u.email, u.rating, u.wins + u.losses AS total_games
           FROM users u WHERE activated = 1
           ORDER BY total_games DESC LIMIT 10`,
        )
        .all(),
      sessions_active: db
        .prepare("SELECT COUNT(*) AS c FROM sessions WHERE expires_at > ?")
        .get(t).c,
    };
    res.json(stats);
  });

  app.get("/api/admin/matches", (req, res) => {
    if (!requireAdmin(req, res)) return;
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit) || 50));
    const offset = Math.max(0, parseInt(req.query.offset) || 0);
    const rows = db
      .prepare(
        `SELECT m.id, m.winner_id, m.loser_id, m.winner_score, m.loser_score,
                m.winner_rating_after, m.loser_rating_after, m.created_at,
                wu.email AS winner_email, lu.email AS loser_email
         FROM matches m
         JOIN users wu ON wu.id = m.winner_id
         JOIN users lu ON lu.id = m.loser_id
         ORDER BY m.created_at DESC
         LIMIT ? OFFSET ?`,
      )
      .all(limit, offset);
    const total = db.prepare("SELECT COUNT(*) AS c FROM matches").get().c;
    res.json({ matches: rows, total });
  });
}
