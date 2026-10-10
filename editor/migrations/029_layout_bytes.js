/**
 * Records how much disk each uploaded layout bundle uses, so an account's storage
 * quota can count its layouts without walking the store on every write.
 */
module.exports = function migrate(db) {
  const cols = db
    .prepare('PRAGMA table_info(layouts)')
    .all()
    .map((c) => c.name);
  if (!cols.includes('bytes'))
    db.exec('ALTER TABLE layouts ADD COLUMN bytes INTEGER NOT NULL DEFAULT 0');
  const { uploadedLayoutDir } = require('../lib/render/layouts');
  const { dirBytes } = require('../lib/render/bundle');
  const set = db.prepare('UPDATE layouts SET bytes = ? WHERE id = ?');
  for (const row of db.prepare("SELECT id FROM layouts WHERE source = 'upload'").all()) {
    set.run(dirBytes(uploadedLayoutDir(row.id)), row.id);
  }
};
