/**
 * Per-user résumé-name uniqueness — finishes the deferral called out in migration 018.
 *
 * `persons.name` was globally UNIQUE (migration 002), so two DIFFERENT users couldn't
 * both name a résumé the same — the second account's create hit a UNIQUE violation (a
 * 500). Relax it to UNIQUE(user_id, name): unique within an account, free across
 * accounts. SQLite can't drop a column-level constraint in place, so rebuild the table
 * (the documented ALTER procedure):
 *   - foreign_keys OFF (toggled OUTSIDE the transaction — it's a no-op inside one),
 *   - copy every row into a new table PRESERVING ids, so the ON DELETE CASCADE children
 *     (sections, variants, versions, tags, linkedin_sync, …) stay bound,
 *   - swap the tables, recreate the user index, re-check FKs.
 * Fully guarded + atomic: a row-count mismatch or ANY dangling FK throws inside the
 * transaction → rollback → the boot fails with the OLD table untouched (Railway then
 * keeps the previous healthy deploy). So a bad rebuild can never silently corrupt data.
 */
module.exports = function migrate(db) {
  const before = db.prepare('SELECT COUNT(*) AS n FROM persons').get().n;

  db.pragma('foreign_keys = OFF');
  try {
    db.transaction(() => {
      db.exec(`
        CREATE TABLE persons_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          data JSON NOT NULL DEFAULT '{}',
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          user_id INTEGER REFERENCES users(id),
          UNIQUE (user_id, name)
        )
      `);
      db.exec(`
        INSERT INTO persons_new (id, name, data, created_at, user_id)
        SELECT id, name, data, created_at, user_id FROM persons
      `);
      const after = db.prepare('SELECT COUNT(*) AS n FROM persons_new').get().n;
      if (after !== before) throw new Error(`persons rebuild row mismatch: ${before} → ${after}`);

      db.exec('DROP TABLE persons');
      db.exec('ALTER TABLE persons_new RENAME TO persons');
      db.exec('CREATE INDEX IF NOT EXISTS idx_persons_user ON persons(user_id)');

      const violations = db.pragma('foreign_key_check');
      if (violations.length) {
        throw new Error(`FK violations after persons rebuild: ${JSON.stringify(violations).slice(0, 200)}`);
      }
    })();
  } finally {
    db.pragma('foreign_keys = ON');
  }
};
