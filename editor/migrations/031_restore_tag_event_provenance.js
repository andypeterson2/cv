/**
 * 031 — Put `score` and `scorer` back on tag_events.
 *
 * 021 created both, 025 dropped them because nothing read them. Something does
 * now: which scorer produced an accepted suggestion is how the stock and
 * fine-tuned rankers are compared on real acceptance. The client has been
 * sending both fields the whole time; they were discarded by the validator and
 * by a six-column insert.
 *
 * Three things a reader of these rows needs to know:
 *
 *  - `scorer` names a serving configuration. `embedding` covers cosine blended
 *    with neighbour votes at the blend weight and K in force when the row was
 *    written, so rows either side of a tuning change measure different things.
 *  - A label nobody was shown first is `action = 'manual' AND rank IS NULL`.
 *    A manual row carrying a rank names a tag that was on screen while the
 *    author typed it.
 *  - Scores do not compare across scorers. Lexical is a fuzzy ratio with a
 *    floor; the embedding arms are uncalibrated cosine mixed with vote shares.
 *    A mean score is readable within one scorer and meaningless between two.
 *
 * Rows written before this keep NULL in both columns, which is why the stats
 * report a `null` scorer rather than hiding those rows.
 */
module.exports = function migrate(db) {
  db.transaction(() => {
    // SQLite offers no conditional form of ADD COLUMN, so this check is what
    // makes a second run safe.
    const cols = db
      .prepare('PRAGMA table_info(tag_events)')
      .all()
      .map((c) => c.name);
    if (!cols.includes('score')) db.exec('ALTER TABLE tag_events ADD COLUMN score REAL');
    if (!cols.includes('scorer')) db.exec('ALTER TABLE tag_events ADD COLUMN scorer TEXT');
  })();
};
