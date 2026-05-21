import Database from "better-sqlite3";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdirSync } from "node:fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DATA_DIR = join(__dirname, "..", "data");
mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = join(DATA_DIR, "wallshoot.db");
export const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE,
    email_lc TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    activated INTEGER NOT NULL DEFAULT 0,
    activation_token TEXT,
    activation_expires INTEGER,
    created_at INTEGER NOT NULL,
    failed_login_count INTEGER NOT NULL DEFAULT 0,
    locked_until INTEGER NOT NULL DEFAULT 0,
    rating INTEGER NOT NULL DEFAULT 1000,
    wins INTEGER NOT NULL DEFAULT 0,
    losses INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    csrf_token TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

  CREATE TABLE IF NOT EXISTS matches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    winner_id INTEGER NOT NULL REFERENCES users(id),
    loser_id INTEGER NOT NULL REFERENCES users(id),
    winner_score INTEGER NOT NULL,
    loser_score INTEGER NOT NULL,
    winner_rating_after INTEGER NOT NULL,
    loser_rating_after INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_matches_winner ON matches(winner_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_matches_loser ON matches(loser_id, created_at DESC);

  CREATE TABLE IF NOT EXISTS pow_failures (
    ip TEXT PRIMARY KEY,
    count INTEGER NOT NULL DEFAULT 0,
    last_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );
`);

// Sweep orphans + expired sessions on boot — recovers from direct SQL edits
// that may have bypassed ON DELETE CASCADE.
db.prepare("DELETE FROM sessions WHERE user_id NOT IN (SELECT id FROM users)").run();
db.prepare("DELETE FROM sessions WHERE expires_at < ?").run(Date.now());

export function now() {
  return Date.now();
}
