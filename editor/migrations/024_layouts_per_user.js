/**
 * Per-user layouts — the other half of the ownership gap migration 018 left open.
 *
 * `layouts` had no owner column, so every account could list, replace and delete every
 * other account's uploaded bundle, and set the default they all compile with. Add the
 * owner. Builtin bundles keep `user_id IS NULL`, which is what makes them visible to
 * everyone; uploads belong to whoever installed them.
 *
 * Additive, following 018: `layouts.id` stays a single-column primary key and
 * `variants.layout_id` stays a single-column FK. A composite key is not available here
 * — the table is WITHOUT ROWID, where primary-key columns are implicitly non-null, so
 * a builtin could not hold a null owner. New uploads are instead stored under an id
 * the app namespaces per user, so two accounts can install the same manifest id.
 *
 * Existing upload rows keep the ids and directories they already have. Renaming them
 * would mean moving bundle directories from inside a migration, and it is not needed:
 * what a caller may reach is decided by the user_id column, never by the id's shape.
 *
 * The last statement severs a variant bound to a layout its person's owner cannot see.
 * Such a row can only predate this migration, and leaving it would let that variant
 * compile with another account's templates.
 */
module.exports = function migrate(db) {
  const ownerId = db
    .prepare("SELECT id FROM users WHERE role = 'owner' ORDER BY id LIMIT 1")
    .get()?.id;
  if (ownerId == null) throw new Error('024 needs the owner account from 018');

  const cols = db
    .prepare('PRAGMA table_info(layouts)')
    .all()
    .map((c) => c.name);

  db.transaction(() => {
    if (!cols.includes('user_id')) {
      db.exec('ALTER TABLE layouts ADD COLUMN user_id INTEGER REFERENCES users(id)');
    }
    db.exec('CREATE INDEX IF NOT EXISTS idx_layouts_user ON layouts(user_id)');
    db.exec("UPDATE layouts SET user_id = NULL WHERE source = 'builtin'");
    db.prepare("UPDATE layouts SET user_id = ? WHERE source <> 'builtin'").run(ownerId);

    db.exec(`
      UPDATE variants SET layout_id = NULL
      WHERE layout_id IS NOT NULL
        AND layout_id IN (SELECT id FROM layouts WHERE user_id IS NOT NULL)
        AND (SELECT user_id FROM persons WHERE persons.id = variants.person_id)
         IS NOT (SELECT user_id FROM layouts WHERE layouts.id = variants.layout_id)
    `);
  })();
};
