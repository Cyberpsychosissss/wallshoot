// Runtime-tunable settings. Defaults come from constants.js; admin overrides
// persist to the `settings` table and are loaded on startup.
//
// Game code imports `settings` and reads e.g. `settings.INITIAL_HP` instead of
// hard-coding constants. Changes apply to *future* matches only.

import * as C from "./constants.js";
import { db, now } from "./db.js";

const SCHEMA = {
  INITIAL_HP: { type: "int", min: 10, max: 1000, label: "初始 HP" },
  BULLETS_PER_TURN: { type: "int", min: 1, max: 30, label: "单回合弹药数" },
  DMG_HEAD: { type: "int", min: 1, max: 1000, label: "头部伤害" },
  DMG_TORSO: { type: "int", min: 1, max: 1000, label: "躯干伤害" },
  DMG_LIMB: { type: "int", min: 1, max: 1000, label: "四肢伤害" },
  PREP_SECONDS: { type: "int", min: 0, max: 30, label: "准备期秒数" },
  INITIAL_HOLES_MIN: { type: "int", min: 0, max: 50, label: "初始破洞下限" },
  INITIAL_HOLES_MAX: { type: "int", min: 0, max: 50, label: "初始破洞上限" },
  INITIAL_HOLES_HEAD_ROW_GUARD: { type: "int", min: 0, max: 23, label: "头部行保护下限" },
  BO_BEST_OF: { type: "int", min: 1, max: 9, label: "BO 几胜制" },
  RATING_START: { type: "int", min: 0, max: 100000, label: "初始积分" },
  RATING_ROUND_DELTA: { type: "int", min: 0, max: 500, label: "单局积分变化" },
  RATING_MATCH_DELTA: { type: "int", min: 0, max: 500, label: "整场积分变化" },
};

export const settings = {};
for (const [k, _spec] of Object.entries(SCHEMA)) settings[k] = C[k];

function loadFromDb() {
  const rows = db.prepare("SELECT key, value FROM settings").all();
  for (const r of rows) {
    if (!(r.key in SCHEMA)) continue;
    try {
      settings[r.key] = JSON.parse(r.value);
    } catch {}
  }
}
loadFromDb();

export function setSetting(key, rawValue) {
  const spec = SCHEMA[key];
  if (!spec) throw new Error("not_tunable");
  let value = rawValue;
  if (spec.type === "int") {
    value = Math.trunc(Number(value));
    if (!Number.isFinite(value)) throw new Error("invalid_number");
    if (value < spec.min || value > spec.max) throw new Error("out_of_range");
  }
  settings[key] = value;
  db.prepare(
    "INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
  ).run(key, JSON.stringify(value), now());
  return value;
}

export function listTunables() {
  const out = {};
  for (const [k, spec] of Object.entries(SCHEMA)) {
    out[k] = { value: settings[k], default: C[k], ...spec };
  }
  return out;
}

export function resetSettings() {
  for (const [k, _spec] of Object.entries(SCHEMA)) settings[k] = C[k];
  db.prepare("DELETE FROM settings").run();
}
