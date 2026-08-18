/**
 * Per-user compile quota (multi-user cost control).
 *
 * Each xelatex compile spawns a LaTeX process for up to ~30s — the one real
 * cost/DoS lever now that any signed-in Google user can compile their own CV.
 * The per-IP rate limit + shared concurrency cap bound BURST; this table bounds
 * TOTAL compiles per user per UTC day, so one account can't run up unbounded
 * compile cost even while staying under the burst limit. The owner is exempt in
 * the app layer, so only metered accounts ever write rows here.
 */
module.exports = function migrate(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS compile_usage (
      user_id INTEGER NOT NULL,
      day     TEXT    NOT NULL,
      count   INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (user_id, day)
    )
  `);
};
