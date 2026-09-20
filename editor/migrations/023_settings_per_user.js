/**
 * Per-user style settings — finishes what migration 018 started.
 *
 * `settings` held one global row per key, so style/spacing/fonts were shared by every
 * account: one PATCH restyled everybody's compiled PDF. Re-key it on (user_id, key) so
 * each account carries its own. SQLite can't add a column to a PRIMARY KEY in place, so
 * rebuild the table the way migration 005 already rebuilt it, with migration 020's
 * guards: a row-count mismatch throws inside the transaction → rollback → the boot
 * fails with the OLD table untouched.
 *
 * FKs stay ON throughout. 020 needs them off because dropping `persons` orphans its
 * cascade children; nothing references `settings`, and leaving them on means the new
 * user_id is checked as it is written.
 *
 * Existing rows are copied to each sentinel account. '@owner' is where they belong;
 * '@system' owns the public demo person, and without its own copy that demo would
 * silently restyle on any database that has style rows.
 */
const LATEX_UNITS = require('../lib/latex-units');

module.exports = function migrate(db) {
  const units = LATEX_UNITS.map((u) => `'${u}'`).join(',');
  const idByRole = db.prepare('SELECT id FROM users WHERE role = ? ORDER BY id LIMIT 1');
  const ownerId = idByRole.get('owner')?.id;
  const systemId = idByRole.get('system')?.id;
  if (ownerId == null || systemId == null) {
    throw new Error('023 needs the sentinel accounts from 018 (owner + system)');
  }
  const targets = [...new Set([ownerId, systemId])];
  const before = db.prepare('SELECT COUNT(*) AS n FROM settings').get().n;

  db.transaction(() => {
    db.exec(`
      CREATE TABLE settings_new (
        user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        key          TEXT    NOT NULL,
        value        TEXT,
        value_num    REAL,
        value_unit   TEXT CHECK(value_unit IS NULL OR value_unit IN (${units})),
        value_legacy TEXT,
        PRIMARY KEY (user_id, key)
      ) WITHOUT ROWID
    `);
    const copy = db.prepare(`
      INSERT INTO settings_new (user_id, key, value, value_num, value_unit, value_legacy)
      SELECT ?, key, value, value_num, value_unit, value_legacy FROM settings
    `);
    for (const uid of targets) copy.run(uid);

    const after = db.prepare('SELECT COUNT(*) AS n FROM settings_new').get().n;
    const expected = before * targets.length;
    if (after !== expected) {
      throw new Error(`settings rebuild row mismatch: ${before} x ${targets.length} -> ${after}`);
    }

    db.exec('DROP TABLE settings');
    db.exec('ALTER TABLE settings_new RENAME TO settings');

    const violations = db.pragma('foreign_key_check');
    if (violations.length) {
      throw new Error(
        `FK violations after settings rebuild: ${JSON.stringify(violations).slice(0, 200)}`,
      );
    }
  })();
};
