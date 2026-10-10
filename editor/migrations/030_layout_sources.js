/**
 * GitHub sources for layouts. A linked layout family records the public repository
 * it comes from, the folder inside it, and whether it follows the latest release or
 * a branch; the daily sync and "check now" compare the commit there with `last_sha`.
 * `shared` is set once the author publishes, and `trusted` once the owner approves,
 * after which new versions that pass every check go public without another review.
 * Version rows record the commit and ref they were built from.
 */
module.exports = function migrate(db) {
  db.transaction(() => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS layout_sources (
        family           TEXT    PRIMARY KEY,
        user_id          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        repo_owner       TEXT    NOT NULL,
        repo_name        TEXT    NOT NULL,
        path             TEXT    NOT NULL DEFAULT '',
        track            TEXT    NOT NULL CHECK (track IN ('release', 'branch')),
        branch           TEXT,
        last_sha         TEXT,
        last_ref         TEXT,
        etag             TEXT,
        last_checked_at  TEXT,
        last_error       TEXT,
        shared           INTEGER NOT NULL DEFAULT 0,
        trusted          INTEGER NOT NULL DEFAULT 0,
        manual_synced_at INTEGER,
        created_at       TEXT    NOT NULL DEFAULT (datetime('now'))
      )
    `);
    db.exec('CREATE INDEX IF NOT EXISTS idx_layout_sources_user ON layout_sources(user_id)');
    const cols = db
      .prepare('PRAGMA table_info(layouts)')
      .all()
      .map((c) => c.name);
    if (!cols.includes('source_sha')) db.exec('ALTER TABLE layouts ADD COLUMN source_sha TEXT');
    if (!cols.includes('source_ref')) db.exec('ALTER TABLE layouts ADD COLUMN source_ref TEXT');
  })();
};
