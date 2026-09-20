/**
 * Drop columns and an index that nothing reads.
 *
 *   versions.hash        a sha256 over the whole export blob, computed and written on
 *                        every checkpoint. No statement ever selected it.
 *   idx_versions_branch  (person_id, branch, id DESC). Both reads are
 *                        `WHERE person_id = ? ORDER BY id DESC` and
 *                        `WHERE id = ? AND person_id = ?`, so no query can use it,
 *                        and idx_versions_person already covers the first.
 *   tag_events.score     written with every event; the only reader groups by
 *   tag_events.scorer    action and rank alone.
 *
 * `branch`, `parent_id` and `tag` stay: those round-trip through the versions API.
 * Each drop is guarded, so re-running on a database that has already lost the column
 * is a no-op.
 */
module.exports = function migrate(db) {
  const columns = (table) =>
    db
      .prepare(`PRAGMA table_info(${table})`)
      .all()
      .map((c) => c.name);

  db.transaction(() => {
    if (columns('versions').includes('hash')) {
      db.exec('ALTER TABLE versions DROP COLUMN hash');
    }
    db.exec('DROP INDEX IF EXISTS idx_versions_branch');
    for (const col of ['score', 'scorer']) {
      if (columns('tag_events').includes(col)) {
        db.exec(`ALTER TABLE tag_events DROP COLUMN ${col}`);
      }
    }
  })();
};
