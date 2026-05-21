import { db, now } from "./db.js";
import { RATING_ROUND_DELTA, RATING_MATCH_DELTA } from "./constants.js";

export function recordMatch({ winnerId, loserId, winnerScore, loserScore }) {
  const delta =
    winnerScore * RATING_ROUND_DELTA -
    loserScore * RATING_ROUND_DELTA +
    RATING_MATCH_DELTA;

  const winner = db
    .prepare("SELECT rating, wins, losses FROM users WHERE id = ?")
    .get(winnerId);
  const loser = db
    .prepare("SELECT rating, wins, losses FROM users WHERE id = ?")
    .get(loserId);
  if (!winner || !loser) return null;

  const winnerNew = winner.rating + delta;
  const loserNew = loser.rating - delta;

  const tx = db.transaction(() => {
    db.prepare(
      "UPDATE users SET rating = ?, wins = wins + 1 WHERE id = ?",
    ).run(winnerNew, winnerId);
    db.prepare(
      "UPDATE users SET rating = ?, losses = losses + 1 WHERE id = ?",
    ).run(loserNew, loserId);
    db.prepare(
      `INSERT INTO matches (winner_id, loser_id, winner_score, loser_score,
                            winner_rating_after, loser_rating_after, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(winnerId, loserId, winnerScore, loserScore, winnerNew, loserNew, now());
  });
  tx();

  return { winnerNew, loserNew, delta };
}
