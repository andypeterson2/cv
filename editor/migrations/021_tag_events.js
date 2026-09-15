/**
 * 021 — Tag suggestion events: what a person did with each suggestion.
 *
 * One row per accept, dismiss, manual add or removal, with the suggestion's
 * rank, score and scorer when it came from a suggestion. The rows measure how
 * well suggestion works and supply history for tuning it; nothing reads them
 * when resolving variants.
 */
module.exports = function migrate(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS tag_events (
      id         INTEGER PRIMARY KEY,
      person_id  INTEGER NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
      target     TEXT    NOT NULL CHECK (target IN ('entry', 'item')),
      target_id  INTEGER NOT NULL,
      tag        TEXT    NOT NULL,
      action     TEXT    NOT NULL CHECK (action IN ('accept', 'dismiss', 'manual', 'remove')),
      rank       INTEGER,
      score      REAL,
      scorer     TEXT,
      created_at TEXT    NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_tag_events_person ON tag_events (person_id, created_at);
  `);
};
